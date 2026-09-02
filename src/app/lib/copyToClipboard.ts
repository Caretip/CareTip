/**
 * Copy text to the clipboard. Returns true only when the write succeeds.
 * Prefer `navigator.clipboard` (secure contexts); fall back to `execCommand`.
 */
export async function writeTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? "");
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Non-secure context / permission — try the legacy path below.
  }
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** Which copy control should show success, given a successful or failed write. */
export function nextCopiedKey(
  current: string | null,
  key: string,
  succeeded: boolean,
): string | null {
  if (succeeded) return key;
  return current === key ? null : current;
}
