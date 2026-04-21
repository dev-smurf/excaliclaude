/**
 * Socket.io client for Excalidraw's real-time collaboration protocol.
 *
 * Handles the full lifecycle: connect, join room, send/receive encrypted
 * scene updates, auto-reconnect on drops, and local element state tracking.
 *
 * Protocol flow:
 *   1. Open WebSocket to collab server
 *   2. Server emits "init-room" → we respond with "join-room"
 *   3. Server emits "first-in-room" or "room-user-change" (handshake complete)
 *   4. Scene data flows via "server-broadcast" (us→server) and "client-broadcast" (server→us)
 *   5. All payloads are AES-128-GCM encrypted — the server is a blind relay
 */

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
// Excalidraw clients choke on very large payloads; 500 is a safe batch size
export const MAX_ELEMENTS_PER_PUSH = 500;

export class CollabClient {
  private _socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;
  private _roomId: string | null = null;
  private _roomKey: string | null = null;
  /** @internal Exposed for testing only */
  _elements: Map<string, ExcalidrawElement> = new Map();
  private _connected = false;
  // Stack of element ID arrays, one entry per draw_elements call, for undo
  private _history: string[][] = [];
  private _intentionalDisconnect = false;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly BASE_RECONNECT_DELAY_MS = 1000;

  isConnected(): boolean {
    return this._connected && this._socket?.connected === true;
  }

  async connect(roomId: string, roomKey: string): Promise<ConnectResult> {
    if (this._socket) {
      this.disconnect();
    }

    this._intentionalDisconnect = false;
    this._reconnectAttempts = 0;
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
          // The collab server rejects connections without a valid Origin header.
          // This matches what the Excalidraw web app sends.
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

      // "room-user-change" fires both on initial join (when others are present)
      // and on subsequent user joins/leaves. We only resolve the connect promise
      // on the first occurrence.
      this._socket.on("room-user-change", (users: string[]) => {
        if (!this._connected) {
          clearTimeout(timer);
          this._connected = true;
          resolve({ alone: false, users: users.length });
        }
      });

      // Inbound scene data from other collaborators (encrypted by the sender)
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
                if (el.isDeleted) {
                  this._elements.delete(el.id);
                } else {
                  this._elements.set(el.id, el);
                }
              }
            }
          } catch {
            // Decrypt failure — wrong key or corrupt data, skip silently
          }
        }
      );

      this._socket.on("disconnect", () => {
        this._connected = false;
        if (!this._intentionalDisconnect) {
          this._attemptReconnect();
        }
      });
    });
  }

  /** Clean shutdown — clears crypto cache and suppresses auto-reconnect. */
  disconnect(): void {
    this._intentionalDisconnect = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
    this._connected = false;
    this._reconnectAttempts = 0;
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

    // Wrap in the same envelope format Excalidraw uses for scene diffs
    const payload = {
      type: "SCENE_UPDATE" as const,
      payload: { elements },
    };

    const { buffer, iv } = await encrypt(this._roomKey!, payload);
    // "server-broadcast" tells the collab server to relay to all other clients
    this._socket!.emit("server-broadcast", this._roomId!, buffer, iv);

    for (const el of elements) {
      this._elements.set(el.id, el);
    }

    // Track non-deleted element IDs for undo
    const newIds = elements.filter((el) => !el.isDeleted).map((el) => el.id);
    if (newIds.length > 0) {
      this._history.push(newIds);
    }
  }

  async undoLastDraw(): Promise<number> {
    this._assertConnected();
    const lastIds = this._history.pop();
    if (!lastIds || lastIds.length === 0) return 0;
    await this.deleteElements(lastIds);
    return lastIds.length;
  }

  getElements(): ExcalidrawElement[] {
    return Array.from(this._elements.values()).filter((el) => !el.isDeleted);
  }

  getElementById(id: string): ExcalidrawElement | undefined {
    const el = this._elements.get(id);
    return el?.isDeleted ? undefined : el;
  }

  elementCount(): number {
    let count = 0;
    for (const el of this._elements.values()) {
      if (!el.isDeleted) count++;
    }
    return count;
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

  /** Exponential backoff reconnect: 1s, 2s, 4s, 8s, 16s then give up. */
  private _attemptReconnect(): void {
    if (
      this._reconnectAttempts >= CollabClient.MAX_RECONNECT_ATTEMPTS ||
      !this._roomId ||
      !this._roomKey
    ) {
      return;
    }

    const delay =
      CollabClient.BASE_RECONNECT_DELAY_MS *
      Math.pow(2, this._reconnectAttempts);
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(() => {
      if (this._intentionalDisconnect || !this._roomId || !this._roomKey) {
        return;
      }
      const roomId = this._roomId;
      const roomKey = this._roomKey;
      // Clean up old socket without marking as intentional
      if (this._socket) {
        this._socket.disconnect();
        this._socket = null;
      }
      this.connect(roomId, roomKey).catch(() => {
        // Reconnect failed — next attempt will be triggered by the
        // disconnect event handler if the socket connects then drops again.
        // If connect() itself throws before establishing, we stop here.
      });
    }, delay);
  }

  private _assertConnected(): void {
    if (!this.isConnected()) {
      throw new Error("Not connected. Call connect() first.");
    }
  }
}
