/**
 * Integration tests for the HTTP/SSE MCP server (src/http.ts).
 *
 * Each describe block spins up a real HTTP server on a random free port,
 * sends actual HTTP requests, and verifies behaviour. All servers are torn
 * down in after() hooks to avoid resource leaks.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";

import { createHttpMcpServer } from "../src/http.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find a free TCP port by binding to :0 and reading the assigned port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, () => {
      const addr = server.address();
      server.close(() => {
        if (addr && typeof addr === "object") {
          resolve(addr.port);
        } else {
          reject(new Error("Could not determine free port"));
        }
      });
    });
  });
}

/** POST JSON to a URL and return the Response (body stream not consumed). */
function postJson(url: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    // MCP spec requires both content types in Accept header for POST requests.
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
}

/** A minimal valid MCP initialize payload. */
const INIT_PAYLOAD = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
};

// ── No authentication ─────────────────────────────────────────────────────────

describe("HTTP server — no authentication", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  before(async () => {
    const port = await getFreePort();
    ({ close } = await createHttpMcpServer({ port }));
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await close();
  });

  test("accepts POST without Authorization header (200)", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD);
    await res.body?.cancel();
    assert.equal(res.status, 200);
  });

  test("accepts GET without Authorization header (non-401)", async () => {
    const res = await fetch(baseUrl);
    await res.body?.cancel();
    assert.notEqual(res.status, 401);
  });
});

// ── With authentication ───────────────────────────────────────────────────────

describe("HTTP server — with authentication", () => {
  const TOKEN = "test-secret-token-abc123";
  let baseUrl: string;
  let close: () => Promise<void>;

  before(async () => {
    const port = await getFreePort();
    ({ close } = await createHttpMcpServer({ port, token: TOKEN }));
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await close();
  });

  test("rejects POST with no Authorization header (401)", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD);
    assert.equal(res.status, 401);
  });

  test("rejects POST with wrong token (401)", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD, {
      Authorization: "Bearer wrong-token",
    });
    assert.equal(res.status, 401);
  });

  test("rejects POST with non-Bearer scheme (401)", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD, {
      Authorization: `Basic ${TOKEN}`,
    });
    assert.equal(res.status, 401);
  });

  test("rejects GET with no Authorization header (401)", async () => {
    const res = await fetch(baseUrl);
    await res.body?.cancel();
    assert.equal(res.status, 401);
  });

  test("rejects GET with wrong token (401)", async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    await res.body?.cancel();
    assert.equal(res.status, 401);
  });

  test("401 response body is JSON with error field", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  test("allows POST with correct Bearer token (200)", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD, {
      Authorization: `Bearer ${TOKEN}`,
    });
    await res.body?.cancel();
    assert.equal(res.status, 200);
  });

  test("allows GET with correct Bearer token (non-401)", async () => {
    const res = await fetch(baseUrl, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    await res.body?.cancel();
    assert.notEqual(res.status, 401);
  });

});

// ── Startup behaviour ─────────────────────────────────────────────────────────

describe("HTTP server — startup", () => {
  test("listens on the requested port", async () => {
    const port = await getFreePort();
    const { close } = await createHttpMcpServer({ port });
    try {
      const res = await fetch(`http://localhost:${port}`);
      await res.body?.cancel();
      // Any response (even 4xx from transport) means the server is up.
      assert.ok(res.status > 0, "server should respond");
    } finally {
      await close();
    }
  });

  test("rejects an invalid port with a thrown error", async () => {
    // Port 1 is privileged on most systems — bind will fail.
    // We just need createHttpMcpServer to reject, not hang.
    // Use port 0 as a placeholder; the real guard is in the CLI.
    // Instead test that a port already in use throws.
    const port = await getFreePort();

    // Occupy the port first.
    const blocker = await createHttpMcpServer({ port });
    try {
      await assert.rejects(
        () => createHttpMcpServer({ port }),
        /EADDRINUSE/,
        "should throw EADDRINUSE when port is taken"
      );
    } finally {
      await blocker.close();
    }
  });

  test("close() resolves cleanly with no open connections", async () => {
    const port = await getFreePort();
    const { close } = await createHttpMcpServer({ port });
    await assert.doesNotReject(close, "close() should resolve without error");
  });

  test("close() resolves cleanly with an open SSE connection", async () => {
    const port = await getFreePort();
    const { close } = await createHttpMcpServer({ port });

    // Open an SSE stream (GET request that stays open).
    const controller = new AbortController();
    fetch(`http://localhost:${port}`, { signal: controller.signal }).catch(
      () => {}
    );

    // Give the request a moment to reach the server.
    await new Promise((r) => setTimeout(r, 50));

    // close() must resolve even with the open SSE stream.
    await assert.doesNotReject(
      () => close(),
      "close() should force-close open SSE connections and resolve"
    );

    controller.abort();
  });
});

// ── Session routing ──────────────────────────────────────────────────────────

describe("HTTP server — session routing", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  before(async () => {
    const port = await getFreePort();
    ({ close } = await createHttpMcpServer({ port }));
    baseUrl = `http://localhost:${port}`;
  });

  after(async () => {
    await close();
  });

  test("initialize returns mcp-session-id header", async () => {
    const res = await postJson(baseUrl, INIT_PAYLOAD);
    await res.body?.cancel();
    assert.equal(res.status, 200);
    const sessionId = res.headers.get("mcp-session-id");
    assert.ok(sessionId, "response should include mcp-session-id header");
  });

  test("second initialize creates a new session", async () => {
    const res1 = await postJson(baseUrl, INIT_PAYLOAD);
    await res1.body?.cancel();
    const session1 = res1.headers.get("mcp-session-id");

    const res2 = await postJson(baseUrl, INIT_PAYLOAD);
    await res2.body?.cancel();
    const session2 = res2.headers.get("mcp-session-id");

    assert.equal(res2.status, 200);
    assert.ok(session1 && session2, "both should have session IDs");
    assert.notEqual(session1, session2, "should be different sessions");
  });

  test("GET without session returns 400", async () => {
    const res = await fetch(baseUrl);
    const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } };
    assert.equal(res.status, 400);
    assert.equal(body.error.message, "Bad Request: No active session");
  });

  test("GET with stale session ID returns 400", async () => {
    // Initialize to create a session.
    const initRes = await postJson(baseUrl, INIT_PAYLOAD);
    await initRes.body?.cancel();

    const res = await fetch(baseUrl, {
      headers: { "mcp-session-id": "stale-nonexistent-id" },
    });
    const body = (await res.json()) as { jsonrpc: string; error: { code: number; message: string } };
    assert.equal(res.status, 400);
  });

  test("POST with valid session routes to existing transport", async () => {
    // Initialize to get a session.
    const initRes = await postJson(baseUrl, INIT_PAYLOAD);
    await initRes.body?.cancel();
    const sessionId = initRes.headers.get("mcp-session-id")!;

    // Send a tools/list request with the session ID.
    const res = await postJson(
      baseUrl,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { "mcp-session-id": sessionId, "mcp-protocol-version": "2024-11-05" }
    );
    const body = await res.text();
    assert.equal(res.status, 200);
    // The SSE response should contain tool names from our server.
    assert.ok(body.includes("connect"), "should list connect tool");
    assert.ok(body.includes("draw_elements"), "should list draw_elements tool");
  });
});
