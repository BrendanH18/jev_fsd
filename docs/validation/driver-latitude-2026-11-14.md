# How much is left to the driver — 2026-11-14 (ROADMAP 4.1)

**Result.** Over the 60 challenges, 3,042 of Rules' decisions were sampled. At 3,014 of them no
manoeuvre the safety filter leaves leads to a failure within six seconds. At 24 more, only the
emergency brake does. In 55 challenges no surviving manoeuvre leads to a failure at any sampled decision. Leaving
aside the emergency brake, which is always on offer, a driver can choose its way into a failure at
just four decisions, in three challenges. As they stand, the challenges test the filter, not the
driver.

## Method

`scripts/driver_latitude.mjs` (Rules; nothing in the simulation changes):

1. Drive the challenge with Rules, keeping a checkpoint every second (`lab/recorder.js`, the
   checkpoints replay branches use) and logging the surviving (eligible) candidates of every decision.
2. From each checkpoint, take the next decision's surviving candidates that Rules did not choose. For
   each one, restore the checkpoint into a second world of the same challenge and drive on. A driver
   picks that candidate at every decision for 3 s whenever it survives, and Rules otherwise. Rules
   then drives alone until 6 s after the checkpoint.
3. A decision point "leaves room to fail" when at least one of those branches adds a failure
   (`failures()` in `bench/metrics.js` on the audit counters: collision, red light, stop sign, failure
   to yield and every feature audit). Arrival and parking are not judged in a six-second branch.

Checks on the method. A branch from the first checkpoint with no forced choice repeats the drive to
the micrometre in 59 of 60 challenges. The exception is "Into the sun": there it does not repeat, so
that challenge's zero is less certain. Forced choices do change the drive: 14,370 of the 20,904
branches (69%) leave the car more than 0.5 m from where Rules had it.

Cost: 22.5 minutes on one core in Node 22.23.4, `d547faf`. The run was stopped from outside after "Behind the plow" and resumed with `--only`.
The five challenges with failing branches, and "Into the sun", were run again with the same counts.

```sh
node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 --json latitude.json
node --experimental-default-type=module scripts/driver_latitude.mjs --port 8404 --only snow-stop,scramble
```

The approximation: decisions are sampled once a second rather than every decision cycle (250 or
650 ms), and a forced choice is followed for 3 s, the forward sims' horizon. A failure that needs a
wrong choice held longer, or that shows only after more than six seconds (a timeout, say), is not
counted. Reaching those cases needs longer horizons, or forcing at every decision, which costs about
three times as much.

## Counts

| | Challenges | Decision points | Points with room to fail |
|---|---|---|---|
| All | 60 | 3,042 | 28 |
| Leaving aside the emergency brake | 60 | 3,042 | 4 |

Every sampled decision had at least one surviving alternative to Rules' choice (6.9 on average).

| Challenge | Points | Room to fail | Failing candidate | Failure |
|---|---|---|---|---|
| Bridges freeze first (`bridges-freeze-first`) | 40 | 17 | `hard_brake` | crossed black ice too fast, or braked or steered hard on it |
| On your bumper (`on-your-bumper`) | 91 | 7 | `hard_brake` | braked hard with a tailgater close behind, 3 times with a rear-end collision |
| All walk (`scramble`) | 97 | 2 | `keep_lane_hold`, `right_0.5_hold` (at 68 and 69 s) | failed to yield |
| Winter composure (`snow-stop`) | 76 | 1 | `keep_lane_hold` (at 75 s) | stop sign |
| Keep going safely (`amber-clear`) | 15 | 1 | `keep_lane_slow` (at 46.7 s) | red light |
| The other 55 | 2,723 | 0 | | |

The emergency brake is the one manoeuvre the filter never removes. It fails only where braking hard
is itself the fault: on black ice, and with a tailgater close behind. Those two challenges therefore
measure whether a driver brakes when it need not. The four other points are real latitude: a
manoeuvre that holds the car's speed into a scramble's all-walk, past a stop line, or into the
junction on a fresh red.

Per-challenge counts, every failing branch and the replay check are in
[the machine-readable record](driver-latitude-2026-11-14.json).

## What this means for Phase 4

With the filter as the guarded track has it, a driver can fail a challenge almost only by timing out
or by braking hard at the wrong moment. The open track (ROADMAP 4.2), where the filter advises but
does not remove options, is what gives a driver room to be wrong. This script measures that room
directly: run it again on the open track, and a challenge with no room to fail there is still
testing nothing.
