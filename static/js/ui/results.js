// The read-only leaderboard (/results, results.html in the demo): every committed result, from
// data/results.json (scripts/build_results.py), served by /api/results or the demo's bundled copy.

import { api, $, h, appUrl, copyText } from "../common.js";
import { downloadCsv, downloadJson } from "./export.js";
import { driveScores } from "../bench/scores.js";
import { CHALLENGES } from "../lab/challenges.js";
import { ROAD_TESTS } from "../lab/road-tests.js";
import { mountPublishedReplay } from "./published-replay.js";
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
  resultVersions,
  suiteLabel,
  selectedSuite,
  matchesCoverage,
  driverDisplayName,
} from "../lab/results.js";
import { CUSTOM_SUITE, LEGACY_SUITE, suiteVersion } from "../bench/suite-version.js";

const REPO = "https://github.com/BrendanH18/jev_fsd/blob/main/";
const KITSILANO_REPLAY_SOURCE = "9b53a074ba6e4e17001d904d32fcb67151260eb1";
const KITSILANO_REPLAY_TAG = "replay/kitsilano-city-2026-11-21";
const demo = !!document.querySelector('meta[name="jev-demo"]');
const challenge = (id) => CHALLENGES.find((c) => c.id === id) || ROAD_TESTS.find((t) => t.id === id) || null;
const source = (path, label = path) => h("a", { href: REPO + path, target: "_blank", rel: "noopener" }, label);
const sources = (row) =>
  row
    ? row.sources.concat(row.recording && !row.sources.includes(row.recording) ? [row.recording] : []).join(", ")
    : "";
const verdict = (row, text) =>
  h("span", { class: row ? (row.passed === row.total ? "pass" : "fail") : "muted", title: sources(row) || null }, text);
const seconds = (s) => (s === null || s === undefined ? "" : `${Math.round(s)} s`);
const submissionSource = (row) => (row?.submitter ? h("small", {}, source(row.sources[0], "Submission report")) : null);
const norm = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function cellScore(cell) {
  if (!cell?.score_inputs) return null;
  return driveScores({ ...cell.score_inputs, time_s: cell.time_s }).score;
}

function sortHeader(label, activeDir, onclick, extra = null) {
  const arrow = activeDir === "asc" ? "▲" : activeDir === "desc" ? "▼" : "⇅";
  const ariaSort = activeDir === "asc" ? "ascending" : activeDir === "desc" ? "descending" : "none";
  return h(
    "th",
    { "aria-sort": ariaSort },
    h(
      "button",
      { type: "button", class: "sort-btn", onclick },
      h("span", {}, label),
      h("span", { class: "sort-arrow", "aria-hidden": "true" }, arrow),
    ),
    extra,
  );
}

function cycleSort(state, column, first, head, render) {
  const focused = [...head.querySelectorAll(".sort-btn")].indexOf(document.activeElement);
  if (state.sortCol !== column) {
    state.sortCol = column;
    state.sortDir = first;
  } else if (state.sortDir === first) {
    state.sortDir = first === "asc" ? "desc" : "asc";
  } else {
    state.sortCol = null;
  }
  render();
  if (focused >= 0) head.querySelectorAll(".sort-btn")[focused]?.focus();
}

