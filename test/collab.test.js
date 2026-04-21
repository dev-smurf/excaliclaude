const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { CollabClient, MAX_ELEMENTS_PER_PUSH } = require("../src/collab.js");
const { makeElement } = require("../src/elements.js");

describe("CollabClient", () => {
  let client;

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
    await assert.rejects(
      () => client.pushElements([el]),
      /Not connected/
    );
  });

  it("deleteElements throws when not connected", async () => {
    await assert.rejects(
      () => client.deleteElements(["some-id"]),
      /Not connected/
    );
  });

  it("clearAll throws when not connected", async () => {
    await assert.rejects(
      () => client.clearAll(),
      /Not connected/
    );
  });

  it("pushElements rejects empty array", async () => {
    // Simulate connected state for validation test
    client._connected = true;
    client._socket = { connected: true, emit: () => {} };
    client._roomKey = "dummy";
    client._roomId = "dummy";

    await assert.rejects(
      () => client.pushElements([]),
      /non-empty array/
    );
  });

  it("pushElements rejects too many elements", async () => {
    client._connected = true;
    client._socket = { connected: true, emit: () => {} };
    client._roomKey = "dummy";
    client._roomId = "dummy";

    const tooMany = Array.from({ length: MAX_ELEMENTS_PER_PUSH + 1 }, (_, i) =>
      makeElement("rectangle", { id: `el-${i}` })
    );

    await assert.rejects(
      () => client.pushElements(tooMany),
      /Too many elements/
    );
  });

  it("disconnect clears state", () => {
    client._connected = true;
    client._roomId = "test";
    client._roomKey = "test";
    client._socket = { disconnect: () => {}, connected: true };
    client._elements.set("a", { id: "a" });

    client.disconnect();

    assert.equal(client.isConnected(), false);
    assert.equal(client._roomId, null);
    assert.equal(client._roomKey, null);
  });

  it("disconnect is safe to call when already disconnected", () => {
    assert.doesNotThrow(() => client.disconnect());
  });
});
