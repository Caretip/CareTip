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

function normalizeLegalHeadingText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * IT-Recht / seed HTML often repeats the page title as a leading `<h1>`.
 * The shell already renders the document title — drop a matching leading heading.
 */
export function stripDuplicateLeadingLegalTitle(html: string, title: string): string {
  const normalizedTitle = normalizeLegalHeadingText(title);
  if (!normalizedTitle) return html;

  let result = html.trim();
  const leadingHeading = /^<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(result);
  if (!leadingHeading) return html;

  const headingText = normalizeLegalHeadingText(leadingHeading[1]);
  if (headingText === normalizedTitle) {
    result = result.slice(leadingHeading[0].length).trimStart();
  }
  return result;
}

/** Client-side defense-in-depth sanitization before rendering provider HTML. */
export function sanitizeLegalHtmlClient(html: string, title?: string): string {
  const sanitized = String(DOMPurify.sanitize(html, LEGAL_HTML_CONFIG));
  return title ? stripDuplicateLeadingLegalTitle(sanitized, title) : sanitized;
}