function summaryTable(data, { drivers, pilots }, version) {
  const maps = data.maps || {};
  const others = Math.max(0, ...drivers.map((d) => d.others?.maps || 0));
  const exportCsv = () => {
    const headers = [
      "Driver",
      "Model",
      "Challenges",
      "Open track",
      "Open flagged choices",
      `City suite ${maps[HOME_MAP] || HOME_MAP}`,
      `City suite ${others} other maps`,
      "Own decisions",
      "Cost USD",
    ];
    const rows = drivers.map((d) => [
      d.label,
      d.model || "none",
      d.challenges ? fractionText(d.challenges) : "not run",
      d.open ? fractionText(d.open) : "not run",
      d.open ? (d.open.flagged_choices ?? 0) : "",
      Object.values(d.home).some(Boolean)
        ? WEATHERS.map((w) => (d.home[w] ? fractionText(d.home[w]) : "-")).join(" / ")
        : "not run",
      d.others ? fractionText(d.others) : "not run",
      d.challenges && d.challenges.model_share !== undefined ? percentText(d.share) : "n/a",
      d.cost ?? 0,
    ]);
    downloadCsv(`jev-results-summary-${version}.csv`, headers, rows);
  };
  const exportJson = () => downloadJson(`jev-results-summary-${version}.json`, { version, drivers, pilots });
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "div",
      { class: "results-toolbar" },
      h("span", { class: "results-toolbar-count" }, `${drivers.length} drivers`),
      h("span", { class: "results-toolbar-spacer" }),
      h(
        "div",
        { class: "results-toolbar-exports" },
        h("button", { type: "button", class: "chip-button", onclick: exportCsv }, "Export CSV"),
        h("button", { type: "button", class: "chip-button", onclick: exportJson }, "Export JSON"),
      ),
    ),
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
          h("th", {}, "Challenges and road tests"),
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
              submissionSource(d.challenges),
            ),
            h(
              "td",
              {},
              d.open ? verdict(d.open, fractionText(d.open)) : verdict(null, "not run"),
              d.open?.failed.length
                ? h("small", {}, `failed ${d.open.failed.map((f) => challenge(f.id)?.title || f.id).join(", ")}`)
                : null,
              d.open ? h("small", {}, `${d.open.flagged_choices ?? 0} flagged choices · ${d.open.date}`) : null,
              submissionSource(d.open),
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
            h(
              "td",
              { title: (d.challenges || d.open)?.cost_basis },
              moneyText(d.cost),
              d.costTrack ? h("small", {}, "open track") : null,
            ),
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
            h("strong", {}, driverDisplayName(data, p.id)),
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

function coveragePicker(state, render) {
  const coverageSelect = h(
    "select",
    {
      onchange: () => {
        state.coverage = coverageSelect.value;
        render();
      },
    },
    h("option", { value: "" }, "Any coverage"),
    h("option", { value: "complete" }, "All drivers measured"),
    h("option", { value: "missing" }, "Missing driver results"),
  );
  return h("label", {}, "Coverage ", coverageSelect);
}

function challengeTable(matrix, data, { open = false, version = LEGACY_SUITE } = {}) {
  if (!matrix.runs.length) return h("p", { class: "muted" }, "No run published yet.");
  const state = { query: "", issuesOnly: false, coverage: "", sortCol: null, sortDir: "asc", sortMetric: "score" };
  const thead = h("thead");
  const tbody = h("tbody");
  const countEl = h("span", { class: "results-toolbar-count", role: "status", "aria-live": "polite" });

  const rowTitle = (row) => challenge(row.id)?.title || row.id;
  const rowMap = (row) => data.maps?.[row.map] || row.map;
  const hasIssue = (row) => {
    const present = row.cells.filter(Boolean);
    if (present.some((c) => !c.pass)) return true;
    const verdicts = new Set(present.map((c) => !!c.pass));
    if (verdicts.size > 1) return true;
    if (open && present.some((c) => (c.flagged_choices || 0) > 0)) return true;
    return false;
  };
  const metricValue = (cell) => {
    if (!cell) return null;
    if (state.sortMetric === "pass") return cell.pass ? 1 : 0;
    if (state.sortMetric === "duration") return Number.isFinite(cell.time_s) ? cell.time_s : null;
    return cellScore(cell);
  };
  const visibleRows = () => {
    const terms = norm(state.query).trim().split(/\s+/).filter(Boolean);
    const filtered = matrix.rows.filter((row) => {
      if ((state.issuesOnly && !hasIssue(row)) || !matchesCoverage(row.cells, state.coverage)) return false;
      if (!terms.length) return true;
      const hay = norm(`${rowTitle(row)} ${row.id} ${rowMap(row)} ${row.map}`);
      return terms.every((term) => hay.includes(term));
    });
    if (state.sortCol === null) return filtered;
    const dir = state.sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (state.sortCol === "challenge") return dir * rowTitle(a).localeCompare(rowTitle(b));
      const av = metricValue(a.cells[state.sortCol]);
      const bv = metricValue(b.cells[state.sortCol]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv) || rowTitle(a).localeCompare(rowTitle(b));
    });
  };
  const toggleSort = (col) => {
    cycleSort(state, col, col === "challenge" || state.sortMetric === "pass" ? "asc" : "desc", thead, render);
  };

  const render = () => {
    const rows = visibleRows();
    countEl.textContent = `Showing ${rows.length} of ${matrix.rows.length}`;
    thead.replaceChildren(
      h(
        "tr",
        {},
        sortHeader("Challenge", state.sortCol === "challenge" ? state.sortDir : null, () => toggleSort("challenge")),
        ...matrix.drivers.map((id, idx) => {
          const run = matrix.runs[idx];
          const flaggedMeta =
            open && run?.flagged_choices !== undefined
              ? h(
                  "span",
                  { class: `th-meta${run.flagged_choices > 0 ? " flagged-count" : ""}` },
                  `${run.flagged_choices} flagged`,
                )
              : null;
          return sortHeader(
            driverDisplayName(data, id),
            state.sortCol === idx ? state.sortDir : null,
            () => toggleSort(idx),
            flaggedMeta,
          );
        }),
        h("th", {}, "Try it"),
      ),
    );
    tbody.replaceChildren(
      ...(rows.length
        ? rows.map((row) => {
            const c = challenge(row.id);
            return h(
              "tr",
              {},
              h(
                "td",
                {},
                h("strong", {}, rowTitle(row)),
                h("small", {}, `${rowMap(row)}${c?.roadTest ? " · road test" : ""}`),
              ),
              ...row.cells.map((cell) => {
                const score = cellScore(cell);
                return h(
                  "td",
                  {},
                  cell
                    ? [
                        h("span", { class: cell.pass ? "pass" : "fail" }, cell.pass ? "✓ pass" : "✗ fail"),
                        h(
                          "small",
                          {},
                          [seconds(cell.time_s), score !== null ? `score ${score}/100` : "score unavailable"]
                            .filter(Boolean)
                            .join(" · "),
                        ),
                        open && cell.flagged_choices !== undefined && cell.flagged_choices !== null
                          ? h(
                              "small",
                              { class: cell.flagged_choices > 0 ? "flagged-count" : "" },
                              `${cell.flagged_choices} flagged choice${cell.flagged_choices === 1 ? "" : "s"}`,
                            )
                          : null,
                        cell.failures.length ? h("small", {}, cell.failures.join(", ")) : null,
                      ]
                    : h("span", { class: "muted" }, "–"),
                );
              }),
              h(
                "td",
                {},
                c
                  ? [
                      h("a", { href: appUrl("", { challenge: row.id }) }, "Drive it"),
                      h(
                        "small",
                        {},
                        h("a", { href: appUrl("", { challenge: row.id, drive: "rules" }) }, "Watch Rules"),
                      ),
                    ]
                  : null,
              ),
            );
          })
        : [
            h(
              "tr",
              {},
              h(
                "td",
                { colspan: matrix.drivers.length + 2, class: "muted" },
                "No challenges match the current filter.",
              ),
            ),
          ]),
    );
  };

  const suiteSlug = open ? "open-track" : "challenges";
  const exportCsv = () => {
    const rows = visibleRows();
    const headers = [
      "Challenge",
      "ID",
      "Map",
      ...matrix.drivers.flatMap((id) => {
        const name = driverDisplayName(data, id);
        return open
          ? [`${name} pass`, `${name} score`, `${name} time_s`, `${name} flagged`]
          : [`${name} pass`, `${name} score`, `${name} time_s`];
      }),
    ];
    const body = rows.map((row) => [
      rowTitle(row),
      row.id,
      rowMap(row),
      ...row.cells.flatMap((cell) => {
        const base = [cell ? (cell.pass ? "pass" : "fail") : "", cellScore(cell) ?? "", cell?.time_s ?? ""];
        return open ? [...base, cell?.flagged_choices ?? ""] : base;
      }),
    ]);
    downloadCsv(`jev-results-${suiteSlug}-${version}.csv`, headers, body);
  };
  const exportJson = () => {
    const rows = visibleRows().map((row) => ({
      id: row.id,
      title: rowTitle(row),
      map: row.map,
      drivers: Object.fromEntries(
        matrix.drivers.map((id, i) => [
          id,
          row.cells[i] ? { ...row.cells[i], computed_score: cellScore(row.cells[i]) } : null,
        ]),
      ),
    }));
    downloadJson(`jev-results-${suiteSlug}-${version}.json`, { version, suite: suiteSlug, rows });
  };

  const searchInput = h("input", {
    type: "search",
    placeholder: "Search challenge or city…",
    "aria-label": open ? "Search open track challenges" : "Search challenges",
    oninput: () => {
      state.query = searchInput.value;
      render();
    },
  });
  const issuesToggle = h("input", {
    type: "checkbox",
    onchange: () => {
      state.issuesOnly = issuesToggle.checked;
      render();
    },
  });
  const metricSelect = h(
    "select",
    {
      "aria-label": "Driver column sort metric",
      onchange: () => {
        state.sortMetric = metricSelect.value;
        if (typeof state.sortCol === "number") render();
      },
    },
    h("option", { value: "score" }, "Sort driver by score"),
    h("option", { value: "duration" }, "Sort driver by duration"),
    h("option", { value: "pass" }, "Sort driver by pass/fail"),
  );

  render();
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "div",
      { class: "results-toolbar" },
      searchInput,
      h("label", {}, issuesToggle, open ? "Failures / disagreements / flagged only" : "Failures / disagreements only"),
      metricSelect,
      coveragePicker(state, render),
      countEl,
      h("span", { class: "results-toolbar-spacer" }),
      h(
        "div",
        { class: "results-toolbar-exports" },
        h("button", { type: "button", class: "chip-button", onclick: exportCsv }, "Export CSV"),
        h("button", { type: "button", class: "chip-button", onclick: exportJson }, "Export JSON"),
      ),
    ),
    h("table", { class: "results-matrix" }, thead, tbody),
  );
}

