import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createServer } from "../src/server.js";
import type { CollabClient } from "../src/collab.js";
import type { ExcalidrawElement, TextElement } from "../src/types.js";

function mockConnected(client: CollabClient): void {
  (client as any)._connected = true;
  (client as any)._socket = { connected: true, emit: () => {} };
  (client as any)._roomKey = "dummy";
  (client as any)._roomId = "dummy";
  client.pushElements = async function (
    this: CollabClient,
    elements: ExcalidrawElement[]
  ): Promise<void> {
    if (!Array.isArray(elements) || elements.length === 0) {
      throw new Error("elements must be a non-empty array");
    }
    for (const el of elements) {
      this._elements.set(el.id, el);
    }
    // Track history for undo support (mirrors real pushElements)
    const newIds = elements.filter((el) => !el.isDeleted).map((el) => el.id);
    if (newIds.length > 0) {
      (this as any)._history.push(newIds);
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

  it("server has all expected tools", () => {
    const { server } = createServer();
    const tools = Object.keys((server as any)._registeredTools);
    assert.ok(tools.includes("connect"));
    assert.ok(tools.includes("draw_elements"));
    assert.ok(tools.includes("update_elements"));
    assert.ok(tools.includes("get_scene"));
    assert.ok(tools.includes("delete_elements"));
    assert.ok(tools.includes("clear_canvas"));
    assert.ok(tools.includes("status"));
  });
});

describe("draw_elements handler", () => {
  it("returns error when not connected", async () => {
    const { server } = createServer();
    const handler = (server as any)._registeredTools.draw_elements;
    const result = await handler.handler({
      elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
    });
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Not connected"));
  });

  it("draws a simple rectangle", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
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
    const handler = (server as any)._registeredTools.get_scene;
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
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.get_scene;
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
    client._elements.set("a", {
      id: "a",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      isDeleted: false,
    } as unknown as ExcalidrawElement);
    client._elements.set("b", {
      id: "b",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      isDeleted: true,
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.get_scene;
    const result = await handler.handler({});
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.count, 1);
    assert.equal(data.elements[0].id, "a");
  });

  it("returns full element data when full=true", async () => {
    const { server, client } = createServer();
    client._elements.set("r1", {
      id: "r1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      strokeColor: "#ff0000",
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      isDeleted: false,
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.get_scene;
    const result = await handler.handler({ full: true });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.count, 1);
    assert.equal(data.elements[0].strokeColor, "#ff0000");
    assert.equal(data.elements[0].backgroundColor, "#a5d8ff");
  });

  it("returns compact data when full=false", async () => {
    const { server, client } = createServer();
    client._elements.set("r1", {
      id: "r1",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      strokeColor: "#ff0000",
      isDeleted: false,
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.get_scene;
    const result = await handler.handler({ full: false });
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.elements[0].strokeColor, undefined);
    assert.equal(data.elements[0].id, "r1");
  });
});

describe("update_elements handler", () => {
  it("reports not-found elements", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.update_elements;
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
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.update_elements;
    await handler.handler({ updates: [{ id: "t1", text: "new" }] });
    const updated = client._elements.get("t1") as unknown as TextElement;
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
    } as unknown as ExcalidrawElement);
    const handler = (server as any)._registeredTools.update_elements;
    await handler.handler({ updates: [{ id: "r1", x: 500 }] });
    const updated = client._elements.get("r1")!;
    assert.equal(updated.x, 500);
    assert.equal(updated.y, 200);
    assert.equal(updated.strokeColor, "#ff0000");
    assert.equal(updated.version, 2);
  });
});

describe("connect handler", () => {
  it("returns error on invalid URL", async () => {
    const { server } = createServer();
    const handler = (server as any)._registeredTools.connect;
    const result = await handler.handler({ url: "not-a-valid-url" });
    assert.ok(result.isError);
    assert.ok(result.content[0].text.includes("Connection failed"));
  });
});

describe("dark background detection", () => {
  it("detects black as dark — white label", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "rectangle",
          x: 0, y: 0, width: 100, height: 50,
          backgroundColor: "#1e1e1e",
          fillStyle: "solid",
          label: { text: "dark" },
        },
      ],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "dark"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#ffffff");
  });

  it("keeps dark text on light backgrounds", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "rectangle",
          x: 0, y: 0, width: 100, height: 50,
          backgroundColor: "#a5d8ff",
          fillStyle: "solid",
          label: { text: "light" },
        },
      ],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "light"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#1e1e1e");
  });

  it("detects dark purple as dark", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "rectangle",
          x: 0, y: 0, width: 100, height: 50,
          backgroundColor: "#2d1b69",
          fillStyle: "solid",
          label: { text: "purple" },
        },
      ],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "purple"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#ffffff");
  });

  it("keeps dark text on transparent backgrounds", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "rectangle",
          x: 0, y: 0, width: 100, height: 50,
          backgroundColor: "transparent",
          label: { text: "clear" },
        },
      ],
    });
    const textEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "clear"
    );
    assert.ok(textEl);
    assert.equal(textEl.strokeColor, "#1e1e1e");
  });
});

