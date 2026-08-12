/**
 * Single QR template renderer — background shell + dynamic branding layers.
 * Used by preview, PNG export, and PDF export (via qrBranded).
 */

import {
  maxSafeLogoWidth,
  QR_ERROR_CORRECTION_LEVEL,
  QR_QUIET_ZONE_MODULES,
} from "../qrReliability";
import { getQrCanvasEnvironment } from "../qrCanvasEnvironment";
import { getEngineTemplate } from "./registry";
import type {
  QrProceduralShellVariant,
  QrTemplateBrandingPayload,
  QrTemplateDefinition,
  QrTemplateFieldId,
  QrTemplateFieldPosition,
  QrTemplateRenderInput,
  QrTemplateZone,
} from "./types";

const ATTRIBUTION_TEXT = "Powered by CareTip";
const FONT_STACK = "system-ui, -apple-system, sans-serif";
/** Warm near-black for CareTip default (light) shell — readable secondary copy. */
const CARETIP_DEFAULT_INK = "#2A1F14";
const CARETIP_DEFAULT_MUTED = "rgba(42, 31, 20, 0.72)";
const CARETIP_DEFAULT_CTA_LABEL = "#FFFFFF";

function isCareTipDefaultTheme(payload: QrTemplateBrandingPayload): boolean {
  return payload.premium !== true;
}

let qrcodeModulePromise: Promise<typeof import("qrcode")> | null = null;

function loadQrCodeModule() {
  qrcodeModulePromise ??= import("qrcode");
  return qrcodeModulePromise;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return getQrCanvasEnvironment().loadImage(url);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function resolveColor(
  token: QrTemplateFieldPosition["color"],
  payload: QrTemplateBrandingPayload,
): string {
  const caretipDefault = isCareTipDefaultTheme(payload);
  switch (token) {
    case "secondary":
      return payload.secondaryColor;
    case "accent":
      return caretipDefault ? payload.primaryColor : payload.qrAccentColor;
    case "onDark":
      return caretipDefault ? CARETIP_DEFAULT_MUTED : "rgba(245,245,245,0.9)";
    case "onLight":
      return caretipDefault ? CARETIP_DEFAULT_CTA_LABEL : "#1A1A1A";
    case "primary":
    default:
      return caretipDefault ? CARETIP_DEFAULT_INK : payload.primaryColor;
  }
}

function fieldText(
  field: QrTemplateFieldId,
  payload: QrTemplateBrandingPayload,
): string | null {
  switch (field) {
    case "logo":
    case "qr":
      return null;
    case "businessName":
      return payload.businessName;
    case "tagline":
      return payload.tagline;
    case "welcomeMessage":
      return payload.welcomeMessage;
    case "cta":
      return payload.ctaText;
    case "thankYouMessage":
      return payload.thankYouMessage;
    case "address":
      return payload.address;
    case "phone":
      return payload.phone;
    case "email":
      return payload.email;
    case "website":
      return payload.website;
    case "socialInstagram":
      return payload.socialInstagram ? `Instagram: ${payload.socialInstagram}` : null;
    case "socialFacebook":
      return payload.socialFacebook ? `Facebook: ${payload.socialFacebook}` : null;
    case "attribution":
      return ATTRIBUTION_TEXT;
    default:
      return null;
  }
}

function absZone(zone: QrTemplateZone, canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
  const w = zone.w * canvasW;
  const h = zone.h * canvasH;
  let x = zone.x * canvasW;
  let y = zone.y * canvasH;
  if (zone.align === "center") x -= w / 2;
  else if (zone.align === "right") x -= w;
  if (zone.valign === "middle") y -= h / 2;
  else if (zone.valign === "bottom") y -= h;
  return { x, y, w, h };
}

function absPosition(
  pos: QrTemplateFieldPosition,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number } {
  const w = (pos.w ?? 0.8) * canvasW;
  const h = (pos.h ?? 0.05) * canvasH;
  let x = pos.x * canvasW;
  let y = pos.y * canvasH;
  if (pos.align === "center") x -= w / 2;
  else if (pos.align === "right") x -= w;
  if (pos.valign === "middle") y -= h / 2;
  else if (pos.valign === "bottom") y -= h;
  return { x, y, w, h };
}

/** Pixel bounds of the QR matrix — fills `qrZone` minus internal safe padding. */
export function resolveQrZoneMatrixBounds(
  def: QrTemplateDefinition,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; size: number } {
  const zone = def.zones?.qrZone ?? def.positions.qr;
  if (!zone) return { x: 0, y: 0, size: 0 };

  if ("w" in zone && "h" in zone && def.zones?.qrZone) {
    const rect = absZone(def.zones.qrZone, canvasW, canvasH);
    const inset = def.qrSafeZone.padding * Math.min(rect.w, rect.h);
    const innerW = rect.w - inset * 2;
    const innerH = rect.h - inset * 2;
    const size = Math.min(innerW, innerH);
    return {
      x: rect.x + (rect.w - size) / 2,
      y: rect.y + (rect.h - size) / 2,
      size,
    };
  }

  return resolveQrFieldBounds(zone as QrTemplateFieldPosition, canvasW, canvasH);
}

/** @deprecated Use resolveQrZoneMatrixBounds — kept for position-only templates. */
export function resolveQrFieldBounds(
  pos: QrTemplateFieldPosition,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; size: number } {
  const { x, y, w, h } = absPosition(pos, canvasW, canvasH);
  const size = Math.min(w, h);
  return {
    x: x + (w - size) / 2,
    y: y + (h - size) / 2,
    size,
  };
}

function resolveQrPanelRect(
  def: QrTemplateDefinition,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (def.zones?.qrZone) {
    return absZone(def.zones.qrZone, canvasW, canvasH);
  }
  const qrPos = def.positions.qr;
  if (!qrPos) return null;
  const bounds = resolveQrFieldBounds(qrPos, canvasW, canvasH);
  const pad = def.qrSafeZone.padding * canvasW;
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    w: bounds.size + pad * 2,
    h: bounds.size + pad * 2,
  };
}

