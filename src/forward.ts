/**
 * serpdata core: a forwarding client for the hosted
 * HasData Google Search MCP server.
 *
 * No search is run and no result page is read locally.
 * tools/list is answered from the literal tool
 * definitions below, taken verbatim from a live capture
 * of the upstream server (name, title, description and
 * inputSchema exactly as captured, including the title
 * key every tool carries and the upstream-generated
 * suffix on the immersive-product tool's name). A
 * tools/call is forwarded over a streamable-HTTP
 * JSON-RPC session: an initialize POST, a
 * notifications/initialized POST, then the tools/call
 * POST, honouring the Mcp-Session-Id response header
 * when the upstream issues one. The session is
 * established lazily on the first forwarded call and
 * reused for the lifetime of the client.
 *
 * The upstream endpoint is pinned to
 * https://mcp.hasdata.com/mcp?apis=google_serp — the
 * query string is part of the pinned URL — and can be
 * overridden with the HASDATA_GOOGLE_SEARCH_MCP_URL
 * environment variable (that override is a labelled
 * reconstruction). When HASDATA_API_KEY is set in the
 * environment, every upstream request carries an
 * `x-api-key: <key>` header (the header name is pinned
 * by the registry record's remote declaration;
 * forwarding the key from this env var is a labelled
 * reconstruction — the capture itself was taken
 * keyless). When the variable is unset, no key header
 * is sent, and no Authorization header is sent in
 * either case.
 *
 * Upstream results pass through verbatim, including any
 * isError flag and any extra result fields. Failures — a
 * JSON-RPC error from the upstream, a non-2xx status, an
 * unparseable response, or a fetch that throws or times
 * out — surface as an isError result whose text starts
 * with `serpdata error:` (that rendering is a labelled
 * reconstruction). Responses may be plain JSON or SSE
 * (data: lines); the JSON-RPC message with the matching
 * id wins.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://mcp.hasdata.com/mcp?apis=google_serp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/hasdata-google-search-tools-original.json) */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "hasdata_google_serp_ai_mode_getAiModeResponse",
    "title": "google_serp_ai_mode: GET /",
    "description": "Get AI Mode SERP Results\n\nCaptures Gemini-powered AI Mode answers from Google Search. Returns the conversational response text, cited source links, subtopic breakdowns, and, when continuable is set, a subsequentRequestToken for multi-turn continuation. Use for next-gen search interfaces, AI-answer monitoring, citation tracking, content research agents, building question-answering pipelines grounded in live Google results, and person/company data enrichment — e.g. asking `Who is the CEO of HasData?`, `What is Roman Milyushkevich's LinkedIn?`, `HasData founder email`, `HasData Instagram handle` to get a synthesized answer plus source URLs in one call, ideal for lead enrichment, sales research, people search, and filling in contact/attribute gaps for CRM records.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Specify the search term for which you want to scrape the SERP."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "continuable": {
          "type": "boolean",
          "description": "Whether to continue an existing AI Mode conversation."
        },
        "subsequentRequestToken": {
          "type": "string",
          "description": "Token used to continue a previous AI Mode request."
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_ai_overview_getAiOverviewResponse",
    "title": "google_serp_ai_overview: GET /",
    "description": "Get AI Overview Results\n\nFetches the lazy-loaded Google AI Overview block via a pageToken returned by the Google SERP API (token valid for 1 minute). Returns the AI-generated answer text, referenced source URLs, and expanded subtopic sections. Use as a follow-up call to Google SERP for tracking AI citations in SEO, fact-checking answers against sources, and LLM retrieval pipelines grounded in live Google results.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pageToken": {
          "type": "string",
          "description": "Token from `aiOverview` block in Google SERP API. Valid for 1 minute."
        }
      },
      "required": [
        "pageToken"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_events_getEventInformation",
    "title": "google_serp_events: GET /",
    "description": "Get Google Event Details\n\nLooks up a single Google event by the `pageToken` returned in a `google/serp` response's `eventsResults` array (or the ready-to-call `hasdataLink` next to it). Returns the venue name/rating/reviews/website/phone, a map link, a description, ticket sources (with official/unofficial flags), and the primary ticket link — details the SERP events widget does not show inline. The `pageToken` expires a few minutes after it is minted, so fetch it and call this endpoint promptly. Use to enrich an events search result with full venue and ticketing information.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pageToken": {
          "type": "string",
          "description": "Token identifying a single event, taken from the `pageToken` field of an `eventsResults` entry in a `google/serp` response. Expires a few minutes after it is minted."
        }
      },
      "required": [
        "pageToken"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_immersive_product_getImmersive_e29f691177",
    "title": "google_serp_immersive_product: GET /",
    "description": "Get Immersive Product Information\n\nExpands the Google Shopping Immersive Product pop-up given an immersiveProductPageToken from the Google Shopping API, with optional moreStores (up to ~13 merchants instead of 3–5) and nextPageToken for paginating stores. Returns multi-store offers (merchant, price, shipping, URL), product specs, images, ratings, and the storesNextPageToken. Use for price-comparison bots, merchant discovery, dropshipping research, and aggregating full offer lists per product.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "pageToken": {
          "type": "string",
          "description": "Token for displaying more product info in the Google immersive pop-up, available in the Google Shopping API response as the `immersiveProductPageToken` property."
        },
        "moreStores": {
          "type": "boolean",
          "description": "Fetch additional store results in a single search. By default it returns 3–5 stores, and when true it returns up to 13 or the maximum available for the product."
        },
        "nextPageToken": {
          "type": "string",
          "description": "Token used to retrieve the next page of store results."
        }
      },
      "required": [
        "pageToken"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_news_getGoogleNews",
    "title": "google_serp_news: GET /",
    "description": "Get Google News Results\n\nRetrieves Google News results by free-text query, topicToken (World, Business, Technology, etc.), sectionToken, publicationToken (e.g. CNN, BBC), or storyToken (full-coverage cluster with sort by relevance/date). Returns article title, snippet, source publisher, published date, thumbnail, and URL, plus tokens for navigating topics, sub-sections, and story clusters. Use for news monitoring, brand/PR tracking, topical aggregators, publisher-specific feeds, and drilling into full story coverage.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Free-text query as used on news.google.com. Not allowed with `topicToken`, `storyToken`, or `publicationToken`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "topicToken": {
          "type": "string",
          "description": "Token for a Google News topic such as World, Business, or Technology. Not allowed with `q`, `storyToken`, or `publicationToken`."
        },
        "sectionToken": {
          "type": "string",
          "description": "Token for a sub-section under a topic, for example Business → Economy. Use only when `topicToken` or `publicationToken` is present."
        },
        "publicationToken": {
          "type": "string",
          "description": "Token for a specific publisher such as CNN or BBC. Not allowed with `q`, `storyToken`, or `topicToken`."
        },
        "storyToken": {
          "type": "string",
          "description": "Token for a single news story cluster (the “Full coverage” page)."
        },
        "so": {
          "type": "string",
          "enum": [
            "0",
            "1"
          ],
          "description": "Sort order for articles in a story. Use only with storyToken."
        }
      },
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_product_getProductInformation",
    "title": "google_serp_product: GET /",
    "description": "Get Product Information\n\nPulls detailed product data from Google Shopping by productId with searchType (offers, specs, reviews) and rich filters (free shipping, used-condition, sort by price/total price/deals/seller rating, reviews count). Returns product title, images, price, ratings, specs, merchant offers (seller, shipping, condition, total price), and review text depending on searchType. Use for price intelligence, catalog enrichment, review mining, competitor spec comparison, and building shopping assistants that surface the cheapest or highest-rated offer.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "productId": {
          "type": "string",
          "description": "The product ID to get results for."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "searchType": {
          "type": "string",
          "enum": [
            "offers",
            "specs",
            "reviews"
          ],
          "description": "Parameter for fetching specific product information, such as 'offers', 'specs', or 'reviews'."
        },
        "start": {
          "type": "number",
          "description": "This parameter specifies the number of search results to skip and is used for pagination. For example, a value of 0 (default) indicates the first page of results, 10 refers to the second page, and 20 to the third page.\n\nThis parameter is applicable only when `searchType=offers` is specified. For reviews pagination use `filter` parameter.\n"
        },
        "filter": {
          "type": "string",
          "description": "Filter parameter for refining search results. Supports various filters for offers and reviews. Multiple filters can be passed using a comma. The available filters are:\n\nOffers filters:\n- `freeship:1`: Show only products with free shipping.\n- `ucond:1`: Show only used products.\n- `scoring:p`: Sort by base price.\n- `scoring:tp`: Sort by total price.\n- `scoring:cpd`: Sort by current promotion deals (special offers).\n- `scoring:mrd`: Sort by seller's rating.\n\nReviews filters:\n- `rnum:{number}`: Number of results (100 is max).\n"
        }
      },
      "required": [
        "productId"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_serp_getSearchResults",
    "title": "google_serp_serp: GET /",
    "description": "Get Google Search Results\n\nFull-featured Google Search scraper with location/uule, country (gl), language (hl, lr), domain, device type, safesearch, time/date filters via tbs (qdr, cdr), and tbm vertical selection (images, videos, news, shopping, local), plus offset/num pagination (num capped at 10 without tbm). Returns organic results (title, link, snippet, position), ads, knowledge graph, related searches, People Also Ask, local pack, featured snippets, AI Overview pageToken, and rich SERP features. Use for SEO rank tracking, keyword research, SERP-feature monitoring, competitor analysis, grounding LLMs with fresh location-aware search data, and especially for person/company data enrichment — e.g. finding a person's LinkedIn/Instagram/Twitter profile (`Roman Milyushkevich LinkedIn`, `HasData Instagram`), a company's CEO/founder/leadership (`HasData CEO`, `HasData founder`), contact emails (`Roman Milyushkevich HasData email`), phone numbers, GitHub profiles, press mentions, or any public attribute of a person or business by running a targeted query and parsing the top organic results.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Specify the search term for which you want to scrape the SERP."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "lr": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "lang_ar",
              "lang_hy",
              "lang_bg",
              "lang_ca",
              "lang_cs",
              "lang_da",
              "lang_de",
              "lang_el",
              "lang_en",
              "lang_es",
              "lang_et",
              "lang_tl",
              "lang_fi",
              "lang_fr",
              "lang_hr",
              "lang_hi",
              "lang_hu",
              "lang_id",
              "lang_is",
              "lang_it",
              "lang_iw",
              "lang_he",
              "lang_ja",
              "lang_ko",
              "lang_lt",
              "lang_lv",
              "lang_nl",
              "lang_no",
              "lang_fa",
              "lang_pl",
              "lang_pt",
              "lang_ro",
              "lang_ru",
              "lang_sk",
              "lang_sl",
              "lang_sr",
              "lang_sv",
              "lang_th",
              "lang_tr",
              "lang_uk",
              "lang_vi",
              "lang_zh-CN",
              "lang_zh-TW"
            ]
          },
          "description": "The 'lr' parameter specifies the language of the websites to return results from. This parameter filters results based on the language of the web content."
        },
        "ludocid": {
          "type": "string",
          "description": "The Google Place ID for a specific location."
        },
        "lsig": {
          "type": "string",
          "description": "Additional Google Place ID."
        },
        "kgmid": {
          "type": "string",
          "description": "Google Knowledge Graph ID."
        },
        "si": {
          "type": "string",
          "description": "Google Cached Search Parameters ID."
        },
        "tbs": {
          "type": "string",
          "description": "This parameter supports various filters that can be combined by separating them with a comma. Here are examples of these filters:\n\n  - Specific Time Range: `cdr:1,cd_min:10/17/2018,cd_max:3/8/2021` - Filter results to show only those within the defined date range.\n  - Sort by Date: `sbd:1` - Results are sorted by date, from the most recent to the oldest.\n  - Sort by Relevance: `sbd:0` - Results are sorted by relevance to the search query.\n  - Sites with Images: `img:1` - Only show results from webpages that contain images.\n\nQuick Date Range (qdr):\n  - `qdr:h` - Show results from the past hour.\n  - `qdr:d` - Limit results to the past day.\n  - `qdr:w` - Filter results from the week.\n  - `qdr:m` - Display results from the past month.\n  - `qdr:y` - Show results from the past year.\n  - `qdr:h10`, `qdr:d10`, `qdr:w10`, `qdr:m10`, `qdr:y10` - Specify a number to show results from the last 10 hours, days, weeks, months, or years respectively.\n\nThese filters enhance the control over search results, allowing for precise retrieval of information based on specific criteria.\n"
        },
        "safe": {
          "type": "string",
          "enum": [
            "active",
            "off"
          ],
          "description": "Adult Content Filtering option."
        },
        "filter": {
          "type": "number",
          "description": "Defines whether to enable or disable the filters for 'Similar Results' and 'Omitted Results'. Set to 1 (default) to enable these filters, or 0 to disable them.\n"
        },
        "nfpr": {
          "type": "number",
          "description": "Controls if auto-corrected results are shown. 0 includes them (default), 1 shows only the original query. Google may still return auto-corrected results if no others are available.\n"
        },
        "tbm": {
          "type": "string",
          "enum": [
            "isch",
            "vid",
            "nws",
            "shop",
            "lcl"
          ],
          "description": "Specify the type of search."
        },
        "deviceType": {
          "type": "string",
          "enum": [
            "desktop",
            "mobile",
            "tablet"
          ],
          "description": "Specify the device type for the search."
        },
        "start": {
          "type": "number",
          "description": "This parameter specifies the number of search results to skip and is used for implementing pagination. For example, a value of 0 (default) indicates the first page of results, 10 refers to the second page, and 20 to the third page.\n\nFor Google Local Results, the start value must be in multiples of 20, such as 20 for the second page, 40 for the third page, etc.\n"
        },
        "num": {
          "type": "number",
          "description": "Number of results per page, ranging from 10 to 100."
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_serp_light_getSearchResults",
    "title": "google_serp_serp_light: GET /",
    "description": "Get Google Light Search Results\n\nGoogle Search scraper served from the lightweight no-JS layout, cheaper and faster than the full SERP API. Returns organic results (title, link, displayed link, snippet, sitelinks, extensions, date, rating and review count), AI Overview with its text blocks and source references, answer box (featured snippet, calculator, unit and currency conversion, local time), knowledge graph, related questions, related searches, inline images, local pack, search filters, pagination, spelling correction and the location Google actually applied. Shopping, top stories, news, videos and jobs blocks are not served in this layout. Supports location/uule, country (gl), language (hl/lr), domain, safesearch, and time/date filters via tbs (qdr, cdr) with offset/num pagination (num capped at 10). Use for high-volume keyword monitoring, bulk rank tracking, backlink discovery, and AI Overview presence tracking.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Specify the search term for which you want to scrape the SERP."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "lr": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "lang_ar",
              "lang_hy",
              "lang_bg",
              "lang_ca",
              "lang_cs",
              "lang_da",
              "lang_de",
              "lang_el",
              "lang_en",
              "lang_es",
              "lang_et",
              "lang_tl",
              "lang_fi",
              "lang_fr",
              "lang_hr",
              "lang_hi",
              "lang_hu",
              "lang_id",
              "lang_is",
              "lang_it",
              "lang_iw",
              "lang_he",
              "lang_ja",
              "lang_ko",
              "lang_lt",
              "lang_lv",
              "lang_nl",
              "lang_no",
              "lang_fa",
              "lang_pl",
              "lang_pt",
              "lang_ro",
              "lang_ru",
              "lang_sk",
              "lang_sl",
              "lang_sr",
              "lang_sv",
              "lang_th",
              "lang_tr",
              "lang_uk",
              "lang_vi",
              "lang_zh-CN",
              "lang_zh-TW"
            ]
          },
          "description": "The 'lr' parameter specifies the language of the websites to return results from. This parameter filters results based on the language of the web content."
        },
        "tbs": {
          "type": "string",
          "description": "This parameter supports various filters that can be combined by separating them with a comma. Here are examples of these filters:\n\n  - Specific Time Range: `cdr:1,cd_min:10/17/2018,cd_max:3/8/2021` - Filter results to show only those within the defined date range.\n  - Sort by Date: `sbd:1` - Results are sorted by date, from the most recent to the oldest.\n  - Sort by Relevance: `sbd:0` - Results are sorted by relevance to the search query.\n  - Sites with Images: `img:1` - Only show results from webpages that contain images.\n\nQuick Date Range (qdr):\n  - `qdr:h` - Show results from the past hour.\n  - `qdr:d` - Limit results to the past day.\n  - `qdr:w` - Filter results from the week.\n  - `qdr:m` - Display results from the past month.\n  - `qdr:y` - Show results from the past year.\n  - `qdr:h10`, `qdr:d10`, `qdr:w10`, `qdr:m10`, `qdr:y10` - Specify a number to show results from the last 10 hours, days, weeks, months, or years respectively.\n\nThese filters enhance the control over search results, allowing for precise retrieval of information based on specific criteria.\n"
        },
        "safe": {
          "type": "string",
          "enum": [
            "active",
            "off"
          ],
          "description": "Adult Content Filtering option."
        },
        "filter": {
          "type": "number",
          "description": "Defines whether to enable or disable the filters for 'Similar Results' and 'Omitted Results'. Set to 1 (default) to enable these filters, or 0 to disable them.\n"
        },
        "start": {
          "type": "number",
          "description": "This parameter specifies the number of search results to skip and is used for implementing pagination. For example, a value of 0 (default) indicates the first page of results, 10 refers to the second page, and 20 to the third page.\n\nFor Google Local Results, the start value must be in multiples of 20, such as 20 for the second page, 40 for the third page, etc.\n"
        },
        "num": {
          "type": "number",
          "description": "Number of results per page, ranging from 10 to 100."
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_shopping_getSearchResults",
    "title": "google_serp_shopping: GET /",
    "description": "Get Shopping Search Results\n\nScrapes Google Shopping listings for a query with location/uule, country/language/domain, time/date filters, device type, shoprs filter-helper IDs, and offset pagination. Returns product title, price, merchant/source, rating, reviews count, thumbnail, product link, productId, immersiveProductPageToken, and filter chips with hasdata_link for refining by brand/price/condition/promotions. Use for e-commerce price tracking, catalog building, promotion discovery, and feeding productIds into the Product API or tokens into the Immersive Product API for deeper data.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Specify the search term for which you want to scrape the SERP."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "domain": {
          "type": "string",
          "description": "Google domain to use. Default is google.com. Provide one exact documented value (195 allowed), e.g. `google.ac`, `google.ad`."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "tbs": {
          "type": "string",
          "description": "This parameter supports various filters that can be combined by separating them with a comma. Here are examples of these filters:\n\n  - Specific Time Range: `cdr:1,cd_min:10/17/2018,cd_max:3/8/2021` - Filter results to show only those within the defined date range.\n  - Sort by Date: `sbd:1` - Results are sorted by date, from the most recent to the oldest.\n  - Sort by Relevance: `sbd:0` - Results are sorted by relevance to the search query.\n  - Sites with Images: `img:1` - Only show results from webpages that contain images.\n\nQuick Date Range (qdr):\n  - `qdr:h` - Show results from the past hour.\n  - `qdr:d` - Limit results to the past day.\n  - `qdr:w` - Filter results from the week.\n  - `qdr:m` - Display results from the past month.\n  - `qdr:y` - Show results from the past year.\n  - `qdr:h10`, `qdr:d10`, `qdr:w10`, `qdr:m10`, `qdr:y10` - Specify a number to show results from the last 10 hours, days, weeks, months, or years respectively.\n\nThese filters enhance the control over search results, allowing for precise retrieval of information based on specific criteria.\n"
        },
        "shoprs": {
          "type": "string",
          "description": "Specifies the helper ID for applying search filters. Must be used with the updated `q` parameter, which includes the selected filter (e.g., Coffee sale).\n\nTo apply filters, use the `hasdata_link` from `filters[index].options[index]` in the JSON. Apply multiple filters by following each `hasdata_link` one by one.\n\nTo remove a filter, follow its specific `hasdata_link`.\n"
        },
        "deviceType": {
          "type": "string",
          "enum": [
            "desktop",
            "mobile",
            "tablet"
          ],
          "description": "Specify the device type for the search."
        },
        "start": {
          "type": "number",
          "description": "This parameter specifies the number of search results to skip and is used for implementing pagination. For example, a value of 0 (default) indicates the first page of results, 40 refers to the second page, and 80 to the third page.\n"
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  },
  {
    "name": "hasdata_google_serp_short_videos_getShortVideosSearchResults",
    "title": "google_serp_short_videos: GET /",
    "description": "Get Short Videos Search Results\n\nScrapes the Google Short Videos carousel (TikTok, YouTube Shorts, Instagram Reels, etc.) for a query with location/uule, country (gl/cr), language (hl/lr), device type, and page-based pagination. Supports Google's advanced filters (tbs). Returns video title, thumbnail, duration, source platform, channel/creator, direct video URL, the platform's video ID and profile handle, and ready-to-call HasData API links (hasdataLinks) for the video's comments, transcript, profile, posts or channel. Use for short-form content discovery, viral-trend monitoring, influencer research, cross-platform video aggregation, and sourcing short clips to summarize or embed in LLM responses.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "q": {
          "type": "string",
          "description": "Search query term for retrieving short videos results."
        },
        "location": {
          "type": "string",
          "description": "Google canonical location for the search."
        },
        "uule": {
          "type": "string",
          "description": "The encoded location parameter."
        },
        "gl": {
          "type": "string",
          "description": "The two-letter country code for the country you want to limit the search to. Provide one exact documented value (245 allowed), e.g. `ac`, `af`."
        },
        "lr": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "lang_ar",
              "lang_hy",
              "lang_bg",
              "lang_ca",
              "lang_cs",
              "lang_da",
              "lang_de",
              "lang_el",
              "lang_en",
              "lang_es",
              "lang_et",
              "lang_tl",
              "lang_fi",
              "lang_fr",
              "lang_hr",
              "lang_hi",
              "lang_hu",
              "lang_id",
              "lang_is",
              "lang_it",
              "lang_iw",
              "lang_he",
              "lang_ja",
              "lang_ko",
              "lang_lt",
              "lang_lv",
              "lang_nl",
              "lang_no",
              "lang_fa",
              "lang_pl",
              "lang_pt",
              "lang_ro",
              "lang_ru",
              "lang_sk",
              "lang_sl",
              "lang_sr",
              "lang_sv",
              "lang_th",
              "lang_tr",
              "lang_uk",
              "lang_vi",
              "lang_zh-CN",
              "lang_zh-TW"
            ]
          },
          "description": "The 'lr' parameter specifies the language of the websites to return results from. This parameter filters results based on the language of the web content."
        },
        "hl": {
          "type": "string",
          "description": "The two-letter language code for the language you want to use for the search. Provide one exact documented value (159 allowed), e.g. `af`, `ak`."
        },
        "cr": {
          "type": "string",
          "description": "The country code for the country you want to limit the search to. Provide one exact documented value (237 allowed), e.g. `countryAF`, `countryAL`."
        },
        "page": {
          "type": "number",
          "description": "Page number for paginated results, where 0 is the first page."
        },
        "tbs": {
          "type": "string",
          "description": "Google advanced search filters, combined with commas. For example:\n\n  - `qdr:h`, `qdr:d`, `qdr:w`, `qdr:m`, `qdr:y` - Show videos from the past hour, day, week, month, or year.\n"
        },
        "deviceType": {
          "type": "string",
          "enum": [
            "desktop",
            "mobile",
            "tablet"
          ],
          "description": "Specify the device type for the search."
        }
      },
      "required": [
        "q"
      ],
      "additionalProperties": false,
      "$schema": "http://json-schema.org/draft-07/schema#"
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function errorResult(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `serpdata error: ${detail}` }],
    isError: true,
  };
}

