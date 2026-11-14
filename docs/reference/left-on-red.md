# Left turns on red

`World.leftOnRed` defaults off. Free drives enable it unless `?leftonred=0`;
Lab enables it only for **Left on red** (seed 38042), 14 Avenue SW
(`e594`) onto 5 Street SW (`e593`) in Calgary's committed pack. Both streets
are one-way; two cars approach from the right on 5 Street (`e140`) on green,
using the existing authored cross-traffic machinery. Installation starts simulation
time at 23 s (red for the car, green for cross traffic), without changing the
shared map or signal plan. Sensing adds `intersection.left_on_red` only for legal geometry
on red, outside scrambles. Stop memory, pedestrian conflicts, sight lines,
traffic gaps, Rules target speed and candidate rejection share right-on-red's
machinery. NPCs use the same stop and gap machinery from the leftmost lane.
The audit judges the actual exit, independently of the planned route; illegal
lefts still count as red-light runs. `leftOnRedSeen` records an opportunity;
there is no separate turn counter or change to metrics when disabled.

Jurisdiction eligibility deliberately covers only the bundled map regions;
unknown areas fail closed. The reviewed city bounds are enumerated in
`sim/left-on-red.js`; check provincial law before adding a new city. No left turn
on red is allowed in either Québec map.
Signed turn restrictions apply even when the separate restrictions feature is
off; explicit `no_left_on_red` on an edge/control also prohibits it. Street packs
do not claim an exhaustive inventory of roadside signs.

Provincial sources (checked 2026-11-05):

- [BC Motor Vehicle Act, s.129(3)(b)](https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05#section129): left into a one-way highway after stopping and yielding, unless signed otherwise. BC also permits a two-way approach; this feature deliberately implements only one-way to one-way.
- [Alberta Driver's Guide](https://open.alberta.ca/dataset/387f4e8a-6c0a-456a-ab31-995aadaf1f2b/resource/1edf5165-9c51-4da8-8206-7bf08bb9a76d/download/tran-drivers-guide-2023-04.pdf): one-way to one-way, full stop, safe and unsigned.
- [Saskatchewan SGI, Traffic signals](https://sgi.sk.ca/handbook/-/knowledge_base/drivers/traffic-signals): the red-light turn exception also applies at two one-way streets.
- [Manitoba MPI, Left turns](https://apps.mpi.mb.ca/comms/drivershandbook/left-turns.html): one-way to one-way after stopping and yielding, unless otherwise indicated.
- [Ontario MTO, Traffic lights](https://www.ontario.ca/document/official-mto-drivers-handbook/traffic-lights): one-way to one-way, full stop and clear way.
- [Nova Scotia Using the Road Regulations, s.50(3)–(4)](https://novascotia.ca/just/regulations/regs/2026-230.pdf): one-way to one-way after stopping and yielding, unless prohibited by a traffic control device (effective October 19, 2026).
- [Québec Highway Safety Code, ss.359–359.1](https://www.legisquebec.gouv.qc.ca/fr/document/lc/C-24.2?langCont=en): red requires stopping and waiting; the exception permits right turns only.

Run `node --experimental-default-type=module scripts/test_left_on_red.mjs`
on Node 22. CI's `scripts/test_*.mjs` loop includes it automatically.
The saved Jev requests `data/snapshots/left_on_red_clear.json` and
`left_on_red_traffic.json` cover driving after a full stop and waiting for traffic
from the right; run them with `uv run scripts/verify_jev.py data/snapshots/left_on_red_*.json`.
`scripts/test_drive_lab.mjs` also measures two complete saved arena evaluations
(all challenges with Rules and cautious) and checks the 9 MB cap: 58.7% with
43 challenges, measured 2026-11-05.

## Agent rules

The project rule for this feature, moved here verbatim from `AGENTS.md`, which states the
pattern every opt-in feature shares ([AGENTS.md](../../AGENTS.md#opt-in-features)).

- **Left turns on red are opt-in.** `World` option `leftOnRed` (free drives, unless `?leftonred=0`; challenges with `leftOnRed: true`) permits a left from a one-way approach onto a one-way exit in the supported provincial map regions, after a full stop in the leftmost lane and yielding to pedestrians and traffic from the right. It shares right-on-red sensing, stop memory, gap checks and audit; Québec, scrambles and signed turn bans never qualify (`sim/left-on-red.js`). The reviewed city bounds fail closed for new maps; extend them only after checking provincial law. `World.leftOnRedSeen` records a legal opportunity; no new metric is added. With it off nothing is computed and no random stream is drawn, so the seeded benchmark and other challenges play out and report exactly as before; keep it that way.
