<p align="center">
  <img src="assets/claude-jumping.svg" alt="Claude Code mascot jumping" width="140" height="120">
</p>

<h1 align="center">
  <code>excaliclaude</code>
</h1>

<h3 align="center">
  Claude draws on your Excalidraw canvas. In real-time.
</h3>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-E07C4C?style=for-the-badge" alt="MIT License"></a>&nbsp;
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 18+">&nbsp;
  <img src="https://img.shields.io/badge/MCP-server-6F42C1?style=for-the-badge&logo=anthropic&logoColor=white" alt="MCP Server">&nbsp;
  <img src="https://img.shields.io/badge/E2E-encrypted-2D7D46?style=for-the-badge&logo=letsencrypt&logoColor=white" alt="E2E Encrypted">
</p>

<br>

<p align="center">
  <img src="https://img.shields.io/badge/1-Open_Excalidraw_+_start_collab-4A90D9?style=flat-square" alt="Step 1">&nbsp;&nbsp;>&nbsp;&nbsp;<img src="https://img.shields.io/badge/2-Give_the_link_to_Claude-E07C4C?style=flat-square" alt="Step 2">&nbsp;&nbsp;>&nbsp;&nbsp;<img src="https://img.shields.io/badge/3-Watch_it_draw_live-2D7D46?style=flat-square" alt="Step 3">
</p>

<br>

---

<br>

## How it works

```
┌─────────┐          ┌──────────────────┐          ┌─────────────────┐
│         │  prompt   │                  │ socket.io │                 │
│   You   │ -------> │   excaliclaude   │ -------> │   Excalidraw    │
│         │          │   (MCP server)   │ AES-128  │   (your browser)│
└─────────┘          └──────────────────┘          └─────────────────┘
                                                          │
                            shapes appear live! ◄─────────┘
```

> [!TIP]
> No browser extension. No DevTools. No API key needed from Excalidraw.
> Just the native collaboration protocol.

<br>

---

<br>

## Install

```bash
npm install -g excaliclaude
```

<br>

<table>
<tr>
<td width="50%">

### <img src="https://img.shields.io/badge/-Claude_Code-E07C4C?style=flat-square" alt="Claude Code"> &nbsp;(recommended)

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

</td>
<td width="50%">

### <img src="https://img.shields.io/badge/-Cursor_/_Windsurf_/_Other-555?style=flat-square" alt="Other">

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

</td>
</tr>
</table>

<details>
<summary><strong>Run from source</strong></summary>

<br>

```bash
git clone https://github.com/dev-smurf/excaliclaude.git
cd excaliclaude
npm install
npm start
```

</details>

<br>

---

<br>

## Tools

| Tool | Description |
|:-----|:------------|
| **`connect`** | Join an Excalidraw collab room via URL |
| **`draw_elements`** | Draw rectangles, ellipses, diamonds, text, arrows, lines |
| **`get_scene`** | Read all visible elements currently on the canvas |
| **`delete_elements`** | Remove specific elements by their ID |
| **`clear_canvas`** | Wipe the entire canvas clean |

<br>

---

<br>

## Example

```
You:    Connect to https://excalidraw.com/#room=abc,key123
        and draw a system architecture with a load balancer,
        3 API servers, and a database.

Claude: ✓ Connected to room abc12345... (2 users in room)
        ✓ Drawing 9 elements...

        *rectangles, arrows, and labels appear live in your browser*
```

<br>

---

<br>

## Security

> [!IMPORTANT]
> The room key **never** leaves your machine unencrypted. The Excalidraw relay server only sees ciphertext.

| Feature | Detail |
|:--------|:-------|
| **E2E Encrypted** | AES-128-GCM with 12-byte IV. Room key derived from URL fragment (never sent to server). |
| **Key in memory only** | Never written to disk. Never logged. Cleared on disconnect. |
| **Validated inputs** | Every tool input goes through Zod schemas before execution. |
| **Rate limited** | Max 500 elements per draw call to prevent abuse. |

<br>

---

<br>

## Architecture

```
bin/excaliclaude.js         ← CLI entry point (stdio transport)
       │
src/server.js               ← MCP server with 5 tools
       │
src/collab.js               ← Socket.io connection + room management + element cache
       │
       ├── src/crypto.js    ← AES-128-GCM encrypt/decrypt (WebCrypto API)
       ├── src/elements.js  ← Element factory with Excalidraw defaults
       └── src/url.js       ← Parse collab URLs → { roomId, roomKey }
```

<br>

---

<br>

## Requirements

| Requirement | Notes |
|:------------|:------|
| **Node.js 18+** | Uses native `crypto.subtle` (WebCrypto) |
| **Excalidraw collab link** | Free, no account needed. Click "Live collaboration" in Excalidraw. |

<br>

---

<p align="center">
  <br>
  <img src="assets/claude-jumping.svg" alt="Claude Code" width="60" height="50">
  <br><br>
  <sub>Built for <a href="https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview">Claude Code</a></sub>
  <br>
  <sub>by <a href="https://github.com/dev-smurf">@dev-smurf</a></sub>
</p>
