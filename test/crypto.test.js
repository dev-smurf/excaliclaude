const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { encrypt, decrypt } = require("../src/crypto.js");

async function generateTestKey() {
  const key = await webcrypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  const jwk = await webcrypto.subtle.exportKey("jwk", key);
  return jwk.k;
}

describe("crypto", () => {
  it("encrypt → decrypt roundtrip produces original data", async () => {
    const keyString = await generateTestKey();
    const original = { type: "SCENE_UPDATE", payload: { elements: [1, 2, 3] } };

    const { buffer, iv } = await encrypt(keyString, original);
    const result = await decrypt(keyString, buffer, iv);

    assert.deepEqual(result, original);
  });

  it("produces different IVs on each call", async () => {
    const keyString = await generateTestKey();
    const data = { hello: "world" };

    const r1 = await encrypt(keyString, data);
    const r2 = await encrypt(keyString, data);

    assert.notDeepEqual(r1.iv, r2.iv);
  });

  it("produces ArrayBuffer output", async () => {
    const keyString = await generateTestKey();
    const { buffer, iv } = await encrypt(keyString, { test: true });

    assert.ok(buffer instanceof ArrayBuffer);
    assert.ok(iv instanceof Uint8Array);
    assert.equal(iv.length, 12);
  });

  it("decrypt fails with wrong key", async () => {
    const key1 = await generateTestKey();
    const key2 = await generateTestKey();
    const data = { secret: "message" };

    const { buffer, iv } = await encrypt(key1, data);

    await assert.rejects(() => decrypt(key2, buffer, iv));
  });

  it("handles complex nested objects", async () => {
    const keyString = await generateTestKey();
    const data = {
      type: "SCENE_INIT",
      payload: {
        elements: [
          {
            id: "abc",
            type: "rectangle",
            x: 100,
            y: 200,
            nested: { deep: [1, 2, 3] },
          },
        ],
      },
    };

    const { buffer, iv } = await encrypt(keyString, data);
    const result = await decrypt(keyString, buffer, iv);

    assert.deepEqual(result, data);
  });

  it("handles unicode text", async () => {
    const keyString = await generateTestKey();
    const data = { text: "Héllo 世界 🎨" };

    const { buffer, iv } = await encrypt(keyString, data);
    const result = await decrypt(keyString, buffer, iv);

    assert.deepEqual(result, data);
  });
});
