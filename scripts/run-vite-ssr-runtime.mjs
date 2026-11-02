/**
 * Runs a runtime test script through Vite's SSR module loader so app modules that read
 * `import.meta.env` work outside the browser. Uses an inline config and no env files, so no
 * local or production API URLs or secrets are loaded.
 * Usage: node scripts/run-vite-ssr-runtime.mjs <script.ts>
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = process.argv[2];
if (!entry) {
  console.error("usage: node scripts/run-vite-ssr-runtime.mjs <script.ts>");
  process.exit(2);
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
