const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../src/server.js");

describe("createServer", () => {
  it("creates a server and client", () => {
    const { server, client } = createServer();
    assert.ok(server);
    assert.ok(client);
    assert.equal(client.isConnected(), false);
  });

  it("server has all expected tools", () => {
    const { server } = createServer();
    const tools = Object.keys(server._registeredTools);
    assert.ok(tools.includes("connect"));
    assert.ok(tools.includes("draw_elements"));
    assert.ok(tools.includes("get_scene"));
    assert.ok(tools.includes("delete_elements"));
    assert.ok(tools.includes("clear_canvas"));
  });
});
