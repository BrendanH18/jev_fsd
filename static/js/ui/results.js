// The read-only leaderboard (/results, results.html in the demo): every committed result, from
// data/results.json (scripts/build_results.py), served by /api/results or the demo's bundled copy.

import { api, $, h, appUrl } from "../common.js";
import { CHALLENGES } from "../lab/challenges.js";
import { ROAD_TESTS } from "../lab/road-tests.js";
import {
  checkResults,
  summary,
  challengeMatrix,
  cityGrid,
  recordings,
  fractionText,
  percentText,
  moneyText,
  WEATHERS,
  HOME_MAP,
} from "../lab/results.js";

const REPO = "https://github.com/BrendanH18/jev_fsd/blob/main/";
const demo = !!document.querySelector('meta[name="jev-demo"]');
const challenge = (id) => CHALLENGES.find((c) => c.id === id) || ROAD_TESTS.find((t) => t.id === id) || null;
const source = (path) => h("a", { href: REPO + path, target: "_blank", rel: "noopener" }, path);
const sources = (row) =>
  row
    ? row.sources.concat(row.recording && !row.sources.includes(row.recording) ? [row.recording] : []).join(", ")
    : "";
const verdict = (row, text) =>
  h("span", { class: row ? (row.passed === row.total ? "pass" : "fail") : "muted", title: sources(row) || null }, text);
const seconds = (s) => (s === null || s === undefined ? "" : `${Math.round(s)} s`);

function summaryTable(data, { drivers, pilots }) {
  const maps = data.maps || {};
  const others = Math.max(0, ...drivers.map((d) => d.others?.maps || 0));
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "table",
      {},
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "Driver"),
          h("th", {}, "Model"),
          h("th", {}, "60 challenges + 2 road tests"),
          h("th", {}, "Open track"),
          h("th", {}, `City suite, ${maps[HOME_MAP] || HOME_MAP}: ${WEATHERS.join(" · ")}`),
          h("th", {}, `City suite, ${others} other maps (dry)`),
          h("th", {}, "Own decisions"),
          h("th", {}, "Cost of the challenges"),
        ),
      ),
      h(
        "tbody",
        {},
        drivers.map((d) =>
          h(
            "tr",
            {},
            h("td", {}, h("strong", {}, d.label), h("small", {}, d.about)),
            h(
              "td",
              {},
              d.model ? h("code", {}, d.model) : "none",
              d.challenges?.model_requested ? h("small", {}, `asked as ${d.challenges.model_requested}`) : null,
            ),
            h(
              "td",
              {},
              d.challenges ? verdict(d.challenges, fractionText(d.challenges)) : verdict(null, "not run"),
              d.challenges?.failed.length
                ? h("small", {}, `failed ${d.challenges.failed.map((f) => challenge(f.id)?.title || f.id).join(", ")}`)
                : null,
              d.challenges ? h("small", {}, d.challenges.date) : null,
            ),
            h(
              "td",
              {},
              d.open ? verdict(d.open, fractionText(d.open)) : verdict(null, "not run"),
              d.open?.failed.length
                ? h("small", {}, `failed ${d.open.failed.map((f) => challenge(f.id)?.title || f.id).join(", ")}`)
                : null,
              d.open ? h("small", {}, d.open.date) : null,
            ),
            h(
              "td",
              {},
              Object.values(d.home).some(Boolean)
                ? WEATHERS.map((w, i) => [
                    i ? " · " : "",
                    verdict(d.home[w], d.home[w] ? fractionText(d.home[w]) : "–"),
                  ])
                : verdict(null, "not run"),
              Object.values(d.home).some(Boolean)
                ? h(
                    "small",
                    {},
                    [
                      ...new Set(
                        Object.values(d.home)
                          .filter(Boolean)
                          .map((r) => r.date),
                      ),
                    ].join(", "),
                  )
                : null,
            ),
            h(
              "td",
              {},
              d.others
                ? verdict({ ...d.others, sources: d.others.rows.flatMap((r) => r.sources) }, fractionText(d.others))
                : verdict(null, "not run"),
            ),
            h("td", {}, d.challenges && d.challenges.model_share !== undefined ? percentText(d.share) : "n/a"),
            h("td", {}, moneyText(d.cost), d.costTrack ? h("small", {}, "open track") : null),
          ),
        ),
      ),
    ),
    pilots.length
      ? h(
          "p",
          { class: "results-note" },
          "One-challenge pilots: ",
          pilots.map((p, i) => [
            i ? "; " : "",
            h("strong", {}, p.label),
            ` (${p.model}) ${p.passed}/${p.total} on `,
            p.rows.flatMap((r) => r.drives.map((d) => challenge(d.id)?.title || d.id)).join(", "),
            ((cost) => (cost ? `, ${moneyText(cost)} billed` : ", no cost"))(
              p.rows.reduce((t, r) => t + r.cost_usd, 0),
            ),
          ]),
        )
      : null,
  );
}

