// The bundled maps as scripts/test_drive_lab.mjs and its arena workers (drive_lab_arena.mjs) load
// them. Import after setting globalThis.document, as the simulation modules expect.
import fs from "node:fs";

const { MapData } = await import("../static/js/map/mapdata.js");

export const names = {
  saskatoon: "ca5573a8d934",
  kitsilano: "623b012bc8b5",
  mount_pleasant: "7165f1c807a8",
  victoria: "d7454a9751b7",
  montreal: "bb9df59633e0",
  toronto: "4a96d42cb3f2",
  ottawa: "d25b07def0d2",
  calgary: "a53c5bcf6438",
  edmonton: "3e794edbefcb",
  winnipeg: "19bb885c9cae",
  halifax: "49db0d437c8c",
};
// (with its bus routes, crosswalks, school and playground zones, level crossings, speed humps and scramble crossings, as the server and the demo serve it)
export const load = (id) => {
  const pack = JSON.parse(fs.readFileSync(new URL(`../data/maps/${names[id]}.v6.pack.json`, import.meta.url)));
  const transit = new URL(`../data/maps/${names[id]}.transit.v1.json`, import.meta.url);
  if (fs.existsSync(transit)) pack.transit = JSON.parse(fs.readFileSync(transit));
  // (crossings v2, with Ontario's pedestrian crossovers, where a map has it)
  const crossings = [2, 1]
    .map((v) => new URL(`../data/maps/${names[id]}.crossings.v${v}.json`, import.meta.url))
    .find((u) => fs.existsSync(u));
  if (crossings) pack.crossings = JSON.parse(fs.readFileSync(crossings));
  const zones = new URL(`../data/maps/${names[id]}.zones.v1.json`, import.meta.url);
  if (fs.existsSync(zones)) pack.zones = JSON.parse(fs.readFileSync(zones));
  const rail = new URL(`../data/maps/${names[id]}.rail.v1.json`, import.meta.url);
  if (fs.existsSync(rail)) pack.rail = JSON.parse(fs.readFileSync(rail));
  // (and speed humps and the like, and scramble crossings)
  for (const name of [
    "calming",
    "scrambles",
    "buslanes",
    "restrictions",
    "contraflow",
    "driveways",
    "parks",
    "bridges",
  ]) {
    const url = new URL(`../data/maps/${names[id]}.${name}.v1.json`, import.meta.url);
    if (fs.existsSync(url)) pack[name] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
};