function drawQrZonePanel(
  ctx: CanvasRenderingContext2D,
  def: QrTemplateDefinition,
  canvasW: number,
  canvasH: number,
): void {
  const zone = resolveQrPanelRect(def, canvasW, canvasH);
  if (!zone) return;
  const radius = Math.round(Math.min(zone.w, zone.h) * 0.03);
  roundRect(ctx, zone.x, zone.y, zone.w, zone.h, radius);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  if (!def.zones?.qrZone) {
    ctx.strokeStyle = "rgba(201, 162, 39, 0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawLuxuryCornerOrnaments(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
  pad = 14,
  corner = 28,
): void {
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(pad + (sx < 0 ? w - pad : pad), pad + (sy < 0 ? h - pad - corner : pad));
    ctx.lineTo(pad + (sx < 0 ? w - pad : pad), pad + (sy < 0 ? h - pad : pad));
    ctx.lineTo(pad + (sx < 0 ? w - pad - corner : pad) + corner * sx, pad + (sy < 0 ? h - pad : pad));
    ctx.stroke();
  }
}

function drawCareTipDefaultShell(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#FFFFFF");
  grad.addColorStop(0.38, "#FFF8F0");
  grad.addColorStop(0.72, "#F8E8D4");
  grad.addColorStop(1, "#F3D5B0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Soft amber wash for warmth
  const wash = ctx.createRadialGradient(w * 0.5, h * 0.12, 8, w * 0.5, h * 0.18, w * 0.72);
  wash.addColorStop(0, "rgba(235, 153, 44, 0.16)");
  wash.addColorStop(1, "rgba(235, 153, 44, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  // Elegant geometric accents
  ctx.strokeStyle = "rgba(235, 153, 44, 0.28)";
  ctx.lineWidth = 1.25;
  roundRect(ctx, 14, 14, w - 28, h - 28, 14);
  ctx.stroke();
  ctx.strokeStyle = "rgba(235, 153, 44, 0.14)";
  ctx.lineWidth = 1;
  roundRect(ctx, 22, 22, w - 44, h - 44, 10);
  ctx.stroke();

  ctx.fillStyle = "rgba(235, 153, 44, 0.07)";
  for (let i = 0; i < 36; i++) {
    ctx.fillRect((i * 47) % w, (i * 29) % h, 3, 1);
  }

  drawLuxuryCornerOrnaments(ctx, w, h, accent, 16, 26);
}

function drawProceduralLuxuryShell(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
  variant: QrProceduralShellVariant,
): void {
  switch (variant) {
    case "velvet-lounge": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#14060c");
      grad.addColorStop(0.45, "#2a1018");
      grad.addColorStop(1, "#0a0408");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(180, 120, 90, 0.06)";
      for (let i = 0; i < 50; i++) {
        ctx.fillRect((i * 41) % w, (i * 23) % h, 2, 2);
      }
      drawLuxuryCornerOrnaments(ctx, w, h, accent);
      break;
    }
    case "grand-atelier": {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#0c0c0c");
      grad.addColorStop(0.5, "#161616");
      grad.addColorStop(1, "#080808");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      const inset = 10;
      roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 6);
      ctx.stroke();
      ctx.lineWidth = 1;
      roundRect(ctx, inset + 6, inset + 6, w - (inset + 6) * 2, h - (inset + 6) * 2, 4);
      ctx.stroke();
      drawLuxuryCornerOrnaments(ctx, w, h, accent, 18, 32);
      break;
    }
    case "royal-suite": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#0a1424");
      grad.addColorStop(0.5, "#122038");
      grad.addColorStop(1, "#060c18");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const platinum = "#c8d0dc";
      ctx.strokeStyle = platinum;
      ctx.lineWidth = 1.25;
      roundRect(ctx, 12, 12, w - 24, h - 24, 8);
      ctx.stroke();
      drawLuxuryCornerOrnaments(ctx, w, h, platinum, 16, 26);
      break;
    }
    case "champagne-salon": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#faf6ef");
      grad.addColorStop(0.55, "#f0e8da");
      grad.addColorStop(1, "#e6dcc8");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      roundRect(ctx, 12, 12, w - 24, h - 24, 10);
      ctx.stroke();
      ctx.fillStyle = "rgba(184, 134, 11, 0.05)";
      for (let i = 0; i < 30; i++) {
        ctx.fillRect((i * 53) % w, (i * 31) % h, 3, 1);
      }
      break;
    }
    case "emerald-sanctuary": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#061410");
      grad.addColorStop(0.48, "#0f2a22");
      grad.addColorStop(1, "#040c0a");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const emerald = "#5ecf9a";
      ctx.strokeStyle = "rgba(94, 207, 154, 0.45)";
      ctx.lineWidth = 1.25;
      roundRect(ctx, 12, 12, w - 24, h - 24, 8);
      ctx.stroke();
      ctx.fillStyle = "rgba(94, 207, 154, 0.05)";
      for (let i = 0; i < 36; i++) {
        ctx.fillRect((i * 47) % w, (i * 29) % h, 2, 2);
      }
      drawLuxuryCornerOrnaments(ctx, w, h, emerald, 16, 28);
      break;
    }
    case "sapphire-pavilion": {
      const grad = ctx.createLinearGradient(0, 0, w * 0.2, h);
      grad.addColorStop(0, "#081428");
      grad.addColorStop(0.5, "#0f2848");
      grad.addColorStop(1, "#050c18");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const sapphire = "#7eb8ff";
      ctx.strokeStyle = "rgba(126, 184, 255, 0.4)";
      ctx.lineWidth = 1.25;
      roundRect(ctx, 12, 12, w - 24, h - 24, 8);
      ctx.stroke();
      drawLuxuryCornerOrnaments(ctx, w, h, sapphire, 16, 26);
      break;
    }
    case "copper-hearth": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#1a100c");
      grad.addColorStop(0.5, "#2a1810");
      grad.addColorStop(1, "#100804");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const copper = "#d4895c";
      ctx.strokeStyle = copper;
      ctx.lineWidth = 1.5;
      const inset = 10;
      roundRect(ctx, inset, inset, w - inset * 2, h - inset * 2, 6);
      ctx.stroke();
      ctx.fillStyle = "rgba(212, 137, 92, 0.06)";
      for (let i = 0; i < 40; i++) {
        ctx.fillRect((i * 43) % w, (i * 27) % h, 2, 2);
      }
      drawLuxuryCornerOrnaments(ctx, w, h, copper, 18, 30);
      break;
    }
    case "rose-gold-salon": {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#fdf6f4");
      grad.addColorStop(0.55, "#f5ebe8");
      grad.addColorStop(1, "#ead8d2");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const roseGold = "#c17f89";
      ctx.strokeStyle = roseGold;
      ctx.lineWidth = 1.5;
      roundRect(ctx, 12, 12, w - 24, h - 24, 10);
      ctx.stroke();
      ctx.fillStyle = "rgba(193, 127, 137, 0.06)";
      for (let i = 0; i < 28; i++) {
        ctx.fillRect((i * 51) % w, (i * 33) % h, 3, 1);
      }
      break;
    }
    case "poc-luxury-shell":
    default:
      drawPocLuxuryShell(ctx, w, h, accent);
      break;
  }
}

