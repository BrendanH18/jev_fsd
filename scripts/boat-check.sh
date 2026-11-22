#!/usr/bin/env bash
# Run checks in this worktree's own long-lived Boat sandbox.
#
#   scripts/boat-check.sh            lint, Python tests, offline Jev requests, fixture check
#   scripts/boat-check.sh --full     also every scripts/test_*.mjs, in parallel (scripts/node_checks.mjs)
#   scripts/boat-check.sh -- CMD...  run CMD in the checkout instead
#   scripts/boat-check.sh --save     rebuild the warm snapshot jev-fsd-warm from origin's default
#                                    branch, in a fresh sandbox that runs no worktree code
#   scripts/boat-check.sh --status   show this worktree's sandbox
#   scripts/boat-check.sh --stop     stop it (the next check resumes it)
#   scripts/boat-check.sh --done     delete it; run this when the agent's work ends
#
# The first check creates a sandbox from jev-fsd-warm (Node 22, uv, Python, Biome and a clone
# of the repository with its dependencies), or a bare one when there is no snapshot, and
# records its id in this worktree's git directory. Later checks reuse it: each makes the clone at
# /home/user/jev_fsd match the working tree exactly (deleted files gone, untracked non-ignored
# files in, ignored ones such as .env never sent, git's index included) and runs there with
# `boat exec --timeout 0`. One sandbox per worktree; agents sharing a worktree each set
# JEV_BOAT_SLOT.
#
# Only what changed since the last check goes (2026-11-21): the working tree's git tree, from a
# private index, is compared with the tree last sent to this sandbox, and only the changed files
# travel, in boat exec's arguments up to 72 KB or as one pushed tarball (a one-line edit: 2 s for
# the whole run instead of 8 s for the push alone). The sandbox checks that its index gives the
# old tree before applying the change and the new one after; a new sandbox, a missing record or
# a mismatch sends every file (an 8 s tarball push; 8 to 22 s before).
#
# Sizes (owner decision, 2026-11-21, measured in docs/reference/development.md#boat-checks):
# --full runs on xlarge (16 vCPUs) with one Node check per vCPU (JEV_BOAT_JOBS); the plain check
# and -- CMD run on default (4 vCPUs), which they gain nothing over. A sandbox of the other size
# is stopped and resumed at this run's size (one start).
#
# Stopping (owner decision, 2026-11-22): every size stops as soon as its check ends, whatever
# happened to it. A stopped sandbox bills nothing, and Boat keeps its machine for 10 minutes
# after it reads stopped, unbilled: a resume in that time, or while it is still stopping, usually
# takes the machine back with no restore and no start. Boat can release the machine early; the
# resume then restores from the snapshot on a new machine and counts as a start. Boat's auto-stop is a deadline, not an idle
# timer, so while a check runs it is kept 30 minutes ahead, renewed every 10 minutes by a loop
# that ends with this script; a run killed outright leaves a sandbox that stops itself within
# 30 minutes. Overrides: JEV_BOAT_TYPE (the size, for every mode), JEV_BOAT_JOBS, JEV_BOAT_IDLE
# (seconds of auto-stop left when the check ends; default 0, stop at once), JEV_BOAT_SNAPSHOT.
main() {
set -euo pipefail
export BOAT_NO_UPDATE=1
snapshot=${JEV_BOAT_SNAPSHOT:-jev-fsd-warm}
type=${JEV_BOAT_TYPE:-}   # empty: full_type for --full, default for everything else
full_type=xlarge
idle=${JEV_BOAT_IDLE:-0}   # 0: stop the sandbox when the check ends
slot=${JEV_BOAT_SLOT:-main}
jobs=${JEV_BOAT_JOBS:-}   # --full's parallel Node checks; empty means one per vCPU
budget=1800   # auto-stop is kept this far ahead while a check runs,
renew=600     # renewed this often, so a killed run's sandbox stops within $budget seconds
clone_url=${JEV_BOAT_CLONE_URL:-https://github.com/BrendanH18/jev_fsd.git}
mode=checks action=run cmd=""
while [ $# -gt 0 ]; do
    case "$1" in
        --full) mode=full ;;
        --save|--status|--stop|--done) action=${1#--} ;;
        --) shift
            [ $# -gt 0 ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            if [ $# -eq 1 ]; then cmd=$1; else cmd=$(printf '%q ' "$@"); fi
            [ -n "$cmd" ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            mode=cmd
            break ;;
        -h|--help) sed -n '2,/^main()/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
        *) echo "boat-check: unknown option $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done
[ "$action" = run ] || [ "$mode" = checks ] || { echo "boat-check: --$action takes no --full or command" >&2; exit 2; }
[ -n "$type" ] || { if [ "$mode" = full ]; then type=$full_type; else type=default; fi; }
case "$type" in small|default|large|xlarge) ;; *) echo "boat-check: JEV_BOAT_TYPE is small, default, large or xlarge" >&2; exit 2 ;; esac
case "$idle" in *[!0-9]*|"") echo "boat-check: JEV_BOAT_IDLE is a number of seconds (0 stops the sandbox when the check ends)" >&2; exit 2 ;; esac
case "$slot" in *[!A-Za-z0-9_-]*|"") echo "boat-check: JEV_BOAT_SLOT may use letters, digits, - and _" >&2; exit 2 ;; esac
case "$jobs" in ""|[1-9]|[1-9][0-9]) ;; *) echo "boat-check: JEV_BOAT_JOBS is a whole number from 1 to 99" >&2; exit 2 ;; esac
case "$cmd" in
    *verify_jev.py*)
        case "$cmd" in *--offline*) ;; *)
            echo "boat-check: live verify_jev.py runs cost credits; they run only when the owner asks, in their own jev-fsd-live sandbox (AGENTS.md), never here. Use --offline." >&2
            exit 2 ;;
        esac ;;
