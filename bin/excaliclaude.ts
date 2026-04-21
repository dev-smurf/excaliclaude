#!/usr/bin/env node

import { execSync } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../src/server.js";

async function setup(): Promise<void> {
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

async function main(): Promise<void> {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const command = process.argv[2];

if (command === "setup") {
  setup();
} else {
  main().catch((err: unknown) => {
    process.stderr.write(
      `excaliclaude fatal: ${(err as Error).message}\n`
    );
    process.exit(1);
  });
}
