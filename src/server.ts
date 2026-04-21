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
import type { ExcalidrawElement, TextElement } from "./types.js";

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

LAYOUT RULES:
1. PLAN BEFORE DRAWING: Calculate positions for every element FIRST. Never place elements without considering the full picture.
2. SPACING: Leave at least 80px horizontal gap between shapes for arrows + labels. At least 120px vertical gap between rows.
3. NO OVERLAP: Before placing ANY element, verify its bounding box does not intersect with any existing element.
4. USE get_scene FIRST when adding to an existing canvas to see current positions.
5. TEXT: The server estimates text dimensions. Keep text concise. Multi-line text uses \\n. Use textAlign: "center" for centered annotations.
6. DARK CONTAINERS: The server auto-detects dark backgrounds and sets white text for labels.`,
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

        return {
          content: [
            {
              type: "text" as const,
              text: `Drew ${builtElements.length} elements: ${summary}`,
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
        "Get all non-deleted elements on the canvas. By default returns compact view (id, type, x, y, width, height, text). Set full=true to get all properties including strokeColor, backgroundColor, fillStyle, points, etc. Call this BEFORE draw_elements or update_elements when adding to an existing canvas.",
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
        const data = full
          ? { count: elements.length, elements }
          : {
              count: elements.length,
              elements: elements.map((el) => {
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
              }),
            };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(data, null, 2),
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
        "Update existing elements on the canvas by ID. Use this to move, resize, restyle, or change text of existing elements instead of deleting and recreating them. Only provide the properties you want to change — all other properties are preserved. Prefer update_elements over delete + draw: deleting and redrawing creates new IDs and severs any arrow bindings to the element. Call get_scene first to obtain element IDs.",
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

        const msg =
          `Updated ${updatedElements.length} elements.` +
          (notFound > 0 ? ` ${notFound} not found.` : "");

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
