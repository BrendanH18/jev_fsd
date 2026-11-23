// Local decision tapes use the same request matching and timeout handling as model tapes.
import { DriveTape } from "../static/js/brain/recording.js";

export const LOCAL_RECORDING_FORMAT = "jev-local-recording/1";

export class LocalRecording {
  constructor({ header, results = {}, drives = {} }) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(header?.driver ?? "") || ["rules", "cautious", "jev"].includes(header.driver))
      throw new Error("A local recording needs a custom driver id.");
    Object.assign(this, { format: LOCAL_RECORDING_FORMAT, header, results, drives });
  }

  tape(id, mode) {
    if (mode === "record") this.drives[id] = {};
    return new LocalTape(this, id, mode);
  }

  serialize() {
    return JSON.stringify(this);
  }
}

class LocalTape extends DriveTape {
  brainFor(autopilot, id, brain) {
    if (id !== this.driver) throw new Error(`The recording is for ${this.driver}, not ${id}.`);
    const header = this.recording.header;
    let inner;
    if (this.mode === "record") {
      inner = brain.decide.bind(brain);
      header.behaviors ??= {};
      header.behaviors[this.driveId] = {
        questionDriven: Boolean(brain.questionDriven),
        timeoutMs: Number.isFinite(brain.timeoutMs) && brain.timeoutMs > 0 ? brain.timeoutMs : null,
      };
    }
    const { questionDriven, timeoutMs } = header.behaviors[this.driveId];
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
            return { failure: { name, status, meta, trace, message: String(error?.message ?? error) } };
          }
        };
        const { answer, failure } = inner
          ? await this.record(autopilot, run, path, body, { signal })
          : await this.replay(autopilot, path, body, { signal });
        if (failure) {
          const { name, status, meta, trace, message } = failure;
          throw Object.assign(new Error(message), { name, status, meta, trace });
        }
        return answer;
      },
    };
  }
}
