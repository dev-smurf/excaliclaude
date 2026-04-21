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

/** Creates the MCP server and its backing CollabClient. Caller owns transport setup. */
export function createServer(): { server: McpServer; client: CollabClient } {
  const server = new McpServer({
    name: "excaliclaude",
    version: "0.1.0",
  });

  const client = new CollabClient();

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
        if (client.isConnected()) {
          client.disconnect();
        }

        const { roomId, roomKey } = parseCollabUrl(url);
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
      description: `Draw elements on the connected Excalidraw canvas. Supports rectangle, ellipse, diamond, text, arrow, line.

LAYOUT RULES (CRITICAL — follow these every time):

1. PLAN BEFORE DRAWING: Before calling this tool, mentally map out the full layout. Calculate positions for every element, annotation, and arrow FIRST. Never place elements without considering the full picture.

2. SPACING: Leave at least 80px horizontal gap between shapes for arrows + labels. Leave at least 120px vertical gap between rows for annotations. Annotations go BELOW their screen in a dedicated zone — never in the arrow corridor.

3. ARROWS MUST NEVER OVERLAP CONTENT: Before drawing any arrow, check what elements exist between the start and end points. If anything is in the path, route the arrow around it using multi-point paths with 90-degree turns: points: [[0,0], [dx,0], [dx,dy]] for L-shapes, or [[0,0], [dx,0], [dx,dy], [dx2,dy]] for Z-shapes. Use as many segments as needed.

4. LABELS ON ARROWS: Arrow labels are standalone text (not bound). Place them adjacent to the arrow in empty space — above for horizontal arrows, beside for vertical arrows. Never on top of the arrow line or other content.

5. TEXT IN DARK CONTAINERS: The server auto-detects dark backgrounds and sets white text. But verify visually — if backgroundColor is dark and fillStyle is "solid", the label will be white.

6. USE get_scene FIRST: When adding to an existing canvas, ALWAYS call get_scene first to see current element positions. Then calculate new positions that avoid all existing content.

7. RESPONSIVE ROUTING: If the best path for an arrow would overlap content, consider: (a) routing the arrow with extra waypoints, (b) repositioning the annotation text, or (c) adding more spacing. Choose whichever produces the cleanest result.

8. TEXT DIMENSIONS: Text elements need width/height for proper rendering. The server estimates these, but keep text concise to avoid overflow. Multi-line text uses \\n.

9. STANDALONE TEXT NEAR ARROWS: When placing text elements near arrows manually (not using the label property), position them at least 10px ABOVE horizontal arrows or 12px to the RIGHT of vertical arrows. Never at the same y-coordinate as a horizontal arrow or the same x-coordinate as a vertical arrow — the text will visually overlap the arrow line.

10. NO ELEMENT OVERLAP EVER: Before placing ANY element, verify its bounding box (x, y, width, height) does not intersect with any existing element. If it would overlap, move it to clear space. This applies to text, shapes, arrows — everything.

11. CENTER TEXT PROPERLY: For annotation text below shapes (titles, descriptions), ALWAYS use textAlign: "center" and set width equal to the shape's width and x equal to the shape's x. This ensures Excalidraw centers the text visually regardless of width estimation. For standalone text inside phone mockups or UI elements, also use textAlign: "center". Never rely on manual x-offset calculations for centering — use textAlign instead.`,
      inputSchema: {
        elements: z
          .array(
            z.object({
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

        return {
          content: [
            {
              type: "text" as const,
              text: `Drew ${builtElements.length} elements on the canvas.`,
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
              elements: elements.map((el) => ({
                id: el.id,
                type: el.type,
                x: el.x,
                y: el.y,
                width: el.width,
                height: el.height,
                text: (el as TextElement).text,
              })),
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
