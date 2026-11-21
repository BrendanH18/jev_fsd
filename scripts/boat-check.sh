#!/usr/bin/env bash
# Run checks in this worktree's own long-lived Boat sandbox.
#
#   scripts/boat-check.sh            lint, Python tests, offline Jev requests, fixture check
#   scripts/boat-check.sh --full     also every scripts/test_*.mjs, one at a time (CI's limit)
#   scripts/boat-check.sh -- CMD...  run CMD in the checkout instead
#   scripts/boat-check.sh --save     rebuild the warm snapshot jev-fsd-warm from origin's default
#                                    branch, in a fresh sandbox that runs no worktree code
#   scripts/boat-check.sh --status   show this worktree's sandbox
#   scripts/boat-check.sh --stop     stop it (the next check resumes it)
#   scripts/boat-check.sh --done     delete it; run this when the agent's work ends
#
# The first check creates a sandbox from jev-fsd-warm (Node 22, uv, Python, Biome and a clone
# of the repository with its dependencies), or a bare one when there is no snapshot, and
# records its id in this worktree's git directory. Later checks reuse it: each pushes the
# working tree to a fresh directory, makes the clone at /home/user/jev_fsd match it exactly
# (git's index included) and runs there with `boat exec --timeout 0`. Boat's auto-stop is a
# deadline, not an idle timer, so it is kept two hours ahead while a check runs and set to
# JEV_BOAT_IDLE seconds after it ends (default 2700): a forgotten sandbox stops by itself, and
# the next check resumes it. One sandbox per worktree; agents sharing a worktree each set
# JEV_BOAT_SLOT. Overrides: JEV_BOAT_TYPE (default), JEV_BOAT_SNAPSHOT. See
# docs/reference/development.md#boat-checks.
main() {
set -euo pipefail
export BOAT_NO_UPDATE=1
snapshot=${JEV_BOAT_SNAPSHOT:-jev-fsd-warm}
type=${JEV_BOAT_TYPE:-default}
idle=${JEV_BOAT_IDLE:-2700}
slot=${JEV_BOAT_SLOT:-main}
budget=7200   # auto-stop is kept this far ahead while a check runs
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
        -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "boat-check: unknown option $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done
[ "$action" = run ] || [ "$mode" = checks ] || { echo "boat-check: --$action takes no --full or command" >&2; exit 2; }
case "$slot" in *[!A-Za-z0-9_-]*|"") echo "boat-check: JEV_BOAT_SLOT may use letters, digits, - and _" >&2; exit 2 ;; esac
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

# One run at a time per slot, so two checks never race to create the slot's sandbox. Only
# `mkdir` takes the lock, and the exit trap releases it; a lock left by a killed run is reported,
# never taken over, so no run can remove a lock another run holds.
if ! mkdir "$lock" 2>/dev/null; then
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
        echo "boat-check: a boat-check that has ended (pid $holder) left its lock; remove $lock and run again" >&2
    else
        echo "boat-check: another boat-check (pid ${holder:-starting}) holds this worktree's sandbox lock; wait for it, or give this agent its own JEV_BOAT_SLOT" >&2
    fi
    exit 2
fi
echo $$ > "$lock/pid"
id=$(cat "$id_file" 2>/dev/null || true)
extended=0 keepalive="" build="" saving=0
stop_keepalive() {   # the keepalive loop and its sleep
    [ -n "$keepalive" ] || return 0
    pkill -P "$keepalive" 2>/dev/null || true
    kill "$keepalive" 2>/dev/null || true
    keepalive=""
}
cleanup() {
    set +e
    stop_keepalive
    # Leave auto-stop JEV_BOAT_IDLE seconds from now, whatever happened to the check.
    if [ "$extended" = 1 ] && [ -n "$id" ]; then
        boat extend "$id" --ttl "$idle" --json >/dev/null 2>&1 \
            || echo "boat-check: couldn't reset auto-stop on $id: boat extend $id --ttl $idle" >&2
    fi
    # The --save build sandbox is deleted, or only stopped while a save from it may still be
    # running (an unfinished save needs its source; a stopped sandbox costs nothing).
    if [ -n "$build" ]; then
        if [ "$saving" = 1 ]; then
            boat stop "$build" --json >/dev/null 2>&1
            echo "boat-check: stopped the build sandbox $build; once boat snapshots shows $snapshot ready from it: boat delete $build --yes" >&2
        else
            boat delete "$build" --yes --json >/dev/null 2>&1 || echo "boat-check: delete the build sandbox: boat delete $build --yes" >&2
        fi
    fi
    [ "$(cat "$lock/pid" 2>/dev/null)" != $$ ] || rm -rf "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# The sandbox's state, or "gone" when Boat no longer knows it. Any other failure (network, auth,
# rate limit) is an error, so a passing hiccup never orphans a sandbox or spends a start.
sandbox_state() {
    local out
    if out=$(boat info "$1" --json 2>&1); then
        printf '%s\n' "$out" | jq -r '.sandbox.state // "unknown"'
        return
    fi
    case "$out" in *'"not_found"'*) echo gone; return 0 ;; esac
    echo "boat-check: couldn't read sandbox $1 from Boat: $out" >&2
    return 1
}

