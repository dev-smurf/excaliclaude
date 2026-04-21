import { randomUUID } from "node:crypto";

import type {
  BaseElement,
  ElementProps,
  ElementType,
  ExcalidrawElement,
  FillStyle,
  FrameElement,
  ImageElement,
  LinearElement,
  StrokeStyle,
  TextElement,
} from "./types.js";

interface BaseDefaults {
  readonly angle: number;
  readonly strokeColor: string;
  readonly backgroundColor: string;
  readonly fillStyle: FillStyle;
  readonly strokeWidth: number;
  readonly strokeStyle: StrokeStyle;
  readonly roughness: number;
  readonly opacity: number;
  readonly roundness: null;
  readonly groupIds: readonly string[];
  readonly frameId: null;
  readonly boundElements: null;
  readonly link: null;
  readonly locked: false;
  readonly isDeleted: false;
}

export const BASE_DEFAULTS: BaseDefaults = {
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  roundness: null,
  groupIds: [],
  frameId: null,
  boundElements: null,
  link: null,
  locked: false,
  isDeleted: false,
};

function randomSeed(): number {
  return Math.floor(Math.random() * 2147483646);
}

export function makeElement(
  type: ElementType,
  props: ElementProps
): ExcalidrawElement {
  const { type: _ignoredType, ...restProps } = props;
  const base: BaseElement = {
    ...BASE_DEFAULTS,
    groupIds: [],
    id: randomUUID(),
    type,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    seed: randomSeed(),
    version: 1,
    versionNonce: randomSeed(),
    updated: Date.now(),
    index: null,
    ...restProps,
  } as BaseElement;

  if (type === "text") {
    const text = (props as Partial<TextElement>).text || "";
    const fontSize = (props as Partial<TextElement>).fontSize || 20;
    const fontFamily = (props as Partial<TextElement>).fontFamily || 5;
    const lineHeight = (props as Partial<TextElement>).lineHeight || 1.25;
    const lines = text.split("\n");
    const maxLineLen = Math.max(...lines.map((l) => l.length));

    const charWidthMultiplier =
      fontFamily === 2 || fontFamily === 9
        ? 0.55
        : fontFamily === 3
          ? 0.6
          : 0.65;

    const estimatedWidth =
      props.width || Math.ceil(maxLineLen * fontSize * charWidthMultiplier) + 10;
    const estimatedHeight =
      props.height || Math.ceil(lines.length * fontSize * lineHeight) + 4;

    return {
      ...base,
      type: "text",
      width: estimatedWidth,
      height: estimatedHeight,
      text,
      originalText: text,
      fontSize,
      fontFamily,
      textAlign: (props as Partial<TextElement>).textAlign || "left",
      verticalAlign: (props as Partial<TextElement>).verticalAlign || "top",
      lineHeight,
      autoResize: true,
      containerId: (props as Partial<TextElement>).containerId || null,
    } satisfies TextElement;
  }

  if (type === "arrow" || type === "line") {
    const linearProps = props as Partial<LinearElement>;
    return {
      ...base,
      type,
      points: linearProps.points || [[0, 0]],
      startArrowhead: linearProps.startArrowhead || null,
      endArrowhead:
        type === "arrow"
          ? "endArrowhead" in props
            ? linearProps.endArrowhead ?? null
            : "arrow"
          : null,
      startBinding: linearProps.startBinding || null,
      endBinding: linearProps.endBinding || null,
      elbowed: linearProps.elbowed || false,
    } satisfies LinearElement;
  }

  if (type === "frame") {
    return {
      ...base,
      type: "frame",
      name: (props as Partial<FrameElement>).name || "",
    } satisfies FrameElement;
  }

  if (type === "image") {
    const imageProps = props as Partial<ImageElement> & { fileId?: string };
    return {
      ...base,
      type: "image",
      fileId: imageProps.fileId || randomUUID(),
      status: "saved",
      scale: imageProps.scale || [1, 1],
    } satisfies ImageElement;
  }

  return base;
}

export function incrementVersion<T extends BaseElement>(element: T): T {
  return {
    ...element,
    version: element.version + 1,
    versionNonce: randomSeed(),
    updated: Date.now(),
  };
}