function drawPocLuxuryShell(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0A0A0A");
  grad.addColorStop(0.55, "#111111");
  grad.addColorStop(0.72, "#F4F2EE");
  grad.addColorStop(1, "#0A0A0A");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  const corner = 28;
  const pad = 14;
  drawLuxuryCornerOrnaments(ctx, w, h, accent, pad, corner);

  ctx.fillStyle = "rgba(201,162,39,0.08)";
  for (let i = 0; i < 40; i++) {
    const dx = (i * 37) % w;
    const dy = (i * 19) % (h * 0.5);
    ctx.fillRect(dx, dy, 2, 2);
  }

  const waveY = h * 0.7;
  ctx.fillStyle = "#F4F2EE";
  ctx.beginPath();
  ctx.moveTo(0, waveY);
  ctx.bezierCurveTo(w * 0.25, waveY - 30, w * 0.75, waveY + 20, w, waveY - 10);
  ctx.lineTo(w, h * 0.86);
  ctx.lineTo(0, h * 0.86);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#0A0A0A";
  ctx.fillRect(0, h * 0.86, w, h * 0.14);
}

async function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  background: import("./types").QrTemplateDefinition["background"],
  accent: string,
  caretipDefault = false,
): Promise<void> {
  if (caretipDefault) {
    drawCareTipDefaultShell(ctx, w, h, accent);
    return;
  }
  if (background.kind === "procedural") {
    drawProceduralLuxuryShell(ctx, w, h, accent, background.variant);
    return;
  }
  if (background.kind === "image") {
    const img = await loadImage(background.src);
    if (img?.naturalWidth) {
      ctx.drawImage(img, 0, 0, w, h);
      return;
    }
  }
  ctx.fillStyle = "#0A0A0A";
  ctx.fillRect(0, 0, w, h);
}

