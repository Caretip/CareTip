import * as WebBrowser from "expo-web-browser";
import { resolveAuthWebUrl } from "@/constants/authLinks";

export async function openCareTipWeb(pathOrUrl: string): Promise<void> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : resolveAuthWebUrl(pathOrUrl);
  await WebBrowser.openBrowserAsync(url);
}
