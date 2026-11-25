import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  benchPage,
  checkFiles,
  commaList,
  isMain,
  jsonDifferences,
  loopbackPort,
  parseOptions,
  readJson,
  wholeNumber,
  writeArtifact,
} from "./cli_tools.mjs";

const root = fs.mkdtempSync(join(tmpdir(), "jev-cli-"));
const file = join(root, "output.json");
const server = http.createServer((request, response) => {
  switch (request.url) {
    case "/bench":
      response.end('<meta name="jev-csrf" content="  ">');
      break;
    default:
      response.writeHead(404).end();
  }
});
try {
  assert.equal(isMain(import.meta.url), true);
  assert.equal(isMain(import.meta.url, "missing.mjs"), false);
  assert.equal(isMain("https://example.invalid/", "missing.mjs"), false);
  const options = parseOptions(["--__proto__=assigned", "--constructor=literal"], ["__proto__", "constructor"]).args;
  assert.equal(Object.entries(options).find(([key]) => key === "__proto__")?.[1], "assigned");
  assert.equal(options.constructor, "literal");
  assert.equal(Object.getPrototypeOf(options), null);
  assert.match(parseOptions(["--value=a=b"], ["value"]).args.value, /^a=b$/);
  assert.equal(parseOptions(["--"], []).help, false);
  assert.throws(() => parseOptions(["--switch=false"], [], ["switch"]), /does not take a value/);
  assert.throws(() => parseOptions(["--value", "-h"], ["value"]), /needs a non-empty value/);
  assert.equal(commaList("names", undefined), null);
  assert.equal(commaList("names", " x,y ").join("|"), "x|y");
  assert.throws(() => commaList("names", "x, x"), /duplicate items/);
  assert.throws(() => commaList("names", "x,,y"), /empty item/);
  assert.equal(wholeNumber("jobs", 5), 5);
  assert.throws(() => wholeNumber("jobs", true), /decimal whole number/);
  assert.throws(() => wholeNumber("jobs", "2\n"), /decimal whole number/);
  assert.throws(() => commaList("test", 42), /comma-separated string/);
  assert.throws(() => loopbackPort(["8331"]), /decimal integer/);
  assert.throws(() => loopbackPort(1.1), /decimal integer/);
  assert.equal(loopbackPort(8331), "8331");

  fs.writeFileSync(file, '\ufeff{"bom":true}');
  assert.equal(readJson(file).bom, true);
  fs.writeFileSync(file, Buffer.from([0x22, 0xc3, 0x22]));
  assert.throws(() => readJson(file), /utf-8/i);
  assert.throws(() => readJson(root), /expected a regular file/);
  fs.writeFileSync(file, '"string"');
  assert.throws(() => readJson(file, { maxBytes: 3 }), /exceeds 3 bytes/);
  const compressed = join(root, "output.json.gz");
  fs.writeFileSync(compressed, gzipSync(JSON.stringify("x".repeat(2048))));
  assert.throws(() => readJson(compressed, { maxBytes: 128 }), /128 bytes/);

  assert.throws(() => checkFiles({}, { json: "" }), /non-empty path/);
  assert.throws(() => writeArtifact(`${file}/`, "{}"), /trailing separator/);
  assert.throws(() => writeArtifact(join(file, "nested"), "{}"), /Parent is not a directory/);
  assert.doesNotThrow(() => checkFiles({ both: root }, { both: compressed }));
  fs.chmodSync(file, 0o640);
  const previous = process.umask(0o077);
  try {
    writeArtifact(file, "{}");
  } finally {
    process.umask(previous);
  }
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  const alias = join(root, "alias.json");
  fs.symlinkSync(file, alias);
  writeArtifact(alias, '{"updated":1}');
  assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  assert.equal(readJson(file).updated, 1);
  assert.equal(
    fs.readdirSync(root).some((name) => name.startsWith(".jev-artifact-")),
    false,
  );

  assert.equal(jsonDifferences({ "a.b": 1 }, { "a.b": 2 }, JSON.stringify)[0], '["a.b"]: expected 1, actual 2');
  const numbers = Array.from({ length: 13 }, (_, index) => index);
  const changed = [...numbers];
  changed[3] = 7;
  changed[12] = 41;
  assert.equal(jsonDifferences(numbers, changed, JSON.stringify, { limit: 1 })[0], "3: expected 3, actual 7");
  assert.equal(jsonDifferences({ x: 1 }, {}, JSON.stringify)[0], "x: expected 1, actual <missing>");
  assert.equal(jsonDifferences(Array(3), Array(2), JSON.stringify)[0], "length: expected 3, actual 2");
  assert.equal(jsonDifferences(2, 3, JSON.stringify, { path: "capture" })[0], "capture: expected 2, actual 3");
  assert.equal(jsonDifferences({ x: 1 }, { x: 2 }, JSON.stringify, { limit: 0 }).length, 0);
  assert.equal(jsonDifferences({ a: "x".repeat(256) }, { a: "y" }, JSON.stringify)[0].includes("..."), true);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await assert.rejects(benchPage(port), /no Jev session token/);
  await assert.rejects(benchPage(port, { signal: AbortSignal.abort(new Error("user cancelled")) }), /user cancelled/);
  await assert.rejects(benchPage(port, { timeoutMs: 0 }), /timeout/i);
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
}
