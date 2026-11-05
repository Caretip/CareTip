// Refuses every non-loopback socket and DNS lookup in this process tree. Logged to a file so the audit can prove it.
const net = require("net"), dns = require("dns"), fs = require("fs");
const LOG = process.env.EGRESS_LOG;
const note = (h) => { if (LOG) try { fs.appendFileSync(LOG, `${new Date().toISOString()} blocked ${h}\n`); } catch {} };
const loop = (h) => !h || h === "localhost" || h === "::1" || /^127\./.test(h) || h === "::ffff:127.0.0.1";
const PROTECTED = new Set([3001, 5173]);
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const o = typeof a[0] === "object" && a[0] !== null ? (Array.isArray(a[0]) ? a[0][0] : a[0]) : { port: a[0], host: a[1] };
  if (o && o.path) return orig.apply(this, a);
  if (PROTECTED.has(Number(o && o.port))) { note("protected-port:" + o.port); const e = new Error("EGRESS_BLOCKED port " + o.port); e.code = "ECONNREFUSED"; process.nextTick(() => this.destroy(e)); return this; }
  if (!loop(o && o.host)) { note(o.host); const e = new Error("EGRESS_BLOCKED " + o.host); e.code = "ECONNREFUSED"; process.nextTick(() => this.destroy(e)); return this; }
  return orig.apply(this, a);
};
const ol = dns.lookup;
dns.lookup = function (h, ...r) { const cb = r[r.length - 1]; if (!loop(h)) { note("dns:" + h); const e = new Error("EGRESS_BLOCKED " + h); e.code = "ENOTFOUND"; return process.nextTick(() => cb(e)); } return ol.call(this, h, ...r); };