esac
for tool in boat jq git; do
    command -v "$tool" >/dev/null || { echo "boat-check: $tool is not installed" >&2; exit 2; }
done
cd "$(git rev-parse --show-toplevel)"
state_dir=$(git rev-parse --path-format=absolute --git-path boat-check)
mkdir -p "$state_dir"
id_file=$state_dir/sandbox-$slot
lock=$state_dir/lock-$slot
name="jev-fsd-check-$(basename "$PWD" | tr -c 'A-Za-z0-9_\n-' '-' | cut -c1-80)-$slot"

id=$(cat "$id_file" 2>/dev/null || true)
armed=0 keepalive="" build="" saving=0 locked=0 stage="" start_log=""
base="" tree="" files_b64="" paths_b64=""   # what run_remote syncs; send sets them
# shellcheck disable=SC2317  # this and the functions below run from the exit trap
stop_keepalive() {   # the keepalive loop and its sleep
    [ -n "$keepalive" ] || return 0
    pkill -P "$keepalive" 2>/dev/null || true
    kill "$keepalive" 2>/dev/null || true
    keepalive=""
}
# The sandbox a create this run started was making, from the create's JSON Lines (fast_start
# writes them to $start_log as they come), when the run ended before it recorded the id.
# shellcheck disable=SC2317
started_id() {
    [ -n "$start_log" ] && [ -s "$start_log" ] || return 0
    jq -rR 'fromjson? | objects | select(.event != "error") | (.id // .sandboxId // .sandbox.id // empty) | strings' \
        "$start_log" 2>/dev/null | head -n 1
}
# Stop sandbox $1, or with JEV_BOAT_IDLE leave its auto-stop that many seconds ahead. Quiet when
# it is already stopping, stopped or gone (an id Boat no longer knows).
# shellcheck disable=SC2317
wind_down() {
    local now
    if [ "$idle" = 0 ]; then
        boat stop "$1" --json >/dev/null 2>&1 && return 0
    else
        boat extend "$1" --ttl "$idle" --json >/dev/null 2>&1 && return 0
    fi
    now=$(sandbox_state "$1" 2>/dev/null) || now=unknown
    case "$now" in stopping|stopped|gone) return 0 ;; esac
    echo "boat-check: couldn't stop $1 ($now): boat stop $1" >&2
}
# shellcheck disable=SC2317
cleanup() {
    set +e
    stop_keepalive
    # The check sandbox stops (or keeps $idle seconds of auto-stop) whatever happened to the check;
    # this is armed before any create or resume. A sandbox this run created but never recorded (the
    # run ended during the create) is deleted: nothing on it is worth a resume.
    if [ "$armed" = 1 ]; then
        [ -n "$id" ] || id=$(started_id)
        if [ -n "$id" ] && [ "$id" != "$(cat "$id_file" 2>/dev/null)" ]; then
            boat delete "$id" --yes --json >/dev/null 2>&1 \
                || echo "boat-check: couldn't delete $id, which this run was creating: boat delete $id --yes" >&2
            id=""
        fi
        [ -z "$id" ] || wind_down "$id"
    fi
    # The --save build sandbox is deleted, even when the run ended while creating it, or only
    # stopped while a save from it may still be running (an unfinished save needs its source; a
    # stopped sandbox costs nothing).
    if [ "$action" = save ] && [ -z "$build" ]; then build=$(started_id); fi
    if [ -n "$build" ]; then
        if [ "$saving" = 1 ]; then
            if boat stop "$build" --json >/dev/null 2>&1; then
                echo "boat-check: stopped the build sandbox $build; once boat snapshots shows $snapshot ready from it: boat delete $build --yes" >&2
            else
                echo "boat-check: couldn't stop the build sandbox $build: boat stop $build; once boat snapshots shows $snapshot ready from it: boat delete $build --yes" >&2
            fi
        else
            boat delete "$build" --yes --json >/dev/null 2>&1 || echo "boat-check: delete the build sandbox: boat delete $build --yes" >&2
        fi
    fi
    [ -z "$stage" ] || rm -rf "$stage"
    [ -z "$start_log" ] || rm -f "$start_log"
    [ "$locked" = 0 ] || rm -rf "$lock"   # only a lock this run took
}
trap cleanup EXIT
trap 'exit 130' INT TERM
# One run at a time per slot, so two checks never race to create the slot's sandbox. Only
# `mkdir` takes the lock, and the exit trap (set above, before the lock is taken) releases it
# only when this run took it. A lock a killed run left behind is reported with its path, never
# taken over, so no run can remove a lock another run holds.
if ! mkdir "$lock" 2>/dev/null; then
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
        echo "boat-check: a boat-check that has ended (pid $holder) left its lock; remove $lock and run again" >&2
    else
        echo "boat-check: another boat-check (pid ${holder:-starting}) holds this worktree's sandbox lock; wait for it, or give this agent its own JEV_BOAT_SLOT. If no boat-check is running, remove $lock" >&2
    fi
    exit 2
