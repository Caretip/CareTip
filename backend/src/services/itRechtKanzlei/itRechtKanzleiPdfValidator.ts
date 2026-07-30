/** Validate rechtstext_pdf base64 payload decodes to a PDF document (%PDF header). */
export function isValidRechtstextPdfBase64(raw: string): boolean {
  const normalized = raw.replace(/\s/g, "");
  if (!normalized) return false;

  try {
    const buffer = Buffer.from(normalized, "base64");
    if (buffer.length < 5) return false;
    return buffer.subarray(0, 4).toString("ascii") === "%PDF";
  } catch {
    return false;
  }
}

/** Basic URL validation for rechtstext_pdf_url. */
export function isValidRechtstextPdfUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
