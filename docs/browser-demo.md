# Browser demo on GitHub Pages

Open the public demo to drive, run the free drivers or watch published model drives. The local app
adds live model connections and custom OpenStreetMap extracts. [Public demo](https://brendanh18.github.io/jev_fsd/)
· [Local quick start](reference/overview.md#quick-start)

## Build and serve a local copy

From the repository root, use Python 3.10 or newer. The static build uses the standard library and
reads the tracked packs, derived map layers and leaderboard. You can build it from a clean checkout
without installing `uv`, Node packages, the TypeSafe SDK or a provider key.

```sh
python3 scripts/build_demo.py
python3 -m http.server 8323 --bind 127.0.0.1 --directory .demo-site
```

Open [127.0.0.1:8323](http://127.0.0.1:8323/). Serve the directory over HTTP so the browser can
load JavaScript modules and fetch JSON. The static preview port is independent of the local
simulator server's default port, 8322.

Use `--output /tmp/jev-demo` to build elsewhere, and pass the same directory to
`http.server --directory`. Choose an empty directory or an earlier demo output. The builder
validates a staged replacement before publishing it. If staging fails, you can keep serving
the existing output. A successful rebuild removes pages and artifacts left over from old builds,
so keep unrelated files outside the generated directory.

To reproduce the project-path deployment locally, generate a child directory and serve its parent.

```sh
python3 scripts/build_demo.py --output /tmp/jev-pages/jev_fsd
python3 -m http.server 8323 --bind 127.0.0.1 --directory /tmp/jev-pages
```

Start at [127.0.0.1:8323/jev_fsd/](http://127.0.0.1:8323/jev_fsd/), including the trailing slash.
Check a direct link and the navigation after changing the page template. For example, open
[`results.html?suite=v1#replay-heading`](http://127.0.0.1:8323/jev_fsd/results.html?suite=v1#replay-heading).
The generated pages are named `bench.html`, `arena.html` and `results.html`. The local Python
server uses the extensionless paths `/bench`, `/arena` and `/results`.

## Drive or compare without a key

- **Start on a specific map.** Add `?map=victoria` at the simulator root for Old Town. Use the map
  IDs from [Canadian city maps](maps.md). For destinations within a map, use **Explore cities** or
  click the minimap. The same URL can open the wheel directly with `&drive=manual`.
- **Try an authored drive.** Open a challenge on the results page or use `?challenge=flagger`.
  The challenge selects the map and conditions from its definition. Complete the original manual
  attempt to record practice and open the comparison in its drive report.
- **Watch a published model.** On `results.html#replay-heading`, select a drive in **Replay a published drive**
  and use its timeline. The four choices include two driver runs of Ottawa's Flagger scenario.
  The page downloads the selected replay's frames separately. Playing them uses zero model calls.
- **Run Rules or the cautious starter.** In `arena.html`, choose a free driver and a set of
  authored drives. In `bench.html`, choose a neighbourhood, seed and preset to sample routes.
  Turn off **Save run** for an exploratory benchmark you do not need in the history.
- **Share an attempt.** Copy its drive link to share the setup, or export the report to share the
  result. Browser device settings, local history and provider credentials are separate from the link.

Browser routing uses Dijkstra over the directed lane graph and returns at most one alternative.
It uses the shared lane joins and can enforce turn restrictions and detour around known closures.
The Python router can rank different alternatives. A demo benchmark is a custom suite, so compare
it with another browser run on the same map, seed, route selection and settings. Authored challenges
use the same route construction and setup in both versions.

The demo runs Rules and the cautious starter without model requests. The leaderboard shows
published Jev and Claude Haiku results, and their curated recordings are playable in the gallery.
Use the local app's model connection flow for a new live run. For an agent hosted with the site,
enter a relative module URL such as `./js/agents/my-agent.js`; a leading slash resolves at the
domain root. [Driver adapter guide](agents.md)

## Keep runs and reports

| Browser data | Where it lives | How to keep a copy |
|---|---|---|
| Drive reports and practice progress | Local storage on the current origin | Export the drive report before clearing site data |
| Demo benchmark runs | Up to ten recent runs in local storage | Use the saved-run selector to revisit them; download a run's JSON to keep it |
| Arena runs and selected baseline | IndexedDB, with a smaller local-storage fallback when IndexedDB is unavailable | Export JSON and use **Import JSON** in the destination browser |
| Active drive rewind and incident frames | Memory for the current drive | Review before leaving the active drive |
| Published leaderboard and curated replays | Static files served with the site | Use the published result sources to obtain the associated run data |

A different hostname, scheme or port has separate storage. For example, a run saved at
`127.0.0.1:8323` will not appear at `localhost:8323`. Changing only the project path on the same
origin leaves origin-scoped history shared. When browser storage is full, saving a benchmark keeps
the earlier runs: the page asks before removing the oldest ones to make room and names any it
removed. Cancel to keep them and download the new run instead. A scripted run
(`window.__bench.run`) keeps them unless it passes a `confirmReplace` callback that returns true. A browser that blocks storage can still run a benchmark
with **Save run** off.

## Verify what will be uploaded

```sh
python3 scripts/build_demo.py --list-maps
python3 scripts/build_demo.py --check --output .demo-site
python3 scripts/build_demo.py --report --output .demo-site
```

Use `--list-maps` before building to see preset IDs, bounds, offsets and whether their packs passed
catalog validation. The checker needs the source checkout for comparison. Run it from the revision
that built the artifact. It checks the exact bundled map contents, including layers selected by the
same loaders as the local app, and compares leaderboard and replay bytes with their sources.
The JSON report includes the release version, leaderboard SHA-256, per-map sizes and the ten
largest files. Use it to diagnose growth in the Pages artifact before deploying.

The map directory of a bundled site is `demo-data/`; its filenames are public map IDs such as
`kitsilano.json`. In the source checkout, packs and layers are named by the bounding box's cache
key. Use the [pack table](maps.md) to locate the corresponding source. A successful build needs
the committed packs. It performs no map downloads and fails with the map or layer name when
a bundled source is invalid.

The leaderboard copies [data/results.json](../data/results.json) verbatim. Use
`uv run --locked scripts/build_results.py` from the source checkout after committing a run or
recording. [Leaderboard publishing workflow](agents.md#publish-a-verified-submission)

## Deploy from GitHub Actions

In the repository's **Settings → Pages**, use **GitHub Actions** as the source. The
[browser demo workflow](../.github/workflows/demo.yml) runs Python, Node and browser jobs before
packaging the site and uploading the Pages artifact. The **Demo checks passed** job checks the
prerequisite results. Deployment runs on `main` and publishes the whole built artifact. Only its
job requests Pages write and ID-token permissions. A newer push cancels an older run on the same
pull request. An active Pages deployment can finish while a newer one waits.
[GitHub custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

All jobs in this workflow use the standard `ubuntu-24.04` runner. The workflow pins the
Playwright version. [Dependabot](../.github/dependabot.yml) groups monthly updates for pinned
Actions, uv-locked Python dependencies and the pinned npm dependency.

The built directory contains the frontend, curated map data and published results and replays,
with the MIT license, Three.js license and map attribution. It excludes the Python service,
`.env` files, saved local runs and raw OSM downloads. Keep `.nojekyll` at the root when uploading
the output.

## Troubleshoot a static preview

| Symptom | What to check |
|---|---|
| The loading screen reports a failed download | Serve the generated directory over HTTP and check the requested asset path. The file URL and a Python server rooted at the source checkout will not serve the generated data. |
| A request for `catalog.json` returns HTML | Check that the host serves static files before any HTML fallback and that you are under the deployed project path. |
| Thumbnails or styles work on the domain root only | Use the nested local preview and run `--check`. Template and import URLs must resolve beneath the project path. |
| A custom bounding box is rejected | Use an exact bundled bounds tuple or select a map ID. For a different extract, open it through the local Python app. |
| Driving looks choppy | Open **Settings** and lower graphics quality. The first visit defaults to High, then the browser remembers quality. A `?quality=low` link makes the starting choice explicit. |
| Touch input is missing during a desktop preview | Add `?touch=1` to expose the input controls, or use a WebGL browser with an actual touch device. [Gamepad and touch](drive-experience.md#gamepad-and-touch) |

The application has no offline-install service worker. A reload after losing the connection
depends on the browser's cache.
