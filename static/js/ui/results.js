// The read-only leaderboard (/results, results.html in the demo): every committed result, from
// data/results.json (scripts/build_results.py), served by /api/results or the demo's bundled copy.

import { api, $, h, appUrl, copyText } from "../common.js";
import { downloadCsv, downloadJson } from "./export.js";
import { driveScores } from "../bench/scores.js";
import { CHALLENGES } from "../lab/challenges.js";
import { ROAD_TESTS } from "../lab/road-tests.js";
import { CHALLENGE_SCORE_METHOD } from "../lab/score-inputs.js";
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
  mapDisplayName,
  driverDisplayName,
} from "../lab/results.js";
import { CUSTOM_SUITE, LEGACY_SUITE, suiteVersion } from "../bench/suite-version.js";

import {
  filterResultRows,
  readResultFilters,
  writeResultFilters,
  RESULTS_FILTERS,
  searchMatches,
} from "../lab/results-filters.js";

const REPO = "https://github.com/BrendanH18/jev_fsd/blob/main/";
const KITSILANO_REPLAY_SOURCE = "9b53a074ba6e4e17001d904d32fcb67151260eb1";
const KITSILANO_REPLAY_TAG = "replay/kitsilano-city-2026-11-21";
const demo = !!document.querySelector('meta[name="jev-demo"]');
const authoredDrives = new Map([...CHALLENGES, ...ROAD_TESTS].map((drive) => [drive.id, drive]));
const challenge = (id) => authoredDrives.get(id);
const source = (path, label = path) =>
  h("a", { href: REPO + path.split("/").map(encodeURIComponent).join("/"), target: "_blank", rel: "noopener" }, label);
const sources = (row) =>
  row
    ? (row.sources ?? [])
        .concat(row.recording && !row.sources?.includes(row.recording) ? [row.recording] : [])
        .join(", ")
    : "";
const verdict = (row, text) =>
  h("span", { class: row ? (row.passed === row.total ? "pass" : "fail") : "muted", title: sources(row) || null }, text);
const seconds = (s) => (Number.isFinite(s) ? `${s.toFixed(1)} s` : "duration unavailable");
const submissionSource = (row) => (row?.submitter ? h("small", {}, source(row.sources[0], "Submission report")) : null);
function cellScore(cell) {
  if (!cell?.score_inputs) return null;
  return driveScores({ ...cell.score_inputs, time_s: cell.time_s }).score;
}

function pathScore(cell) {
  return cell?.comparison_score_inputs?.method === CHALLENGE_SCORE_METHOD
    ? driveScores(cell.comparison_score_inputs).score
    : null;
}

function sortHeader(label, activeDir, onclick, extra = null) {
  const arrow = activeDir === "asc" ? "▲" : activeDir === "desc" ? "▼" : "⇅";
  const ariaSort = activeDir === "asc" ? "ascending" : activeDir === "desc" ? "descending" : "none";
  return h(
    "th",
    { scope: "col", "aria-sort": ariaSort },
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
  if (state.sort !== column) {
    state.sort = column;
    state.direction = first;
  } else if (state.direction === first) {
    state.direction = first === "asc" ? "desc" : "asc";
  } else {
    state.sort = "";
    state.direction = "";
  }
  render(true);
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
      "Cost track",
    ];
    const rows = drivers.map((d) => [
      d.label,
      d.model || "none",
      d.challenges ? fractionText(d.challenges) : "not run",
      d.open ? fractionText(d.open) : "not run",
      d.open?.flagged_choices ?? "",
      Object.values(d.home).some(Boolean)
        ? WEATHERS.map((w) => (d.home[w] ? fractionText(d.home[w]) : "-")).join(" / ")
        : "not run",
      d.others ? fractionText(d.others) : "not run",
      d.challenges && d.challenges.model_share !== undefined ? percentText(d.share) : "n/a",
      d.cost ?? "",
      d.costTrack ?? (d.challenges ? "guarded" : ""),
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
              d.challenges?.failed?.length
                ? h("small", {}, `failed ${d.challenges.failed.map((f) => challenge(f.id)?.title || f.id).join(", ")}`)
                : null,
              d.challenges ? h("small", {}, d.challenges.date) : null,
              submissionSource(d.challenges),
            ),
            h(
              "td",
              {},
              d.open ? verdict(d.open, fractionText(d.open)) : verdict(null, "not run"),
              d.open?.failed?.length
                ? h("small", {}, `failed ${d.open.failed.map((f) => challenge(f.id)?.title || f.id).join(", ")}`)
                : null,
              d.open
                ? h("small", {}, `${d.open.flagged_choices ?? "Unmeasured"} flagged choices · ${d.open.date}`)
                : null,
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
            p.rows.flatMap((r) => (r.drives ?? []).map((d) => challenge(d.id)?.title || d.id)).join(", "),
            ((cost) => (cost ? `, ${moneyText(cost)} billed` : ", no cost"))(
              p.rows.reduce((t, r) => t + r.cost_usd, 0),
            ),
          ]),
        )
      : null,
  );
}

