import type { Server } from "node:http";

/**
 * Bounds on how long a client may take to SEND a request (not how long CareTip takes to answer).
 * Node's defaults allow 60 s for headers and 300 s for the whole request, which lets a few slow
 * connections ("slowloris") hold sockets open cheaply.
 *
 * - headersTimeout 20 s: headers are tiny; a real client sends them at once.
 * - requestTimeout 300 s (Node's default, set explicitly): the largest legitimate body is a 10 MB
 *   verification upload, about 160 s on a slow 0.5 Mbit/s mobile uplink. A shorter limit would cut
 *   off real uploads; the header timeout is what stops slow-sending connections.
 * keepAliveTimeout keeps Node's default (5 s, below the header timeout as Node requires).
 * WebSocket connections are upgraded before these apply and are not affected.
 */
export const HTTP_HEADERS_TIMEOUT_MS = 20_000;
export const HTTP_REQUEST_TIMEOUT_MS = 300_000;

export function applyHttpServerTimeouts(server: Server): void {
  server.headersTimeout = Math.max(HTTP_HEADERS_TIMEOUT_MS, server.keepAliveTimeout + 1_000);
  server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
}