fi
locked=1
echo $$ > "$lock/pid"
start_log=$(mktemp)

# look ID sets state to the sandbox's state, or "gone" when Boat no longer knows it, and size to
# its machine size. Any other failure (network, auth, rate limit) is an error, so a passing hiccup
# never orphans a sandbox or spends a start.
look() {
    local out
    state="" size=""
    if out=$(boat info "$1" --json 2>&1); then
        # An answer jq can't read is an error too, never an empty state that would make a new sandbox.
        if state=$(printf '%s\n' "$out" | jq -er '.sandbox.state // "unknown"') \
            && size=$(printf '%s\n' "$out" | jq -r '.sandbox.type // ""'); then
            return 0
        fi
        state="" size=""
        echo "boat-check: couldn't read sandbox $1 from Boat's answer: $out" >&2
        return 1
    fi
    case "$out" in *'"not_found"'*) state=gone; return 0 ;; esac
    echo "boat-check: couldn't read sandbox $1 from Boat: $out" >&2
    return 1
}
sandbox_state() { look "$1" || return 1; echo "$state"; }   # in a subshell, so the caller's state stays

# Each create or resume uses one of the account's daily starts; reusing a running sandbox uses none.
start_failed() {
    case "$2" in *no_ready_machine*)
        echo "boat-check: $1: Boat had no machine ready after a minute of tries; nothing started and no start was counted. Try again later." >&2
        exit 3 ;;
    esac
    echo "boat-check: $1 failed:" >&2
    local why
    why=$(printf '%s\n' "$2" | jq -r 'select(.event == "error") | .error' 2>/dev/null || true)
    printf '%s\n' "${why:-$2}" >&2
    echo "boat-check: boat limits shows the starts left today; tell the owner rather than retrying" >&2
    exit 3
}
# With --fail-fast, a start that finds no ready machine creates nothing and isn't counted against
# the start limits, so retry it a few times. A failed attempt can leave Boat finishing a resume for
# a moment ("resume already in progress"), which a retry also waits out. A resume while the
# sandbox is stopping takes its machine back; when Boat can't (sandbox_stopping), the stop is
# waited out for up to two minutes and the resume then takes back the machine Boat keeps.
# The output goes to $start_log as it comes, so the exit trap can find a sandbox a cut-short
# create was making.
fast_start() {   # fast_start WHAT boat ARGS...; leaves the output in $out
    local what=$1 attempt=1 waits=0
    shift
    while :; do
        if "$@" --fail-fast --json >"$start_log" 2>&1; then out=$(cat "$start_log"); return 0; fi
        out=$(cat "$start_log")
        case "$out" in
            *sandbox_stopping*)
                waits=$((waits + 1))
                [ "$waits" -le 24 ] || return 1
                [ "$waits" != 1 ] || echo "boat-check: Boat couldn't take $what back while it stops; trying again once it has stopped" >&2
                sleep 5; continue ;;
            *no_ready_machine*) [ "$attempt" = 6 ] || echo "boat-check: no machine ready for $what; trying again in 10 s" >&2 ;;
            *"already in progress"*) [ "$attempt" = 6 ] || echo "boat-check: Boat is still busy with $what; trying again in 10 s" >&2 ;;
            *) return 1 ;;
        esac
        [ "$attempt" -lt 6 ] || return 1
        attempt=$((attempt + 1))
        sleep 10
    done
}
new_sandbox() {   # new_sandbox NAME [boat new ARGS...]: prints the new sandbox's id
    local sandbox_name=$1 new_id
    shift
    # --no-env: no GitHub token, agent logins or model keys, so no check can spend credits.
    fast_start "a new sandbox" boat new --no-env --type "$type" --ttl "$budget" --name "$sandbox_name" "$@" \
        || start_failed "creating a sandbox" "$out"
    new_id=$(printf '%s\n' "$out" | jq -r 'select(.event == "ready") | .id' 2>/dev/null | head -n 1)
    [ -n "$new_id" ] || start_failed "creating a sandbox" "$out"
    echo "$new_id"
}

