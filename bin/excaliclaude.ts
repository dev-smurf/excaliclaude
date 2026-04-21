#!/usr/bin/env node

/**
 * CLI entry point for excaliclaude.
 *
 * Modes:
 *   excaliclaude setup           — registers this server with Claude Code via `claude mcp add`
 *   excaliclaude serve [options] — starts HTTP/SSE server for Claude.ai (via ngrok or similar)
 *   excaliclaude (no args)       — starts MCP server on stdio (how Claude Code invokes it)
 *
 * serve options:
 *   --port <number>   Port to listen on (default: 3000)
 *   --token <string>  Bearer token for auth (overrides EXCALICLAUDE_TOKEN env var)
 */

import { execSync } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../src/server.js";
import { createHttpMcpServer } from "../src/http.js";

/** One-time setup: registers excaliclaude as a user-scoped MCP server in Claude Code. */
function setup(): void {
  console.log("Setting up excaliclaude for Claude Code...\n");

  try {
    execSync("claude mcp add -s user excaliclaude -- npx -y excaliclaude", {
      stdio: "inherit",
    });
    console.log("\nDone! Restart Claude Code and you're ready to go.");
    console.log("  1. Open excalidraw.com");
    console.log('  2. Click "Live collaboration" and copy the link');
    console.log("  3. Tell Claude to connect and draw\n");
  } catch {
    console.error(
      "Failed to run 'claude mcp add'. Make sure Claude Code CLI is installed."
    );
    console.error("Manual setup:");
    console.error(
      '  claude mcp add -s user excaliclaude -- npx -y excaliclaude\n'
    );
    process.exit(1);
  }
}

/**
 * HTTP/SSE mode for Claude.ai.
 *
 * Starts a local HTTP server compatible with the MCP Streamable HTTP transport.
 * Pair with ngrok (or any tunnel) to get a public URL for Claude.ai.
 *
 * Auth token resolution order:
 *   1. --token <value>  CLI flag
 *   2. EXCALICLAUDE_TOKEN environment variable
 *   3. (none) — unauthenticated, only safe on localhost without a tunnel
 */
async function serve(args: string[]): Promise<void> {
  // ── Port ────────────────────────────────────────────────────────────────
  const portIdx = args.indexOf("--port");
  const rawPort = portIdx !== -1 ? (args[portIdx + 1] ?? "3000") : "3000";
  const port = parseInt(rawPort, 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`excaliclaude: invalid port "${rawPort}" (must be 1–65535)`);
    process.exit(1);
  }

  // ── Token ────────────────────────────────────────────────────────────────
  const tokenIdx = args.indexOf("--token");
  const token =
    tokenIdx !== -1
      ? (args[tokenIdx + 1] ?? process.env["EXCALICLAUDE_TOKEN"])
      : process.env["EXCALICLAUDE_TOKEN"];

  const { close } = await createHttpMcpServer({ port, token });

  console.log(`\nexcaliclaude HTTP server on port ${port}`);

  if (token) {
    console.log("Auth: Bearer token enabled");
  } else {
    console.log(
      "Warning: no auth set — use --token or EXCALICLAUDE_TOKEN before exposing via tunnel"
    );
  }

  console.log("\nExpose with ngrok:");
  console.log(`  ngrok http ${port}`);
  console.log(
    "\nThen add the ngrok URL to: Claude.ai → Customize → Connectors → Add custom connector\n"
  );

  process.on("SIGINT", () => {
    close().finally(() => process.exit(0));
  });
}

/** Stdio mode: how Claude Code invokes this server. */
async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const command = process.argv[2];
const commandArgs = process.argv.slice(3);

if (command === "setup") {
  setup();
} else if (command === "serve") {
  serve(commandArgs).catch((err: unknown) => {
    console.error(`excaliclaude serve: ${(err as Error).message}`);
    process.exit(1);
  });
} else {
  main().catch((err: unknown) => {
    process.stderr.write(`excaliclaude fatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
