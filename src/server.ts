/**
 * MCP server exposing Excalidraw collaboration as tool calls.
 *
 * Each tool maps to a high-level drawing operation (draw, update, delete, etc.).
 * A single CollabClient instance is shared across all tools — the LLM connects
 * once and then issues drawing commands against that session.
 */

import crypto from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CollabClient } from "./collab.js";
import { makeElement } from "./elements.js";
import { parseCollabUrl } from "./url.js";
import { buildShapeLabel, buildArrowLabel } from "./labels.js";
import type { LabelProps } from "./labels.js";
import type { ExcalidrawElement, LinearElement, TextElement } from "./types.js";

// ── Spatial helpers ────────────────────────────────────────────────────────

interface BBox {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
}

/** Build a bounding box list from visible elements, skipping bound labels and arrows/lines. */
function collectBBoxes(elements: ExcalidrawElement[]): BBox[] {
  return elements
    .filter((el) => {
      // Skip bound text labels (they intentionally overlap their container)
      if (el.type === "text" && (el as TextElement).containerId) return false;
      // Skip arrows and lines (they naturally cross over shapes)
      if (el.type === "arrow" || el.type === "line") return false;
      // Skip zero-size elements
      if (el.width === 0 && el.height === 0) return false;
      return true;
    })
    .map((el) => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      w: el.width,
      h: el.height,
      text: (el as TextElement).text,
    }));
}

/** Axis-aligned bounding box intersection test with a small tolerance. */
function boxesOverlap(a: BBox, b: BBox, tolerance = 4): boolean {
  return (
    a.x < b.x + b.w - tolerance &&
    a.x + a.w > b.x + tolerance &&
    a.y < b.y + b.h - tolerance &&
    a.y + a.h > b.y + tolerance
  );
}

interface OverlapPair {
  a: string; // id or short label
  b: string;
}

/** Find all overlapping element pairs from a set of bounding boxes. */
function findOverlaps(boxes: BBox[]): OverlapPair[] {
  const overlaps: OverlapPair[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i]!, boxes[j]!)) {
        const label = (b: BBox) => {
          if (b.text) return `${b.type} "${b.text.slice(0, 15)}"`;
          return `${b.type} (${b.id.slice(0, 8)})`;
        };
        overlaps.push({ a: label(boxes[i]!), b: label(boxes[j]!) });
      }
    }
  }
  return overlaps;
}

/** Compute canvas bounds and overlap warnings for all visible elements. */
function buildSpatialSummary(elements: ExcalidrawElement[]): string {
  if (elements.length === 0) return "";

  const boxes = collectBBoxes(elements);
  const parts: string[] = [];

  // Canvas bounds
  if (boxes.length > 0) {
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));
    parts.push(`Canvas bounds: (${Math.round(minX)}, ${Math.round(minY)}) to (${Math.round(maxX)}, ${Math.round(maxY)})`);
  }

  // Overlap warnings
  const overlaps = findOverlaps(boxes);
  if (overlaps.length > 0) {
    const lines = overlaps.slice(0, 10).map((o) => `  - ${o.a} overlaps ${o.b}`);
    parts.push(`OVERLAPS DETECTED (${overlaps.length}):\n${lines.join("\n")}`);
  }

  // Unbound arrows
  const arrows = elements.filter((el): el is LinearElement =>
    el.type === "arrow" && !(el as LinearElement).startBinding && !(el as LinearElement).endBinding
  );
  if (arrows.length > 0) {
    parts.push(`UNBOUND ARROWS (${arrows.length}): ${arrows.map((a) => a.id.slice(0, 8)).join(", ")} — these arrows are not connected to any shape. Use startBinding/endBinding to attach them.`);
  }

  return parts.join("\n");
}

/**
 * Creates the MCP server and its backing CollabClient. Caller owns transport setup.
 *
 * @param existingClient - Optional CollabClient to reuse. When omitted a new
 *   one is created. The HTTP transport passes a shared client so the Excalidraw
 *   room connection survives across MCP session reconnects.
 */
