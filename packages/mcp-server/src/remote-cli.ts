#!/usr/bin/env node
import { startRemoteSolveLangServer } from "./remote.js";

startRemoteSolveLangServer()
  .then((server) => {
    const address = server.address();
    const location = typeof address === "object" && address
      ? `${address.address}:${address.port}`
      : String(address ?? "unknown");
    console.error(`SolveLang remote MCP server listening at ${location}`);
  })
  .catch((error) => {
    console.error("SolveLang remote MCP fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
