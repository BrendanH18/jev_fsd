// node --experimental-default-type=module scripts/build_jev_fixtures.mjs [--check]
// Only common.js's optional CSRF lookup needs a DOM; generation makes no API calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.document = { querySelector: () => null };
const { buildRealismCases } = await import("../static/tests/jev-fixtures.js");
const directory = fileURLToPath(new URL("../static/tests/fixtures/jev/", import.meta.url));
const checking = process.argv.includes("--check");
fs.mkdirSync(directory, { recursive: true });
let failures = 0;
for (const fixture of buildRealismCases()) {
  const target = path.join(directory, `${fixture.name}.json`);
  const expected = JSON.stringify(fixture, null, 2) + "\n";
  if (checking) {
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== expected) {
      console.error(`Stale fixture: ${fixture.name}`);
      failures++;
    }
  } else fs.writeFileSync(target, expected);
}
console.log(checking ? `${failures} stale fixture(s)` : "Rebuilt Jev realism fixtures");
process.exitCode = failures ? 1 : 0;
