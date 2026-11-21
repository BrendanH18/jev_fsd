#!/usr/bin/env bash
# Run checks in this worktree's own long-lived Boat sandbox.
#
#   scripts/boat-check.sh            lint, Python tests, offline Jev requests, fixture check
#   scripts/boat-check.sh --full     also every scripts/test_*.mjs, one at a time (CI's limit)
#   scripts/boat-check.sh -- CMD...  run CMD in the checkout instead
#   scripts/boat-check.sh --save     after a passing run, save the sandbox as the warm
#                                    snapshot jev-fsd-warm that new sandboxes start from
#   scripts/boat-check.sh --status   show this worktree's sandbox
#   scripts/boat-check.sh --stop     stop it (the next check resumes it)
#   scripts/boat-check.sh --done     delete it; run this when the agent's work ends
#
# The first check creates a sandbox from jev-fsd-warm (Node 22, uv, Python, Biome and a clone
# of the repository with its dependencies), or a bare one when there is no snapshot, and
# records its id in this worktree's git directory. Later checks reuse it: each pushes the
# working tree to a fresh directory, makes the clone at /home/user/jev_fsd match it exactly
# (git's index included) and runs there with `boat exec --timeout 0`. Boat's auto-stop is a
# deadline, not an idle timer, so every check moves it to JEV_BOAT_IDLE seconds after the
# check ends (default 2700): a forgotten sandbox stops by itself, and the next check resumes
# it. One sandbox per worktree; agents sharing a worktree each set JEV_BOAT_SLOT. Overrides:
# JEV_BOAT_TYPE (default), JEV_BOAT_SNAPSHOT. See docs/reference/development.md#boat-checks.
main() {
set -euo pipefail
export BOAT_NO_UPDATE=1
snapshot=${JEV_BOAT_SNAPSHOT:-jev-fsd-warm}
type=${JEV_BOAT_TYPE:-default}
idle=${JEV_BOAT_IDLE:-2700}
slot=${JEV_BOAT_SLOT:-main}
budget=7200   # the longest a check may run before auto-stop would cut it off
clone_url=${JEV_BOAT_CLONE_URL:-https://github.com/BrendanH18/jev_fsd.git}
mode=checks action=run save=0 cmd=""
while [ $# -gt 0 ]; do
    case "$1" in
        --full) mode=full ;;
        --save) save=1 ;;
        --status|--stop|--done) action=${1#--} ;;
        --) shift
            [ $# -gt 0 ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            if [ $# -eq 1 ]; then cmd=$1; else cmd=$(printf '%q ' "$@"); fi
            [ -n "$cmd" ] || { echo "boat-check: -- needs a command" >&2; exit 2; }
            mode=cmd
            break ;;
        -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "boat-check: unknown option $1 (try --help)" >&2; exit 2 ;;
    esac
    shift
done
case "$slot" in *[!A-Za-z0-9_-]*|"") echo "boat-check: JEV_BOAT_SLOT may use letters, digits, - and _" >&2; exit 2 ;; esac
case "$cmd" in
    *verify_jev.py*)
        case "$cmd" in *--offline*) ;; *)
            echo "boat-check: live verify_jev.py runs cost credits and need the owner's go-ahead; the check sandbox has no keys. Use --offline." >&2
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
name="jev-check-$(basename "$PWD" | tr -c 'A-Za-z0-9_\n-' '-' | cut -c1-80)-$slot"

# One run at a time per slot, so two checks never race to create the slot's sandbox.
if ! mkdir "$lock" 2>/dev/null; then
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
        echo "boat-check: another boat-check (pid $holder) is using this worktree's sandbox; wait for it, or give this agent its own JEV_BOAT_SLOT" >&2
        exit 2
    fi
    rm -rf "$lock"
    mkdir "$lock"
fi
echo $$ > "$lock/pid"
id=$(cat "$id_file" 2>/dev/null || true)
extended=0
cleanup() {
    set +e
    # Leave auto-stop JEV_BOAT_IDLE seconds from now, whatever happened to the check.
    if [ "$extended" = 1 ] && [ -n "$id" ]; then
        boat extend "$id" --ttl "$idle" --json >/dev/null 2>&1 \
            || echo "boat-check: couldn't reset auto-stop on $id: boat extend $id --ttl $idle" >&2
    fi
    rm -rf "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

sandbox_state() { boat info "$1" --json 2>/dev/null | jq -r '.sandbox.state // ""' 2>/dev/null || true; }
pending_save() {
    boat snapshots --json 2>/dev/null | jq -e --arg n "$snapshot" --arg id "$1" \
        '.named[]? | select(.name == $n and .sourceSandboxId == $id and .status != "ready" and .status != "failed")' >/dev/null 2>&1
}

case "$action" in
    status)
        if [ -z "$id" ]; then echo "boat-check: no sandbox for this worktree (slot $slot)"; exit 0; fi
        echo "boat-check: $id ($(sandbox_state "$id"))"
        boat info "$id"
        exit 0 ;;
    stop|done)
        [ -n "$id" ] || { echo "boat-check: no sandbox for this worktree (slot $slot)" >&2; exit 0; }
        if [ "$action" = done ] && ! pending_save "$id"; then
            if boat delete "$id" --yes --json >/dev/null 2>&1 || [ -z "$(sandbox_state "$id")" ]; then
                rm -f "$id_file"; id=""
                echo "boat-check: deleted this worktree's sandbox"
                exit 0
            fi
            echo "boat-check: couldn't delete $id: boat delete $id --yes" >&2
            exit 1
        fi
        [ "$action" = stop ] || echo "boat-check: a save of $snapshot from $id is still running, so it is stopped instead; boat delete $id --yes once boat snapshots shows it ready" >&2
        boat stop "$id" --json >/dev/null || { echo "boat-check: couldn't stop $id: boat stop $id" >&2; exit 1; }
        echo "boat-check: stopped $id"
        exit 0 ;;
