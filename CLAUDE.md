# excaliclaude

MCP server for real-time Excalidraw collaboration via the native collab protocol.

## Architecture

- `src/url.js` -- Parse collab URLs into roomId + roomKey
- `src/crypto.js` -- AES-128-GCM encrypt/decrypt (webcrypto)
- `src/elements.js` -- Element factory with Excalidraw defaults
- `src/collab.js` -- CollabClient: socket.io connection, room management, element cache
- `src/server.js` -- MCP server with 5 tools (connect, draw, get, delete, clear)
- `bin/excaliclaude.js` -- CLI entry point (stdio transport)

## Commands

```bash
npm test          # Run all tests (node:test)
npm start         # Start MCP server (stdio)
```

## Key facts

- Collab server: wss://oss-collab.excalidraw.com
- Encryption: AES-128-GCM, 12-byte IV, JWK key format
- Socket events: join-room, server-broadcast, client-broadcast
- Payload types: SCENE_INIT, SCENE_UPDATE
- Max 100 elements per push (rate limit)
- Room key is NEVER logged or written to disk