function challengeTable(matrix, data) {
  if (!matrix.runs.length) return h("p", { class: "muted" }, "No run published yet.");
  const label = (id) => data.drivers[id]?.label || id;
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "table",
      { class: "results-matrix" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", {}, "Challenge"),
          ...matrix.drivers.map((id) => h("th", {}, label(id))),
          h("th", {}, "Try it"),
        ),
      ),
      h(
        "tbody",
        {},
        matrix.rows.map((row) => {
          const c = challenge(row.id);
          return h(
            "tr",
            {},
            h(
              "td",
              {},
              h("strong", {}, c?.title || row.id),
              h("small", {}, `${data.maps?.[row.map] || row.map}${c?.roadTest ? " · road test" : ""}`),
            ),
            ...row.cells.map((cell) =>
              h(
                "td",
                {},
                cell
                  ? [
                      h("span", { class: cell.pass ? "pass" : "fail" }, cell.pass ? "✓ pass" : "✗ fail"),
                      h("small", {}, cell.failures.length ? cell.failures.join(", ") : seconds(cell.time_s)),
                    ]
                  : h("span", { class: "muted" }, "–"),
              ),
            ),
            h(
              "td",
              {},
              c
                ? [
                    h("a", { href: appUrl("", { challenge: row.id }) }, "Drive it"),
                    h("small", {}, h("a", { href: appUrl("", { challenge: row.id, drive: "rules" }) }, "Watch Rules")),
                  ]
                : null,
            ),
          );
        }),
      ),
    ),
  );
}

function cityTable(grid, data) {
  const label = (id) => data.drivers[id]?.label || id;
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "table",
      { class: "results-matrix" },
      h(
        "thead",
        {},
        h("tr", {}, h("th", {}, "Map"), h("th", {}, "Weather"), ...grid.drivers.map((id) => h("th", {}, label(id)))),
      ),
      h(
        "tbody",
        {},
        grid.rows.map((row) =>
          h(
            "tr",
            {},
            h("td", {}, data.maps?.[row.map] || row.map),
            h("td", {}, row.weather),
            ...row.cells.map((cell) =>
              h(
                "td",
                {},
                cell
                  ? [
                      verdict(cell, fractionText(cell)),
                      h(
                        "small",
                        {},
                        cell.failed.length
                          ? cell.failed.map((f) => `${f.id}: ${f.failures.join(", ")}`).join("; ")
                          : cell.date,
                      ),
                    ]
                  : h("span", { class: "muted" }, "not run"),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function replayList(list, data) {
  return h(
    "div",
    { class: "panel results-replay" },
    h(
      "p",
      {},
      "Every model drive is recorded with each answer the model gave, so it replays with no key and no model call. ",
      demo ? "Replay runs in the local app: clone the repository, start its server (" : "With this server running (",
      h("code", {}, "uv run server.py"),
      demo ? ") and run in another terminal:" : "), run in another terminal:",
    ),
    h(
      "ul",
      {},
      list.map((r) =>
        h(
          "li",
          {},
          h("strong", {}, data.drivers[r.driver]?.label || r.driver),
          ` · ${r.label} · `,
          source(r.recording),
          h("pre", {}, r.command),
        ),
      ),
    ),
    h(
      "p",
      { class: "results-note" },
      "A recording replays exactly only on the JavaScript engine and the simulation it was made on. Which drives still replay exactly on the current tree is in ",
      source("docs/model-results.md"),
      ".",
    ),
  );
}

async function main() {
  const status = $("#results-status");
  try {
    const data = checkResults(await api("/api/results"));
    const top = summary(data);
    $("#results-summary").replaceChildren(summaryTable(data, top));
    $("#results-challenges").replaceChildren(challengeTable(challengeMatrix(data), data));
    $("#results-open").replaceChildren(challengeTable(challengeMatrix(data, "open"), data));
    $("#results-city").replaceChildren(cityTable(cityGrid(data), data));
    $("#results-replay").replaceChildren(replayList(recordings(data), data));
    $("#results-sources").replaceChildren(
      h(
        "ul",
        {},
        [...new Set(data.rows.flatMap((r) => r.sources))].sort().map((path) => h("li", {}, source(path))),
      ),
    );
    const dates = [...new Set(data.rows.filter((r) => r.suite !== "bare").map((r) => r.date))].sort();
    status.textContent = `${data.rows.length} committed runs, ${dates[0]} to ${dates.at(-1)}. Hover a result to see the file it came from.`;
  } catch (err) {
    status.textContent = `Could not load the results: ${err.message}`;
  }
}

main();
