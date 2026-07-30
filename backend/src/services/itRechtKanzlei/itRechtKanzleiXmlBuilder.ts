import { escapeXml } from "../../utils/xmlEscape.js";
import type { ItRechtXmlResponse } from "./itRechtKanzlei.types.js";
import { IT_RECHT_API_VERSION, itRechtModuleVersion } from "./itRechtKanzlei.types.js";

function metaBlock(response: ItRechtXmlResponse): string {
  const shop = response.metaShopVersion ?? IT_RECHT_API_VERSION;
  const modul = response.metaModulVersion ?? itRechtModuleVersion();
  return `<meta_shopversion>${escapeXml(shop)}</meta_shopversion><meta_modulversion>${escapeXml(modul)}</meta_modulversion>`;
}

function accountNameElement(accountName: string): string {
  if (!accountName) return "<accountname/>";
  return `<accountname>${escapeXml(accountName)}</accountname>`;
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
          return `<account><accountid>${escapeXml(account.accountId)}</accountid>${accountNameElement(account.accountName)}${localeBlock}${countryBlock}</account>`;
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
