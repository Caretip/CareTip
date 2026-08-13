/**
 * Intercept Android/iOS system paths before Expo Router maps them to screens.
 * Apple's Android bounce uses caretip://apple-auth — that is an OAuth callback,
 * not a navigable route.
 */
import { isAppleAndroidCallbackUrl } from "@/services/apple/appleAndroidOAuth";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (typeof path === "string" && isAppleAndroidCallbackUrl(path)) {
      return "/";
    }
    return typeof path === "string" && path.trim() ? path : "/";
  } catch {
    return "/";
  }
}
