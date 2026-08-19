/**
 * Browser PNG download and print helpers for digital QR images.
 * Independent of the branded template engine and the Physical A5 pipeline.
 */

export function downloadQrDataUrlPng(
  dataUrl: string,
  filename: string,
  opts?: { exportAllowed?: boolean },
): boolean {
  if (!dataUrl) return false;
  if (opts?.exportAllowed === false) return false;
  const base = filename.trim().replace(/[^\w.-]+/g, "_") || "caretip-qr";
  const name = base.toLowerCase().endsWith(".png") ? base : `${base}.png`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

export function printQrDataUrl(
  dataUrl: string,
  heading: string,
  opts?: { exportAllowed?: boolean },
): boolean {
  if (!dataUrl) return false;
  if (opts?.exportAllowed === false) return false;
  if (!/^data:image\//i.test(dataUrl)) return false;

  const w = window.open("", "_blank");
  if (!w) return false;

  const doc = w.document;
  doc.documentElement.lang = "en";

  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.appendChild(meta);

  doc.title = "CareTip QR";

  const style = doc.createElement("style");
  style.textContent = `
    body { font-family: system-ui, sans-serif; text-align: center; padding: 24px; margin: 0; }
    h1 { font-size: 1rem; font-weight: 600; margin: 0 0 16px; color: #111; }
    img { max-width: min(360px, 100%); height: auto; }
    @media print { body { padding: 12px; } }
  `;
  doc.head.appendChild(style);

  const h1 = doc.createElement("h1");
  h1.textContent = heading;
  doc.body.appendChild(h1);

  const img = doc.createElement("img");
  img.src = dataUrl;
  img.alt = "QR code";
  doc.body.appendChild(img);

  w.addEventListener("load", () => {
    window.setTimeout(() => w.print(), 200);
  });

  return true;
}
