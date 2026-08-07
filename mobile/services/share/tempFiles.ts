/**
 * Temporary share files under the app cache directory.
 * Prefix keeps cleanup scoped — never touch unrelated cache entries.
 */

const SHARE_TEMP_PREFIX = "caretip-share-";
const EXPORT_FILE_NAME = "caretip-data-export.json";

export function shareTempFileName(suffix: string): string {
  const safe = suffix.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${SHARE_TEMP_PREFIX}${Date.now()}-${safe}`;
}

export function dataExportFileName(): string {
  return EXPORT_FILE_NAME;
}

export async function resolveCacheDirectory(): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    throw new Error("Cache directory is unavailable on this device.");
  }
  return dir;
}

export async function writeCacheTextFile(fileName: string, contents: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const dir = await resolveCacheDirectory();
  const path = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(path, contents);
  return path;
}

export async function writeCacheBase64File(fileName: string, base64: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  const dir = await resolveCacheDirectory();
  const path = `${dir}${fileName}`;
  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

/** Delete CareTip share temp files (and optionally the reusable export JSON). */
export async function cleanupShareTempFiles(options?: {
  includeExport?: boolean;
}): Promise<void> {
  const FileSystem = await import("expo-file-system/legacy");
  const dir = FileSystem.cacheDirectory;
  if (!dir) return;

  try {
    const entries = await FileSystem.readDirectoryAsync(dir);
    const targets = entries.filter((name) => {
      if (name.startsWith(SHARE_TEMP_PREFIX)) return true;
      if (options?.includeExport && name === EXPORT_FILE_NAME) return true;
      return false;
    });
    await Promise.all(
      targets.map(async (name) => {
        try {
          await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
        } catch {
          // Best-effort cleanup — ignore individual delete failures.
        }
      }),
    );
  } catch {
    // Directory listing can fail on restricted environments — ignore.
  }
}

export async function deleteCacheFile(path: string): Promise<void> {
  const FileSystem = await import("expo-file-system/legacy");
  try {
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Best-effort.
  }
}