# Runs in the sandbox as `bash -c`: $1 mode (checks, full, cmd or build), $2 push directory
# (empty: the files come in $8 and $9), $3 command, $4 clone URL, $5 how many Node checks --full
# runs at once (empty: one per vCPU), $6 base tree (empty: every file is sent), $7 the working
# tree's git tree, $8 and $9 files.tgz and paths in base64.
# shellcheck disable=SC2016
remote='set -euo pipefail
mode=$1 push=$2 cmd=$3 clone_url=$4 jobs=${5:-} base=${6:-} tree=${7:-} files_b64=${8:-} paths_b64=${9:-}
repo=/home/user/jev_fsd
export PATH="$HOME/.local/node22/bin:$HOME/.local/bin:$PATH"
say() { echo "boat-check: $*" >&2; }
# A check whose CLI was killed may still be running here; wait for it rather than pull its tree away.
exec 9>"$HOME/.boat-check.lock"
flock -w 900 9 || { say "an earlier check is still running in this sandbox; try again later"; exit 2; }

# Toolchain: already in the warm snapshot, installed here on a bare sandbox.
if ! node --version 2>/dev/null | grep -q "^v22\."; then
    say "installing Node 22"
    arch=$(uname -m); case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
    dist=https://nodejs.org/dist/latest-v22.x
    line=$(curl -fsSL "$dist/SHASUMS256.txt" | grep -E " node-v22\.[0-9.]+-linux-$arch\.tar\.gz$")
    tmp=$(mktemp -d)
    curl -fsSL -o "$tmp/${line##* }" "$dist/${line##* }"
    (cd "$tmp" && printf "%s\n" "$line" | sha256sum -c --quiet)
    rm -rf "$HOME/.local/node22"; mkdir -p "$HOME/.local/node22"
    tar -xzf "$tmp/${line##* }" -C "$HOME/.local/node22" --strip-components=1
    rm -rf "$tmp"
fi
if ! command -v uv >/dev/null; then
    say "installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
fi
[ -d "$repo/.git" ] || { say "cloning the repository"; git clone -q "$clone_url" "$repo"; }
deps() {   # Biome when the lock file changed, and the Python environment
    if ! cmp -s package-lock.json node_modules/.boat-check-lock; then
        npm ci --no-audit --no-fund --loglevel=error
        cp package-lock.json node_modules/.boat-check-lock
    fi
    uv sync --locked --quiet
    say "node $(node --version), $(uv run --locked python --version), $(nproc) vCPUs ($(lscpu | sed -n "s/^Model name:[[:space:]]*//p"))"
}

if [ "$mode" = build ]; then   # --save: the default branch and its dependencies, nothing else
    cd "$repo"
    git fetch -q origin
    git reset -q --hard "$(git rev-parse -q --verify origin/HEAD || git rev-parse --verify origin/main)"
    git clean -fdqx -e node_modules -e .venv
    deps
    exit 0
fi

