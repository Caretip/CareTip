import express, { type RequestHandler } from "express";

const XML_CONTENT_TYPES = new Set(["text/xml", "application/xml"]);
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

const xmlTextParser = express.text({
  type: ["text/xml", "application/xml"],
  limit: "15mb",
});

const formParser = express.urlencoded({
  extended: false,
  limit: "15mb",
});

function normalizedContentType(req: { get(name: string): string | undefined }): string {
  return req.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isLegalWebhookXmlContentType(contentType: string): boolean {
  return XML_CONTENT_TYPES.has(contentType) || contentType === FORM_CONTENT_TYPE;
}

export function extractLegalWebhookXmlBody(req: {
  body: unknown;
  get(name: string): string | undefined;
}): string | null {
  const contentType = normalizedContentType(req);

  if (XML_CONTENT_TYPES.has(contentType) && typeof req.body === "string") {
    return req.body;
  }

  if (contentType === FORM_CONTENT_TYPE && req.body && typeof req.body === "object") {
    const xml = (req.body as Record<string, unknown>).xml;
    if (typeof xml === "string" && xml.trim()) {
      return xml;
    }
  }

  return null;
}

/** Parse IT-Recht XML bodies (text/xml or form field `xml`) before the webhook handler runs. */
export const legalWebhookBodyParser: RequestHandler = (req, res, next) => {
  const contentType = normalizedContentType(req);

  if (XML_CONTENT_TYPES.has(contentType)) {
    xmlTextParser(req, res, next);
    return;
  }

  if (contentType === FORM_CONTENT_TYPE) {
    formParser(req, res, next);
    return;
  }

  next();
};
