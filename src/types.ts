/**
 * Shared type definitions for Excalidraw elements and the collab protocol.
 *
 * These mirror the shapes Excalidraw uses internally. We only define the subset
 * needed for the collab wire format — Excalidraw silently ignores unknown fields,
 * so we don't need to be exhaustive.
 */

export type ElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "frame"
  | "image";

export type FillStyle = "solid" | "hachure" | "cross-hatch" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface Roundness {
  type: number;
  value?: number;
}

export interface BoundElement {
  id: string;
  type: "arrow" | "text";
}

/** Describes how an arrow endpoint snaps to a shape (fixedPoint is 0-1 normalized). */
export interface ElementBinding {
  elementId: string;
  fixedPoint: [number, number];
}

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  roughness: number;
  opacity: number;
  roundness: Roundness | null;
  groupIds: string[];
  frameId: string | null;
  boundElements: BoundElement[] | null;
  link: string | null;
  locked: boolean;
  isDeleted: boolean;
  // seed, version, and versionNonce are used by Excalidraw's CRDT-like
  // reconciliation to resolve conflicts between concurrent edits.
  seed: number;
  version: number;
  versionNonce: number;
  updated: number;
  index: string | null;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  // originalText is what the user typed; text may differ after auto-wrapping.
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  autoResize: boolean;
  // When set, this text is bound inside a shape (label). Null = standalone text.
  containerId: string | null;
}

export interface LinearElement extends BaseElement {
  type: "arrow" | "line";
  // Points are relative to (x, y). First point is always [0, 0].
  points: [number, number][];
  startArrowhead: string | null;
  endArrowhead: string | null;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  elbowed: boolean;
}

export interface FrameElement extends BaseElement {
  type: "frame";
  name: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string;
  status: "pending" | "saved" | "error";
  scale: [number, number];
}

export type ExcalidrawElement =
  | BaseElement
  | TextElement
  | LinearElement
  | FrameElement
  | ImageElement;

// Loose prop bag used by makeElement() — callers pass arbitrary overrides.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementProps = Record<string, any>;

/** Parsed from the collab URL fragment: #room=<roomId>,<roomKey> */
export interface RoomCoords {
  roomId: string;
  roomKey: string;
}

export interface EncryptResult {
  buffer: ArrayBuffer;
  iv: Uint8Array;
}

/** Outcome of joining a room — either we're the first or others are present. */
export type ConnectResult =
  | { alone: true }
  | { alone: false; users: number };

export interface BroadcastPayload {
  type: "SCENE_INIT" | "SCENE_UPDATE";
  payload?: {
    elements?: ExcalidrawElement[];
  };
}

/**
 * Socket.io events sent FROM the Excalidraw collab server TO us.
 * The handshake flow: connect → init-room → join-room → first-in-room | room-user-change.
 */
export interface ServerToClientEvents {
  "init-room": () => void;
  "first-in-room": () => void;
  "room-user-change": (users: string[]) => void;
  "client-broadcast": (
    encryptedData: ArrayBuffer,
    iv: number[]
  ) => void;
  disconnect: (reason: string) => void;
  connect_error: (err: Error) => void;
  connect: () => void;
}

/** Socket.io events sent FROM us TO the Excalidraw collab server. */
export interface ClientToServerEvents {
  "join-room": (roomId: string) => void;
  "server-broadcast": (
    roomId: string,
    buffer: ArrayBuffer,
    iv: Uint8Array
  ) => void;
}
