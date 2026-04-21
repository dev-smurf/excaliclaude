import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { CollabClient, MAX_ELEMENTS_PER_PUSH } from "../src/collab.js";
import { makeElement } from "../src/elements.js";

describe("CollabClient", () => {
  let client: CollabClient;

  beforeEach(() => {
    client = new CollabClient();
  });

  it("starts disconnected", () => {
    assert.equal(client.isConnected(), false);
  });

  it("getElements returns empty array when disconnected", () => {
    assert.deepEqual(client.getElements(), []);
  });

  it("pushElements throws when not connected", async () => {
    const el = makeElement("rectangle", { x: 0, y: 0, width: 100, height: 50 });
    await assert.rejects(() => client.pushElements([el]), /Not connected/);
  });

  it("deleteElements throws when not connected", async () => {
    await assert.rejects(() => client.deleteElements(["some-id"]), /Not connected/);
  });

  it("clearAll throws when not connected", async () => {
    await assert.rejects(() => client.clearAll(), /Not connected/);
  });

  it("pushElements rejects empty array", async () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: true, emit: () => {} };
    (client as any)._roomKey = "dummy";
    (client as any)._roomId = "dummy";

    await assert.rejects(() => client.pushElements([]), /non-empty array/);
  });

  it("pushElements rejects too many elements", async () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: true, emit: () => {} };
    (client as any)._roomKey = "dummy";
    (client as any)._roomId = "dummy";

    const tooMany = Array.from({ length: MAX_ELEMENTS_PER_PUSH + 1 }, (_, i) =>
      makeElement("rectangle", { id: `el-${i}` })
    );

    await assert.rejects(() => client.pushElements(tooMany), /Too many elements/);
  });

  it("disconnect clears state", () => {
    (client as any)._connected = true;
    (client as any)._roomId = "test";
    (client as any)._roomKey = "test";
    (client as any)._socket = { disconnect: () => {}, connected: true };
    client._elements.set("a", makeElement("rectangle", { id: "a" }));

    client.disconnect();

    assert.equal(client.isConnected(), false);
    assert.equal((client as any)._roomId, null);
    assert.equal((client as any)._roomKey, null);
  });

  it("disconnect is safe to call when already disconnected", () => {
    assert.doesNotThrow(() => client.disconnect());
  });

  it("getElements excludes deleted elements", () => {
    client._elements.set("alive", makeElement("rectangle", { id: "alive", isDeleted: false }));
    client._elements.set("dead", {
      ...makeElement("rectangle", { id: "dead" }),
      isDeleted: true,
    });
    const result = client.getElements();
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "alive");
  });

  it("deleteElements silently skips IDs that do not exist", async () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: true, emit: () => {} };
    (client as any)._roomKey = "dummy";
    (client as any)._roomId = "dummy";
    await assert.doesNotReject(() => client.deleteElements(["nonexistent"]));
  });

  it("clearAll does nothing when there are no elements", async () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: true, emit: () => {} };
    (client as any)._roomKey = "dummy";
    (client as any)._roomId = "dummy";
    await assert.doesNotReject(() => client.clearAll());
  });

  it("pushElements rejects a non-array argument", async () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: true, emit: () => {} };
    (client as any)._roomKey = "dummy";
    (client as any)._roomId = "dummy";
    await assert.rejects(
      () => client.pushElements("not-an-array" as any),
      /non-empty array/
    );
  });

  it("isConnected returns false when socket.connected is false", () => {
    (client as any)._connected = true;
    (client as any)._socket = { connected: false };
    assert.equal(client.isConnected(), false);
  });

  it("isConnected returns false when socket is null", () => {
    (client as any)._connected = true;
    (client as any)._socket = null;
    assert.equal(client.isConnected(), false);
  });

  it("getElementById returns element by ID", () => {
    const el = makeElement("rectangle", { id: "r1" });
    client._elements.set("r1", el);
    assert.equal(client.getElementById("r1")?.id, "r1");
  });

  it("getElementById returns undefined for deleted elements", () => {
    client._elements.set("r2", {
      ...makeElement("rectangle", { id: "r2" }),
      isDeleted: true,
    });
    assert.equal(client.getElementById("r2"), undefined);
  });

  it("getElementById returns undefined for unknown ID", () => {
    assert.equal(client.getElementById("nope"), undefined);
  });

  it("elementCount counts only non-deleted elements", () => {
    client._elements.set("a", makeElement("rectangle", { id: "a" }));
    client._elements.set("b", makeElement("rectangle", { id: "b" }));
    client._elements.set("c", {
      ...makeElement("rectangle", { id: "c" }),
      isDeleted: true,
    });
    assert.equal(client.elementCount(), 2);
  });

  it("elementCount returns 0 when empty", () => {
    assert.equal(client.elementCount(), 0);
  });
});
