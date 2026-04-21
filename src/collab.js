const { io } = require("socket.io-client");
const { encrypt, decrypt } = require("./crypto.js");

const COLLAB_SERVER = "https://oss-collab.excalidraw.com";
const CONNECT_TIMEOUT = 15000;
const MAX_ELEMENTS_PER_PUSH = 500;

class CollabClient {
  constructor() {
    this._socket = null;
    this._roomId = null;
    this._roomKey = null;
    this._elements = new Map();
    this._connected = false;
  }

  isConnected() {
    return this._connected && this._socket?.connected === true;
  }

  async connect(roomId, roomKey) {
    if (this._socket) {
      this.disconnect();
    }

    this._roomId = roomId;
    this._roomKey = roomKey;
    this._elements.clear();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timed out after ${CONNECT_TIMEOUT}ms`));
        this.disconnect();
      }, CONNECT_TIMEOUT);

      this._socket = io(COLLAB_SERVER, {
        transports: ["websocket"],
        timeout: CONNECT_TIMEOUT,
        extraHeaders: {
          Origin: "https://excalidraw.com",
        },
      });

      this._socket.on("connect_error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Socket connection error: ${err.message}`));
      });

      this._socket.on("init-room", () => {
        this._socket.emit("join-room", this._roomId);
      });

      this._socket.on("first-in-room", () => {
        clearTimeout(timer);
        this._connected = true;
        resolve({ alone: true });
      });

      this._socket.on("room-user-change", (users) => {
        if (!this._connected) {
          clearTimeout(timer);
          this._connected = true;
          resolve({ alone: false, users: users.length });
        }
      });

      this._socket.on("client-broadcast", async (encryptedData, iv) => {
        try {
          const data = await decrypt(
            this._roomKey,
            encryptedData,
            new Uint8Array(iv)
          );
          if (
            data.payload?.elements &&
            (data.type === "SCENE_INIT" || data.type === "SCENE_UPDATE")
          ) {
            for (const el of data.payload.elements) {
              this._elements.set(el.id, el);
            }
          }
        } catch {
          // Decrypt failure — wrong key or corrupt data, skip silently
        }
      });

      this._socket.on("disconnect", () => {
        this._connected = false;
      });
    });
  }

  disconnect() {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
    this._connected = false;
    this._roomId = null;
    this._roomKey = null;
  }

  async pushElements(elements) {
    this._assertConnected();

    if (!Array.isArray(elements) || elements.length === 0) {
      throw new Error("elements must be a non-empty array");
    }

    if (elements.length > MAX_ELEMENTS_PER_PUSH) {
      throw new Error(
        `Too many elements (${elements.length}). Max ${MAX_ELEMENTS_PER_PUSH} per call.`
      );
    }

    const payload = {
      type: "SCENE_UPDATE",
      payload: { elements },
    };

    const { buffer, iv } = await encrypt(this._roomKey, payload);
    this._socket.emit("server-broadcast", this._roomId, buffer, iv);

    for (const el of elements) {
      this._elements.set(el.id, el);
    }
  }

  getElements() {
    return Array.from(this._elements.values()).filter((el) => !el.isDeleted);
  }

  async deleteElements(ids) {
    this._assertConnected();

    const deletedElements = ids
      .map((id) => this._elements.get(id))
      .filter(Boolean)
      .map((el) => ({
        ...el,
        isDeleted: true,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2147483646),
        updated: Date.now(),
      }));

    if (deletedElements.length === 0) {
      return;
    }

    for (let i = 0; i < deletedElements.length; i += MAX_ELEMENTS_PER_PUSH) {
      const batch = deletedElements.slice(i, i + MAX_ELEMENTS_PER_PUSH);
      await this.pushElements(batch);
    }
  }

  async clearAll() {
    this._assertConnected();

    const allIds = Array.from(this._elements.keys());
    if (allIds.length === 0) {
      return;
    }

    await this.deleteElements(allIds);
  }

  _assertConnected() {
    if (!this.isConnected()) {
      throw new Error("Not connected. Call connect() first.");
    }
  }
}

module.exports = { CollabClient, COLLAB_SERVER, MAX_ELEMENTS_PER_PUSH };