# Make the clone match the working tree exactly, git index included, so `git ls-files` lists the
# same files as on the computer that ran the script. $push/files.tgz holds the files: all of
# them, or with a base tree only those changed since it, with $push/paths listing every changed
# or deleted path (a small change comes in the arguments instead of a push). The index of the clone
# is the tree last synced; `git write-tree` must give the base tree before a change is applied
# and the wanted tree after, or the script asks for the whole tree (exit 75 and a marker file);
# a whole tree that does not match stops the run before any check.
t_sync=$SECONDS
mkdir -p /home/user/push
find /home/user/push -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} + 2>/dev/null || true
rm -f "$HOME/.boat-check-resync"
if [ -z "$push" ]; then
    push=$(mktemp -d /home/user/push/inline-XXXXXX)
    printf %s "$files_b64" | base64 -d >"$push/files.tgz"
    printf %s "$paths_b64" | base64 -d >"$push/paths"
fi
cd "$repo"
untar() { tar -xzf "$push/files.tgz" --warning=no-unknown-keyword; }
junk() { git clean -ffdqx -e /node_modules -e /.venv; }   # untracked and ignored files, empty directories
watch_all() {   # no index entry may hide a working tree change from git (assume-unchanged, skip-worktree)
    local flag
    for flag in --no-assume-unchanged --no-skip-worktree; do
        git ls-files -v -z | perl -0ne "print substr(\$_, 2) if /^[a-zS] /" | git update-index "$flag" -z --stdin
    done
}
if [ -n "$base" ]; then
    # Undo what earlier checks left: their files, and changes to tracked ones.
    watch_all || true
    junk
    git diff-files -z --name-only | git checkout-index -f -u -z --stdin || true
    git update-index -q --refresh || true
    if [ "$(git write-tree 2>/dev/null)" != "$base" ] || ! git diff-files --quiet; then
        say "the tree here is not the one last pushed to this sandbox; pushing every file"
        touch "$HOME/.boat-check-resync"; exit 75
    fi
    xargs -0r rm -rf -- <"$push/paths"
    junk
    untar
    # A refusal (such as a file under a directory that became a symlink) fails the tree check below.
    git update-index --add --remove --replace -z --stdin <"$push/paths" || true
else
    # Replace everything but .git and the installed dependencies.
    find "$repo" -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules ! -name .venv -exec rm -rf {} +
    untar
    git read-tree --empty
    find . \( -path ./.git -o -path ./node_modules -o -path ./.venv \) -prune -o \( -type f -o -type l \) -printf "%P\0" \
        | git --literal-pathspecs add -f --pathspec-from-file=- --pathspec-file-nul
fi
rm -rf "$push"
if [ "$(git write-tree)" != "$tree" ]; then
    if [ -n "$base" ]; then
        say "the changed files did not give the working tree here; pushing every file"
        touch "$HOME/.boat-check-resync"; exit 75
    fi
    say "the files sent do not give the working tree here (an export-ignore or export-subst attribute, or a git setting such as core.autocrlf on the computer that sent them), so no check ran"
    exit 2
fi
deps
say "tree and dependencies ready in $((SECONDS - t_sync)) s"

status=0
case "$mode" in
    cmd) ( eval "$cmd" ) || status=$? ;;
    *)
        failed=() times=()
        step() {
            local t0=$SECONDS
            say "== $1"
            if ! ( eval "$2" ); then failed+=("$1"); fi
            times+=("$((SECONDS - t0)) s  $1")
        }
        python_tests="JEV_REQUIRE_NODE=1 uv run --locked python -m unittest discover -s tests"
        step "lint and format" "uv run --locked ruff check && uv run --locked ruff format --check && npm run lint"
        [ "$mode" = full ] || step "Python tests" "$python_tests"
        step "offline Jev requests" "uv run --locked scripts/verify_jev.py --offline"
        step "Jev fixtures" "node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check"
        if [ "$mode" = full ]; then
            # The Python tests run alongside the Node checks, and their output is printed after them.
            say "== Python tests (alongside the Node checks)"
            py_log=$(mktemp)
            ( t0=$SECONDS rc=0; ( eval "$python_tests" ) >"$py_log" 2>&1 || rc=$?
              echo "$((SECONDS - t0))" >"$py_log.s"; exit "$rc" ) &
            py_pid=$!
            step "Node checks" "node scripts/node_checks.mjs --jobs ${jobs:-$(nproc)} --timeout 360"
            py_rc=0; wait "$py_pid" || py_rc=$?
            say "== Python tests (output)"; cat "$py_log" >&2
            [ "$py_rc" = 0 ] || failed+=("Python tests")
            times+=("$(cat "$py_log.s" 2>/dev/null || echo "?") s  Python tests (alongside the Node checks)")
            rm -f "$py_log" "$py_log.s"
        fi
        say "times:"; printf "  %s\n" "${times[@]}" >&2
        if [ "${#failed[@]}" -gt 0 ]; then
            say "failed:"; printf "  %s\n" "${failed[@]}" >&2
            status=1
        else
            say "all checks passed"
        fi ;;
