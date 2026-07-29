import DOMPurify from "dompurify";

const LEGAL_HTML_CONFIG = {
  ALLOWED_TAGS: [
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
  ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "id"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
} ;

/** Client-side defense-in-depth sanitization before rendering provider HTML. */
export function sanitizeLegalHtmlClient(html: string): string {
  return String(DOMPurify.sanitize(html, LEGAL_HTML_CONFIG));
}
