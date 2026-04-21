export type ElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line";

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
  seed: number;
  version: number;
  versionNonce: number;
  updated: number;
  index: string | null;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  originalText: string;
  fontSize: number;
  fontFamily: number;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
  lineHeight: number;
  autoResize: boolean;
  containerId: string | null;
}

export interface LinearElement extends BaseElement {
  type: "arrow" | "line";
  points: [number, number][];
  startArrowhead: string | null;
  endArrowhead: string | null;
  startBinding: ElementBinding | null;
  endBinding: ElementBinding | null;
  elbowed: boolean;
}

export type ExcalidrawElement = BaseElement | TextElement | LinearElement;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementProps = Record<string, any>;

export interface RoomCoords {
  roomId: string;
  roomKey: string;
}

export interface EncryptResult {
  buffer: ArrayBuffer;
  iv: Uint8Array;
}

export type ConnectResult =
  | { alone: true }
  | { alone: false; users: number };

export interface BroadcastPayload {
  type: "SCENE_INIT" | "SCENE_UPDATE";
  payload?: {
    elements?: ExcalidrawElement[];
  };
}

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

export interface ClientToServerEvents {
  "join-room": (roomId: string) => void;
  "server-broadcast": (
    roomId: string,
    buffer: ArrayBuffer,
    iv: Uint8Array
  ) => void;
}
