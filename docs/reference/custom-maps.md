# Custom maps and configuration

Keep custom extracts neighbourhood-sized: roughly 1–2 km across and under 0.25 square degrees.
Use `?bbox=W,S,E,N`, a preset name, or a server default:

```sh
JEV_FSD_BBOX="-123.1120,49.2570,-123.0940,49.2680" uv run server.py
uv run scripts/fetch_map.py mount_pleasant
```

Custom maps download and cache under `data/maps/`. If fetching fails, the app displays a
synthetic practice grid and labels it. Refresh a bundled preset with
`uv run scripts/fetch_map.py victoria --force`; see [map documentation](../maps.md) for raw-cache handling.

| Environment setting | Default | Purpose |
|---|---|---|
| `TYPESAFE_API_KEY` | None | Enable Jev |
| `JEV_FSD_BUDGET_USD` | `1.00` | Cap live Jev, decision-model and LLM spend per server run; an endpoint without a price or reported cost counts as $0 |
| `JEV_FSD_RPM` | `240` | Cap live model calls per minute; an endpoint's own `rpm` replaces it (`0` = none) |
| `JEV_FSD_DECISION_ENDPOINTS` | `data/decision-endpoints.json` | Decision-model drivers ([agent guide](../agents.md#decision-models-jev-and-others)) |
| `JEV_FSD_LLM_ENDPOINTS` | `data/llm-endpoints.json` | LLM endpoint drivers ([agent guide](../agents.md#llm-endpoints-test-your-own-model)) |
| `JEV_FSD_LLM_BASE_URL`, `_MODEL`, `_API_KEY`, `_NAME` | None | One OpenAI-compatible endpoint without a config file (`llm:default`) |
| `JEV_FSD_LLM_PRICE_INPUT_PER_MTOK`, `_OUTPUT_PER_MTOK`, `_TIMEOUT_S` | None, None, `10` | Prices (USD per million tokens) and total per-decision deadline for that endpoint |
| `JEV_FSD_NPCS` | `40` | Set traffic-car count |
| `JEV_FSD_BBOX` | Kitsilano | Select a default area by bounding box or preset |
| `PORT` | `8322` | Set the server port |
| `TYPESAFE_DEFAULT_MODEL` | `jev-latest` | Set the model |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | Set the API endpoint |
