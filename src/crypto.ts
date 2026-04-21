import { webcrypto } from "node:crypto";

import type { EncryptResult } from "./types.js";

const crypto = webcrypto as unknown as Crypto;
const IV_LENGTH = 12;

async function importKey(
  keyString: string,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
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

export async function encrypt(
  keyString: string,
  data: unknown
): Promise<EncryptResult> {
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

export async function decrypt(
  keyString: string,
  buffer: ArrayBuffer,
  iv: Uint8Array
): Promise<unknown> {
  const cryptoKey = await importKey(keyString, "decrypt");

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    cryptoKey,
    buffer
  );

  return JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
}
