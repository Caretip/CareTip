import { escapeXml } from "../../utils/xmlEscape.js";
import type { ItRechtXmlResponse } from "./itRechtKanzlei.types.js";
import { IT_RECHT_API_VERSION, IT_RECHT_MODULE_VERSION } from "./itRechtKanzlei.types.js";

function metaBlock(response: ItRechtXmlResponse): string {
  const shop = response.metaShopVersion ?? IT_RECHT_API_VERSION;
  const modul = response.metaModulVersion ?? IT_RECHT_MODULE_VERSION;
  return `<meta_shopversion>${escapeXml(shop)}</meta_shopversion><meta_modulversion>${escapeXml(modul)}</meta_modulversion>`;
}

export function buildItRechtXmlResponse(response: ItRechtXmlResponse): string {
  if (response.status === "success") {
    const accounts =
      response.accounts
        ?.map((account) => {
          const locales =
            account.locales?.map((locale) => `<locale>${escapeXml(locale)}</locale>`).join("") ?? "";
          const localeBlock = locales ? `<locales>${locales}</locales>` : "";
          const countries =
            account.countries?.map((country) => `<country>${escapeXml(country)}</country>`).join("") ??
            "";
          const countryBlock = countries ? `<countries>${countries}</countries>` : "";
          return `<account><accountid>${escapeXml(account.accountId)}</accountid><accountname>${escapeXml(account.accountName)}</accountname>${localeBlock}${countryBlock}</account>`;
        })
        .join("") ?? "";

    const targetUrl = response.targetUrl
      ? `<target_url>${escapeXml(response.targetUrl)}</target_url>`
      : "";

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><status>success</status>${metaBlock(response)}${accounts}${targetUrl}</response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><status>error</status>${metaBlock(response)}<error>${response.error ?? 99}</error><error_message>${escapeXml(response.errorMessage ?? "An error occurred.")}</error_message></response>`;
}

export function buildItRechtAuthErrorXml(): string {
  return buildItRechtXmlResponse({
    status: "error",
    error: 3,
    errorMessage: "Invalid authentication token.",
  });
}