function filterControls(section, state, config, render) {
  const controls = new Map();
  let debounce;
  const search = h("input", {
    type: "search",
    maxlength: 160,
    value: state.query,
    placeholder: config.placeholder,
    "aria-label": config.placeholder.replace("…", ""),
    oninput: () => {
      state.query = search.value;
      render();
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (search.isConnected) persist();
      }, 180);
    },
  });
  controls.set("query", search);
  for (const [key, { label, choices }] of Object.entries(config.facets)) {
    const select = h(
      "select",
      {
        "aria-label": label,
        onchange: () => {
          state[key] = select.value;
          render(true);
        },
      },
      ...choices.map(([value, name]) => h("option", { value }, name)),
    );
    controls.set(key, select);
  }
  const reset = h(
    "button",
    {
      type: "button",
      class: "chip-button",
      onclick: () => {
        Object.assign(state, RESULTS_FILTERS);
        sync();
        render(true);
        search.focus();
      },
    },
    "Reset filters",
  );
  function sync() {
    for (const [key, control] of controls) control.value = state[key];
  }
  sync();
  const persist = () => {
    const url = new URL(location.href);
    writeResultFilters(url.searchParams, section, state);
    if (url.href === location.href) return;
    try {
      history.replaceState(history.state, "", url);
    } catch {
      // Filtering remains available when the browser throttles URL updates.
    }
  };
  return { controls: [...controls.values(), reset], persist };
}

const coverage = {
  label: "Coverage",
  choices: [
    ["", "All coverage"],
    ["complete", "All drivers measured"],
    ["missing", "Missing driver results"],
  ],
};
const outcome = (open) => ({
  label: "Result outcome",
  choices: [
    ["", "All outcomes"],
    ["any", open ? "Failures or flags" : "Failures / disagreements"],
    ["fail", "Any failure"],
    ["pass", "All measured pass"],
    ["split", "Split verdicts"],
    ...(open ? [["flags", "Flagged choices"]] : []),
  ],
});
const facet = (label, all, values, name = (value) => value) => ({
  label,
  choices: [["", all], ...[...new Set(values)].sort((a, b) => name(a).localeCompare(name(b))).map((v) => [v, name(v)])],
});

function tableFilters(section, data, table, extra, placeholder, keys) {
  const driverName = (id) => driverDisplayName(data, id);
  const facets = {
    issues: outcome(section === "open"),
    coverage,
    map: facet(
      "Filter by map",
      "All maps",
      table.rows.map((row) => row.map),
      (map) => mapDisplayName(data, map),
    ),
    driver: facet("Filter by driver availability", "Any published driver", table.drivers, driverName),
    ...extra,
  };
  const options = Object.fromEntries(
    Object.entries(facets).map(([key, value]) => [key, value.choices.map(([id]) => id)]),
  );
  options.sort = [...keys, ...table.drivers.map((id) => `driver-${id}`)];
  options.direction = ["asc", "desc"];
  return {
    state: readResultFilters(new URL(location.href).searchParams, section, options),
    config: { facets, placeholder },
  };
}

