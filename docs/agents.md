# Bring your own driving agent

Open `/arena` to evaluate Rules, Jev (when configured), the free cautious starter, or your own
agent on four fixed challenges. The public demo uses `arena.html` and supports browser agents.
Select **Realtime** when comparing model latency or manual attempts; **Lockstep** waits for a
decision and measures the resulting choices. Changing clocks changes the experiment.

Copy `static/js/agents/cautious.js` to `static/js/agents/my-agent.js`. Change its default
definition's id and label, then open **Settings → Local agent module** and load
`/js/agents/my-agent.js`. On a project-hosted Pages site use `./js/agents/my-agent.js` instead.
The arena has the same loader. A loaded definition is scoped to that page; load it again in
another tab. Modules are trusted JavaScript, not sandboxed plugins.

```js
export default {
  id: "my-driver",
  label: "My driver",
  create: () => ({
    async decide(snap, eligible, request, signal) {
      // snap: the observed world; eligible: candidates that passed shared safety checks.
      // Each candidate includes id, law, steer, speed and sim (3-second prediction).
      const candidate = eligible.reduce((best, c) =>
        c.sim.progress_m > best.sim.progress_m ? c : best);
      return {
        motion: "drive", // "drive", "stop" or "reverse"
        candidateId: candidate.id,
        meta: { source: "my-driver", model: "my-driver",
          latency_ms: 0, input_tokens: 0, cost_usd: 0 }
      };
    }
  })
};
```

The harness rejects an invalid candidate or motion and falls back to Rules. The decision
timeout is 1.5 seconds even if an agent ignores the abort signal; stale results cannot execute.
The emergency brake and safety filtering remain shared. An agent can still choose a poor
eligible manoeuvre, and the simulator still audits collisions and violations.

For a remote model, implement `decide` using `request.state` and `request.questions`, with
the supplied abort signal. Keep provider keys behind a server endpoint, as `JevBrain` does;
GitHub Pages has no private server or secret store. Return measured latency, token counts and
cost in `meta`; set `live_call: true` for a remote request. The adapter contract does not provide
a server proxy for arbitrary providers. An agent factory should return a fresh instance for
each run. Stateful agent internals are not rewound by the simulator's replay recorder.

Evaluation exports include every result, challenge version, map-pack version, seed, weather,
time, vehicle and clock. A pass requires arrival, zero collision/red-light/stop/yield incidents,
and less than one second off-road. Coaching scores are reported separately. Stopped and
timed-out evaluations are labelled and never become passes. These are local results; the app
does not upload them to a public leaderboard. Your browser's saved challenge attempts appear
below the results and label manual, mixed and replay-branch drives.

Run `node --experimental-default-type=module scripts/test_drive_lab.mjs` after changing an
agent or scenario. For broader driving changes, also run the existing seeded city benchmark.
