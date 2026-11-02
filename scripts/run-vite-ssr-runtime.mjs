/**
 * Runs a runtime test script through Vite's SSR module loader so app modules that read
 * `import.meta.env` work outside the browser. Uses an inline config and no env files, so no
 * local or production API URLs or secrets are loaded.
 * Usage: node scripts/run-vite-ssr-runtime.mjs <script.ts> [VITE_KEY=value ...]
 * Extra `VITE_*=value` arguments become `import.meta.env` values for that run only.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [entry, ...envArgs] = process.argv.slice(2);
if (!entry) {
  console.error("usage: node scripts/run-vite-ssr-runtime.mjs <script.ts> [VITE_KEY=value ...]");
  process.exit(2);
}
for (const arg of envArgs) {
  const eq = arg.indexOf("=");
  const key = eq > 0 ? arg.slice(0, eq) : "";
  if (!key.startsWith("VITE_")) {
    console.error(`ignored non-VITE_ argument: ${key || arg}`);
    continue;
  }
  process.env[key] = arg.slice(eq + 1);
}

const server = await createServer({
  configFile: false,
  root,
  envDir: path.join(root, "scripts", ".vite-ssr-runtime-no-env"),
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "@": path.join(root, "src") } },
});

try {
  await server.ssrLoadModule(path.resolve(root, entry));
} finally {
  await server.close();
}
