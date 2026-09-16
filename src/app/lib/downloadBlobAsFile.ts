/**
 * Browser file download helpers.
 *
 * Root cause of stuck "Working on it…" downloads (especially Windows):
 * calling `URL.revokeObjectURL` immediately after `a.click()` can revoke the
 * blob before the browser finishes starting the download.
 */

const DEFAULT_REVOKE_MS = 60_000;

export function downloadBlobAsFile(
  blob: Blob,
  filename: string,
  opts?: { revokeAfterMs?: number },
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  const revokeAfterMs = opts?.revokeAfterMs ?? DEFAULT_REVOKE_MS;
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, revokeAfterMs);
}

/** Open a same-origin or absolute URL in a new tab (preferred for public PDFs). */
export function openUrlInNewTab(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