esac

# Find this slot's sandbox and get it running, or make one. Each create or resume uses one of
# the account's daily starts; reusing a running sandbox uses none.
start_failed() {
    echo "boat-check: $1 failed:" >&2
    printf '%s\n' "$2" | jq -r 'select(.event == "error") | .error' 2>/dev/null >&2 || printf '%s\n' "$2" >&2
    echo "boat-check: boat limits shows the starts left today; tell the owner rather than retrying" >&2
    exit 3
}
state=""
[ -z "$id" ] || state=$(sandbox_state "$id")
if [ "$state" = stopping ]; then
    for _ in $(seq 1 24); do sleep 5; state=$(sandbox_state "$id"); [ "$state" = stopping ] || break; done
fi
case "$state" in
    provisioned|cloning|ready|idle|running) ;;
    stopping) echo "boat-check: $id is still stopping; try again in a minute" >&2; exit 2 ;;
    stopped)
        echo "boat-check: resuming $id" >&2
        if ! out=$(boat resume "$id" --ttl "$budget" --json 2>&1); then
            case "$out" in
                *snapshot_data_expired*) echo "boat-check: $id can't be resumed (its data expired); making a new one" >&2; state="" ;;
                *) start_failed "resuming $id" "$out" ;;
            esac
        fi ;;
    "") [ -z "$id" ] || echo "boat-check: Boat doesn't know $id any more; making a new sandbox" >&2 ;;
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
    out=$(boat new --no-env --type "$type" --ttl "$budget" --name "$name" ${from[@]+"${from[@]}"} --json 2>&1) \
        || start_failed "creating a sandbox" "$out"
    id=$(printf '%s\n' "$out" | jq -r 'select(.event == "ready") | .id' 2>/dev/null | head -n 1)
    [ -n "$id" ] || start_failed "creating a sandbox" "$out"
    echo "$id" > "$id_file"
fi
boat extend "$id" --ttl "$budget" --json >/dev/null
extended=1
echo "boat-check: sandbox $id ($name)" >&2

# Push into a fresh directory; the remote script moves it into the clone.
push="/home/user/push/$(date +%Y%m%d-%H%M%S)-$$"
boat push "$id" . --to "$push" >/dev/null

# Runs in the sandbox as `bash -c`: $1 mode, $2 push directory, $3 command, $4 save, $5 clone URL.
# shellcheck disable=SC2016
remote='set -euo pipefail
mode=$1 push=$2 cmd=$3 save=$4 clone_url=$5
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

# Dependencies: Biome when the lock file changed, and the Python environment.
if ! cmp -s package-lock.json node_modules/.boat-check-lock; then
    npm ci --no-audit --no-fund --loglevel=error
    cp package-lock.json node_modules/.boat-check-lock
fi
uv sync --locked --quiet
say "node $(node --version), $(uv run --locked python --version), $(nproc) vCPUs"

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

# --save keeps the toolchain, the clone and its dependencies, not this tree or its results.
if [ "$save" = 1 ] && [ "$status" = 0 ]; then
    git fetch -q origin || say "couldnt fetch; the snapshot keeps the clone at its current commit"
    git reset -q --hard "$(git rev-parse -q --verify origin/HEAD || git rev-parse -q --verify origin/main || echo HEAD)"
    git clean -fdqx -e node_modules -e .venv
    if ! cmp -s package-lock.json node_modules/.boat-check-lock; then
        npm ci --no-audit --no-fund --loglevel=error
        cp package-lock.json node_modules/.boat-check-lock
    fi
    uv sync --locked --quiet
fi
exit "$status"'

set +e
boat exec "$id" --timeout 0 -- bash -c "$remote" boat-check "$mode" "$push" "$cmd" "$save" "$clone_url"
status=$?
set -e
if [ "$save" = 0 ] || [ "$status" != 0 ]; then
    [ "$save" = 0 ] || echo "boat-check: the checks failed, so $snapshot was not saved" >&2
    exit "$status"
fi

# The save runs in the background. Wait for this sandbox's save of the name (sourceSandboxId) to
# read ready; an older save of the name doesn't count. The lock stays held meanwhile, so no other
# check changes the sandbox mid-save.
echo "boat-check: saving $id as $snapshot" >&2
boat snapshot "$id" "$snapshot" >/dev/null || { echo "boat-check: saving $snapshot failed" >&2; exit 1; }
deadline=$((SECONDS + 600))
state=""
while :; do   # poll once more after the deadline before giving up
    state=$(boat snapshots --json 2>/dev/null | jq -r --arg n "$snapshot" --arg id "$id" \
        '[.named[]? | select(.name == $n and .sourceSandboxId == $id) | .status][0] // ""' || true)
    case "$state" in ready|failed) break ;; esac
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep 5
done
case "$state" in
    ready) echo "boat-check: saved $snapshot" >&2 ;;
    failed) echo "boat-check: saving $snapshot failed (boat snapshots shows why)" >&2; exit 1 ;;
    *) echo "boat-check: $snapshot isn't ready after about 10 minutes; don't run --done until boat snapshots shows it ready" >&2; exit 1 ;;
esac
exit 0
}
main "$@"; exit
