# excaliclaude

MCP server for real-time Excalidraw collaboration via the native collab protocol.

## Architecture

- `src/types.ts` -- Shared TypeScript interfaces (elements, events, etc.)
- `src/url.ts` -- Parse collab URLs into roomId + roomKey
- `src/crypto.ts` -- AES-128-GCM encrypt/decrypt with key caching
- `src/elements.ts` -- Element factory for all types (rect, text, arrow, frame, image)
- `src/labels.ts` -- Label building, dark bg detection, text dimension estimation
- `src/collab.ts` -- CollabClient: socket.io connection, room management, element cache, undo history, auto-reconnect
- `src/server.ts` -- MCP server with 9 tools
- `src/http.ts` -- HTTP/SSE server factory (StreamableHTTPServerTransport + Bearer auth + socket tracking)
- `bin/excaliclaude.ts` -- CLI entry point: stdio (Claude Code), HTTP serve (Claude.ai), setup

## Tools (9)

connect, draw_elements, update_elements, get_scene, group_elements, delete_elements, undo_last_draw, clear_canvas, status

## Commands

```bash
npm run build     # Compile TypeScript to dist/
npm test          # Run all tests (tsx --test)
npm start         # Start MCP server (stdio)
npx excaliclaude setup               # Auto-configure for Claude Code
npx excaliclaude serve               # HTTP/SSE server for Claude.ai (port 3000)
npx excaliclaude serve --port 8080   # Custom port
npx excaliclaude serve --token <tok> # With Bearer auth (recommended when using a tunnel)
```

## Key facts

- Collab server: wss://oss-collab.excalidraw.com
- Encryption: AES-128-GCM, 12-byte IV, JWK key format (cached after first import)
- Socket events: join-room, server-broadcast, client-broadcast
- Payload types: SCENE_INIT, SCENE_UPDATE
- Max 500 elements per push
- Auto-reconnect: exponential backoff, max 5 attempts
- HTTP serve: stateful per-session transports (shared CollabClient), Bearer token auth, open sockets force-closed on shutdown
- Auth token from EXCALICLAUDE_TOKEN env var or --token CLI flag (CLI takes precedence)
- Room key is NEVER logged or written to disk
- Origin header: `Origin: https://excalidraw.com` (required by collab server)
- Text dimensions are estimated (not measured) -- slight positioning offsets expected
- Element types: rectangle, ellipse, diamond, text, arrow, line, frame, image