esac
exit "$status"'

# `boat exec` prints JSON frames whenever its output isn't a terminal, so ask for them always and
# turn them back into the command's stdout, stderr and exit code. Each frame's text travels as
# one base64 line, so partial lines and control characters survive.
frames() {
    jq -rR --unbuffered '(fromjson? // {type: "text", data: (. + "\n")})
        | if .type == "stdout" then "O" + (.data | @base64)
          elif .type == "stderr" or .type == "text" then "E" + (.data | @base64)
          elif .type == "exit" then "X\(.exitCode // 1)"
          elif .event == "error" then "E" + ("boat: \(.error)\n" | @base64)
          else empty end'
}
unframe() {
    local line rc=""
    while IFS= read -r line; do
        case "$line" in
            O*) printf '%s' "${line#O}" | base64 -d ;;
            E*) printf '%s' "${line#E}" | base64 -d >&2 ;;
            X*) rc=${line#X} ;;
        esac
    done
    [ -n "$rc" ] || return 255
    return "$rc"
}
# keep_alive ID: from now until the exit trap, push sandbox ID's auto-stop back to $budget seconds
# every $renew seconds, so a long check (its push, run and any resync) never reaches it. The loop
# checks that this script ($$, also in the subshell) is still alive before each renewal, so a run
# killed outright (no exit trap) leaves at most $budget seconds of auto-stop.
keep_alive() {
    stop_keepalive
    # Its own stdio, so its sleep never holds the caller's output pipe open after the script ends.
    ( while sleep "$renew"; do
          kill -0 $$ 2>/dev/null || exit 0
          # set -e carries into the subshell: one failed renewal (a network blip) must not end the loop.
          boat extend "$1" --ttl "$budget" --json >/dev/null 2>&1 || true
      done ) </dev/null >/dev/null 2>&1 &
    keepalive=$!
}
# run_remote ID MODE PUSH CMD: run the remote script in sandbox ID and return its exit code. The
# files to sync come from send (base, tree, files_b64, paths_b64).
run_remote() {
    local codes rc
    set +e
    boat exec "$1" --timeout 0 --json -- bash -c "$remote" boat-check "$2" "$3" "$4" "$clone_url" "$jobs" \
        "$base" "$tree" "$files_b64" "$paths_b64" | frames | unframe
    codes=("${PIPESTATUS[@]}")
    set -e
    rc=${codes[2]}
    if [ "$rc" = 255 ]; then   # no exit frame: the CLI failed before or while running the command
        rc=${codes[0]}
        [ "$rc" != 0 ] || rc=1
        echo "boat-check: boat exec ended without the command's exit code (exit ${codes[0]})" >&2
    fi
    return "$rc"
}

case "$action" in
    save)
        # A fresh bare sandbox that runs no worktree code, so nothing a check or custom command
        # changed on a check sandbox's disk reaches later sandboxes. Uses one start.
        echo "boat-check: building $snapshot from origin's default branch in a fresh sandbox" >&2
        build=$(new_sandbox "$snapshot-build")
        keep_alive "$build"
        run_remote "$build" build "" "" || { echo "boat-check: the build failed, so $snapshot was not saved" >&2; exit 1; }
        # The save runs in the background. Wait for this sandbox's save of the name
        # (sourceSandboxId) to read ready; an older save of the name doesn't count.
        echo "boat-check: saving $build as $snapshot" >&2
        saving=1
        boat snapshot "$build" "$snapshot" >/dev/null || { echo "boat-check: saving $snapshot failed" >&2; exit 1; }
        deadline=$((SECONDS + 600)) status=""
        while :; do   # poll once more after the deadline before giving up
            status=$(boat snapshots --json 2>/dev/null | jq -r --arg n "$snapshot" --arg id "$build" \
                '[.named[]? | select(.name == $n and .sourceSandboxId == $id) | .status][0] // ""' || true)
            case "$status" in ready|failed) break ;; esac
            [ "$SECONDS" -lt "$deadline" ] || break
            sleep 5
        done
        case "$status" in
            ready) echo "boat-check: saved $snapshot" >&2; saving=0; exit 0 ;;   # the exit trap deletes the build sandbox
            failed) echo "boat-check: saving $snapshot failed (boat snapshots shows why)" >&2; saving=0; exit 1 ;;
            *) echo "boat-check: $snapshot isn't ready after about 10 minutes" >&2; exit 1 ;;
        esac ;;
    status)
        if [ -z "$id" ]; then echo "boat-check: no sandbox for this worktree (slot $slot)"; exit 0; fi
        echo "boat-check: $id ($(sandbox_state "$id" || echo unknown))"
        boat info "$id"
        exit 0 ;;
    stop)
        [ -n "$id" ] || { echo "boat-check: no sandbox for this worktree (slot $slot)" >&2; exit 0; }
        boat stop "$id" --json >/dev/null || { echo "boat-check: couldn't stop $id: boat stop $id" >&2; exit 1; }
        echo "boat-check: stopped $id"
        exit 0 ;;
    done)
        [ -n "$id" ] || { echo "boat-check: no sandbox for this worktree (slot $slot)" >&2; exit 0; }
        if boat delete "$id" --yes --json >/dev/null 2>&1 || [ "$(sandbox_state "$id")" = gone ]; then
            rm -f "$id_file"; id=""
            echo "boat-check: deleted this worktree's sandbox"
            exit 0
        fi
        echo "boat-check: couldn't delete $id: boat delete $id --yes" >&2
        exit 1 ;;
