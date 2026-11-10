# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted HasData Google Search MCP server, serving all ten captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `hasdata_google_serp_ai_mode_getAiModeResponse`, `hasdata_google_serp_ai_overview_getAiOverviewResponse`, `hasdata_google_serp_events_getEventInformation`, `hasdata_google_serp_immersive_product_getImmersive_e29f691177`, `hasdata_google_serp_news_getGoogleNews`, `hasdata_google_serp_product_getProductInformation`, `hasdata_google_serp_serp_getSearchResults`, `hasdata_google_serp_serp_light_getSearchResults`, `hasdata_google_serp_shopping_getSearchResults`, `hasdata_google_serp_short_videos_getShortVideosSearchResults`.
- Upstream results pass through verbatim; upstream failures surface as `serpdata error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `HASDATA_GOOGLE_SEARCH_MCP_URL`; when `HASDATA_API_KEY` is set it is sent as an `x-api-key: <value>` header on every upstream request.
