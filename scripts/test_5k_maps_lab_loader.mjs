import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { load, names, readPreparedMap } from "./drive_lab_maps.mjs";

assert.equal(Object.keys(names).length, 12);
assert.equal(Object.isFrozen(names), true);
assert.equal(readPreparedMap("quebec_city").name, names.quebec_city);
assert.equal(load("quebec_city").edges.size > 0, true);
assert.equal(readPreparedMap("toronto").crossings.crossings_version, "2");
assert.throws(() => readPreparedMap("toString"), /Unknown drive-lab map/);

const local = fs.mkdtempSync(path.join(os.tmpdir(), "jev-lab-maps-"));
const directory = pathToFileURL(local + path.sep);
const key = names.kitsilano;
const packFile = `${key}.v6.pack.json`;
const put = (file, content) => fs.writeFileSync(new URL(file, directory), content);
const read = (onWarning) => readPreparedMap("kitsilano", { directory, onWarning });
try {
  assert.throws(() => read(), /Cannot read map artifact.*pack.json/);
  const pack = {
    pack_version: "6",
    name: key,
    nodes: [],
    edges: [],
    lanes: [],
    intersections: [],
    stops: [],
    buildings: [],
  };
  put(packFile, JSON.stringify({ ...pack, name: "wrong" }));
  assert.throws(() => read(), /mismatched name/);
  put(packFile, JSON.stringify({ ...pack, nodes: [null] }));
  assert.throws(() => read(), /expected nodes array of objects/);
  put(packFile, JSON.stringify({ ...pack, pack_version: "5" }));
  assert.throws(() => read(), /expected v6 pack/);
  put(packFile, JSON.stringify(pack));
  assert.equal(read().rail, undefined);
  const v1 = `${key}.crossings.v1.json`;
  const v2 = `${key}.crossings.v2.json`;
  put(v1, JSON.stringify({ crossings_version: "1", name: key, crossings: [] }));
  put(v2, Buffer.from([0xff]));
  let warning = "";
  assert.equal(
    read((text) => {
      warning = text;
    }).crossings.crossings_version,
    "1",
  );
  assert.equal(warning.includes(v1) && warning.includes(v2), true);
  put(v1, JSON.stringify({ crossings_version: "1", crossings: {} }));
  assert.throws(
    () => read(),
    (error) => error instanceof AggregateError && error.errors.length === 2,
  );
  put(v2, JSON.stringify({ crossings_version: "2", crossings: [] }));
  assert.equal(read().crossings.crossings_version, "2");
  put(`${key}.calming.v1.json`, JSON.stringify({ calming_version: "1", name: "different", devices: [] }));
  assert.throws(() => read(), /belongs to a different map/);
} finally {
  fs.rmSync(local, { recursive: true, force: true });
}