function cityTable(grid, data, version = LEGACY_SUITE) {
  const state = { query: "", issuesOnly: false, coverage: "", sortCol: null, sortDir: "asc" };
  const thead = h("thead");
  const tbody = h("tbody");
  const countEl = h("span", { class: "results-toolbar-count", role: "status", "aria-live": "polite" });

  const mapName = (row) => data.maps?.[row.map] || row.map;
  const passRate = (cell) => (cell?.total ? cell.passed / cell.total : null);
  const hasIssue = (row) => {
    const present = row.cells.filter(Boolean);
    if (present.some((c) => c.passed < c.total)) return true;
    const rates = new Set(present.map((c) => passRate(c)));
    return rates.size > 1;
  };
  const visibleRows = () => {
    const terms = norm(state.query).trim().split(/\s+/).filter(Boolean);
    const filtered = grid.rows.filter((row) => {
      if ((state.issuesOnly && !hasIssue(row)) || !matchesCoverage(row.cells, state.coverage)) return false;
      if (!terms.length) return true;
      const hay = norm(`${mapName(row)} ${row.map} ${row.weather}`);
      return terms.every((term) => hay.includes(term));
    });
    if (state.sortCol === null) return filtered;
    const dir = state.sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (state.sortCol === "map") return dir * mapName(a).localeCompare(mapName(b));
      if (state.sortCol === "weather") return dir * a.weather.localeCompare(b.weather);
      const av = passRate(a.cells[state.sortCol]);
      const bv = passRate(b.cells[state.sortCol]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir * (av - bv) || mapName(a).localeCompare(mapName(b));
    });
  };
  const toggleSort = (col) => {
    cycleSort(state, col, typeof col === "number" ? "desc" : "asc", thead, render);
  };

  const render = () => {
    const rows = visibleRows();
    countEl.textContent = `Showing ${rows.length} of ${grid.rows.length}`;
    thead.replaceChildren(
      h(
        "tr",
        {},
        sortHeader("Map", state.sortCol === "map" ? state.sortDir : null, () => toggleSort("map")),
        sortHeader("Weather", state.sortCol === "weather" ? state.sortDir : null, () => toggleSort("weather")),
        ...grid.drivers.map((id, idx) =>
          sortHeader(driverDisplayName(data, id), state.sortCol === idx ? state.sortDir : null, () => toggleSort(idx)),
        ),
      ),
    );
    tbody.replaceChildren(
      ...(rows.length
        ? rows.map((row) =>
            h(
              "tr",
              {},
              h("td", {}, mapName(row)),
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
                        cell.model
                          ? h(
                              "small",
                              { title: cell.cost_basis },
                              `${percentText(cell.model_share)} model decisions · Rules fallbacks ${cell.fallbacks} · ${moneyText(cell.cost_usd)}`,
                            )
                          : null,
                      ]
                    : h("span", { class: "muted" }, "not run"),
                ),
              ),
            ),
          )
        : [
            h(
              "tr",
              {},
              h("td", { colspan: grid.drivers.length + 2, class: "muted" }, "No city runs match the current filter."),
            ),
          ]),
    );
  };

  const exportCsv = () => {
    const rows = visibleRows();
    const headers = ["Map", "Weather", ...grid.drivers.map((id) => driverDisplayName(data, id))];
    const body = rows.map((row) => [
      mapName(row),
      row.weather,
      ...row.cells.map((cell) => (cell ? fractionText(cell) : "not run")),
    ]);
    downloadCsv(`jev-results-city-${version}.csv`, headers, body);
  };
  const exportJson = () => {
    const rows = visibleRows().map((row) => ({
      map: row.map,
      weather: row.weather,
      drivers: Object.fromEntries(grid.drivers.map((id, i) => [id, row.cells[i] || null])),
    }));
    downloadJson(`jev-results-city-${version}.json`, { version, suite: "city", rows });
  };

  const searchInput = h("input", {
    type: "search",
    placeholder: "Search city or weather…",
    "aria-label": "Search city suite",
    oninput: () => {
      state.query = searchInput.value;
      render();
    },
  });
  const issuesToggle = h("input", {
    type: "checkbox",
    onchange: () => {
      state.issuesOnly = issuesToggle.checked;
      render();
    },
  });

  render();
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "div",
      { class: "results-toolbar" },
      searchInput,
      h("label", {}, issuesToggle, "Failures / disagreements only"),
      coveragePicker(state, render),
      countEl,
      h("span", { class: "results-toolbar-spacer" }),
      h(
        "div",
        { class: "results-toolbar-exports" },
        h("button", { type: "button", class: "chip-button", onclick: exportCsv }, "Export CSV"),
        h("button", { type: "button", class: "chip-button", onclick: exportJson }, "Export JSON"),
      ),
    ),
    h("table", { class: "results-matrix" }, thead, tbody),
  );
}

