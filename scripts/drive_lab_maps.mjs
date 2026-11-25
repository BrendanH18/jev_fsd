// The bundled maps used by the drive-lab tests and their arena workers.
import fs from "node:fs";

const { MapData } = await import("../static/js/map/mapdata.js");

const packVersion = "6";
const bundled = new URL("../data/maps/", import.meta.url);
export const names = Object.freeze({
  saskatoon: "ca5573a8d934",
  kitsilano: "623b012bc8b5",
  mount_pleasant: "7165f1c807a8",
  victoria: "d7454a9751b7",
  montreal: "bb9df59633e0",
  toronto: "4a96d42cb3f2",
  ottawa: "d25b07def0d2",
  quebec_city: "8e99888cb743",
  calgary: "a53c5bcf6438",
  edmonton: "3e794edbefcb",
  winnipeg: "19bb885c9cae",
  halifax: "49db0d437c8c",
});

const layerArrays = {
  transit: ["routes", "stops"],
  crossings: ["crossings"],
  zones: ["zones"],
  rail: ["tracks", "crossings"],
  calming: ["devices"],
  scrambles: ["scrambles"],
  buslanes: ["lanes"],
  restrictions: ["restrictions"],
  contraflow: ["edges"],
  driveways: ["driveways"],
  parks: ["areas", "spans"],
  bridges: ["spans"],
};

function readArtifact(directory, file, kind, version, fields, optional) {
  try {
    const input = fs.readFileSync(new URL(file, directory));
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input));
    if (value?.[`${kind}_version`] !== version) throw new Error(`expected v${version} ${kind}`);
    for (const field of fields) {
      if (
        !Array.isArray(value[field]) ||
        value[field].some((record) => !record || Array.isArray(record) || typeof record !== "object")
      ) {
        throw new Error(`expected ${field} array of objects`);
      }
    }
    return value;
  } catch (error) {
    if (optional && error.code === "ENOENT") return null;
    throw new Error(`Cannot read map artifact ${file}: ${error.message}`, { cause: error });
  }
}

export function readPreparedMap(id, { directory = bundled, onWarning = console.warn } = {}) {
  if (!Object.hasOwn(names, id)) throw new Error(`Unknown drive-lab map ${JSON.stringify(id)}`);
  const key = names[id];
  const pack = readArtifact(directory, `${key}.v${packVersion}.pack.json`, "pack", packVersion, [
    "nodes",
    "edges",
    "lanes",
    "intersections",
    "stops",
    "buildings",
  ]);
  if (pack.name !== key) throw new Error(`Pack ${key} has mismatched name ${JSON.stringify(pack.name)}`);
  for (const [kind, fields] of Object.entries(layerArrays)) {
    const versions = kind === "crossings" ? ["2", "1"] : ["1"];
    let error;
    let loaded;
    for (const version of versions) {
      const file = `${key}.${kind}.v${version}.json`;
      try {
        const layer = readArtifact(directory, file, kind, version, fields, true);
        if (!layer) continue;
        if (layer.name !== undefined && layer.name !== key && layer.name !== "")
          throw new Error(`${file} belongs to a different map`);
        loaded = { layer, file };
      } catch (err) {
        if (error) throw new AggregateError([error, err], `${error.message}; ${err.message}`);
        error = err;
      }
      if (loaded) break;
    }
    if (loaded) {
      pack[kind] = loaded.layer;
      if (error) onWarning(`Using ${loaded.file} after ${error.message}`);
    } else if (error) {
      throw error;
    }
  }
  return pack;
}

export const load = (id) => new MapData(readPreparedMap(id));