export function createServer(existingClient?: CollabClient): { server: McpServer; client: CollabClient } {
  const server = new McpServer({
    name: "excaliclaude",
    version: "0.1.0",
  });

  const client = existingClient ?? new CollabClient();

  server.registerTool(
    "connect",
    {
      title: "Connect to Excalidraw",
      description:
        "Connect to an Excalidraw collaboration room. If already connected to another room, the existing connection is closed first. Get the link by clicking 'Live collaboration' in Excalidraw. Must be called before any other tool.",
      inputSchema: {
        url: z
          .string()
          .describe(
            "Excalidraw collab URL (e.g. https://excalidraw.com/#room=ROOM_ID,KEY)"
          ),
      },
    },
    async ({ url }: { url: string }) => {
      try {
        const { roomId, roomKey } = parseCollabUrl(url);

        // Already connected to this room — skip reconnection to preserve
        // element cache, undo history, and avoid socket churn.
        if (client.isConnected() && client.roomId === roomId) {
          const count = client.elementCount();
          return {
            content: [
              {
                type: "text" as const,
                text: `Already connected to room ${roomId.slice(0, 8)}... (${count} elements on canvas)`,
              },
            ],
          };
        }

        if (client.isConnected()) {
          client.disconnect();
        }

        const result = await client.connect(roomId, roomKey);

        return {
          content: [
            {
              type: "text" as const,
              text: `Connected to room ${roomId.slice(0, 8)}... ${result.alone ? "(you are alone)" : `(${result.users} users in room)`}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Connection failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "draw_elements",
    {
      title: "Draw on Excalidraw",
      description: `Draw elements on the connected Excalidraw canvas. Supports rectangle, ellipse, diamond, text, arrow, line, frame, image.

BINDINGS (connect arrows to shapes):
- Set startBinding/endBinding on arrows with { elementId, fixedPoint }.
- fixedPoint is [x, y] normalized 0-1 on the target shape: [0.5, 0] = top center, [0.5, 1] = bottom center, [0, 0.5] = left center, [1, 0.5] = right center.
- The target shape MUST exist (already on canvas or drawn in the same call with a pre-assigned id).

PRE-ASSIGNED IDs:
- Set "id" on any element to choose its ID. Then reference that ID in arrow bindings within the same call.
- Example: draw a rectangle with id:"box1", then an arrow with endBinding: { elementId:"box1", fixedPoint:[0.5,0] }.

ELBOWED ARROWS (auto-routed right-angle paths):
- Set elbowed: true on arrows. Excalidraw auto-routes them with 90° turns around obstacles.
- Elbowed arrows REQUIRE at least one binding (startBinding or endBinding). Without a binding they render as straight lines.
- When using elbowed arrows, set points to just [[0,0], [dx,dy]] (start and end). Excalidraw computes the intermediate waypoints.

WORKFLOW (follow every time):
1. CALL get_scene FIRST to see all current elements, their positions, and any existing overlaps.
2. PLAN THE FULL LAYOUT before drawing anything. Calculate x, y, width, height for every element. Account for text length — longer text needs wider/taller boxes.
3. CHECK FOR COLLISIONS: For each new element, verify its bounding box (x, y, x+width, y+height) does not intersect any existing element.
4. IF RESIZING: When a box grows, shift all elements to its right/below to maintain spacing. Never resize in isolation.
5. DRAW EVERYTHING IN ONE CALL: Shapes + arrows + labels together, using pre-assigned IDs for bindings.

SPACING: At least 80px horizontal gap between shapes, 120px vertical gap between rows.
TEXT: Server estimates dimensions. Keep text concise. Multi-line uses \\n. Use textAlign: "center" for centered text.
DARK CONTAINERS: Server auto-detects dark backgrounds and uses white text for labels.

The response includes overlap warnings and unbound arrow alerts — fix any issues before proceeding.`,
      inputSchema: {
        elements: z
          .array(
            z.object({
              id: z
                .string()
                .optional()
                .describe(
                  "Optional pre-assigned ID. Set this so arrows can reference shapes drawn in the same call via startBinding/endBinding."
                ),
              type: z.enum([
                "rectangle",
                "ellipse",
                "diamond",
                "text",
                "arrow",
                "line",
                "frame",
                "image",
              ]),
              x: z.number(),
              y: z.number(),
              width: z.number().optional().default(0),
              height: z.number().optional().default(0),
              strokeColor: z.string().optional(),
              backgroundColor: z.string().optional(),
              fillStyle: z
                .enum(["solid", "hachure", "cross-hatch", "zigzag"])
                .optional(),
              strokeWidth: z.number().optional(),
              strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
              roughness: z.number().optional(),
              opacity: z.number().min(0).max(100).optional(),
              roundness: z
                .object({ type: z.number(), value: z.number().optional() })
                .nullable()
                .optional(),
              text: z.string().optional(),
              fontSize: z.number().optional(),
              fontFamily: z.number().optional(),
              textAlign: z.enum(["left", "center", "right"]).optional(),
              points: z.array(z.array(z.number()).length(2)).optional(),
              startArrowhead: z.string().nullable().optional(),
              endArrowhead: z.string().nullable().optional(),
              startBinding: z
                .object({
                  elementId: z.string(),
                  fixedPoint: z.array(z.number()).length(2),
                })
                .nullable()
                .optional(),
              endBinding: z
                .object({
                  elementId: z.string(),
                  fixedPoint: z.array(z.number()).length(2),
                })
                .nullable()
                .optional(),
              elbowed: z
                .boolean()
                .optional()
                .describe(
                  "Set true for auto-routed right-angle arrows. Requires at least one binding."
                ),
              label: z
                .object({
                  text: z.string(),
                  fontSize: z.number().optional(),
                  x: z.number().optional(),
                  y: z.number().optional(),
                })
                .optional(),
              name: z
                .string()
                .optional()
                .describe("Name for frame elements"),
              fileId: z
                .string()
                .optional()
                .describe("File ID for image elements"),
              scale: z
                .array(z.number())
                .length(2)
                .optional()
                .describe("Scale [x, y] for image elements"),
            })
          )
          .min(1)
          .max(500)
          .describe("Array of Excalidraw elements to draw"),
      },
    },
    async ({ elements }: { elements: Array<Record<string, unknown>> }) => {
      try {
        const builtElements: ExcalidrawElement[] = [];

        for (const el of elements) {
          const elType = el.type as string;
          const built = makeElement(
            elType as ExcalidrawElement["type"],
            el as Record<string, unknown>
          );

          const label = el.label as LabelProps | undefined;

          if (label && ["rectangle", "ellipse", "diamond", "frame"].includes(elType)) {
            const labelEl = buildShapeLabel(built, label);
            builtElements.push(built, labelEl);
          } else if (label && (elType === "arrow" || elType === "line")) {
            const labelEl = buildArrowLabel(built, label);
            builtElements.push(built, labelEl);
          } else {
            builtElements.push(built);
          }
        }

        await client.pushElements(builtElements);

        const summary = builtElements
          .map((el) => {
            const tag = el.type === "text" && (el as TextElement).containerId
              ? "label"
              : el.type;
            const name = (el as TextElement).text
              ? ` "${(el as TextElement).text.slice(0, 20)}"`
              : "";
            return `${tag}${name} (${el.id})`;
          })
          .join(", ");

        // Post-draw spatial check across ALL canvas elements
        const spatial = buildSpatialSummary(client.getElements());
        const response = `Drew ${builtElements.length} elements: ${summary}` +
          (spatial ? `\n\n${spatial}` : "");

        return {
          content: [
            {
              type: "text" as const,
              text: response,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Draw failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_scene",
    {
      title: "Get Excalidraw scene",
      description:
        "Get all non-deleted elements on the canvas. ALWAYS call this BEFORE draw_elements or update_elements to understand the current layout.\n\nCompact view (default) returns: id, type, x, y, width, height, text, boundElements, plus a spatial summary with canvas bounds, overlap warnings, and unbound arrows. Use this data to plan element placement and avoid collisions.\n\nSet full=true for all properties including strokeColor, backgroundColor, fillStyle, points, bindings, etc.",
      inputSchema: {
        full: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Return full element data (all properties) instead of compact view"
          ),
      },
    },
    async ({ full }: { full: boolean }) => {
      try {
        const elements = client.getElements();
        const compactElements = elements.map((el) => {
          const compact: Record<string, unknown> = {
            id: el.id,
            type: el.type,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
          };
          if ((el as TextElement).text !== undefined) {
            compact.text = (el as TextElement).text;
          }
          if (el.boundElements && el.boundElements.length > 0) {
            compact.boundElements = el.boundElements;
          }
          return compact;
        });

        const data = full
          ? { count: elements.length, elements }
          : { count: elements.length, elements: compactElements };

        const spatial = full ? "" : buildSpatialSummary(elements);
        const response = JSON.stringify(data, null, 2) +
          (spatial ? `\n\n${spatial}` : "");

        return {
          content: [
            {
              type: "text" as const,
              text: response,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Get scene failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "update_elements",
    {
      title: "Update Excalidraw elements",
      description:
        "Update existing elements on the canvas by ID. Use this to move, resize, restyle, or change text of existing elements instead of deleting and recreating them. Only provide the properties you want to change — all other properties are preserved.\n\nIMPORTANT: When resizing or moving an element, check if adjacent elements or bound arrows need to move too. Use get_scene first to see the full layout, then cascade changes to maintain proper spacing and avoid overlaps.\n\nPrefer update_elements over delete + draw: deleting and redrawing creates new IDs and severs arrow bindings.",
      inputSchema: {
        updates: z
          .array(
            z.object({
              id: z.string().describe("ID of the element to update"),
              x: z.number().optional(),
              y: z.number().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              strokeColor: z.string().optional(),
              backgroundColor: z.string().optional(),
              fillStyle: z
                .enum(["solid", "hachure", "cross-hatch", "zigzag"])
                .optional(),
              strokeWidth: z.number().optional(),
              strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
              opacity: z.number().min(0).max(100).optional(),
              text: z.string().optional(),
              fontSize: z.number().optional(),
              points: z.array(z.array(z.number()).length(2)).optional(),
            })
          )
          .min(1)
          .max(500)
          .describe(
            "Array of updates with element ID and changed properties"
          ),
      },
    },
    async ({
      updates,
    }: {
      updates: Array<{ id: string } & Record<string, unknown>>;
    }) => {
      try {
        const updatedElements: ExcalidrawElement[] = [];
        let notFound = 0;

        for (const upd of updates) {
          const existing = client.getElementById(upd.id);
          if (!existing) {
            notFound++;
            continue;
          }

          const { id: _id, ...changes } = upd;

          // Excalidraw requires originalText to stay in sync with text
          if (
            (changes as Record<string, unknown>).text !== undefined &&
            existing.type === "text"
          ) {
            (changes as Record<string, unknown>).originalText = (
              changes as Record<string, unknown>
            ).text;
          }

          const updated: ExcalidrawElement = {
            ...existing,
            ...changes,
            version: existing.version + 1,
            versionNonce: Math.floor(Math.random() * 2147483646),
            updated: Date.now(),
          } as ExcalidrawElement;

          updatedElements.push(updated);
        }

        if (updatedElements.length > 0) {
          await client.pushElements(updatedElements);
        }

        const spatial = buildSpatialSummary(client.getElements());
        const msg =
          `Updated ${updatedElements.length} elements.` +
          (notFound > 0 ? ` ${notFound} not found.` : "") +
          (spatial ? `\n\n${spatial}` : "");

        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Update failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete_elements",
    {
      title: "Delete Excalidraw elements",
      description:
        "Delete elements from the canvas by their IDs. IDs not found in the current scene are silently ignored. Call get_scene first to get current element IDs.",
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Array of element IDs to delete"),
      },
    },
    async ({ ids }: { ids: string[] }) => {
      try {
        const before = client.elementCount();
        await client.deleteElements(ids);
        const after = client.elementCount();
        const actuallyDeleted = before - after;
        return {
          content: [
            {
              type: "text" as const,
              text: `Deleted ${actuallyDeleted} of ${ids.length} elements.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Delete failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "clear_canvas",
    {
      title: "Clear Excalidraw canvas",
      description:
        "Remove ALL elements from the canvas permanently. Cannot be undone. The canvas will be empty for all collaborators. Use delete_elements for selective removal. Use update_elements to modify existing elements without removing them.",
      inputSchema: {},
    },
    async () => {
      try {
        await client.clearAll();
        return {
          content: [{ type: "text" as const, text: "Canvas cleared." }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Clear failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "group_elements",
    {
      title: "Group Excalidraw elements",
      description:
        "Group elements together so they move as a unit in Excalidraw. Takes a list of element IDs and assigns them a shared group ID.",
      inputSchema: {
        ids: z
          .array(z.string())
          .min(2)
          .describe("Element IDs to group together (minimum 2)"),
      },
    },
    async ({ ids }: { ids: string[] }) => {
      try {
        const groupId = crypto.randomUUID();
        const updatedElements: ExcalidrawElement[] = [];
        let notFound = 0;

        for (const id of ids) {
          const existing = client.getElementById(id);
          if (!existing) {
            notFound++;
            continue;
          }
          updatedElements.push({
            ...existing,
            groupIds: [...(existing.groupIds || []), groupId],
            version: existing.version + 1,
            versionNonce: Math.floor(Math.random() * 2147483646),
            updated: Date.now(),
          } as ExcalidrawElement);
        }

        if (updatedElements.length > 0) {
          await client.pushElements(updatedElements);
        }

        const msg =
          `Grouped ${updatedElements.length} elements.` +
          (notFound > 0 ? ` ${notFound} not found.` : "");
        return { content: [{ type: "text" as const, text: msg }] };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Group failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "undo_last_draw",
    {
      title: "Undo last draw",
      description:
        "Undo the last draw_elements call by deleting all elements it created. Can be called multiple times to undo further back. Does not undo update_elements or delete_elements.",
      inputSchema: {},
    },
    async () => {
      try {
        const count = await client.undoLastDraw();
        if (count === 0) {
          return {
            content: [
              { type: "text" as const, text: "Nothing to undo." },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Undone: removed ${count} elements from the last draw.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Undo failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "status",
    {
      title: "Connection status",
      description:
        "Check whether excaliclaude is connected to a room, which room, and how many elements are on the canvas. Use this to verify connectivity before drawing.",
      inputSchema: {},
    },
    async () => {
      if (!client.isConnected()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Not connected. Use the connect tool with an Excalidraw collab URL first.",
            },
          ],
        };
      }
      const count = client.elementCount();
      return {
        content: [
          {
            type: "text" as const,
            text: `Connected | ${count} elements on canvas`,
          },
        ],
      };
    }
  );

  return { server, client };
}
