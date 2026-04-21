import { webcrypto } from "node:crypto";

import type { EncryptResult } from "./types.js";

const crypto = webcrypto as unknown as Crypto;
const IV_LENGTH = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Cache imported CryptoKeys to avoid re-importing on every call
const keyCache = new Map<string, CryptoKey>();

async function getKey(
  keyString: string,
  usage: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const cacheKey = `${keyString}:${usage}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const cryptoKey = await crypto.subtle.importKey(
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

  keyCache.set(cacheKey, cryptoKey);
  return cryptoKey;
}

export function clearKeyCache(): void {
  keyCache.clear();
}

export async function encrypt(
  keyString: string,
  data: unknown
): Promise<EncryptResult> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const cryptoKey = await getKey(keyString, "encrypt");
  const encoded = encoder.encode(JSON.stringify(data));

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
  const cryptoKey = await getKey(keyString, "decrypt");

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    cryptoKey,
    buffer
  );

  return JSON.parse(decoder.decode(decrypted)) as unknown;
}