function rpcErrorMessage(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Parse a JSON-RPC response body, tolerating SSE framing.
 * Returns the message whose id matches `expectedId` when
 * one is present, else the last parseable message, else
 * null when nothing parses.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const candidates: Record<string, unknown>[] = [];
  const tryPush = (payload: string): void => {
    try {
      const parsed: unknown = JSON.parse(payload);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; ignore this candidate.
    }
  };
  if (trimmed.includes("data:")) {
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") tryPush(payload);
    }
  } else {
    tryPush(trimmed);
  }
  if (candidates.length === 0) return null;
  if (expectedId !== undefined) {
    const match = candidates.find((c) => c.id === expectedId);
    if (match !== undefined) return match;
  }
  return candidates[candidates.length - 1];
}

async function defaultFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session. The
 * session is established lazily on the first forwarded
 * call and reused for the lifetime of the client (the
 * process lifetime when the client is the MCP server's
 * or a one-shot client for the CLI).
 */
export class SerpdataClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private ready = false;
  private sessionPromise: Promise<void> | null = null;
  private idCounter = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? defaultFetch;
  }

  private endpointUrl(): string {
    if (this.deps.url && this.deps.url.trim() !== "") return this.deps.url.trim();
    const raw = (this.deps.env ?? process.env).HASDATA_GOOGLE_SEARCH_MCP_URL;
    if (raw && raw.trim() !== "") return raw.trim();
    return DEFAULT_ENDPOINT_URL;
  }

  private apiKey(): string | null {
    const raw = (this.deps.env ?? process.env).HASDATA_API_KEY;
    if (raw && raw.trim() !== "") return raw.trim();
    return null;
  }

  private timeoutMs(): number {
    if (typeof this.deps.timeoutMs === "number" && this.deps.timeoutMs > 0) {
      return this.deps.timeoutMs;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idCounter += 1;
    return this.idCounter;
  }

  private async post(
    body: unknown,
    withSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.apiKey();
    if (key !== null) headers["x-api-key"] = key;
    if (withSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.ready) return;
    if (this.sessionPromise === null) {
      this.sessionPromise = (async () => {
        const initId = this.nextId();
        const initRes = await this.post(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "serpdata", version: VERSION },
            },
          },
          false,
        );
        const sessionId = initRes.headers.get("mcp-session-id");
        if (sessionId) this.sessionId = sessionId;
        const initText = await initRes.text();
        const initParsed = parseRpcBody(initText, initId);
        if (initParsed !== null && initParsed.error) {
          throw new Error(rpcErrorMessage(initParsed.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initParsed === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const initializedRes = await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await initializedRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.ready = true;
      })();
    }
    try {
      await this.sessionPromise;
    } catch (err) {
      this.sessionPromise = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.ensureSession();
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.post(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return errorResult(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const parsed = parseRpcBody(await callRes.text(), callId);
    if (parsed !== null && parsed.error) {
      return errorResult(rpcErrorMessage(parsed.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return errorResult(`HTTP ${callRes.status}`);
    }
    if (parsed === null) return errorResult("malformed response");
    const result = parsed.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return errorResult("malformed response");
    }
    // Pass the upstream result through verbatim.
    return result;
  }
}

/** Create a forwarding client; tests inject a fake fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): SerpdataClient {
  return new SerpdataClient(deps);
}

/** One-shot helper: a fresh client per call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new SerpdataClient(deps).callTool(name, args);
}
