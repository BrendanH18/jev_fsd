// Offline map loading shared by the focused city-progress regressions.
import fs from "node:fs";
import { MapData } from "../static/js/map/mapdata.js";
export function kitsilano() {
  const root = new URL("../data/maps/", import.meta.url), key = "623b012bc8b5";
  const pack = JSON.parse(fs.readFileSync(new URL(`${key}.v6.pack.json`, root)));
  for (const layer of ["transit", "crossings", "zones", "rail", "calming", "scrambles", "buslanes", "restrictions", "contraflow", "driveways", "parks", "bridges"]) {
    const url = [2, 1].map(v => new URL(`${key}.${layer}.v${v}.json`, root)).find(u => fs.existsSync(u));
    if (url) pack[layer] = JSON.parse(fs.readFileSync(url));
  }
  return new MapData(pack);
}
