const COLLAB_URL_REGEX = /#room=([a-f0-9]+),([A-Za-z0-9_-]+)$/;

function parseCollabUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("URL must be a non-empty string");
  }

  const match = url.match(COLLAB_URL_REGEX);
  if (!match) {
    throw new Error(
      `Invalid Excalidraw collab URL. Expected format: https://excalidraw.com/#room=ROOM_ID,KEY`
    );
  }

  const [, roomId, roomKey] = match;

  if (roomId.length < 10) {
    throw new Error(`Room ID too short: "${roomId}"`);
  }

  if (roomKey.length < 10) {
    throw new Error(`Room key too short: "${roomKey}"`);
  }

  return { roomId, roomKey };
}

module.exports = { parseCollabUrl };