function drawTextField(
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
): void {
  const { x, y, w } = absPosition(pos, canvasW, canvasH);
  const maxSize = pos.maxFontSize ?? 12;
  const weight = pos.fontWeight ?? "400";
  const color = resolveColor(pos.color, payload);
  // CareTip Basic/default shell stays sentence-case for readable thank-you / body copy.
  const content =
    pos.uppercase && !isCareTipDefaultTheme(payload) ? text.toUpperCase() : text;

  ctx.fillStyle = color;
  ctx.textAlign = pos.align ?? "center";
  ctx.textBaseline = "top";
  ctx.font = `${weight} ${maxSize}px ${FONT_STACK}`;
  const lines = wrapText(ctx, content, w);
  let cy = y;
  const lh = maxSize * (isCareTipDefaultTheme(payload) ? 1.42 : 1.35);
  for (const line of lines) {
    const tx = pos.align === "left" ? x : pos.align === "right" ? x + w : x + w / 2;
    ctx.fillText(line, tx, cy);
    cy += lh;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

async function drawLogoField(
  ctx: CanvasRenderingContext2D,
  logoUrl: string | null,
  pos: QrTemplateFieldPosition,
  canvasW: number,
  canvasH: number,
): Promise<void> {
  // Business logo only — never substitute CareTip branding on the QR card.
  if (!logoUrl) return;
  const img = await loadImage(logoUrl);
  if (!img?.naturalWidth) return;
  const { x, y, w, h } = absPosition(pos, canvasW, canvasH);
  drawLogoImageCrisp(ctx, img, { x, y, w, h }, "center");
}

async function drawQrMatrix(
  ctx: CanvasRenderingContext2D,
  qrUrl: string,
  bounds: { x: number; y: number; size: number },
  payload: QrTemplateBrandingPayload,
  presentation: "framed" | "inset" | "panel" = "framed",
  centerLogoInQr = false,
): Promise<void> {
  const { x, y, size } = bounds;
  const accent = payload.qrAccentColor;

  if (presentation === "framed") {
    const frame = Math.round(size * 0.06);
    roundRect(ctx, x - frame, y - frame, size + frame * 2, size + frame * 2, frame);
    ctx.fillStyle = accent;
    ctx.fill();
    roundRect(ctx, x - 2, y - 2, size + 4, size + 4, 8);
    ctx.fillStyle = payload.qrModuleLight;
    ctx.fill();
  }

  const moduleLight =
    presentation === "inset" || presentation === "panel" ? "#FFFFFF" : payload.qrModuleLight;
  const qrCanvas = getQrCanvasEnvironment().createCanvas(size, size);
  const { toCanvas } = await loadQrCodeModule();
  await toCanvas(qrCanvas, qrUrl, {
    width: size,
    margin: QR_QUIET_ZONE_MODULES,
    color: { dark: payload.secondaryColor, light: moduleLight },
    errorCorrectionLevel: QR_ERROR_CORRECTION_LEVEL,
  });

  const qrRadius = presentation === "panel" ? 4 : presentation === "inset" ? 2 : 6;
  roundRect(ctx, x, y, size, size, qrRadius);
  ctx.save();
  ctx.clip();
  ctx.drawImage(qrCanvas, x, y, size, size);
  ctx.restore();

  if (centerLogoInQr && payload.logoUrl) {
    const logoImg = await loadImage(payload.logoUrl);
    if (logoImg?.naturalWidth) {
      const markW = maxSafeLogoWidth(size, true);
      const markH = (logoImg.naturalHeight / logoImg.naturalWidth) * markW;
      const cx = x + size / 2;
      const cy = y + size / 2;
      ctx.fillStyle = moduleLight;
      ctx.beginPath();
      ctx.arc(cx, cy, markW * 0.58, 0, Math.PI * 2);
      ctx.fill();
      drawLogoImageCrisp(ctx, logoImg, {
        x: cx - markW / 2,
        y: cy - markH / 2,
        w: markW,
        h: markH,
      });
    }
  }
}

async function drawQrField(
  ctx: CanvasRenderingContext2D,
  qrUrl: string,
  pos: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
  presentation: "framed" | "inset" | "panel" = "framed",
): Promise<void> {
  const bounds = resolveQrFieldBounds(pos, canvasW, canvasH);
  await drawQrMatrix(ctx, qrUrl, bounds, payload, presentation, Boolean(payload.logoUrl));
}

function drawTextInRect(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  style: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
): void {
  const maxSize = style.maxFontSize ?? 12;
  const weight = style.fontWeight ?? "400";
  const color = resolveColor(style.color, payload);
  const content = style.uppercase ? text.toUpperCase() : text;
  const align = style.align ?? "center";

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.font = `${weight} ${maxSize}px ${FONT_STACK}`;
  const lines = wrapText(ctx, content, rect.w);
  const lh = maxSize * (isCareTipDefaultTheme(payload) ? 1.42 : 1.35);
  const blockH = lines.length * lh;
  let cy = rect.y + Math.max(0, (rect.h - blockH) / 2);
  for (const line of lines) {
    const tx = align === "left" ? rect.x : align === "right" ? rect.x + rect.w : rect.x + rect.w / 2;
    ctx.fillText(line, tx, cy);
    cy += lh;
  }
}

function drawTextFieldAt(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  style: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
): void {
  const maxSize = style.maxFontSize ?? 12;
  const weight = style.fontWeight ?? "400";
  const color = resolveColor(style.color, payload);
  const content = style.uppercase ? text.toUpperCase() : text;
  const align = style.align ?? "center";

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.font = `${weight} ${maxSize}px ${FONT_STACK}`;
  const lines = wrapText(ctx, content, rect.w);
  const lh = maxSize * (isCareTipDefaultTheme(payload) ? 1.42 : 1.35);
  let cy = rect.y;
  for (const line of lines) {
    const tx = align === "left" ? rect.x : align === "right" ? rect.x + rect.w : rect.x + rect.w / 2;
    ctx.fillText(line, tx, cy);
    cy += lh;
  }
}

/** Neutral mark when a business has not uploaded a logo — never CareTip. */
function drawNeutralBusinessLogoPlaceholder(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  businessName: string,
): void {
  const size = Math.min(rect.w, rect.h);
  const x = rect.x + (rect.w - size) / 2;
  const y = rect.y + (rect.h - size) / 2;
  const radius = Math.max(6, size * 0.18);

  roundRect(ctx, x, y, size, size, radius);
  ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke();

  const initial = (businessName.trim().charAt(0) || "?").toUpperCase();
  ctx.fillStyle = "rgba(100, 116, 139, 0.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(size * 0.42)}px ${FONT_STACK}`;
  ctx.fillText(initial, x + size / 2, y + size / 2 + size * 0.02);
}

function fitImageInBox(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number } {
  if (!imgW || !imgH || !boxW || !boxH) return { w: boxW, h: boxH };
  const ratio = imgH / imgW;
  let lw = boxW;
  let lh = ratio * lw;
  if (lh > boxH) {
    lh = boxH;
    lw = lh / ratio;
  }
  return { w: lw, h: lh };
}

function drawLogoImageCrisp(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: { x: number; y: number; w: number; h: number },
  alignment: "center" | "top" = "center",
): void {
  const { w: lw, h: lh } = fitImageInBox(img.naturalWidth, img.naturalHeight, rect.w, rect.h);
  const dx = Math.round(rect.x + (rect.w - lw) / 2);
  const dy = Math.round(alignment === "top" ? rect.y : rect.y + (rect.h - lh) / 2);
  const dw = Math.round(lw);
  const dh = Math.round(lh);
  const downscaling = dw < img.naturalWidth || dh < img.naturalHeight;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = downscaling;
  if (downscaling && "imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }
  // Draw from full source resolution — never use a compressed intermediate.
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = prevSmooth;
}

async function drawLogoInRect(
  ctx: CanvasRenderingContext2D,
  logoUrl: string | null,
  rect: { x: number; y: number; w: number; h: number },
  businessName?: string,
  alignment: "center" | "top" = "center",
): Promise<void> {
  if (!logoUrl) {
    if (businessName) drawNeutralBusinessLogoPlaceholder(ctx, rect, businessName);
    return;
  }
  const img = await loadImage(logoUrl);
  if (!img?.naturalWidth) {
    if (businessName) drawNeutralBusinessLogoPlaceholder(ctx, rect, businessName);
    return;
  }
  drawLogoImageCrisp(ctx, img, rect, alignment);
}

function resolveLogoSlot(
  rect: { x: number; y: number; w: number; h: number },
  baseLogoH: number,
  gap: number,
  layout: NonNullable<QrTemplateBrandingPayload["logoLayout"]> | undefined,
): { box: { x: number; y: number; w: number; h: number }; advance: number } {
  const sizeMul = layout?.size === "small" ? 0.82 : layout?.size === "large" ? 1.42 : 1.05;
  const padMul = layout?.padding === "tight" ? 0.7 : layout?.padding === "generous" ? 1.45 : 1;
  const logoH = baseLogoH * sizeMul;
  const orientation = layout?.orientation ?? "square";

  let maxW = rect.w * 0.92;
  let maxH = logoH;
  if (orientation === "landscape") {
    maxW = rect.w * 0.96;
    maxH = logoH * 0.68;
  } else if (orientation === "portrait") {
    maxW = rect.w * 0.5;
    maxH = logoH * 1.15;
  } else {
    maxW = rect.w * 0.84;
    maxH = logoH;
  }

  const boxX = rect.x + (rect.w - maxW) / 2;
  const advance = maxH + gap * padMul + gap * 0.4;
  return { box: { x: boxX, y: 0, w: maxW, h: maxH }, advance };
}

function drawCtaInRect(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  style: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
): void {
  const caretipDefault = isCareTipDefaultTheme(payload);
  const pillH = Math.min(
    rect.h,
    Math.max(caretipDefault ? 22 : 18, (style.maxFontSize ?? 10) * (caretipDefault ? 2.45 : 2.2)),
  );
  const pillW = Math.min(rect.w, rect.w * (style.w ?? 1));
  const px = rect.x + (rect.w - pillW) / 2;
  const py = rect.y + (rect.h - pillH) / 2;
  const grad = ctx.createLinearGradient(px, py, px + pillW, py);
  grad.addColorStop(0, payload.qrAccentColor);
  grad.addColorStop(0.5, payload.primaryColor);
  grad.addColorStop(1, payload.qrAccentColor);
  roundRect(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  if (caretipDefault) {
    ctx.strokeStyle = "rgba(42, 31, 20, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  drawTextInRect(
    ctx,
    text,
    { x: px, y: py, w: pillW, h: pillH },
    {
      ...style,
      color: "onLight",
      align: "center",
      maxFontSize: caretipDefault ? Math.max(style.maxFontSize ?? 11, 12) : style.maxFontSize,
      fontWeight: caretipDefault ? "800" : style.fontWeight,
    },
    payload,
  );
}

async function renderBrandingZone(
  ctx: CanvasRenderingContext2D,
  def: QrTemplateDefinition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
): Promise<void> {
  const zone = def.zones!.brandingZone;
  const rect = absZone(zone, canvasW, canvasH);
  const caretipDefault = isCareTipDefaultTheme(payload);
  const gap = Math.round(rect.h * (caretipDefault ? 0.06 : 0.055));
  let cursorY = rect.y + gap;

  const nameText = fieldText("businessName", payload)?.trim() || "";
  const showName = Boolean(
    payload.fieldVisibility.businessName && def.positions.businessName && nameText,
  );
  // Keep business name inside the branding zone so the QR panel cannot cover it.
  const reservedForText = Math.round(
    rect.h * (showName ? (caretipDefault ? 0.48 : 0.38) : 0.12),
  );
  const logoBudgetBottom = rect.y + rect.h - reservedForText;

  const logoStyle = def.positions.logo;
  const hasLogo = Boolean(payload.logoUrl?.trim());
  // Default CareTip card: only spend logo space when a real logo exists.
  const showLogoSlot =
    Boolean(payload.fieldVisibility.logo && logoStyle) &&
    (hasLogo || !caretipDefault);

  if (showLogoSlot && logoStyle) {
    const maxLogoH = Math.max(28, logoBudgetBottom - cursorY - gap);
    const preferredH =
      rect.h * (logoStyle.h ?? 0.58) * (caretipDefault ? 0.72 : 1);
    const baseLogoH = Math.min(preferredH, maxLogoH);
    const { box, advance } = resolveLogoSlot(rect, baseLogoH, gap, payload.logoLayout);
    const drawnAdvance = Math.min(advance, maxLogoH + gap);
    await drawLogoInRect(
      ctx,
      payload.logoUrl,
      { ...box, y: cursorY, h: Math.min(box.h, maxLogoH) },
      hasLogo ? undefined : payload.businessName,
      payload.logoLayout?.alignment ?? "center",
    );
    cursorY += drawnAdvance;
  }

  // Desired brand order: Logo → Company Name → Tagline → Welcome → Address
  // Welcome stays above address so Studio-configured copy is not clipped under the QR.
  const stack: Array<{ field: QrTemplateFieldId; weight: number }> = [
    { field: "businessName", weight: caretipDefault ? 0.46 : 0.36 },
    { field: "tagline", weight: caretipDefault ? 0.2 : 0.18 },
    { field: "welcomeMessage", weight: 0.16 },
    { field: "address", weight: caretipDefault ? 0.16 : 0.18 },
  ];

  const visibleStack = stack.filter((item) => {
    if (!def.supportedFields.includes(item.field)) return false;
    if (!payload.fieldVisibility[item.field]) return false;
    if (!def.positions[item.field]) return false;
    return Boolean(fieldText(item.field, payload)?.trim());
  });

  const zoneBottom = rect.y + rect.h - gap;
  const available = Math.max(24, zoneBottom - cursorY);
  const gapBetween = gap * (caretipDefault ? 0.9 : 0.7);
  const gapsTotal = Math.max(0, visibleStack.length - 1) * gapBetween;
  const textBudget = Math.max(24, available - gapsTotal);
  const weightSum = visibleStack.reduce((sum, item) => sum + item.weight, 0) || 1;

  const minFor = (field: QrTemplateFieldId): number => {
    if (field === "businessName") return caretipDefault ? 28 : 22;
    if (field === "welcomeMessage") return 16;
    if (field === "address") return caretipDefault ? 18 : 16;
    return 12;
  };

  let rawSlots = visibleStack.map((item) => {
    const proportional = textBudget * (item.weight / weightSum);
    return Math.max(proportional, minFor(item.field));
  });
  const rawSum = rawSlots.reduce((a, b) => a + b, 0);
  if (rawSum > textBudget && rawSum > 0) {
    const scale = textBudget / rawSum;
    rawSlots = rawSlots.map((h) => Math.max(10, h * scale));
  }

  for (let i = 0; i < visibleStack.length; i++) {
    const item = visibleStack[i]!;
    const style = def.positions[item.field]!;
    const text = fieldText(item.field, payload)!;
    const remainingForItem = Math.max(10, zoneBottom - cursorY);
    const drawnH = Math.min(rawSlots[i]!, remainingForItem);
    if (drawnH < 10) break;
    const tunedStyle: QrTemplateFieldPosition =
      item.field === "businessName"
        ? {
            ...style,
            maxFontSize: Math.max(style.maxFontSize ?? 19, caretipDefault ? 22 : 19),
            fontWeight: caretipDefault ? "800" : style.fontWeight ?? "700",
            color: caretipDefault ? "primary" : style.color ?? "accent",
          }
        : caretipDefault && (item.field === "tagline" || item.field === "address")
          ? {
              ...style,
              color: "onDark",
              maxFontSize:
                item.field === "address"
                  ? (style.maxFontSize ?? 10) + 2
                  : (style.maxFontSize ?? 11) + 0.5,
            }
          : item.field === "address"
            ? { ...style, maxFontSize: (style.maxFontSize ?? 10) + 1.5 }
            : style;
    drawTextFieldAt(
      ctx,
      text,
      { x: rect.x, y: cursorY, w: rect.w, h: drawnH },
      tunedStyle,
      payload,
    );
    cursorY += drawnH + gapBetween;
  }
}

async function renderCtaZone(
  ctx: CanvasRenderingContext2D,
  def: QrTemplateDefinition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
): Promise<void> {
  if (!payload.fieldVisibility.cta) return;
  const style = def.positions.cta;
  const text = fieldText("cta", payload);
  if (!style || !text?.trim()) return;
  const rect = absZone(def.zones!.ctaZone, canvasW, canvasH);
  drawCtaInRect(ctx, text, rect, style, payload);
}

async function renderFooterZone(
  ctx: CanvasRenderingContext2D,
  def: QrTemplateDefinition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
): Promise<void> {
  const rect = absZone(def.zones!.footerZone, canvasW, canvasH);
  const gap = Math.round(rect.h * 0.06);
  let cursorY = rect.y + gap;

  if (payload.fieldVisibility.thankYouMessage) {
    const style = def.positions.thankYouMessage;
    const text = fieldText("thankYouMessage", payload);
    if (style && text?.trim()) {
      const slotH = rect.h * 0.22;
      drawTextFieldAt(ctx, text, { x: rect.x, y: cursorY, w: rect.w, h: slotH }, style, payload);
      cursorY += slotH + gap;
    }
  }

  const contactFields: QrTemplateFieldId[] = ["phone", "website"];
  const visibleContact = contactFields.filter(
    (f) => def.supportedFields.includes(f) && payload.fieldVisibility[f] && fieldText(f, payload)?.trim(),
  );
  if (visibleContact.length) {
    const rowH = rect.h * 0.2;
    const colW = rect.w / visibleContact.length;
    visibleContact.forEach((field, i) => {
      const style = def.positions[field];
      const text = fieldText(field, payload);
      if (!style || !text?.trim()) return;
      drawTextFieldAt(
        ctx,
        text,
        { x: rect.x + colW * i, y: cursorY, w: colW, h: rowH },
        style,
        payload,
      );
    });
    cursorY += rowH + gap;
  }

  const socialFields: QrTemplateFieldId[] = ["socialInstagram", "socialFacebook"];
  const visibleSocial = socialFields.filter(
    (f) => def.supportedFields.includes(f) && payload.fieldVisibility[f] && fieldText(f, payload)?.trim(),
  );
  if (visibleSocial.length) {
    const rowH = rect.h * 0.12;
    const colW = rect.w / visibleSocial.length;
    visibleSocial.forEach((field, i) => {
      const style = def.positions[field];
      const text = fieldText(field, payload);
      if (!style || !text?.trim()) return;
      drawTextFieldAt(
        ctx,
        text,
        { x: rect.x + colW * i, y: cursorY, w: colW, h: rowH },
        style,
        payload,
      );
    });
    cursorY += rowH;
  }

  if (payload.fieldVisibility.attribution) {
    const style = def.positions.attribution;
    const text = fieldText("attribution", payload);
    if (style && text?.trim()) {
      const slotH = rect.h * 0.14;
      drawTextFieldAt(
        ctx,
        text,
        { x: rect.x, y: rect.y + rect.h - slotH - gap, w: rect.w, h: slotH },
        style,
        payload,
      );
    }
  }
}

async function renderZoneBasedCard(
  ctx: CanvasRenderingContext2D,
  def: QrTemplateDefinition,
  input: QrTemplateRenderInput,
  canvasW: number,
  canvasH: number,
): Promise<void> {
  const qrPresentation = def.qrPresentation ?? "framed";

  await renderBrandingZone(ctx, def, input.payload, canvasW, canvasH);

  if (input.payload.fieldVisibility.qr) {
    drawQrZonePanel(ctx, def, canvasW, canvasH);
    const bounds = resolveQrZoneMatrixBounds(def, canvasW, canvasH);
    await drawQrMatrix(ctx, input.qrUrl, bounds, input.payload, qrPresentation, false);
  }

  await renderCtaZone(ctx, def, input.payload, canvasW, canvasH);
  await renderFooterZone(ctx, def, input.payload, canvasW, canvasH);
}

function drawCtaPill(
  ctx: CanvasRenderingContext2D,
  text: string,
  pos: QrTemplateFieldPosition,
  payload: QrTemplateBrandingPayload,
  canvasW: number,
  canvasH: number,
): void {
  const { x, y, w, h } = absPosition(pos, canvasW, canvasH);
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, payload.qrAccentColor);
  grad.addColorStop(0.5, payload.primaryColor);
  grad.addColorStop(1, payload.qrAccentColor);
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  drawTextField(ctx, text, { ...pos, color: "onLight", valign: "middle" }, payload, canvasW, canvasH);
}

function scaleCanvas(
  source: HTMLCanvasElement,
  scale: number,
  opts?: { smooth?: boolean },
): HTMLCanvasElement {
  if (scale <= 1) return source;
  const scaled = getQrCanvasEnvironment().createCanvas(
    Math.round(source.width * scale),
    Math.round(source.height * scale),
  );
  const ctx = scaled.getContext("2d");
  if (!ctx) return source;
  const smooth = opts?.smooth !== false;
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, scaled.width, scaled.height);
  return scaled;
}

export function engineTemplateLayoutMetrics(
  templateId: string,
  canvasHeight?: number,
): {
  totalWidth: number;
  totalHeight: number;
  qrSize: number;
  qrDrawX: number;
  qrDrawY: number;
  qrMargin: number;
  safeZonePaddingPx: number;
} | null {
  const def = getEngineTemplate(templateId);
  if (!def) return null;
  const qrPos = def.positions.qr;
  if (!qrPos) return null;
  const H = canvasHeight ?? def.canvasHeight;
  const W = def.canvasWidth;
  const bounds = resolveQrZoneMatrixBounds(def, W, H);
  const panel = resolveQrPanelRect(def, W, H);
  return {
    totalWidth: W,
    totalHeight: H,
    qrSize: bounds.size,
    qrDrawX: bounds.x,
    qrDrawY: bounds.y,
    qrMargin: QR_QUIET_ZONE_MODULES,
    safeZonePaddingPx: panel
      ? def.qrSafeZone.padding * Math.min(panel.w, panel.h)
      : 0,
  };
}

export async function renderQrTemplateCard(input: QrTemplateRenderInput): Promise<HTMLCanvasElement | null> {
  const def = getEngineTemplate(input.templateId);
  if (!def) return null;

  const W = def.canvasWidth;
  let H = def.canvasHeight;
  if (def.background.kind === "image") {
    const bgProbe = await loadImage(def.background.src);
    if (bgProbe?.naturalWidth) {
      H = Math.round(W * (bgProbe.naturalHeight / bgProbe.naturalWidth));
    }
  }

  const pixelScale = Math.min(4, Math.max(1, input.scale ?? 1));
  const canvas = getQrCanvasEnvironment().createCanvas(
    Math.round(W * pixelScale),
    Math.round(H * pixelScale),
  );
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (pixelScale > 1) {
    ctx.scale(pixelScale, pixelScale);
  }

  await drawBackground(
    ctx,
    W,
    H,
    def.background,
    input.payload.qrAccentColor,
    isCareTipDefaultTheme(input.payload),
  );

  if (def.zones) {
    await renderZoneBasedCard(ctx, def, input, W, H);
    return canvas;
  }

  const qrPresentation = def.qrPresentation ?? "framed";

  const drawOrder: QrTemplateFieldId[] = [
    "logo",
    "businessName",
    "address",
    "tagline",
    "welcomeMessage",
    "cta",
    "thankYouMessage",
    "phone",
    "email",
    "website",
    "socialInstagram",
    "socialFacebook",
    "attribution",
  ];

  for (const fieldId of drawOrder) {
    if (!def.supportedFields.includes(fieldId)) continue;
    if (!input.payload.fieldVisibility[fieldId]) continue;
    const pos = def.positions[fieldId];
    if (!pos) continue;

    if (fieldId === "logo") {
      await drawLogoField(ctx, input.payload.logoUrl, pos, W, H);
      continue;
    }

    const text = fieldText(fieldId, input.payload);
    if (!text?.trim()) continue;

    if (fieldId === "cta") {
      drawCtaPill(ctx, text, pos, input.payload, W, H);
    } else {
      drawTextField(ctx, text, pos, input.payload, W, H);
    }
  }

  if (input.payload.fieldVisibility.qr && def.positions.qr) {
    drawQrZonePanel(ctx, def, W, H);
    await drawQrField(
      ctx,
      input.qrUrl,
      def.positions.qr,
      input.payload,
      W,
      H,
      qrPresentation,
    );
  }

  return canvas;
}
