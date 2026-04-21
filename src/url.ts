/**
 * Parses Excalidraw collaboration URLs into room credentials.
 *
 * Collab URLs encode the room ID and encryption key in the URL fragment
 * (after the #), so the key never reaches the server in HTTP requests.
 * Format: https://excalidraw.com/#room=<hex-roomId>,<base64url-key>
 */

import type { RoomCoords } from "./types.js";

const COLLAB_URL_REGEX = /#room=([a-f0-9]+),([A-Za-z0-9_-]+)$/;

export function parseCollabUrl(url: string): RoomCoords {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("URL must be a non-empty string");
  }

  const match = url.match(COLLAB_URL_REGEX);
  if (!match) {
    throw new Error(
      `Invalid Excalidraw collab URL. Expected format: https://excalidraw.com/#room=ROOM_ID,KEY`
    );
  }

  const roomId = match[1]!;
  const roomKey = match[2]!;

  // Sanity-check lengths to catch truncated paste errors early
  if (roomId.length < 10) {
    throw new Error(`Room ID too short: "${roomId}"`);
  }

  if (roomKey.length < 10) {
    throw new Error(`Room key too short: "${roomKey}"`);
  }

  return { roomId, roomKey };
}
