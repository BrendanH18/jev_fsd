import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { checkLocalDriverId } from "./local_recording.mjs";
import { isId } from "./recording_artifacts.mjs";

export function scaffoldDriver(path, id = basename(path, ".mjs"), label = id) {
  if (!path.endsWith(".mjs")) throw new Error("--scaffold must end in .mjs.");
  checkLocalDriverId(id);
  if (!isId(label) || /[\r\n]/.test(label)) throw new Error("--label needs a nonempty single line.");
  const text = `// A starter agent for Jev FSD. Keep only the logic you want to evaluate.
export default {
  id: ${JSON.stringify(id)},
  label: ${JSON.stringify(label)},
  create: () => ({
    async decide(_snapshot, eligible, _request, _signal) {
      // Prefer a clear forward manoeuvre with the most predicted progress.
      const clear = eligible.filter((candidate) => !candidate.flagged && candidate.id !== "hard_brake");
      const best = clear.reduce((first, candidate) =>
        !first || candidate.sim.progress_m > first.sim.progress_m ? candidate : first, null);
      const choice = best ?? eligible.find((candidate) => candidate.id === "hard_brake");
      if (!choice) return null; // Let the harness fall back to Rules.
      return { motion: choice.id === "hard_brake" ? "stop" : "drive", candidateId: choice.id };
    },
  }),
};
`;
  writeFileSync(path, text, { flag: "wx" });
}
