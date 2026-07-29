import sanitizeHtml from "sanitize-html";

const LEGAL_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "ul",
    "ol",
    "li",
    "a",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "blockquote",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
    "div",
    "sup",
    "sub",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    "*": ["class", "id"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
  },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer",
      target: "_blank",
    }),
  },
};

/**
 * Sanitize provider HTML before persistence and before serving to clients.
 */
export function sanitizeLegalHtml(raw: string): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  return sanitizeHtml(trimmed, LEGAL_HTML_OPTIONS).trim();
}

export function isLegalHtmlEmpty(html: string): boolean {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
  return text.length === 0;
}
