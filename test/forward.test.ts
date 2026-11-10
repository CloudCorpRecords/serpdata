import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  SerpdataClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * implementing the streamable-HTTP session flow
 * (initialize -> notifications/initialized -> tools/call):
 * no live network, no live call — the real HasData
 * endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/hasdata-google-search-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const SAMPLE_RESULT = {
  content: [{ type: "text", text: "{\"organicResults\":[],\"count\":0}" }],
  structuredContent: { count: 0 },
};

const SERP = "hasdata_google_serp_serp_getSearchResults";
const NEWS = "hasdata_google_serp_news_getGoogleNews";
const OVERVIEW = "hasdata_google_serp_ai_overview_getAiOverviewResponse";
const PRODUCT = "hasdata_google_serp_product_getProductInformation";
const IMMERSIVE =
  "hasdata_google_serp_immersive_product_getImmersive_e29f691177";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("socket hang up");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-xyz" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "hasdata-google-search", version: "1.0.7" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new SerpdataClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 10 tools, deep-equal", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 10);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 10 tool names in fixture order", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.deepEqual(TOOL_NAMES, [
      "hasdata_google_serp_ai_mode_getAiModeResponse",
      "hasdata_google_serp_ai_overview_getAiOverviewResponse",
      "hasdata_google_serp_events_getEventInformation",
      "hasdata_google_serp_immersive_product_getImmersive_e29f691177",
      "hasdata_google_serp_news_getGoogleNews",
      "hasdata_google_serp_product_getProductInformation",
      "hasdata_google_serp_serp_getSearchResults",
      "hasdata_google_serp_serp_light_getSearchResults",
      "hasdata_google_serp_shopping_getSearchResults",
      "hasdata_google_serp_short_videos_getShortVideosSearchResults",
    ]);
    assert.deepEqual(TOOL_NAMES, fixture.tools.map((t) => t.name));
  });

  it("serves the immersive-product name with its upstream suffix verbatim", () => {
    assert.ok(TOOL_NAMES.includes(IMMERSIVE));
    assert.equal(
      TOOL_DEFS[3].name,
      "hasdata_google_serp_immersive_product_getImmersive_e29f691177",
    );
  });

  it("carries exactly the fixture's keys on every tool", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < fixture.tools.length; i++) {
      assert.deepEqual(
        Object.keys(TOOL_DEFS[i]).sort(),
        Object.keys(fixture.tools[i]).sort(),
      );
      assert.deepEqual(Object.keys(TOOL_DEFS[i]).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
      assert.equal(typeof TOOL_DEFS[i].title, "string");
    }
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = new Map(
      TOOL_DEFS.map((t) => [
        t.name,
        (t.inputSchema as { required?: string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(
      required.get("hasdata_google_serp_ai_mode_getAiModeResponse"),
      ["q"],
    );
    assert.deepEqual(required.get(OVERVIEW), ["pageToken"]);
    assert.deepEqual(
      required.get("hasdata_google_serp_events_getEventInformation"),
      ["pageToken"],
    );
    assert.deepEqual(required.get(IMMERSIVE), ["pageToken"]);
    assert.deepEqual(required.get(NEWS), []);
    assert.deepEqual(required.get(PRODUCT), ["productId"]);
    assert.deepEqual(required.get(SERP), ["q"]);
    assert.deepEqual(
      required.get("hasdata_google_serp_serp_light_getSearchResults"),
      ["q"],
    );
    assert.deepEqual(
      required.get("hasdata_google_serp_shopping_getSearchResults"),
      ["q"],
    );
    assert.deepEqual(
      required.get("hasdata_google_serp_short_videos_getShortVideosSearchResults"),
      ["q"],
    );
  });

  it("carries every fixture property, in order, per tool", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < fixture.tools.length; i++) {
      const served = Object.keys(
        (TOOL_DEFS[i].inputSchema as { properties: object }).properties,
      );
      const expected = Object.keys(
        (fixture.tools[i].inputSchema as { properties: object }).properties,
      );
      assert.deepEqual(served, expected);
    }
    // The news tool's schema carries no `required` key at all, as captured.
    const newsSchema = TOOL_DEFS.find((t) => t.name === NEWS)!
      .inputSchema as Record<string, unknown>;
    assert.equal("required" in newsSchema, false);
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(
      DEFAULT_ENDPOINT_URL,
      "https://mcp.hasdata.com/mcp?apis=google_serp",
    );

    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, {
      name: "serpdata",
      version: VERSION,
    });
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(
        call.headers["Accept"],
        "application/json, text/event-stream",
      );
    }
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-xyz");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-xyz");
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SERP, { q: "first" });
    await c.callTool(NEWS, { q: "second" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-xyz");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the HASDATA_GOOGLE_SEARCH_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new SerpdataClient({
      fetchFn: upstream.fetchFn,
      env: {
        HASDATA_GOOGLE_SEARCH_MCP_URL:
          "https://staging.example.com/mcp?apis=google_serp",
      },
    });
    await c.callTool(SERP, { q: "HasData" });
    assert.ok(
      upstream.calls.every(
        (call) =>
          call.url === "https://staging.example.com/mcp?apis=google_serp",
      ),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool(SERP, { q: "HasData" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"),
    );
  });
});

