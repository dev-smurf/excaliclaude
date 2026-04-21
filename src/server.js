const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const { CollabClient } = require("./collab.js");
const { parseCollabUrl } = require("./url.js");
const { makeElement } = require("./elements.js");

function createServer() {
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
        "Connect to an Excalidraw collaboration room. Get the link by clicking 'Live collaboration' in Excalidraw.",
      inputSchema: {
        url: z
          .string()
          .describe(
            "Excalidraw collab URL (e.g. https://excalidraw.com/#room=ROOM_ID,KEY)"
          ),
      },
    },
    async ({ url }) => {
      try {
        if (client.isConnected()) {
          client.disconnect();
        }

        const { roomId, roomKey } = parseCollabUrl(url);
        const result = await client.connect(roomId, roomKey);

        return {
          content: [
            {
              type: "text",
              text: `Connected to room ${roomId.slice(0, 8)}... ${result.alone ? "(you are alone)" : `(${result.users} users in room)`}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Connection failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "draw_elements",
    {
      title: "Draw on Excalidraw",
      description:
        "Draw elements on the connected Excalidraw canvas. Supports rectangle, ellipse, diamond, text, arrow, line.",
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
                })
                .optional(),
            })
          )
          .min(1)
          .max(500)
          .describe("Array of Excalidraw elements to draw"),
      },
    },
    async ({ elements }) => {
      try {
        const builtElements = [];

        for (const el of elements) {
          const built = makeElement(el.type, el);

          if (el.label && ["rectangle", "ellipse", "diamond"].includes(el.type)) {
            const labelFontSize = el.label.fontSize || 16;
            const labelText = el.label.text;
            const labelLines = labelText.split("\n");
            const maxLineLen = Math.max(...labelLines.map((l) => l.length));
            const labelWidth = Math.ceil(maxLineLen * labelFontSize * 0.65) + 10;
            const labelHeight = Math.ceil(labelLines.length * labelFontSize * 1.25) + 4;

            // Auto white text on dark backgrounds
            const bg = built.backgroundColor || "transparent";
            const isDarkBg = (() => {
              if (bg === "transparent" || built.fillStyle !== "solid") return false;
              const m = bg.match(/^#([0-9a-f]{2})/i);
              if (!m) return false;
              return parseInt(m[1], 16) < 100;
            })();
            const labelColor = isDarkBg ? "#ffffff" : "#1e1e1e";

            const labelX = built.x + (built.width - labelWidth) / 2;
            const labelY = built.y + (built.height - labelHeight) / 2;

            const labelEl = makeElement("text", {
              text: labelText,
              fontSize: labelFontSize,
              strokeColor: labelColor,
              textAlign: "center",
              verticalAlign: "middle",
              containerId: built.id,
              x: labelX,
              y: labelY,
              width: labelWidth,
              height: labelHeight,
            });
            built.boundElements = [{ id: labelEl.id, type: "text" }];
            builtElements.push(built, labelEl);
          } else if (el.label && (el.type === "arrow" || el.type === "line")) {
            // Arrow/line labels: standalone text near the midpoint (not bound)
            const labelFontSize = el.label.fontSize || 12;
            const labelText = el.label.text;
            const labelLines = labelText.split("\n");
            const maxLineLen = Math.max(...labelLines.map((l) => l.length));
            const labelWidth = Math.ceil(maxLineLen * labelFontSize * 0.65) + 10;
            const labelHeight = Math.ceil(labelLines.length * labelFontSize * 1.25) + 4;

            const points = built.points || [[0, 0]];
            const lastPt = points[points.length - 1];
            const isHorizontal = Math.abs(lastPt[0]) >= Math.abs(lastPt[1]);

            let labelX, labelY;
            if (isHorizontal) {
              // Place above the arrow midpoint
              const midX = built.x + lastPt[0] / 2;
              labelX = midX - labelWidth / 2;
              labelY = built.y - labelHeight - 4;
            } else {
              // Place to the right of the arrow midpoint
              const midY = built.y + lastPt[1] / 2;
              labelX = built.x + 8;
              labelY = midY - labelHeight / 2;
            }

            const labelEl = makeElement("text", {
              text: labelText,
              fontSize: labelFontSize,
              strokeColor: "#888888",
              x: labelX,
              y: labelY,
              width: labelWidth,
              height: labelHeight,
            });
            builtElements.push(built, labelEl);
          } else {
            builtElements.push(built);
          }
        }

        await client.pushElements(builtElements);

        return {
          content: [
            {
              type: "text",
              text: `Drew ${builtElements.length} elements on the canvas.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Draw failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_scene",
    {
      title: "Get Excalidraw scene",
      description: "Get all visible elements currently on the canvas.",
      inputSchema: {},
    },
    async () => {
      try {
        const elements = client.getElements();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: elements.length,
                  elements: elements.map((el) => ({
                    id: el.id,
                    type: el.type,
                    x: el.x,
                    y: el.y,
                    width: el.width,
                    height: el.height,
                    text: el.text,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Get scene failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "delete_elements",
    {
      title: "Delete Excalidraw elements",
      description: "Delete elements from the canvas by their IDs.",
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .describe("Array of element IDs to delete"),
      },
    },
    async ({ ids }) => {
      try {
        await client.deleteElements(ids);
        return {
          content: [
            { type: "text", text: `Deleted ${ids.length} elements.` },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Delete failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "clear_canvas",
    {
      title: "Clear Excalidraw canvas",
      description: "Remove all elements from the canvas.",
      inputSchema: {},
    },
    async () => {
      try {
        await client.clearAll();
        return {
          content: [{ type: "text", text: "Canvas cleared." }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Clear failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return { server, client };
}

module.exports = { createServer };