esac

# Find this slot's sandbox and get it running, or make one. From here on the exit trap stops it
# (or deletes one this run was still creating), however the run ends.
armed=1
t0=$SECONDS
state="" size=""
if [ -n "$id" ]; then
    look "$id" || { echo "boat-check: try again once Boat answers" >&2; exit 1; }
fi
# A sandbox of another size is stopped and resumed at this run's size (one start, as any resume).
# Such a resume always starts a new machine and must wait until the sandbox reads stopped.
case "$state" in provisioned|cloning|ready|idle|running|stopping|stopped)
    [ -n "$size" ] || { echo "boat-check: couldn't read the size of $id from Boat; try again once Boat answers" >&2; exit 1; }
    if [ "$size" != "$type" ]; then
        if [ "$state" != stopped ]; then echo "boat-check: $id is $size; stopping it to resume as $type" >&2; fi
        if [ "$state" != stopped ] && [ "$state" != stopping ]; then
            boat stop "$id" --json >/dev/null || { echo "boat-check: couldn't stop $id: boat stop $id" >&2; exit 1; }
        fi
        for _ in $(seq 1 24); do
            state=$(sandbox_state "$id") || exit 1
            [ "$state" = stopping ] || break
            sleep 5
        done
    fi ;;
esac
case "$state" in
    provisioned|cloning|ready|idle|running) ;;
    stopping|stopped)
        # A plain resume (no new size) while it is stopping, or within 10 minutes of stopped,
        # takes back the machine Boat keeps: no restore and no start.
        resize=()
        [ "$size" = "$type" ] || resize=(--type "$type")
        if [ "$state" = stopping ] && [ "${#resize[@]}" -gt 0 ]; then
            echo "boat-check: $id is still stopping; try again in a minute" >&2; exit 2
        fi
        echo "boat-check: resuming $id ($state) as $type" >&2
        if ! fast_start "$id" boat resume "$id" --no-env --ttl "$budget" ${resize[@]+"${resize[@]}"}; then
            case "$out" in
                *snapshot_data_expired*) echo "boat-check: $id can't be resumed (its data expired); making a new one" >&2; state="" ;;
                *) start_failed "resuming $id" "$out" ;;
            esac
        fi ;;
    "") ;;
    gone) echo "boat-check: Boat doesn't know $id any more; making a new sandbox" >&2; state="" ;;
    unknown) echo "boat-check: boat info $id gave no state; check it with boat info $id" >&2; exit 1 ;;
    *)
        echo "boat-check: $id is $state; deleting it and making a new one" >&2
        boat delete "$id" --yes --json >/dev/null 2>&1 || echo "boat-check: couldn't delete $id: boat delete $id --yes" >&2
        state="" ;;
esac
if [ -z "$state" ]; then
    rm -f "$id_file"
    from=()
    if boat snapshots --json 2>/dev/null | jq -e --arg n "$snapshot" '.named[]? | select(.name == $n and .status == "ready")' >/dev/null; then
        from=(--from "$snapshot")
    else
        echo "boat-check: no ready $snapshot snapshot, so this sandbox starts bare and installs everything; --save makes one" >&2
    fi
    echo "boat-check: creating $name" >&2
    id=""   # the trap reads a cut-short create's id from $start_log
    id=$(new_sandbox "$name" ${from[@]+"${from[@]}"})
    echo "$id" > "$id_file"
