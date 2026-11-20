#!/usr/bin/env node
import { startRelayServer } from "./relay.js";

startRelayServer()
  .then((server) => {
    const address = server.address();
    const location = typeof address === "object" && address
      ? `${address.address}:${address.port}`
      : String(address ?? "unknown");
    console.error(`SolveLang hosted relay listening at ${location}`);
  })
  .catch((error) => {
    console.error("SolveLang hosted relay fatal error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
