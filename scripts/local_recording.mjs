// Local decision tapes use the same request matching and timeout handling as model tapes.
import { DriveTape, validateAnswers, validateTapeRequest } from "../static/js/brain/recording.js";

import { isId, isRecord } from "./recording_artifacts.mjs";

export const LOCAL_RECORDING_FORMAT = "jev-local-recording/1";

const RESERVED = ["rules", "cautious", "jev"];
const dictionary = (value) => Object.assign(Object.create(null), value);

export function checkLocalDriverId(id) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,39}$/.test(id))
    throw new Error("A local driver id needs 1–40 lowercase letters, digits, hyphens or underscores, starting with a letter.");
  if (RESERVED.includes(id)) throw new Error(`The driver id "${id}" is reserved for a built-in driver.`);
}

export class LocalRecording {
  constructor({ header, results = {}, drives = {} }) {
    checkLocalDriverId(header?.driver);
    this.format = LOCAL_RECORDING_FORMAT;
    this.header = header;
    this.results = dictionary(results);
    this.drives = dictionary(drives);
    this.header.behaviors = dictionary(header.behaviors);
  }

  static parse(value) {
    if (value?.format !== LOCAL_RECORDING_FORMAT) throw new Error(`Expected ${LOCAL_RECORDING_FORMAT}.`);
    const { header, results, drives } = value;
    if (!isRecord(header) || !isRecord(results) || !isRecord(header.behaviors))
      throw new Error("A local recording needs a header, results and driver behavior metadata.");
    validateAnswers(drives);
    for (const [id, answers] of Object.entries(drives)) {
      const behavior = Object.hasOwn(header.behaviors, id) ? header.behaviors[id] : null;
      if (!isRecord(behavior) || typeof behavior.questionDriven !== "boolean")
        throw new Error(`Local drive ${id} needs boolean questionDriven metadata.`);
      if (behavior.timeoutMs !== null && !validTimeout(behavior.timeoutMs))
        throw new Error(`Local drive ${id} has invalid timeoutMs metadata.`);
      for (const outcomes of Object.values(answers)) {
        for (const { response } of outcomes) {
          if (response === undefined) continue;
          if (!isRecord(response) || Object.hasOwn(response, "answer") === Object.hasOwn(response, "failure"))
            throw new Error(`Local drive ${id} must record an answer or a failure.`);
          if (Object.hasOwn(response, "failure") &&
            (!isRecord(response.failure) || typeof response.failure.message !== "string"))
            throw new Error(`Local drive ${id} has a failure without a message.`);
        }
      }
    }
    for (const id of Object.keys(header.behaviors))
      if (!Object.hasOwn(drives, id)) throw new Error(`Local drive ${id} has behavior metadata without a tape.`);
    for (const [id, result] of Object.entries(results))
      if (!isRecord(result)) throw new Error(`Local drive ${id} has an invalid result object.`);
    return new LocalRecording({ header: { ...header }, results, drives });
  }

  tape(id, mode) {
    validateTapeRequest(id, mode);
    if (mode === "record") this.drives[id] = dictionary();
    return new LocalTape(this, String(id), mode);
  }

  serialize() {
    return JSON.stringify(this);
  }
}

const validTimeout = (value) => Number.isFinite(value) && value > 0 && value <= 2 ** 31 - 1;

export function checkedLocalDefinition(definition) {
  if (!isRecord(definition)) throw new Error("Export a local driver definition as the module's default export.");
  checkLocalDriverId(definition.id);
  if (!isId(definition.label)) throw new Error("The local driver needs a nonempty label.");
  if (typeof definition.create !== "function") throw new Error("The local driver needs a create() factory.");
  return {
    ...definition,
    create: () => {
      const brain = definition.create();
      if (!isRecord(brain) || typeof brain.decide !== "function")
        throw new Error(`Local driver ${definition.id} must create an object with decide().`);
      if (brain.questionDriven !== undefined && typeof brain.questionDriven !== "boolean")
        throw new Error(`Local driver ${definition.id} questionDriven must be boolean.`);
      if (brain.timeoutMs != null && !validTimeout(brain.timeoutMs))
        throw new Error(`Local driver ${definition.id} timeoutMs must be a positive supported duration.`);
      return brain;
    },
  };
}

class LocalTape extends DriveTape {
  brainFor(autopilot, id, brain) {
    if (id !== this.driver) throw new Error(`The recording is for ${this.driver}, not ${id}.`);
    const header = this.recording.header;
    let inner;
    if (this.mode === "record") {
      if (typeof brain?.decide !== "function") throw new Error(`Local driver ${id} has no decide() method.`);
      inner = brain.decide.bind(brain);
      header.behaviors[this.driveId] = {
        questionDriven: Boolean(brain.questionDriven),
        timeoutMs: validTimeout(brain.timeoutMs) ? brain.timeoutMs : null,
      };
    }
    const behavior = header.behaviors[this.driveId];
    if (!behavior) throw new Error(`The local recording lacks behavior metadata for ${this.driveId}.`);
    const { questionDriven, timeoutMs } = behavior;
    return {
      questionDriven,
      timeoutMs,
      decide: async (snap, eligible, request, signal) => {
        const { epoch, state, questions, local, flags, mustStop, track } = request;
        const body = { epoch, state, questions, local, flags, mustStop, track, offers: eligible.map(({ id }) => id) };
        const path = "agent:decide";
        // Store agent errors with the metadata the fallback uses and normalize answers before use.
        const run = async () => {
          try {
            return { answer: JSON.parse(JSON.stringify((await inner(snap, eligible, request, signal)) ?? null)) };
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            const { name, status, meta, trace } = error ?? {};
            const message = String(error?.message ?? error);
            try {
              return { failure: JSON.parse(JSON.stringify({ name, status, meta, trace, message })) };
            } catch {
              return { failure: { message, name: typeof name === "string" ? name : "Error" } };
            }
          }
        };
        const { answer, failure } = inner
          ? await this.record(autopilot, run, path, body, { signal })
          : await this.replay(autopilot, path, body, { signal });
        if (failure) {
          const { name, status, meta, trace, message } = failure;
          throw Object.assign(new Error(message), { ...(name === undefined ? {} : { name }), status, meta, trace });
        }
        return answer;
      },
    };
  }
}
