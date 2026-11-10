# serpdata

serpdata is a small local bridge to the hosted HasData
Google Search MCP server, which returns Google search
data as JSON. Ask it a query and it brings back the
full SERP — organic results, ads, knowledge graph,
People Also Ask, AI Overview hooks — or the cheaper
light layout; follow the tokens those responses hand
back and it fetches the AI Overview block, event
details, or an immersive product pop-up. News,
shopping, short videos, and single-product lookups
each have their own tool.

The bridge keeps no search data of its own. It serves
the upstream server's tool list locally, exactly as
captured from the live endpoint, and forwards each
tool call upstream, returning the result untouched.
The captured surface is read-only: every tool fetches
public Google result pages. There is no write,
purchase, checkout, messaging, or payment tool in it.

## Tools

- `hasdata_google_serp_serp_getSearchResults` — the
  full Google SERP. Required: `q`. Optional location
  controls (`location`, `uule`, `domain`, `gl`, `hl`,
  `lr`), place/Knowledge Graph ids, `tbs` time and
  sort filters, `tbm` vertical, `deviceType`, and
  `start`/`num` paging.
- `hasdata_google_serp_serp_light_getSearchResults` —
  the lightweight no-JS SERP layout: faster, organic
  results plus AI Overview, answer box, and knowledge
  graph. Required: `q`.
- `hasdata_google_serp_ai_overview_getAiOverviewResponse`
  — the lazy-loaded AI Overview block. Required:
  `pageToken` (from a SERP response; valid 1 minute).
- `hasdata_google_serp_ai_mode_getAiModeResponse` —
  Gemini-powered AI Mode answers, with optional
  multi-turn continuation. Required: `q`.
- `hasdata_google_serp_news_getGoogleNews` — Google
  News by query or by topic/section/publication/story
  token. No required fields.
- `hasdata_google_serp_shopping_getSearchResults` —
  Google Shopping listings for a query. Required: `q`.
- `hasdata_google_serp_product_getProductInformation`
  — one product's offers, specs, or reviews from
  Google Shopping. Required: `productId`.
- `hasdata_google_serp_immersive_product_getImmersive_e29f691177`
  — expands the Shopping immersive product pop-up
  (the name's suffix is upstream-generated and served
  verbatim). Required: `pageToken`.
- `hasdata_google_serp_events_getEventInformation` —
  full details for one event from a SERP events
  result. Required: `pageToken`.
- `hasdata_google_serp_short_videos_getShortVideosSearchResults`
  — the Short Videos carousel (TikTok, Shorts, Reels)
  for a query. Required: `q`.

## Configuration

- `HASDATA_GOOGLE_SEARCH_MCP_URL` (optional) —
  override the upstream endpoint. Defaults to
  `https://mcp.hasdata.com/mcp?apis=google_serp`.
  (The override hook is this rebuild's own labelled
  reconstruction.)
- `HASDATA_API_KEY` (optional) — when set, every
  upstream request carries an `x-api-key: <key>`
  header, for the caller's own HasData API key. When
  it is not set, no key header is sent. (The header
  name and the env name are pinned by the original's
  registry record; forwarding the key from this env
  var is a labelled reconstruction — the original
  surface was captured keyless.)

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session with the upstream: a JSON-RPC
`initialize` request (protocolVersion `2025-03-26`,
clientInfo name `serpdata`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `serpdata error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/serpdata hasdata_google_serp_serp_getSearchResults '{"q":"HasData CEO","gl":"us"}'
npx @reneturcios/serpdata hasdata_google_serp_news_getGoogleNews '{"q":"open source MCP"}'
npx @reneturcios/serpdata hasdata_google_serp_product_getProductInformation '{"productId":"1234567890","searchType":"offers"}'
npx @reneturcios/serpdata --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/serpdata mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "serpdata": {
      "command": "npx",
      "args": ["-y", "@reneturcios/serpdata", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/serpdata
docker run --rm ghcr.io/cloudcorprecords/serpdata --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
