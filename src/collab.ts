import { io, Socket } from "socket.io-client";

import { encrypt, decrypt, clearKeyCache } from "./crypto.js";
import type {
  BroadcastPayload,
  ClientToServerEvents,
  ConnectResult,
  ExcalidrawElement,
  ServerToClientEvents,
} from "./types.js";

export const COLLAB_SERVER = "https://oss-collab.excalidraw.com";
const CONNECT_TIMEOUT = 15000;
export const MAX_ELEMENTS_PER_PUSH = 500;

export class CollabClient {
  _socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  _roomId: string | null = null;
  _roomKey: string | null = null;
  _elements: Map<string, ExcalidrawElement> = new Map();
  _connected = false;

  isConnected(): boolean {
    return this._connected && this._socket?.connected === true;
  }

  async connect(roomId: string, roomKey: string): Promise<ConnectResult> {
    if (this._socket) {
      this.disconnect();
    }

    this._roomId = roomId;
    this._roomKey = roomKey;
    this._elements.clear();

    return new Promise<ConnectResult>((resolve, reject) => {
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
      }) as Socket<ServerToClientEvents, ClientToServerEvents>;

      this._socket.on("connect_error", (err: Error) => {
        clearTimeout(timer);
        reject(new Error(`Socket connection error: ${err.message}`));
      });

      this._socket.on("init-room", () => {
        this._socket!.emit("join-room", this._roomId!);
      });

      this._socket.on("first-in-room", () => {
        clearTimeout(timer);
        this._connected = true;
        resolve({ alone: true });
      });

      this._socket.on("room-user-change", (users: string[]) => {
        if (!this._connected) {
          clearTimeout(timer);
          this._connected = true;
          resolve({ alone: false, users: users.length });
        }
      });

      this._socket.on(
        "client-broadcast",
        async (encryptedData: ArrayBuffer, iv: number[]) => {
          try {
            const data = (await decrypt(
              this._roomKey!,
              encryptedData,
              new Uint8Array(iv)
            )) as BroadcastPayload;

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
        }
      );

      this._socket.on("disconnect", () => {
        this._connected = false;
      });
    });
  }

  disconnect(): void {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
    this._connected = false;
    clearKeyCache();
    this._roomId = null;
    this._roomKey = null;
  }

  async pushElements(elements: ExcalidrawElement[]): Promise<void> {
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
      type: "SCENE_UPDATE" as const,
      payload: { elements },
    };

    const { buffer, iv } = await encrypt(this._roomKey!, payload);
    this._socket!.emit("server-broadcast", this._roomId!, buffer, iv);

    for (const el of elements) {
      this._elements.set(el.id, el);
    }
  }

  getElements(): ExcalidrawElement[] {
    return Array.from(this._elements.values()).filter((el) => !el.isDeleted);
  }

  async deleteElements(ids: string[]): Promise<void> {
    this._assertConnected();

    const deletedElements = ids
      .map((id) => this._elements.get(id))
      .filter((el): el is ExcalidrawElement => el != null)
      .map((el) => ({
        ...el,
        isDeleted: true as const,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2147483646),
        updated: Date.now(),
      }));

    if (deletedElements.length === 0) {
      return;
    }

    for (let i = 0; i < deletedElements.length; i += MAX_ELEMENTS_PER_PUSH) {
      const batch = deletedElements.slice(i, i + MAX_ELEMENTS_PER_PUSH);
      await this.pushElements(batch as ExcalidrawElement[]);
    }
  }

  async clearAll(): Promise<void> {
    this._assertConnected();

    const allIds = Array.from(this._elements.keys());
    if (allIds.length === 0) {
      return;
    }

    await this.deleteElements(allIds);
  }

  private _assertConnected(): void {
    if (!this.isConnected()) {
      throw new Error("Not connected. Call connect() first.");
    }
  }
}