fi
boat extend "$id" --ttl "$budget" --json >/dev/null
keep_alive "$id"
echo "boat-check: $type sandbox $id ($name), ready in $((SECONDS - t0)) s" >&2

# The working tree as git sees it (tracked files, and untracked ones git doesn't ignore, as
# `boat push` takes them) is indexed in a copy of the worktree's index in the git directory,
# which leaves the real one alone and keeps its stat data, so only changed and untracked files
# are read. Its git tree names the exact contents. A sandbox that got tree T last time needs only the files that
# differ from T, so pushed-$slot keeps the sandbox id and T; any other sandbox gets every file.
tree_index=$state_dir/index-$slot
pushed_file=$state_dir/pushed-$slot
rm -f "$tree_index"
cp "$(git rev-parse --path-format=absolute --git-path index)" "$tree_index" 2>/dev/null || true
for flag in --no-assume-unchanged --no-skip-worktree; do   # the copy must see every change
    GIT_INDEX_FILE=$tree_index git ls-files -v -z | perl -0ne 'print substr($_, 2) if /^[a-zS] /' \
        | GIT_INDEX_FILE=$tree_index git update-index "$flag" -z --stdin
done
GIT_INDEX_FILE=$tree_index git add -A
tree=$(GIT_INDEX_FILE=$tree_index git write-tree)
stage=$(mktemp -d)
base="" last_id="" last_tree=""
[ ! -f "$pushed_file" ] || read -r last_id last_tree <"$pushed_file" || true
if [ -n "$last_id" ] && [ "$last_id" = "$id" ] && git cat-file -e "$last_tree^{tree}" 2>/dev/null; then base=$last_tree; fi
# send BASE: package the files that changed since BASE, or all of them when BASE is empty. A
# package of up to 72 KB goes in boat exec's arguments; a bigger one is pushed.
send() {
    base=$1 files_b64="" paths_b64="" push=""
    local t0=$SECONDS
    rm -rf "${stage:?}"/*
    if [ -n "$base" ]; then   # changed files from the working tree; the sandbox checks the result
        git diff-tree -r -z --no-renames --name-only "$base" "$tree" >"$stage/paths"
        git diff-tree -r -z --no-renames --name-only --diff-filter=d "$base" "$tree" >"$stage/list"
        COPYFILE_DISABLE=1 tar -czf "$stage/files.tgz" --no-recursion --null -T "$stage/list"
        rm "$stage/list"
    else   # every file, exactly as indexed
        : >"$stage/paths"
        git archive --format=tar.gz -o "$stage/files.tgz" "$tree"
    fi
    local count size
    count=$(tr -cd '\0' <"$stage/paths" | wc -c | tr -d ' ')
    size=$(($(wc -c <"$stage/files.tgz") + $(wc -c <"$stage/paths")))
    if [ -n "$base" ] && [ "$size" -le 72000 ]; then
        files_b64=$(base64 <"$stage/files.tgz" | tr -d '\n')
        paths_b64=$(base64 <"$stage/paths" | tr -d '\n')
        if [ "$count" = 0 ]; then echo "boat-check: no file changed since the last check" >&2
        else echo "boat-check: sending the $count paths changed since the last check with the command" >&2; fi
        return
    fi
    push="/home/user/push/$(date +%Y%m%d-%H%M%S)-$$"
    boat push "$id" "$stage" --to "$push" >/dev/null
    if [ -n "$base" ]; then
        echo "boat-check: pushed the $count paths changed since the last check in $((SECONDS - t0)) s" >&2
    else
        echo "boat-check: pushed the working tree in $((SECONDS - t0)) s" >&2
    fi
}
send "$base"
echo "$id $tree" >"$pushed_file"
status=0
run_remote "$id" "$mode" "$push" "$cmd" || status=$?
# The sandbox couldn't apply the change (its tree wasn't the one last pushed): push everything.
if [ "$status" = 75 ] && [ -n "$base" ] \
    && boat exec "$id" --json -- test -f /home/user/.boat-check-resync 2>/dev/null | jq -e 'select(.exitCode != null) | .exitCode == 0' >/dev/null; then
    send ""
    status=0
    run_remote "$id" "$mode" "$push" "$cmd" || status=$?
fi
exit "$status"
}
# shellcheck disable=SC2317  # the exit stops bash reading on if this file changes while it runs
{ main "$@"; exit; }