function challengeTable(matrix, data, { open = false, version = LEGACY_SUITE } = {}) {
  if (!matrix.runs.length) return h("p", { class: "muted" }, "No run published yet.");
  const section = open ? "open" : "challenges";
  const { state, config } = tableFilters(
    section,
    data,
    matrix,
    {
      kind: {
        label: "Drive type",
        choices: [
          ["", "All drive types"],
          ["challenge", "Challenges"],
          ["road-test", "Road tests"],
        ],
      },
      metric: {
        label: "Driver column sort metric",
        choices: [
          ["", "Sort driver by score"],
          ["path", "Sort driver by path score"],
          ["duration", "Sort driver by duration"],
          ["pass", "Sort driver by pass/fail"],
          ...(open ? [["flags", "Sort driver by flags"]] : []),
          ["incidents", "Sort driver by incident count"],
        ],
      },
    },
    open ? "Search open track challenges…" : "Search challenges…",
    ["challenge", "map"],
  );

  const thead = h("thead");
  const tbody = h("tbody");
  const countEl = h("span", { class: "results-toolbar-count", role: "status" });
  const rowTitle = (row) => challenge(row.id)?.title || row.id;
  const rowMap = (row) => mapDisplayName(data, row.map);
  const visibleRows = () =>
    filterResultRows(matrix.rows, state, {
      drivers: matrix.drivers,
      describe: (row) => [
        rowTitle(row),
        row.id,
        rowMap(row),
        row.map,
        ...row.cells.flatMap((cell) => cell?.failures ?? []),
      ],
      kind: (row) => (challenge(row.id)?.roadTest ? "road-test" : "challenge"),
      failed: (cell) => !cell.pass,
      metric: (row, column, metric) => {
        if (column === "challenge") return rowTitle(row);
        if (column === "map") return rowMap(row);
        const cell = row.cells[matrix.drivers.indexOf(column.slice(7))];
        if (!cell) return null;
        if (metric === "pass") return Number(cell.pass);
        if (metric === "path") return pathScore(cell);
        if (metric === "duration") return cell.time_s ?? null;
        if (metric === "flags") return cell.flagged_choices ?? null;
        if (metric === "incidents")
          return cell.incident_counts ? Object.values(cell.incident_counts).reduce((total, n) => total + n, 0) : null;
        return cellScore(cell);
      },
    });
  const toggleSort = (col) =>
    cycleSort(
      state,
      col,
      ["challenge", "map"].includes(col) || state.metric === "duration" ? "asc" : "desc",
      thead,
      render,
    );

  const render = (persist = false) => {
    if (persist) filters.persist();
    const rows = visibleRows();
    countEl.textContent = `Showing ${rows.length} of ${matrix.rows.length}`;
    thead.replaceChildren(
      h(
        "tr",
        {},
        sortHeader("Challenge", state.sort === "challenge" ? state.direction : null, () => toggleSort("challenge")),
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
            state.sort === `driver-${id}` ? state.direction : null,
            () => toggleSort(`driver-${id}`),
            flaggedMeta,
          );
        }),
        sortHeader("Map", state.sort === "map" ? state.direction : null, () => toggleSort("map")),
        h("th", { scope: "col" }, "Try it"),
      ),
    );
    tbody.replaceChildren(
      ...(rows.length
        ? rows.map((row) => {
            const c = challenge(row.id);
            return h(
              "tr",
              {},
              h("th", { scope: "row" }, rowTitle(row), c?.roadTest ? h("small", {}, "Road test") : null),
              ...row.cells.map((cell) => {
                const score = cellScore(cell);
                const measuredScore = pathScore(cell);
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
                        measuredScore !== null ? h("small", {}, `Path score ${measuredScore}/100`) : null,
                        open && cell.flagged_choices !== undefined && cell.flagged_choices !== null
                          ? h(
                              "small",
                              { class: cell.flagged_choices > 0 ? "flagged-count" : "" },
                              `${cell.flagged_choices} flagged choice${cell.flagged_choices === 1 ? "" : "s"}`,
                            )
                          : null,
                        cell.failures.length ? h("small", {}, cell.failures.join(", ")) : null,
                      ]
                    : h("span", { class: "muted" }, "not run"),
                );
              }),
              h("td", {}, rowMap(row)),
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
                { colspan: matrix.drivers.length + 3, class: "muted" },
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
      "Drive type",
      "Map",
      "Map ID",
      "Track",
      "Suite version",
      ...matrix.drivers.flatMap((id) => {
        const name = driverDisplayName(data, id);
        const base = [`${name} pass`, `${name} score`, `${name} path score`, `${name} time_s`, `${name} failures`];
        return open ? [...base, `${name} flagged`] : base;
      }),
    ];
    const body = rows.map((row) => [
      rowTitle(row),
      row.id,
      challenge(row.id)?.roadTest ? "road test" : "challenge",
      rowMap(row),
      row.map,
      open ? "open" : "guarded",
      version,
      ...row.cells.flatMap((cell) => {
        const base = [
          cell ? (cell.pass ? "pass" : "fail") : "",
          cellScore(cell) ?? "",
          pathScore(cell) ?? "",
          cell?.time_s ?? "",
          cell?.failures.join("; ") ?? "",
        ];
        return open ? [...base, cell?.flagged_choices ?? ""] : base;
      }),
    ]);
    downloadCsv(`jev-results-${suiteSlug}-${version}.csv`, headers, body);
  };
  const exportJson = () => {
    const rows = visibleRows().map((row) => ({
      id: row.id,
      title: rowTitle(row),
      kind: challenge(row.id)?.roadTest ? "road-test" : "challenge",
      map: row.map,
      map_name: rowMap(row),
      drivers: Object.fromEntries(
        matrix.drivers.map((id, i) => [
          id,
          row.cells[i]
            ? { ...row.cells[i], computed_score: cellScore(row.cells[i]), path_score: pathScore(row.cells[i]) }
            : null,
        ]),
      ),
    }));
    downloadJson(`jev-results-${suiteSlug}-${version}.json`, {
      version,
      suite: suiteSlug,
      track: open ? "open" : "guarded",
      filters: { ...state },
      rows,
    });
  };

  const filters = filterControls(section, state, config, render);

  render();
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "div",
      { class: "results-toolbar" },
      ...filters.controls,
      countEl,
      h("span", { class: "results-toolbar-spacer" }),
      h(
        "div",
        { class: "results-toolbar-exports" },
        h("button", { type: "button", class: "chip-button", onclick: exportCsv }, "Export CSV"),
        h("button", { type: "button", class: "chip-button", onclick: exportJson }, "Export JSON"),
      ),
    ),
    h(
      "div",
      { class: "table-wrap results-scroll", tabindex: 0, role: "region", "aria-labelledby": `${section}-heading` },
      h("table", { class: "results-matrix", "aria-labelledby": `${section}-heading` }, thead, tbody),
    ),
  );
}

