const { webcrypto } = require("node:crypto");

const crypto = webcrypto;
const IV_LENGTH = 12;

async function importKey(keyString, usage) {
  return crypto.subtle.importKey(
    "jwk",
    {
      alg: "A128GCM",
      ext: true,
      k: keyString,
      key_ops: ["encrypt", "decrypt"],
      kty: "oct",
    },
    { name: "AES-GCM", length: 128 },
    false,
    [usage]
  );
}

async function encrypt(keyString, data) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await importKey(keyString, "encrypt");
  const encoded = new TextEncoder().encode(JSON.stringify(data));

  const buffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoded
  );

  return { buffer, iv };
}

async function decrypt(keyString, buffer, iv) {
  const cryptoKey = await importKey(keyString, "decrypt");

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    buffer
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

module.exports = { encrypt, decrypt };
