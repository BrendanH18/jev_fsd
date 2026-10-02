# Browser demo on GitHub Pages

Build a static, secret-free site with the Python standard library:

```sh
python3 scripts/build_demo.py
python3 -m http.server 8323 --directory .demo-site
```

Open `http://localhost:8323`. All eight map packs and the Three.js runtime are bundled.
Routing and suggested drives run against the directed lane graph in the browser. Rules and
the cautious starter make no model requests. Jev remains discoverable but requires the local
Python application. Custom map downloads are also local-app features.

The build copies only frontend assets, curated map data, the license and attribution. It never
copies `.env`, provider credentials, saved runs or local reports. Reports and demo benchmark
runs use this browser's local storage. Relative URLs and `appUrl` support a project subpath
such as `/jev_fsd/`; the simulator, benchmark replay, arena and share links all retain that root.

`.github/workflows/demo.yml` builds and checks pull requests, then deploys from `main`. Set
the repository's **Settings → Pages → Source** to **GitHub Actions**. See GitHub's
[custom Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The workflow requests Pages deployment permission only for its deployment job.

The public demo uses browser Dijkstra routing over the map's directed graph, with turn
constraints and the shared JavaScript lane-joining geometry. Its routes can differ from the
Python server's route alternatives and ranking. Authored challenges are identical across both
builds because their route construction and setup are shared. Load a published custom agent
with a relative URL such as `./js/agents/my-agent.js`; a leading `/` points at the domain root.

Use a desktop WebGL browser. Smaller layouts support inspecting the lab, but driving requires
a keyboard. Quality defaults to High; choose Low on slower devices. There is no frame-rate
guarantee or offline-install service worker.
