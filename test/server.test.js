const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../src/server.js");

function mockConnected(client) {
  client._connected = true;
  client._socket = { connected: true, emit: () => {} };
  client._roomKey = "dummy";
  client._roomId = "dummy";
  // Mock pushElements to skip encryption (tested separately in crypto.test.js)
  client.pushElements = async function (elements) {
    if (!Array.isArray(elements) || elements.length === 0) {
      throw new Error("elements must be a non-empty array");
    }
    for (const el of elements) {
      this._elements.set(el.id, el);
    }
  };
}

describe("createServer", () => {
  it("creates a server and client", () => {
    const { server, client } = createServer();
    assert.ok(server);
    assert.ok(client);
    assert.equal(client.isConnected(), false);
  });

  it("server has all 6 expected tools", () => {
    const { server } = createServer();
    const tools = Object.keys(server._registeredTools);
    assert.ok(tools.includes("connect"));
    assert.ok(tools.includes("draw_elements"));
    assert.ok(tools.includes("update_elements"));
    assert.ok(tools.includes("get_scene"));
    assert.ok(tools.includes("delete_elements"));
    assert.ok(tools.includes("clear_canvas"));
    assert.equal(tools.length, 6);
  });
});

describe("draw_elements handler", () => {
  it("returns error when not connected", async () => {
    const { server } = createServer();
    const handler = server._registeredTools.draw_elements;
    const result = await handler.handler({
      elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
    });
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Not connected"));
  });

  it("draws a simple rectangle", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    const result = await handler.handler({
      elements: [{ type: "rectangle", x: 10, y: 20, width: 100, height: 50 }],
    });
    assert.ok(!result.isError);
    assert.ok(result.content[0].text.includes("Drew"));
    assert.equal(client.getElements().length, 1);
  });
});

describe("get_scene handler", () => {
  it("returns empty scene when not connected", async () => {
    const { server } = createServer();
    const handler = server._registeredTools.get_scene;
    const result = await handler.handler({});
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.count, 0);
    assert.deepEqual(data.elements, []);
  });

  it("returns correct shape with id, type, x, y, width, height, text", async () => {
    const { server, client } = createServer();
    client._elements.set("t1", {
      id: "t1",
      type: "text",
      x: 10,
      y: 20,
      width: 100,
      height: 30,
      text: "Hello",
      isDeleted: false,
    });
    const handler = server._registeredTools.get_scene;
    const result = await handler.handler({});
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.count, 1);
    assert.equal(data.elements[0].id, "t1");
    assert.equal(data.elements[0].type, "text");
    assert.equal(data.elements[0].text, "Hello");
    assert.equal(data.elements[0].x, 10);
  });

  it("excludes deleted elements", async () => {
    const { server, client } = createServer();
    client._elements.set("a", { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: false });
    client._elements.set("b", { id: "b", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true });
    const handler = server._registeredTools.get_scene;
    const result = await handler.handler({});
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.count, 1);
    assert.equal(data.elements[0].id, "a");
  });
});

describe("update_elements handler", () => {
  it("reports not-found elements", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.update_elements;
    const result = await handler.handler({
      updates: [{ id: "nonexistent", x: 50 }],
    });
    assert.ok(result.content[0].text.includes("0"));
    assert.ok(result.content[0].text.includes("1 not found"));
  });

  it("updates text and originalText together", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    client._elements.set("t1", {
      id: "t1",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: "old",
      originalText: "old",
      version: 1,
      isDeleted: false,
    });
    const handler = server._registeredTools.update_elements;
    await handler.handler({ updates: [{ id: "t1", text: "new" }] });
    const updated = client._elements.get("t1");
    assert.equal(updated.text, "new");
    assert.equal(updated.originalText, "new");
    assert.equal(updated.version, 2);
  });

  it("preserves unchanged properties", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    client._elements.set("r1", {
      id: "r1",
      type: "rectangle",
      x: 100,
      y: 200,
      width: 50,
      height: 30,
      strokeColor: "#ff0000",
      version: 1,
      isDeleted: false,
    });
    const handler = server._registeredTools.update_elements;
    await handler.handler({ updates: [{ id: "r1", x: 500 }] });
    const updated = client._elements.get("r1");
    assert.equal(updated.x, 500);
    assert.equal(updated.y, 200);
    assert.equal(updated.strokeColor, "#ff0000");
    assert.equal(updated.version, 2);
  });
});

describe("connect handler", () => {
  it("returns error on invalid URL", async () => {
    const { server } = createServer();
    const handler = server._registeredTools.connect;
    const result = await handler.handler({ url: "not-a-valid-url" });
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Connection failed"));
  });
});

describe("dark background detection", () => {
  it("detects black as dark — white label", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "rectangle", x: 0, y: 0, width: 100, height: 50,
        backgroundColor: "#1e1e1e", fillStyle: "solid",
        label: { text: "dark" },
      }],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "dark"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#ffffff");
  });

  it("keeps dark text on light backgrounds", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "rectangle", x: 0, y: 0, width: 100, height: 50,
        backgroundColor: "#a5d8ff", fillStyle: "solid",
        label: { text: "light" },
      }],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "light"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#1e1e1e");
  });

  it("detects dark purple as dark", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "rectangle", x: 0, y: 0, width: 100, height: 50,
        backgroundColor: "#2d1b69", fillStyle: "solid",
        label: { text: "purple" },
      }],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "purple"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#ffffff");
  });

  it("keeps dark text on transparent backgrounds", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "rectangle", x: 0, y: 0, width: 100, height: 50,
        backgroundColor: "transparent",
        label: { text: "clear" },
      }],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "clear"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#1e1e1e");
  });
});

describe("arrow label placement", () => {
  it("places label above horizontal arrows", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "arrow", x: 100, y: 200, width: 150, height: 0,
        points: [[0, 0], [150, 0]],
        label: { text: "go" },
      }],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "go"
    );
    assert.ok(labelEl);
    assert.ok(labelEl.y < 200, "label should be above the arrow");
  });

  it("places label to the right of vertical arrows", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "arrow", x: 100, y: 200, width: 0, height: 150,
        points: [[0, 0], [0, 150]],
        label: { text: "down" },
      }],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "down"
    );
    assert.ok(labelEl);
    assert.ok(labelEl.x > 100, "label should be to the right of the arrow");
  });

  it("uses explicit label x,y when provided", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "arrow", x: 100, y: 200, width: 150, height: 0,
        points: [[0, 0], [150, 0]],
        label: { text: "custom", x: 500, y: 600 },
      }],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "custom"
    );
    assert.ok(labelEl);
    assert.equal(labelEl.x, 500);
    assert.equal(labelEl.y, 600);
  });
});

describe("label centering in shapes", () => {
  it("centers label within rectangle", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = server._registeredTools.draw_elements;
    await handler.handler({
      elements: [{
        type: "rectangle", x: 100, y: 100, width: 200, height: 100,
        label: { text: "Hi" },
      }],
    });
    const rect = Array.from(client._elements.values()).find(
      (el) => el.type === "rectangle"
    );
    const label = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && el.text === "Hi"
    );
    assert.ok(rect);
    assert.ok(label);
    assert.equal(label.containerId, rect.id);
    assert.ok(rect.boundElements.some((b) => b.id === label.id && b.type === "text"));
    assert.ok(label.x > rect.x);
    assert.ok(label.x < rect.x + rect.width);
    assert.ok(label.y > rect.y);
    assert.ok(label.y < rect.y + rect.height);
  });
});