function cityTable(grid, data, version = LEGACY_SUITE) {
  const { state, config } = tableFilters(
    "city",
    data,
    grid,
    {
      weather: facet(
        "Filter by weather",
        "All weather",
        grid.rows.map((row) => row.weather),
      ),
      metric: {
        label: "City driver sort metric",
        choices: [
          ["", "Sort driver by pass rate"],
          ["cost", "Sort driver by cost"],
          ["fallbacks", "Sort driver by fallbacks"],
          ["date", "Sort driver by date"],
          ["share", "Sort driver by model share"],
        ],
      },
    },
    "Search city or weather…",
    ["map", "weather"],
  );
  const thead = h("thead");
  const tbody = h("tbody");
  const countEl = h("span", { class: "results-toolbar-count", role: "status" });

  const mapName = (row) => mapDisplayName(data, row.map);
  const visibleRows = () =>
    filterResultRows(grid.rows, state, {
      drivers: grid.drivers,
      describe: (row) => [mapName(row), row.map, row.weather],
      failed: (cell) => cell.passed < cell.total,
      metric: (row, column, metric) => {
        if (column === "map") return mapName(row);
        if (column === "weather") return row.weather;
        const cell = row.cells[grid.drivers.indexOf(column.slice(7))];
        if (!cell) return null;
        if (metric === "cost") return cell.cost_usd ?? null;
        if (metric === "fallbacks") return cell.fallbacks ?? null;
        if (metric === "date") return cell.date ? Date.parse(cell.date) : null;
        if (metric === "share") return cell.model_share ?? null;
        return cell.total ? cell.passed / cell.total : null;
      },
    });
  const toggleSort = (col) => cycleSort(state, col, col.startsWith("driver-") ? "desc" : "asc", thead, render);

  const render = (persist = false) => {
    if (persist) filters.persist();
    const rows = visibleRows();
    countEl.textContent = `Showing ${rows.length} of ${grid.rows.length}`;
    thead.replaceChildren(
      h(
        "tr",
        {},
        sortHeader("Map", state.sort === "map" ? state.direction : null, () => toggleSort("map")),
        sortHeader("Weather", state.sort === "weather" ? state.direction : null, () => toggleSort("weather")),
        ...grid.drivers.map((id) =>
          sortHeader(driverDisplayName(data, id), state.sort === `driver-${id}` ? state.direction : null, () =>
            toggleSort(`driver-${id}`),
          ),
        ),
      ),
    );
    tbody.replaceChildren(
      ...(rows.length
        ? rows.map((row) =>
            h(
              "tr",
              {},
              h("th", { scope: "row" }, mapName(row)),
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
                          cell.failed?.length
                            ? cell.failed.map((f) => `${f.id}: ${f.failures.join(", ")}`).join("; ")
                            : cell.date,
                        ),
                        cell.model
                          ? h(
                              "small",
                              { title: cell.cost_basis },
                              `${percentText(cell.model_share)} model decisions · Rules fallbacks ${cell.fallbacks ?? "n/a"} · ${moneyText(cell.cost_usd)}`,
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
    const headers = [
      "Map",
      "Map ID",
      "Weather",
      "Suite version",
      ...grid.drivers.flatMap((id) => {
        const name = driverDisplayName(data, id);
        return [
          `${name} passed`,
          `${name} total`,
          `${name} date`,
          `${name} cost_usd`,
          `${name} fallbacks`,
          `${name} model_share`,
        ];
      }),
    ];
    const body = rows.map((row) => [
      mapName(row),
      row.map,
      row.weather,
      version,
      ...row.cells.flatMap((c) => [c?.passed, c?.total, c?.date, c?.cost_usd, c?.fallbacks, c?.model_share]),
    ]);
    downloadCsv(`jev-results-city-${version}.csv`, headers, body);
  };
  const exportJson = () => {
    const rows = visibleRows().map((row) => ({
      map: row.map,
      weather: row.weather,
      map_name: mapName(row),
      drivers: Object.fromEntries(grid.drivers.map((id, i) => [id, row.cells[i] || null])),
    }));
    downloadJson(`jev-results-city-${version}.json`, { version, suite: "city", filters: { ...state }, rows });
  };

  const filters = filterControls("city", state, config, render);

  render();
  return h(
    "div",
    { class: "table-wrap panel" },
    h(
      "div",
      { class: "results-toolbar" },
      ...filters.controls,
      countEl,
      h("span", { class: "results-toolbar-spacer" }),
      h(
        "div",
        { class: "results-toolbar-exports" },
        h("button", { type: "button", class: "chip-button", onclick: exportCsv }, "Export CSV"),
        h("button", { type: "button", class: "chip-button", onclick: exportJson }, "Export JSON"),
      ),
    ),
    h(
      "div",
      { class: "table-wrap results-scroll", tabindex: 0, role: "region", "aria-labelledby": "city-heading" },
      h("table", { class: "results-matrix", "aria-labelledby": "city-heading" }, thead, tbody),
    ),
  );
}

function replayList(list, data) {
  if (!list.length) return h("p", { class: "muted" }, "No terminal replays have been published.");
  const items = h("ul");
  const counts = h("p", { role: "status" });
  const search = h("input", {
    type: "search",
    placeholder: "Search terminal replays…",
    "aria-label": "Search terminal replays",
    oninput: () => render(),
  });
  const version = h(
    "select",
    { "aria-label": "Terminal replay suite", onchange: () => render() },
    ...facet(
      "Suite",
      "All suites",
      list.map((r) => r.suite_version),
      suiteLabel,
    ).choices.map(([value, title]) => h("option", { value }, title)),
  );
  function render() {
    const rows = list.filter(
      (r) =>
        (!version.value || version.value === r.suite_version) &&
        searchMatches(search.value, [
          driverDisplayName(data, r.driver),
          r.label,
          r.recording,
          r.engine,
          suiteLabel(r.suite_version),
        ]),
    );
    counts.textContent = rows.length
      ? `Showing ${rows.length} of ${list.length} terminal replays`
      : "No terminal replays match.";
    items.replaceChildren(...rows.map(renderRecording));
  }
  function renderRecording(r) {
    const kitsilano = r.sourceCommit === KITSILANO_REPLAY_SOURCE;
    const copyStatus = h("span", { role: "status" });
    const command = h("pre", { tabindex: "0", "aria-label": "Terminal command" }, r.command);
    const copyBtn = h(
      "button",
      {
        type: "button",
        class: "chip-button results-copy-btn",
        onclick: async () => {
          copyStatus.textContent = "";
          if (await copyText(r.command)) {
            copyStatus.textContent = "Command copied.";
          } else {
            command.focus();
            const selection = document.getSelection();
            const range = document.createRange();
            range.selectNodeContents(command);
            selection?.removeAllRanges();
            selection?.addRange(range);
            copyStatus.textContent = "Use your keyboard to copy the selected command.";
          }
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
            h("code", {}, r.engine || "the recorded Node version"),
            " and check out ",
            h("code", {}, kitsilano ? KITSILANO_REPLAY_TAG : r.sourceCommit),
            ". Replace the recording path below with its absolute path. ",
            r.legacyReplay ? "Look for the terminal line confirming that all drives played out as recorded. " : null,
            kitsilano
              ? source(
                  "docs/validation/city-model-pilots.md#replay-the-city-recordings",
                  "Replay worktree instructions",
                )
              : null,
          )
        : r.engine
          ? h("p", { class: "results-note" }, "Recorded on ", h("code", {}, r.engine), ".")
          : null,
      h("div", { class: "results-cmd-wrap" }, command, copyBtn),
      copyStatus,
    );
  }
  render();
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
    h("div", { class: "results-toolbar" }, search, version, counts),
    items,
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
  status.textContent = "Loading the results…";
  try {
    const data = checkResults(await api("/api/results"));
    const versions = resultVersions(data);
    const filter = $("#results-version");
    filter.replaceChildren(
      ...(versions.length ? versions : [LEGACY_SUITE]).map((v) => h("option", { value: v }, suiteLabel(v))),
    );
    $("#suite-filter").hidden = versions.length < 2;
    const readSuite = () => selectedSuite(versions, new URL(location.href).searchParams.get("suite"));
    filter.value = readSuite();
    const renderVersion = () => {
      const version = filter.value || LEGACY_SUITE;
      const rows = data.rows.filter((row) => suiteVersion(row) === version);
      const custom = version === CUSTOM_SUITE;
      for (const id of ["challenges", "open", "city"]) {
        $(`#results-${id}`).closest("section").hidden = custom;
        $(`.results-jumps a[href="#${id}-heading"]`).hidden = custom;
      }
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
      const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort();
      const period = dates.length > 1 ? `, ${dates[0]} to ${dates.at(-1)}` : dates.length ? `, ${dates[0]}` : "";
      status.textContent = `${suiteLabel(version)} · ${rows.length} committed ${rows.length === 1 ? "run" : "runs"}${period}.`;
    };
    filter.addEventListener("change", () => {
      const url = new URL(location.href);
      url.searchParams.set("suite", filter.value);
      history.replaceState(history.state, "", url);
      renderVersion();
    });
    window.addEventListener("popstate", () => {
      filter.value = readSuite();
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
    const anchor = document.getElementById(location.hash.slice(1));
    if (anchor?.closest("main") && !anchor.closest("[hidden]")) anchor.scrollIntoView();
  } catch (err) {
    status.replaceChildren(
      `Could not load the results. ${err.message} `,
      h("button", { type: "button", class: "chip-button", onclick: main }, "Retry results"),
    );
  }
}

main();
mountPublishedReplay($("#published-replay"));
