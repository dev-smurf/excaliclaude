/**
 * HTTP/SSE transport for Claude.ai (and other remote MCP clients).
 *
 * Creates a Node.js HTTP server that wraps the MCP server with
 * StreamableHTTPServerTransport. Intended for use behind a tunnel
 * (ngrok, Cloudflare Tunnel, etc.) so Claude.ai can connect locally.
 *
 * Stateless mode is used (no session IDs) because a single CollabClient
 * handles one Excalidraw room at a time — HTTP session tracking adds no value.
 */

import { createServer as createHttpServer, type Server } from "node:http";
import type { Socket } from "node:net";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

  const { server } = createServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session tracking
  });

  await server.connect(transport);

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

    // ── Body parsing (POST only) ───────────────────────────────────────────
    let body: unknown;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        // Leave body undefined; the transport rejects malformed payloads.
      }
    }

    await transport.handleRequest(req, res, body);
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
      transport.close().catch(() => {
        // Ignore transport close errors during shutdown.
      });
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { httpServer, close };
}
