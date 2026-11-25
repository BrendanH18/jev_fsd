import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const workflows = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
const boat = fileURLToPath(new URL("./boat-check.sh", import.meta.url));
const root = fs.mkdtempSync(join(tmpdir(), "jev-ci-"));
const bin = join(root, "bin");
const actions = join(root, "calls");
const repo = join(root, "repo");
fs.mkdirSync(bin);
fs.mkdirSync(repo);
function writeExecutable(name, content) {
  fs.writeFileSync(join(bin, name), content, { mode: 0o755 });
}
function run(command, args, env = {}, cwd = root) {
  return spawnSync(command, args, {
    cwd,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: actions, ...env },
    encoding: "utf8",
    timeout: 5000,
  });
}
const bash = (name, ...args) => run("bash", [join(workflows, name), ...args]);
const fixture = (env, ...args) => run("bash", [boat, ...args], env, repo);

try {
  const yaml = new Map(
    fs
      .readdirSync(workflows)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => [f, fs.readFileSync(join(workflows, f), "utf8")]),
  );
  for (const [file, contents] of yaml) {
    for (const [, pin] of contents.matchAll(/^\s+(?:- )?uses: (.+)$/gm))
      assert.match(pin, /^[\w/-]+@[0-9a-f]{40} # v[\d.]+$/, file);
    for (const [, runner] of contents.matchAll(/^\s+runs-on: (.+)$/gm)) assert.equal(runner, "ubuntu-24.04", file);
    assert.equal(
      (contents.match(/uses: actions\/checkout@/g) ?? []).length,
      (contents.match(/persist-credentials: false/g) ?? []).length,
      file,
    );
  }
  const demo = yaml.get("demo.yml");
  const bench = yaml.get("bench.yml");
  assert.match(demo, /name: Demo checks passed\n\s+needs: \[python, node, browser, build\]\n\s+if: always\(\)/);
  assert.match(bench, /name: Benchmark passed\n\s+needs: \[suite\]\n\s+if: always\(\)/);
  assert.match(yaml.get("lint.yml"), /name: Lint and format/);
  assert.match(demo, /node scripts\/node_checks\.mjs --jobs 1 --github --json checks\.json/);
  assert.match(demo, /mapfile -t checks <<< "\$files"/);
  assert.match(demo, /name: node-checks-\$\{\{ matrix\.shard \}\}/);
  assert.match(demo, /python -m unittest discover -s tests/);
  assert.match(demo, /needs: demo-passed/);
  assert.match(bench, /--json benchmark\.json/);
  assert.match(bench, /--require-count --check 1 --json benchmark\.json/);
  assert.match(bench, /name: benchmark-\$\{\{ matrix\.features \}\}-\$\{\{ matrix\.weather \}\}/);
  assert.match(yaml.get("soak.yml"), /continue-on-error: true/);
  const replay = yaml.get("replay-drift.yml");
  assert.match(replay, /if: needs\.tapes\.outputs\.count != '0'/);
  assert.match(replay, /count=\$\(jq -er/);
  assert.match(replay, /No published replay tapes were found/);
  assert.match(replay, /steps\.main-replay\.outcome == 'failure'/);
  assert.match(replay, /steps\.published\.outcome == 'success'/);
  assert.match(demo, /build:[\s\S]*?needs: \[python, node, browser\]/);
  assert.match(demo, /github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main'/);
  assert.match(demo, /pages: write\n\s+id-token: write/);
  assert.match(demo, /group: pages\n\s+cancel-in-progress: false/);
  assert.match(demo, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(bench, /include:\n\s+- \{ features: hard-city, hard: true \}/);
  assert.match(bench, /needs: \[suite\]/);
  assert.match(bench, /--mode hard --json hard-city\.json/);
  assert.match(yaml.get("codeql.yml"), /language: \[actions, javascript-typescript, python\]/);
  assert.match(yaml.get("lint.yml"), /uv run --locked ruff format --check/);
  assert.match(yaml.get("lint.yml"), /run: npm ci\n/);
  assert.match(yaml.get("lint.yml"), /run: npm run lint/);
  assert.match(yaml.get("soak.yml"), /needs: \[soak, park-night\]/);
  assert.match(yaml.get("soak.yml"), /--shard "\$SHARD" --shards 8/);
  assert.match(yaml.get("soak.yml"), /retention-days: 14/);
  for (const name of ["bench", "demo", "soak"]) {
    assert.match(yaml.get(`${name}.yml`), /bash \.github\/workflows\/wait-for-local-server\.sh/);
  }
  for (const workflow of [demo, bench]) {
    const gate = workflow.split("          set -o pipefail\n")[1].split("\n        env:")[0];
    const result = (needs) => run("bash", ["-e", "-c", gate], { RESULTS: JSON.stringify(needs) });
    assert.equal(result({ node: { result: "success" } }).status, 0);
    assert.equal(result({}).status, 1);
    for (const state of ["failure", "skipped", "cancelled"]) {
      const failed = result({ node: { result: "success" }, build: { result: state } });
      assert.equal(failed.status, 1);
      assert.match(failed.stdout, new RegExp(`build: ${state}`));
    }
  }

  writeExecutable("curl", '#!/bin/bash\nprintf "%s\\n" "$@" > "$CALLS"\nprintf 204\n');
  const wait = "wait-for-local-server.sh";
  assert.equal(bash(wait, "08331", "/bench", String(process.pid)).status, 0);
  const curlArgs = fs.readFileSync(actions, "utf8");
  assert.match(curlArgs, /--noproxy\n\*\n/);
  assert.match(curlArgs, /--max-time\n2\n/);
  assert.match(curlArgs, /http:\/\/127\.0\.0\.1:8331\/bench/);
  assert.equal(bash(wait, "65536", "/", String(process.pid)).status, 2);
  assert.equal(bash(wait, "0", "/", String(process.pid)).status, 2);
  assert.equal(bash(wait, "8331", "bench", String(process.pid)).status, 2);
  assert.equal(bash(wait, "8331", "/bench", "-1").status, 2);
  assert.match(bash(wait, "8331", "/", "2147483647").stderr, /exited before it answered/);

  writeExecutable(
    "boat",
    `#!/bin/bash
printf "%s\\n" "$*" >> "$CALLS"
case "$1" in
  info) printf '%s\\n' "$MOCK_INFO"; exit "\${MOCK_INFO_EXIT:-0}";;
  exec) printf '%s' "$MOCK_FRAMES"; exit "\${MOCK_EXEC_EXIT:-0}";;
  push|extend|stop) exit 0;;
  delete) exit "\${MOCK_DELETE_EXIT:-0}";;
  snapshots) printf '%s\\n' "$MOCK_SNAPSHOTS"; exit "\${MOCK_SNAPSHOTS_EXIT:-0}";;
  *) echo "unexpected stub Boat call: $*" >&2; exit 1;;
esac
`,
  );
  assert.equal(run("git", ["init", "-q"], {}, repo).status, 0);
  const state = join(repo, ".git", "boat-check");
  fs.mkdirSync(state);
  const sandbox = join(state, "sandbox-testing");
  fs.writeFileSync(sandbox, "bx_fixture\n");
  fs.writeFileSync(join(repo, "tracked.txt"), "fixture");
  assert.equal(run("git", ["add", "tracked.txt"], {}, repo).status, 0);
  const env = {
    JEV_BOAT_SLOT: "testing",
    MOCK_INFO: '{"sandbox":{"state":"ready","type":"default"}}',
    MOCK_FRAMES: [
      { type: "stdout", data: "out fragment " },
      { type: "stderr", data: "warning\n" },
      { type: "stdout", data: "continued\n" },
      { type: "exit", exitCode: 255 },
      "",
    ]
      .map((frame) => (frame === "" ? frame : JSON.stringify(frame)))
      .join("\n"),
  };
  assert.match(fixture(env, "--status", "--done").stderr, /choose one/);
  assert.match(fixture(env, "--full", "--full").stderr, /specify --full once/);
  assert.match(fixture(env, "--full", "--", "true").stderr, /not both/);
  assert.match(fixture(env, "--", "  ").stderr, /needs a command/);
  assert.match(fixture({ ...env, JEV_BOAT_TYPE: "other" }, "--status").stderr, /JEV_BOAT_TYPE is/);
  assert.match(fixture({ ...env, JEV_BOAT_IDLE: "-1" }, "--status").stderr, /JEV_BOAT_IDLE is/);
  assert.match(fixture({ ...env, JEV_BOAT_SLOT: "../other" }, "--status").stderr, /JEV_BOAT_SLOT may use/);
  assert.match(fixture({ ...env, JEV_BOAT_JOBS: "100" }, "--status").stderr, /whole number from 1 to 99/);
  assert.match(fixture(env, "--", "uv run scripts/verify_jev.py").stderr, /Use --offline/);
  const lock = join(state, "lock-testing");
  fs.mkdirSync(lock);
  fs.writeFileSync(join(lock, "pid"), String(process.pid));
  assert.match(fixture(env, "--status").stderr, /holds this worktree/);
  assert.equal(fs.existsSync(lock), true);
  fs.writeFileSync(join(lock, "pid"), "2147483647");
  assert.match(fixture(env, "--status").stderr, /left its lock/);
  assert.equal(fs.existsSync(lock), true);
  fs.rmSync(lock, { recursive: true });
  const completed = fixture({ ...env, JEV_BOAT_IDLE: "000" }, "--", "true");
  assert.equal(completed.status, 255, completed.stderr);
  assert.equal(completed.stdout.trim(), "out fragment continued");
  assert.match(completed.stderr, /warning\n/);
  assert.doesNotMatch(completed.stderr, /without a valid command exit/);
  assert.match(fs.readFileSync(actions, "utf8"), /^stop bx_fixture --json$/m);
  // A different size makes Git see the edit even if the filesystem timestamps still match.
  fs.writeFileSync(join(repo, "tracked.txt"), "changed fixture");
  fs.writeFileSync(join(repo, "path with spaces.txt"), "new");
  const missing = fixture({ ...env, MOCK_FRAMES: "", MOCK_EXEC_EXIT: "7" }, "--", "true");
  assert.equal(missing.status, 7, missing.stderr);
  assert.match(missing.stderr, /without a valid command exit/);
  assert.match(missing.stderr, /sending the 2 paths changed/);
  const bad = fixture({ ...env, MOCK_FRAMES: '{"type":"exit","exitCode":256}\n' }, "--", "true");
  assert.equal(bad.status, 1, bad.stderr);
  assert.match(bad.stderr, /without a valid command exit/);
  const unknown = fixture({ ...env, MOCK_INFO: '{"sandbox":{"state":"future","type":"default"}}' }, "--", "true");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unrecognized sandbox state future/);
  const noWorktree = run("bash", [boat, "--status"], env);
  assert.match(noWorktree.stderr, /run this from a Git working tree/);
  assert.match(
    fixture({ ...env, MOCK_INFO: '{"sandbox":{"state":true,"type":"default"}}' }, "--status").stderr,
    /couldn't read sandbox/,
  );
  assert.match(
    fixture({ ...env, MOCK_INFO: '{"sandbox":{"state":"ready","type":3}}' }, "--status").stderr,
    /couldn't read sandbox/,
  );
  const gone = { ...env, MOCK_INFO: '{"error":{"code":"not_found"}}', MOCK_INFO_EXIT: "1" };
  assert.match(fixture(gone, "--status").stdout, /\(gone\)/);
  const noSnapshots = fixture({ ...gone, MOCK_SNAPSHOTS_EXIT: "8" }, "--", "true");
  assert.match(noSnapshots.stderr, /cannot list snapshots/);
  assert.doesNotMatch(noSnapshots.stderr, /unexpected stub Boat call: new/);
  fs.writeFileSync(sandbox, "bx_fixture\n");
  const noDelete = fixture(
    { ...env, MOCK_INFO: '{"sandbox":{"state":"failed","type":"default"}}', MOCK_DELETE_EXIT: "8" },
    "--",
    "true",
  );
  assert.match(noDelete.stderr, /couldn't delete/);
  assert.equal(fs.readFileSync(sandbox, "utf8"), "bx_fixture\n");
  const stopped = fixture({ ...env, MOCK_INFO: '{"sandbox":{"state":"stopped","type":"default"}}' }, "--stop");
  assert.match(stopped.stdout, /\(stopped\)/);
  fs.writeFileSync(sandbox, "--invalid\n");
  assert.match(fixture(env, "--status").stderr, /invalid sandbox id/);
  fs.writeFileSync(sandbox, "bx_fixture\n");
  assert.equal(fixture(env, "--done").status, 0);
  for (const file of ["sandbox-testing", "index-testing", "pushed-testing", "lock-testing"])
    assert.equal(fs.existsSync(join(state, file)), false, file);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