describe("arrow label placement", () => {
  it("places label above horizontal arrows", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "arrow",
          x: 100, y: 200, width: 150, height: 0,
          points: [[0, 0], [150, 0]],
          label: { text: "go" },
        },
      ],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "go"
    );
    assert.ok(labelEl);
    assert.ok(labelEl.y < 200, "label should be above the arrow");
  });

  it("places label to the right of vertical arrows", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "arrow",
          x: 100, y: 200, width: 0, height: 150,
          points: [[0, 0], [0, 150]],
          label: { text: "down" },
        },
      ],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "down"
    );
    assert.ok(labelEl);
    assert.ok(labelEl.x > 100, "label should be to the right of the arrow");
  });

  it("uses explicit label x,y when provided", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "arrow",
          x: 100, y: 200, width: 150, height: 0,
          points: [[0, 0], [150, 0]],
          label: { text: "custom", x: 500, y: 600 },
        },
      ],
    });
    const labelEl = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "custom"
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
    const handler = (server as any)._registeredTools.draw_elements;
    await handler.handler({
      elements: [
        {
          type: "rectangle",
          x: 100, y: 100, width: 200, height: 100,
          label: { text: "Hi" },
        },
      ],
    });
    const rect = Array.from(client._elements.values()).find(
      (el) => el.type === "rectangle"
    );
    const label = Array.from(client._elements.values()).find(
      (el) => el.type === "text" && (el as TextElement).text === "Hi"
    );
    assert.ok(rect);
    assert.ok(label);
    assert.equal((label as TextElement).containerId, rect.id);
    assert.ok(
      rect.boundElements?.some((b) => b.id === label.id && b.type === "text")
    );
    assert.ok(label.x > rect.x);
    assert.ok(label.x < rect.x + rect.width);
    assert.ok(label.y > rect.y);
    assert.ok(label.y < rect.y + rect.height);
  });
});

describe("undo_last_draw handler", () => {
  it("undoes the last draw", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const draw = (server as any)._registeredTools.draw_elements;
    const undo = (server as any)._registeredTools.undo_last_draw;

    await draw.handler({
      elements: [{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }],
    });
    assert.equal(client.elementCount(), 1);

    const result = await undo.handler({});
    assert.ok(result.content[0].text.includes("Undone"));
    assert.equal(client.elementCount(), 0);
  });

  it("returns nothing to undo when history is empty", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const undo = (server as any)._registeredTools.undo_last_draw;
    const result = await undo.handler({});
    assert.ok(result.content[0].text.includes("Nothing to undo"));
  });

  it("undoes multiple draws in reverse order", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    const draw = (server as any)._registeredTools.draw_elements;
    const undo = (server as any)._registeredTools.undo_last_draw;

    await draw.handler({
      elements: [{ type: "rectangle", x: 0, y: 0, width: 50, height: 50 }],
    });
    await draw.handler({
      elements: [
        { type: "rectangle", x: 100, y: 0, width: 50, height: 50 },
        { type: "rectangle", x: 200, y: 0, width: 50, height: 50 },
      ],
    });
    assert.equal(client.elementCount(), 3);

    await undo.handler({});
    assert.equal(client.elementCount(), 1);

    await undo.handler({});
    assert.equal(client.elementCount(), 0);
  });
});

describe("status handler", () => {
  it("returns not connected when disconnected", async () => {
    const { server } = createServer();
    const handler = (server as any)._registeredTools.status;
    const result = await handler.handler({});
    assert.ok(result.content[0].text.includes("Not connected"));
  });

  it("returns connected with element count", async () => {
    const { server, client } = createServer();
    mockConnected(client);
    client._elements.set("a", { id: "a", isDeleted: false } as any);
    client._elements.set("b", { id: "b", isDeleted: false } as any);
    const handler = (server as any)._registeredTools.status;
    const result = await handler.handler({});
    assert.ok(result.content[0].text.includes("Connected"));
    assert.ok(result.content[0].text.includes("2"));
  });
});