# Each create or resume uses one of the account's daily starts; reusing a running sandbox uses none.
start_failed() {
    case "$2" in *no_ready_machine*)
        echo "boat-check: $1: Boat had no machine ready after a minute of tries; nothing started and no start was counted. Try again later." >&2
        exit 3 ;;
    esac
    echo "boat-check: $1 failed:" >&2
    printf '%s\n' "$2" | jq -r 'select(.event == "error") | .error' 2>/dev/null >&2 || printf '%s\n' "$2" >&2
    echo "boat-check: boat limits shows the starts left today; tell the owner rather than retrying" >&2
    exit 3
}
# With --fail-fast, a start that finds no ready machine creates nothing and isn't counted against
# the start limits, so retry it a few times.
fast_start() {   # fast_start WHAT boat ARGS...; leaves the output in $out
    local what=$1 attempt
    shift
    for attempt in 1 2 3 4 5 6; do
        if out=$("$@" --fail-fast --json 2>&1); then return 0; fi
        case "$out" in *no_ready_machine*) ;; *) return 1 ;; esac
        [ "$attempt" = 6 ] || { echo "boat-check: no machine ready for $what; trying again in 10 s" >&2; sleep 10; }
    done
    return 1
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

# Runs in the sandbox as `bash -c`: $1 mode (checks, full, cmd or build), $2 push directory,
# $3 command, $4 clone URL.
# shellcheck disable=SC2016
remote='set -euo pipefail
mode=$1 push=$2 cmd=$3 clone_url=$4
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
    base=https://nodejs.org/dist/latest-v22.x
    line=$(curl -fsSL "$base/SHASUMS256.txt" | grep -E " node-v22\.[0-9.]+-linux-$arch\.tar\.gz$")
    tmp=$(mktemp -d)
    curl -fsSL -o "$tmp/${line##* }" "$base/${line##* }"
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
    say "node $(node --version), $(uv run --locked python --version), $(nproc) vCPUs"
}

if [ "$mode" = build ]; then   # --save: the default branch and its dependencies, nothing else
    cd "$repo"
    git fetch -q origin
    git reset -q --hard "$(git rev-parse -q --verify origin/HEAD || git rev-parse --verify origin/main)"
    git clean -fdqx -e node_modules -e .venv
    deps
    exit 0
fi

# Make the clone match the pushed tree exactly: replace everything but .git and the installed
# dependencies (deleted files go too), and make git index exactly the pushed files, so
# `git ls-files` lists the same files as on the computer that ran the script.
find "$repo" -mindepth 1 -maxdepth 1 ! -name .git ! -name node_modules ! -name .venv -exec rm -rf {} +
find "$push" -mindepth 1 -maxdepth 1 -exec mv -t "$repo" {} +
rmdir "$push"
find /home/user/push -mindepth 1 -maxdepth 1 -mmin +720 -exec rm -rf {} + 2>/dev/null || true
cd "$repo"
git read-tree --empty
find . \( -path ./.git -o -path ./node_modules -o -path ./.venv \) -prune -o \( -type f -o -type l \) -printf "%P\0" \
    | git --literal-pathspecs add -f --pathspec-from-file=- --pathspec-file-nul
deps

status=0
case "$mode" in
    cmd) ( eval "$cmd" ) || status=$? ;;
    *)
        failed=()
        step() { say "== $1"; if ! ( eval "$2" ); then failed+=("$1"); fi; }
        step "lint and format" "uv run --locked ruff check && uv run --locked ruff format --check && npm run lint"
        step "Python tests" "JEV_REQUIRE_NODE=1 uv run --locked python -m unittest discover -s tests"
        step "offline Jev requests" "uv run --locked scripts/verify_jev.py --offline"
        step "Jev fixtures" "node --experimental-default-type=module scripts/build_jev_fixtures.mjs --check"
        if [ "$mode" = full ]; then
            for f in scripts/test_*.mjs; do
                step "$f" "timeout --kill-after=10s 360s node --experimental-default-type=module $f"
            done
        fi
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
# run_remote ID MODE PUSH CMD: run the remote script in sandbox ID and return its exit code.
# Auto-stop is pushed back every 30 minutes meanwhile, so a long check never reaches it.
run_remote() {
    local codes rc
    # Its own stdio, so its sleep never holds the caller's output pipe open after the script ends.
    ( while sleep 1800; do boat extend "$1" --ttl "$budget" --json >/dev/null 2>&1; done ) </dev/null >/dev/null 2>&1 &
    keepalive=$!
    set +e
    boat exec "$1" --timeout 0 --json -- bash -c "$remote" boat-check "$2" "$3" "$4" "$clone_url" | frames | unframe
    codes=("${PIPESTATUS[@]}")
    set -e
    stop_keepalive
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

# Find this slot's sandbox and get it running, or make one.
state=""
if [ -n "$id" ]; then
    state=$(sandbox_state "$id") || { echo "boat-check: try again once Boat answers" >&2; exit 1; }
fi
if [ "$state" = stopping ]; then
    for _ in $(seq 1 24); do sleep 5; state=$(sandbox_state "$id") || exit 1; [ "$state" = stopping ] || break; done
fi
case "$state" in
    provisioned|cloning|ready|idle|running) ;;
    stopping) echo "boat-check: $id is still stopping; try again in a minute" >&2; exit 2 ;;
    stopped)
        echo "boat-check: resuming $id" >&2
        if ! fast_start "resuming $id" boat resume "$id" --no-env --ttl "$budget"; then
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
    id=$(new_sandbox "$name" ${from[@]+"${from[@]}"})
    echo "$id" > "$id_file"
fi
boat extend "$id" --ttl "$budget" --json >/dev/null
extended=1
echo "boat-check: sandbox $id ($name)" >&2

# Push into a fresh directory; the remote script moves it into the clone.
push="/home/user/push/$(date +%Y%m%d-%H%M%S)-$$"
boat push "$id" . --to "$push" >/dev/null
status=0
run_remote "$id" "$mode" "$push" "$cmd" || status=$?
exit "$status"
}
main "$@"; exit
