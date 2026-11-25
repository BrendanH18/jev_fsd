#!/usr/bin/env bash
# Called immediately after starting a loopback server in a GitHub Actions step.
set -euo pipefail

if [[ $# != 3 || ! $1 =~ ^[0-9]{1,5}$ || $2 != /* || ! $3 =~ ^[1-9][0-9]*$ ]]; then
    echo "Usage: wait-for-local-server.sh PORT /PATH PID" >&2
    exit 2
fi
if (( 10#$1 < 1 || 10#$1 > 65535 )); then
    echo "Local server port must be between 1 and 65535" >&2
    exit 2
fi
url="http://127.0.0.1:$((10#$1))$2"
deadline=$((SECONDS + 60))
while (( SECONDS < deadline )); do
    if ! kill -0 "$3" 2>/dev/null; then
        echo "Local server process $3 exited before it answered at $url" >&2
        exit 1
    fi
    if status=$(curl --noproxy '*' --silent --output /dev/null --write-out '%{http_code}' --max-time 2 -- "$url") &&
        [[ $status == 2[0-9][0-9] ]]; then
        exit 0
    fi
    sleep 1
done
echo "Local server did not answer at $url within 60 seconds (last HTTP status ${status:-unknown})" >&2
exit 1
