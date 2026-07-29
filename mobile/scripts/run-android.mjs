/**
 * Cross-platform Android run wrapper.
 * On Windows, pins GRADLE_USER_HOME to C:\gradle to avoid MAX_PATH failures
 * when Cursor's sandbox redirects Gradle cache into a deep temp path.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

if (process.platform === "win32") {
  const ps1 = path.join(__dirname, "run-android-windows.ps1");
  const result = spawnSync(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", ps1, ...process.argv.slice(2)],
    { stdio: "inherit", cwd: mobileRoot },
  );
  process.exit(result.status ?? 1);
}

const env = { ...process.env };
if (process.platform === "win32") {
  const gradleHome = "C:\\gradle";
  if (!existsSync(gradleHome)) mkdirSync(gradleHome, { recursive: true });
  env.GRADLE_USER_HOME = gradleHome;
}

const result = spawnSync("npx", ["expo", "run:android", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: mobileRoot,
  env,
  shell: true,
});
process.exit(result.status ?? 1);
