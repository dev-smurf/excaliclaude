/**
 * HTTP/SSE transport for Claude.ai (and other remote MCP clients).
 *
 * Creates a Node.js HTTP server that wraps the MCP server with
 * StreamableHTTPServerTransport. Intended for use behind a tunnel
 * (ngrok, Cloudflare Tunnel, etc.) so Claude.ai can connect locally.
 *
 * Each new MCP client connection (initialize request) creates a fresh
 * McpServer + transport pair, but they all share a single CollabClient
 * so the Excalidraw room connection persists across reconnects.
 */

import crypto from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import type { Socket } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { CollabClient } from "./collab.js";
import { createServer } from "./server.js";

export interface HttpServerOptions {
  port: number;
  /**
   * Bearer token for authentication.
   * When set, every request must include `Authorization: Bearer <token>`.
   * When omitted, the server accepts all requests without auth.
   */
  token?: string;
}

export interface HttpServerResult {
  httpServer: Server;
  /** Gracefully stop the server and close all open connections. */
  close: () => Promise<void>;
}

/**
 * Creates and starts an HTTP MCP server on the given port.
 *
 * @example
 * const { close } = await createHttpMcpServer({ port: 3000, token: process.env.TOKEN });
 * // … use it …
 * await close();
 */
export async function createHttpMcpServer(
  options: HttpServerOptions
): Promise<HttpServerResult> {
  const { port, token } = options;

  // Shared Excalidraw client — persists across MCP sessions so the
  // room connection survives if the MCP client (e.g. Claude.ai) reconnects.
  const client = new CollabClient();

  // Active transport for the current MCP session.
  // Recreated when a new client connects (sends an initialize request).
  let activeTransport: StreamableHTTPServerTransport | null = null;

  // Track open sockets so we can force-close them on shutdown,
  // preventing the server from hanging on open SSE streams.
  const openSockets = new Set<Socket>();

  const httpServer = createHttpServer(async (req, res) => {
    // ── Bearer token auth ──────────────────────────────────────────────────
    if (token) {
      const authHeader = req.headers["authorization"] ?? "";
      if (authHeader !== `Bearer ${token}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    // ── Session routing ────────────────────────────────────────────────────
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Known session → route to existing transport.
    if (sessionId && activeTransport?.sessionId === sessionId) {
      await activeTransport.handleRequest(req, res);
      return;
    }

    // No matching session — only POST can create a new one (via initialize).
    if (req.method === "POST") {
      // Spin up a fresh MCP server + transport for this session.
      // The CollabClient is shared so the Excalidraw connection persists.
      const { server } = createServer(client);
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      await server.connect(newTransport);
      await newTransport.handleRequest(req, res);

      // If the request was an initialize, adopt the new session.
      if (newTransport.sessionId) {
        if (activeTransport) {
          await activeTransport.close().catch(() => {});
        }
        activeTransport = newTransport;
      } else {
        // Non-init request without valid session — transport already rejected it.
        await newTransport.close().catch(() => {});
      }
      return;
    }

    // GET / DELETE without a valid session.
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No active session" },
        id: null,
      })
    );
  });

  httpServer.on("connection", (socket: Socket) => {
    openSockets.add(socket);
    socket.once("close", () => openSockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, () => resolve());
    httpServer.once("error", reject);
  });

  const close = (): Promise<void> => {
    // Destroy open connections (including long-lived SSE streams).
    for (const socket of openSockets) socket.destroy();
    return new Promise((resolve, reject) => {
      if (activeTransport) {
        activeTransport.close().catch(() => {});
      }
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { httpServer, close };
}
