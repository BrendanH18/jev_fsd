// A worker thread for scripts/test_drive_lab.mjs: given a challenge's index in CHALLENGES, drives
// it with Rules and then the cautious agent on one freshly loaded map, as that test's arena loop
// did, and posts back { index, results }. The test spreads the challenges over a few of these.
import { parentPort } from "node:worker_threads";

globalThis.document = { querySelector: () => null };
const { CHALLENGES } = await import("../static/js/lab/challenges.js");
const { evaluateChallenge } = await import("../static/js/lab/evaluation.js");
const { load } = await import("./drive_lab_maps.mjs");

parentPort.on("message", async (index) => {
  const challenge = CHALLENGES[index],
    map = load(challenge.map),
    results = [];
  for (const brain of ["rules", "cautious"]) results.push(await evaluateChallenge(map, challenge, { brain }));
  parentPort.postMessage({ index, results });
});
