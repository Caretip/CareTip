import type { Server } from "node:http";

/**
 * Bounds on how long a client may take to SEND a request (not how long CareTip takes to answer).
 * Node's defaults allow 60 s for headers and 300 s for the whole request, which lets a few slow
 * connections ("slowloris") hold sockets open cheaply.
 *
 * - headersTimeout 20 s: headers are tiny; a real client sends them at once.
 * - requestTimeout 120 s: the largest legitimate body is a 10 MB verification upload, which takes
 *   well under two minutes even on a slow mobile uplink (about 0.7 Mbit/s).
 * keepAliveTimeout keeps Node's default (5 s, below the header timeout as Node requires).
 * WebSocket connections are upgraded before these apply and are not affected.
 */
export const HTTP_HEADERS_TIMEOUT_MS = 20_000;
export const HTTP_REQUEST_TIMEOUT_MS = 120_000;

export function applyHttpServerTimeouts(server: Server): void {
  server.headersTimeout = Math.max(HTTP_HEADERS_TIMEOUT_MS, server.keepAliveTimeout + 1_000);
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
}