function replayList(list, data) {
  return h(
    "div",
    { class: "panel results-replay" },
    h(
      "p",
      {},
      "Replay other published drives in the terminal using the saved answers, with no model calls. ",
      demo ? "Clone the repository. " : "",
      "Start the server from the recorded checkout when specified (",
      h("code", {}, "uv run server.py"),
      ") and run the replay in another terminal.",
    ),
    h(
      "ul",
      {},
      list.map((r) => {
        const kitsilano = r.sourceCommit === KITSILANO_REPLAY_SOURCE;
        const copyBtn = h(
          "button",
          {
            type: "button",
            class: "chip-button results-copy-btn",
            onclick: async () => {
              const ok = await copyText(r.command);
              copyBtn.textContent = ok ? "Copied" : "Copy failed";
              setTimeout(() => {
                copyBtn.textContent = "Copy command";
              }, 1400);
            },
          },
          "Copy command",
        );
        return h(
          "li",
          {},
          h("strong", {}, driverDisplayName(data, r.driver)),
          ` · ${suiteLabel(r.suite_version)} · ${r.label} · `,
          source(r.recording),
          r.sourceCommit
            ? h(
                "p",
                { class: "results-note" },
                "For exact replay, use ",
                h("code", {}, r.engine),
                " and check out ",
                h("code", {}, kitsilano ? KITSILANO_REPLAY_TAG : r.sourceCommit),
                ". Replace the recording path below with its absolute path. ",
                r.legacyReplay
                  ? "Look for the terminal line confirming that all drives played out as recorded. "
                  : null,
                kitsilano
                  ? source(
                      "docs/validation/city-model-pilots.md#replay-the-city-recordings",
                      "Replay worktree instructions",
                    )
                  : null,
              )
            : null,
          h("div", { class: "results-cmd-wrap" }, h("pre", {}, r.command), copyBtn),
        );
      }),
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
    const versions = resultVersions(data);
    const filter = $("#results-version");
    filter.replaceChildren(...versions.map((v) => h("option", { value: v }, suiteLabel(v))));
    $("#suite-filter").hidden = versions.length < 2;
    const readSuite = () => selectedSuite(versions, new URL(location.href).searchParams.get("suite"));
    filter.value = readSuite();
    const renderVersion = () => {
      const version = filter.value || LEGACY_SUITE;
      const rows = data.rows.filter((row) => suiteVersion(row) === version);
      const custom = version === CUSTOM_SUITE;
      for (const id of ["challenges", "open", "city"]) $(`#results-${id}`).closest("section").hidden = custom;
      $("#results-summary").replaceChildren(
        custom
          ? h(
              "ul",
              {},
              rows.map((row) =>
                h(
                  "li",
                  {},
                  `${driverDisplayName(data, row.driver)} · ${row.label} · ${row.track} · ${fractionText(row)} · ${row.date}`,
                  row.sources.flatMap((path, i) => [
                    " · ",
                    source(path, row.submitter ? (i ? "Recording" : "Report") : path),
                  ]),
                ),
              ),
            )
          : summaryTable(data, summary(data, version), version),
      );
      if (!custom) {
        $("#results-challenges").replaceChildren(
          challengeTable(challengeMatrix(data, "challenges", version), data, { open: false, version }),
        );
        $("#results-open").replaceChildren(
          challengeTable(challengeMatrix(data, "open", version), data, { open: true, version }),
        );
        $("#results-city").replaceChildren(cityTable(cityGrid(data, version), data, version));
      }
      const dates = rows
        .map((row) => row.date)
        .filter(Boolean)
        .sort();
      const period = dates.length ? `, ${dates[0]} to ${dates.at(-1)}` : "";
      status.textContent = `${suiteLabel(version)} · ${rows.length} committed ${rows.length === 1 ? "run" : "runs"}${period}.`;
    };
    filter.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("suite", filter.value);
      history.replaceState(history.state, "", url);
      renderVersion();
    });
    renderVersion();
    $("#results-replay").replaceChildren(replayList(recordings(data), data));
    $("#results-sources").replaceChildren(
      h(
        "ul",
        {},
        [...new Set(data.rows.flatMap((r) => r.sources))].sort().map((path) => h("li", {}, source(path))),
      ),
    );
    // The tables above the replay grow after a direct link has already scrolled to its fragment.
    if (location.hash === "#replay-heading") $(location.hash).scrollIntoView();
  } catch (err) {
    status.textContent = `Could not load the results: ${err.message}`;
  }
}

main();
mountPublishedReplay($("#published-replay"));
