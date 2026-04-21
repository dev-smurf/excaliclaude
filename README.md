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
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">&nbsp;
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 18+">&nbsp;
  <img src="https://img.shields.io/badge/MCP-server-6F42C1?style=for-the-badge&logo=anthropic&logoColor=white" alt="MCP Server">&nbsp;
  <img src="https://img.shields.io/badge/E2E-encrypted-2D7D46?style=for-the-badge&logo=letsencrypt&logoColor=white" alt="E2E Encrypted">
</p>

<br>

---

<br>

## How it works

<p align="center">
  <strong>Open Excalidraw</strong> &nbsp;→&nbsp; <strong>Start collab</strong> &nbsp;→&nbsp; <strong>Give link to Claude</strong> &nbsp;→&nbsp; <strong>Shapes appear live</strong>
</p>

<br>

Claude connects to the Excalidraw collaboration server using the native protocol (socket.io + AES-128-GCM encryption). No browser extension. No DevTools. No Excalidraw API key. Just the same protocol your browser uses when you collaborate with someone.

<br>

---

<br>

## Install

### <img src="https://img.shields.io/badge/Claude_Code-E07C4C?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code"> &nbsp; one command

```bash
npx excaliclaude setup
```

That's it. Restart Claude Code and you're ready.

<details>
<summary>Manual setup</summary>

```bash
claude mcp add -s user excaliclaude -- npx -y excaliclaude
```

</details>

<br>

### <img src="https://img.shields.io/badge/Cursor-000?style=for-the-badge&logo=cursor&logoColor=white" alt="Cursor"> &nbsp; <img src="https://img.shields.io/badge/Windsurf-0057FF?style=for-the-badge&logo=codeium&logoColor=white" alt="Windsurf"> &nbsp; <img src="https://img.shields.io/badge/Other-555?style=for-the-badge" alt="Other">

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

<details>
<summary><strong>Run from source</strong></summary>

<br>

```bash
git clone https://github.com/dev-smurf/excaliclaude.git
cd excaliclaude
npm install && npm run build
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
| **`update_elements`** | Move, resize, restyle, or change text of existing elements by ID |
| **`get_scene`** | Read all non-deleted elements with their IDs and positions |
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

Claude: Connected to room abc12345... (2 users in room)
        Drawing 9 elements...

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
bin/excaliclaude.ts         CLI entry point (stdio transport)
       |
src/server.ts               MCP server with 6 tools
       |
src/collab.ts               Socket.io connection + room management + element cache
       |
       |-- src/crypto.ts    AES-128-GCM encrypt/decrypt (WebCrypto API)
       |-- src/elements.ts  Element factory with Excalidraw defaults
       |-- src/url.ts       Parse collab URLs into roomId + roomKey
       |-- src/types.ts     Shared TypeScript interfaces
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
