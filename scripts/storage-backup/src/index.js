#!/usr/bin/env node
// @ts-check
import { runBackup } from "./backup.js";
import { createS3Client } from "./clients.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger();

async function main() {
  let config;
  try {
    config = loadConfig(process.env, { dryRunFlag: process.argv.includes("--dry-run") });
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error("config.invalid", { problems: err.problems });
      return 2;
    }
    throw err;
  }

  const controller = new AbortController();
  for (const sig of /** @type {const} */ (["SIGTERM", "SIGINT"])) {
    process.once(sig, () => {
      logger.warn("run.signal", { signal: sig });
      controller.abort();
    });
  }

  const source = createS3Client(config.source, config);
  const destination = createS3Client(config.destination, config);
  try {
    const result = await runBackup({ source, destination, config, logger, signal: controller.signal });
    return result.exitCode;
  } finally {
    source.destroy();
    destination.destroy();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    logger.error("run.crashed", { name: String(err?.name ?? "Error").slice(0, 80) });
    process.exitCode = 1;
  });
