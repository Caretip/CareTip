/**
 * Child for graceful-shutdown-runtime.ts: boots the real API (src/index.ts) on PORT, then raises
 * SIGTERM on itself when the parent writes "TERM" to stdin (Windows cannot deliver SIGTERM from
 * outside, and the handler under test is the same either way).
 * Disposable Postgres only (CARETIP_ISOLATED_POSTGRES_URL).
 */
import { completeIsolatedPostgresBootstrap } from "./lib/isolatedPostgresTestGate.js";

await completeIsolatedPostgresBootstrap();
await import("../src/index.js");

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  if (chunk.includes("TERM")) process.emit("SIGTERM");
});
