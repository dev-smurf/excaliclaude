/**
 * Label construction for shapes and arrows.
 *
 * Shape labels are bound text elements (containerId links them to the parent).
 * Arrow labels are standalone text positioned near the arrow's midpoint.
 * Dark background detection auto-switches label color to white for readability.
 */

import { makeElement } from "./elements.js";
import type { ExcalidrawElement, LinearElement } from "./types.js";

export interface LabelProps {
  text: string;
  fontSize?: number;
  x?: number;
  y?: number;
}

/** Rough pixel dimensions for text — no DOM available, so we approximate. */
export function estimateTextDimensions(
  text: string,
  fontSize: number
): { width: number; height: number } {
  const lines = text.split("\n");
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  return {
    width: Math.ceil(maxLineLen * fontSize * 0.65) + 10,
    height: Math.ceil(lines.length * fontSize * 1.25) + 4,
  };
}

/** Only solid fills can obscure text — hachure/cross-hatch show through. */
export function isDarkBackground(bg: string, fillStyle: string): boolean {
  if (bg === "transparent" || fillStyle !== "solid") return false;

  // Expand 3-char hex (#000 → #000000)
  const normalized = bg.replace(
    /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i,
    "#$1$1$2$2$3$3"
  );

  const m = normalized.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
  );
  if (!m) return false;

  const r = parseInt(m[1]!, 16);
  const g = parseInt(m[2]!, 16);
  const b = parseInt(m[3]!, 16);

  // ITU-R BT.709 perceptual luminance
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

export function buildShapeLabel(
  shape: ExcalidrawElement,
  label: LabelProps
): ExcalidrawElement {
  const fontSize = label.fontSize || 16;
  const { width, height } = estimateTextDimensions(label.text, fontSize);
  const color = isDarkBackground(
    shape.backgroundColor,
    shape.fillStyle
  )
    ? "#ffffff"
    : "#1e1e1e";

  // Use the container's width so textAlign: "center" works correctly
  // regardless of text width estimation accuracy
  const labelEl = makeElement("text", {
    text: label.text,
    fontSize,
    strokeColor: color,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: shape.id,
    x: shape.x,
    y: shape.y + (shape.height - height) / 2,
    width: shape.width,
    height,
  });

  // Mutation here is intentional — we need to link the shape to its label
  // before both are pushed to the collab server in the same batch.
  (
    shape as { boundElements: { id: string; type: string }[] | null }
  ).boundElements = [{ id: labelEl.id, type: "text" }];

  return labelEl;
}

/**
 * Arrow labels are standalone text (not bound via containerId) because
 * Excalidraw's bound-text on arrows has quirky positioning behavior.
 * We place them adjacent to the arrow's midpoint instead.
 */
export function buildArrowLabel(
  arrow: ExcalidrawElement,
  label: LabelProps
): ExcalidrawElement {
  const fontSize = label.fontSize || 12;
  const { width, height } = estimateTextDimensions(label.text, fontSize);

  let x: number;
  let y: number;

  if (label.x !== undefined && label.y !== undefined) {
    x = label.x;
    y = label.y;
  } else {
    const points = (arrow as LinearElement).points || [[0, 0]];
    const lastPt = points[points.length - 1]!;
    const isHorizontal = Math.abs(lastPt[0]) >= Math.abs(lastPt[1]);

    if (isHorizontal) {
      const midX = arrow.x + lastPt[0] / 2;
      x = midX - width / 2;
      y = arrow.y - height - 10;
    } else {
      const midY = arrow.y + lastPt[1] / 2;
      x = arrow.x + 12;
      y = midY - height / 2;
    }
  }

  // Gray text so arrow labels are visually secondary to shape labels
  return makeElement("text", {
    text: label.text,
    fontSize,
    strokeColor: "#888888",
    x,
    y,
    width,
    height,
  });
}
