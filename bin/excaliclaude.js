#!/usr/bin/env node

const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = require("../src/server.js");

async function main() {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`excaliclaude fatal: ${err.message}\n`);
  process.exit(1);
});
