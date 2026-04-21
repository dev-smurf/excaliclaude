# excaliclaude

MCP server that lets Claude draw in your Excalidraw canvas in real-time.

You open Excalidraw, start a collaboration session, give the link to Claude, and watch elements appear live on your canvas. No browser extension. No DevTools. Just the native Excalidraw collaboration protocol.

## How it works

```
Claude Code  -->  excaliclaude MCP  -->  socket.io + AES-128-GCM
                                              |
                                    oss-collab.excalidraw.com
                                              |
                                     Your browser (live!)
```

1. Open [excalidraw.com](https://excalidraw.com)
2. Click **Live collaboration** and copy the link
3. Tell Claude: *"Connect to this Excalidraw and draw me a system architecture diagram"*
4. Watch it appear in real-time

## Install

```bash
npm install -g excaliclaude
```

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "excaliclaude": {
      "command": "excaliclaude"
    }
  }
}
```

### Cursor / Other MCP clients

```json
{
  "mcpServers": {
    "excaliclaude": {
      "command": "npx",
      "args": ["-y", "excaliclaude"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `connect` | Connect to an Excalidraw collaboration room |
| `draw_elements` | Draw shapes, text, arrows on the canvas |
| `get_scene` | Get all visible elements on the canvas |
| `delete_elements` | Remove elements by ID |
| `clear_canvas` | Clear everything |

## Example

```
You: Connect to https://excalidraw.com/#room=abc123,key456 and draw a flowchart
     with "Start" -> "Process" -> "End"

Claude: *connects to the room, draws three boxes with arrows*
        *you see them appear live in your browser*
```

## Security

- **E2E encrypted** -- The room key never leaves your machine. Excalidraw's relay server only sees ciphertext.
- **Key in memory only** -- Never written to disk, never logged.
- **Input validation** -- All tool inputs validated with Zod schemas.
- **Rate limited** -- Max 100 elements per draw call.

## Requirements

- Node.js 18+ (uses native `crypto.subtle`)
- An Excalidraw collaboration link

## Development

```bash
git clone https://github.com/dev-smurf/excaliclaude.git
cd excaliclaude
npm install
npm test
```

## License

MIT
