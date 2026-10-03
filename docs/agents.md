# Bring your own driving agent

Open `/arena` to evaluate Rules, Jev (when configured), the free cautious starter, or your own
agent on six fixed challenges. The public demo uses `arena.html` and supports browser agents.
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

Evaluation exports include every result, per-challenge version, map-pack version, seed, weather,
time, vehicle, decision clock, time limit, simulation version and scoring version. A pass
requires arrival, zero collision/red-light/stop/yield incidents,
and less than one second off-road. Coaching scores are reported separately. Stopped and
timed-out evaluations are labelled and never become passes. These are local results; the app
does not upload them to a public leaderboard. Your browser's saved challenge attempts appear
below the results and label manual, mixed and replay-branch drives.

## Saved evaluations and comparisons

Evaluations save automatically to this browser, including completed attempts from a stopped
or failed suite. **View** reopens a saved run; **Export results** downloads the selected run
with its original timestamp. **Import JSON** validates a v1 or v2 export as data and saves it
locally without executing any agent. Up to ten runs fit within a 4 MB history budget; older
runs are dropped first. Storage failures leave the current run available for export. Imports
are limited to 5 MB. **Delete saved run** removes only the selected saved evaluation.

Choose **Compare against**, then a **Baseline driver**. Each current driver is compared with
that driver on matching challenges only. Versions, map, seed, weather, time, vehicle, clock
and time limit must match. Stopped attempts, duplicate matching baseline rows and missing
conditions do not produce deltas. Summary deltas use only matched pairs, so a partial suite
is never compared with a whole suite. Pass-rate changes are percentage points; latency in
summaries is the mean of individual runs' p50 values, not a pooled percentile. These imported
results are self-reported, with no server verification. Legacy v1 exports can be viewed,
but their missing simulation version and time limit prevent comparisons with v2 runs.

Click an agent's name in a result row to inspect its timeline. Audited collisions, red lights,
missed stops, failed yields, hard brakes, the off-road failure threshold, hazard triggers,
emergency brakes, fallbacks and termination events retain their simulation timestamps.
Arena hard-brake counts use the coaching model's events so the totals match the timeline.
Expand an event to see the most recent executed decision, its age, selected candidate,
eligible and rejected options, hazard flags and observed state. Other decisions retain a
compact choice record; full snapshots are kept around timeline events to bound storage use.
This temporal association does not establish causation. Recorded observation state does not
expose unseen hazards.
Older exports retain their scoring incidents but have no recorded decision context.
Traces retain at most 600 decisions and 1,000 events per attempt; truncation is labelled.
This is a decision log, not a saved 3D replay or a capture of custom-agent internals.

Run `node scripts/test_drive_lab.mjs` after changing an
agent or scenario. For broader driving changes, also run the existing seeded city benchmark.
Run `node scripts/test_arena_history.mjs` after changing history, comparisons or trace formats.
These commands require Node 22 or newer. With Playwright installed and a running app, run
`python3 scripts/test_arena_browser.py` for the complete arena workflow; use `--url` for a
static demo and `--chromium` for an existing browser executable.