/* ------------------------------------------------------------------ */

describe("upstream key header", () => {
  it("sends x-api-key: <key> on every request when HASDATA_API_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new SerpdataClient({
      fetchFn: upstream.fetchFn,
      env: { HASDATA_API_KEY: "hasdata-key-42" },
    });
    await c.callTool(SERP, { q: "HasData" });
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every(
        (call) => call.headers["x-api-key"] === "hasdata-key-42",
      ),
    );
  });

  it("sends no x-api-key header when HASDATA_API_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(SERP, { q: "HasData" });
    assert.ok(calls.every((call) => call.headers["x-api-key"] === undefined));
  });

  it("never sends an Authorization header, with or without a key", async () => {
    const withKey = makeUpstream();
    const c1 = new SerpdataClient({
      fetchFn: withKey.fetchFn,
      env: { HASDATA_API_KEY: "hasdata-key-42" },
    });
    await c1.callTool(SERP, { q: "HasData" });
    assert.ok(
      withKey.calls.every((call) => call.headers["Authorization"] === undefined),
    );
    const { client: c2, calls } = stubClient();
    await c2.callTool(SERP, { q: "HasData" });
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  it("forwards full-SERP arguments verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      q: "HasData CEO",
      location: "San Francisco, California, United States",
      gl: "us",
      hl: "en",
      tbm: "nws",
      start: 10,
      num: 10,
    };
    await c.callTool(SERP, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, SERP);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards an AI Overview pageToken call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { pageToken: "tok-overview-1" };
    await c.callTool(OVERVIEW, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, OVERVIEW);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a product-information call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      productId: "987654321",
      searchType: "offers",
      filter: "freeship:1",
    };
    await c.callTool(PRODUCT, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, PRODUCT);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards an immersive-product call under its suffixed name verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { pageToken: "tok-immersive-1", moreStores: true };
    await c.callTool(IMMERSIVE, args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, IMMERSIVE);
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a news call with no arguments as an empty object", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool(NEWS, {});
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, NEWS);
    assert.deepEqual(params.arguments, {});
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "page token expired" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool(OVERVIEW, { pageToken: "stale" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool(PRODUCT, { productId: "987654321" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      NEWS,
      { q: "MCP registry" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, NEWS);
    assert.deepEqual(params.arguments, { q: "MCP registry" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as serpdata error text", () => {
  it("maps a JSON-RPC error to `serpdata error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "page token expired" },
    });
    const out = await c.callTool(OVERVIEW, { pageToken: "stale" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "serpdata error: page token expired");
  });

  it("maps an initialize JSON-RPC error to serpdata error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "serpdata error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "serpdata error: malformed response");
  });

  it("maps a non-2xx upstream status to serpdata error text", async () => {
    const { client: c } = stubClient({
      callBodyText: "internal error",
      callStatus: 500,
    });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "serpdata error: HTTP 500");
  });

  it("maps a throwing fetch to serpdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^serpdata error: /);
  });

  it("maps a throwing initialize fetch to serpdata error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "serpdata error: socket hang up");
  });

  it("maps a timed-out call to serpdata error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool(SERP, { q: "HasData" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^serpdata error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("picks the matching id among several SSE messages", () => {
    const body = [
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}',
      'data: {"jsonrpc":"2.0","id":3,"result":{"n":3}}',
      "",
    ].join("\n");
    assert.deepEqual(parseRpcBody(body, 3), {
      jsonrpc: "2.0",
      id: 3,
      result: { n: 3 },
    });
    // With no matching id, the last parseable message wins.
    assert.deepEqual(parseRpcBody(body, 99), {
      jsonrpc: "2.0",
      id: 3,
      result: { n: 3 },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, SERP, ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, SERP, "q=HasData"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, PRODUCT, { productId: "987654321" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { productId: "987654321" });
  });

  it("accepts omitted arguments through the MCP layer as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, NEWS, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli([SERP, "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli([SERP, "[]"]);
    assert.equal(res.status, 2);
  });
});
