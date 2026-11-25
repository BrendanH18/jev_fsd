// Arena replay can use historical partial recordings. Publication requires a complete bundle.
import { driverKind, ModelRecording } from "../static/js/brain/recording.js";
import { LOCAL_RECORDING_FORMAT, LocalRecording } from "./local_recording.mjs";
import { isArenaSet, isId, isRecord, isTrack } from "./recording_artifacts.mjs";

export function parseArenaTape(value) {
  const tape = value?.format === LOCAL_RECORDING_FORMAT ? LocalRecording.parse(value) : ModelRecording.parse(value);
  const { header, results, drives } = tape;
  const { arena } = header;
  if (!isRecord(arena)) throw new Error("Expected an Arena recording.");
  if (!isArenaSet(arena.set)) throw new Error("The recording declares an unknown Arena set.");
  if (arena.track !== undefined && !isTrack(arena.track))
    throw new Error("The recording declares an unknown Arena track.");
  if (!Array.isArray(arena.ids) || !arena.ids.every(isId) || new Set(arena.ids).size !== arena.ids.length)
    throw new Error("The recording must declare distinct Arena drive IDs.");
  if (!isRecord(header.maps)) throw new Error("The Arena recording needs a map fingerprint table.");
  const planned = new Set(arena.ids);
  if (!Object.keys(results).length) throw new Error("The Arena recording has no finished drives.");
  for (const [id, result] of Object.entries(results)) {
    if (!planned.has(id)) throw new Error(`Result ${id} is outside the recording's drive plan.`);
    if (result.challenge !== id) throw new Error(`Result ${id} identifies a different challenge.`);
    if (typeof result.pass !== "boolean") throw new Error(`Result ${id} needs a boolean verdict.`);
    if (!Object.hasOwn(drives, id)) throw new Error(`Result ${id} has no decision tape.`);
    if (result.map !== undefined && !Object.hasOwn(header.maps, result.map))
      throw new Error(`Result ${id} refers to an unrecorded map (${result.map}).`);
    if ((result.track ?? "guarded") !== (arena.track ?? "guarded"))
      throw new Error(`Result ${id} uses a different track from the recording.`);
  }
  for (const id of Object.keys(drives))
    if (!Object.hasOwn(results, id)) throw new Error(`Decision tape ${id} has no result.`);
  if (driverKind(header.driver) && Object.keys(tape.scenarios).length)
    throw new Error("An Arena recording cannot contain seeded benchmark scenarios.");
  return tape;
}

export function tapeCounts(tape) {
  const output = { drives: 0, requests: 0, answers: 0, responses: 0, timeouts: 0, cancellations: 0, errors: 0 };
  const local = tape.format === LOCAL_RECORDING_FORMAT;
  if (local) output.driver_failures = 0;
  for (const answers of Object.values(tape.drives)) {
    output.drives++;
    for (const queue of Object.values(answers)) {
      output.requests++;
      output.answers += queue.length;
      for (const result of queue) {
        if (result.timeout) output.timeouts++;
        else if (result.cancelled) output.cancellations++;
        else if (result.error) output.errors++;
        else if (local && result.response?.failure) output.driver_failures++;
        else output.responses++;
      }
    }
  }
  return output;
}
