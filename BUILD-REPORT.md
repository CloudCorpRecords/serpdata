# BUILD REPORT — serpdata

Rebuild of `com.hasdata/google-search` v1.0.7 (remote-only, keyless capture)
as `@reneturcios/serpdata` 0.1.0 / `io.github.CloudCorpRecords/serpdata`.

## Fixture conflicts

**None.** The brief, the spec prose, and the fixture agree on all 10 tool
names and every required field. Required fields as served, taken from
the fixture (`harness/fixtures/hasdata-google-search-tools-original.json`):

- `hasdata_google_serp_ai_mode_getAiModeResponse` — required: `q`
- `hasdata_google_serp_ai_overview_getAiOverviewResponse` — required: `pageToken`
- `hasdata_google_serp_events_getEventInformation` — required: `pageToken`
- `hasdata_google_serp_immersive_product_getImmersive_e29f691177` — required: `pageToken`
- `hasdata_google_serp_news_getGoogleNews` — required: (none; its schema carries no `required` key, as captured)
- `hasdata_google_serp_product_getProductInformation` — required: `productId`
- `hasdata_google_serp_serp_getSearchResults` — required: `q`
- `hasdata_google_serp_serp_light_getSearchResults` — required: `q`
- `hasdata_google_serp_shopping_getSearchResults` — required: `q`
- `hasdata_google_serp_short_videos_getShortVideosSearchResults` — required: `q`

The immersive-product tool's name carries the upstream-generated suffix
`_e29f691177` and is served verbatim. The fixture's tool literals (name,
title, description, inputSchema — including every `title` key, every
property description and enum, `additionalProperties: false`, and the
`$schema` key on every schema) are served verbatim from
`src/forward.ts`; the TOOL_DEFS literals were generated programmatically
by parsing the fixture JSON and re-serialising it (nothing retyped) and
were verified deep-equal to the fixture at generation time, again by the
registration-integrity test, and again by the parity harness.

## What was built

All 19 factory files under `builds/serpdata/`:

- `package.json` (`@reneturcios/serpdata` 0.1.0, bin
  `serpdata` → `dist/cli.js`, deps exactly `@modelcontextprotocol/sdk ^1`
  + `zod ^3`; devDeps `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 93-char string
  "Google search as JSON: organic results, AI Overview and AI Mode, news, shopping and products.";
  npm entry carries `"version": "0.1.0"`; OCI entry
  `ghcr.io/cloudcorprecords/serpdata:0.1.0` carries **no** version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/serpdata"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0 entry,
  2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/serpdata`, smoke assertion on server name
  `serpdata`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness output.

## Design

- Forwarding client to `https://mcp.hasdata.com/mcp?apis=google_serp`
  (pinned; the query string is part of the pinned URL), overridable via
  `HASDATA_GOOGLE_SEARCH_MCP_URL` (labelled reconstruction). tools/call
  is forwarded as a streamable-HTTP JSON-RPC client: initialize
  (protocolVersion `2025-03-26`, clientInfo `serpdata`) →
  notifications/initialized → tools/call, honouring `Mcp-Session-Id`
  when issued; session established lazily and reused per client.
  Plain-JSON and SSE replies both parsed; the matching-id message
  wins; upstream results pass through verbatim (including `isError`
  and extra fields such as `structuredContent`).
- When `HASDATA_API_KEY` is set, an `x-api-key: <value>` header is
  sent on every upstream request (header name pinned by the registry
  record's remote declaration; forwarding it from this env var is a
  labelled reconstruction — the capture was keyless). When unset, no
  key header is sent. No `Authorization` header is sent in either
  case. Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `serpdata error:` text
  results (labelled reconstruction).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers) serving
  the fixture literals exactly; no `McpServer` + zod registration.
  `src/mcp.ts` also exports `createServer` / `startMcpServer` /
  `handleCallTool` so the MCP layer is testable without a transport;
  the CLI's `mcp` subcommand starts it over stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all tests
  run against a stubbed JSON-RPC upstream. No live network calls in
  tests; no live call claimed anywhere. The captured surface is ten
  read-only fetches over public Google result pages; no write,
  purchase, checkout, messaging, or payment tool exists in the
  surface — none was added.

## Lockfile (Route 3, clean)

Generated in the build dir with `package.json` in place and no
`node_modules` present: `npm install --package-lock-only
--ignore-scripts --offline`. Verified: parses,
`name == @reneturcios/serpdata`, **128 package entries**. Then
`npm install --ignore-scripts --offline` in the build dir for
`node_modules`. No write-guard failure occurred; `dist/` was built
in-tree normally.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js 2294 B, forward.js 48134 B,
  mcp.js 2679 B, all non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage on
  stderr, exit 2
- `npm test` → **44 tests, 44 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 10 tool
  objects in order, exactly the fixture's keys per tool, required
  fields per tool including the news tool's absent `required` key,
  every property key in order per tool, the immersive suffix verbatim;
  session establishment/reuse/session-id handling; env URL override
  and explicit url override; x-api-key header present on every request
  when the key is set / absent when unset / no Authorization header in
  either case; verbatim argument forwarding for five tools including a
  no-argument news call; verbatim result pass-through incl. upstream
  isError and SSE; JSON-RPC/init/malformed/HTTP/throw/timeout failures
  → `serpdata error:`; parseRpcBody JSON + SSE + matching-id cases;
  MCP-layer validation — unknown tool → MethodNotFound, array/string
  args → InvalidParams, valid and omitted-args calls forwarded; CLI
  --version / -v / unknown exit 2 / bad-JSON exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/hasdata-google-search-tools-original.json --rebuild
  "stdio:node builds/serpdata/dist/cli.js mcp" --out
  builds/serpdata/parity-out` (run from `~/workspace/mcp-rebuild-100`)
  → **PASS, parity 100.0, 10/10 identical, no missing/extra/schema
  diffs** (see `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 93 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for serpdata; only the
mechanics were patterned on the sibling staydata build, and only the
fixture's tool literals are served verbatim.
