import { useEffect } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { isAppleAndroidCallbackUrl } from "@/services/apple/appleAndroidOAuth";

function extractToken(url: string): string | null {
  const parsed = Linking.parse(url);
  const token = parsed.queryParams?.token;
  if (typeof token === "string" && token.trim()) return token.trim();
  if (Array.isArray(token) && typeof token[0] === "string") return token[0].trim();
  return null;
}

function routeAuthDeepLink(url: string, router: ReturnType<typeof useRouter>): boolean {
  const lower = url.toLowerCase();
  const token = extractToken(url);

  if (lower.includes("verify-email") || lower.includes("/verify?")) {
    router.replace(
      token
        ? { pathname: "/(auth)/verify-email", params: { token } }
        : "/(auth)/verify-email",
    );
    return true;
  }

  if (lower.includes("reset-password") || lower.includes("forgot-password/reset")) {
    router.replace(
      token
        ? { pathname: "/(auth)/reset-password", params: { token } }
        : "/(auth)/reset-password",
    );
    return true;
  }

  if (lower.includes("/login") || lower.includes("://login")) {
    const parsed = Linking.parse(url);
    const pendingEmail =
      typeof parsed.queryParams?.pendingEmail === "string"
        ? parsed.queryParams.pendingEmail
        : undefined;
    const emailVerified =
      parsed.queryParams?.emailVerified === "1" ||
      parsed.queryParams?.emailVerified === "true"
        ? "1"
        : undefined;
    router.replace({
      pathname: "/(auth)/login",
      params: {
        ...(pendingEmail ? { pendingEmail } : {}),
        ...(emailVerified ? { emailVerified } : {}),
      },
    });
    return true;
  }

  return false;
}

/** Routes email verification and password-reset universal links into native auth screens. */
export function DeepLinkBridge() {
  const router = useRouter();

  useEffect(() => {
    const handle = (url: string | null) => {
      try {
        if (!url) return;
        if (isAppleAndroidCallbackUrl(url)) return;
        routeAuthDeepLink(url, router);
      } catch {
        // Malformed URLs must not crash the app.
      }
    };

    void Linking.getInitialURL()
      .then(handle)
      .catch(() => undefined);
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, [router]);

  return null;
}
