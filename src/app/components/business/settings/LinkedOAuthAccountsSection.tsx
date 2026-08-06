import { useCallback, useEffect, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { Link2, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  listLinkedOAuthAccountsAPI,
  linkOAuthAccountAPI,
  unlinkOAuthAccountAPI,
  type LinkedOAuthAccount,
  type OAuthProviderId,
} from "../../../lib/api";
import { googleOAuthWebClientId } from "../../../lib/googleOAuthWebClientId";
import {
  appleOAuthWebClientId,
  facebookOAuthWebAppId,
  OAUTH_PROVIDER_ORDER,
  providerDisplayName,
} from "../../../lib/oauthProviderIds";
import { requestAppleIdToken, isAppleSdkAvailable } from "../../../lib/appleOAuthWeb";
import { requestFacebookAccessToken } from "../../../lib/facebookOAuthWeb";
import { logClientError } from "../../../lib/clientLog";
import { toUserFriendlyMessage } from "../../../lib/errorMessages";

const TEAL = "#e9781c";

function providerConfigured(provider: OAuthProviderId): boolean {
  switch (provider) {
    case "google":
      return Boolean(googleOAuthWebClientId()?.trim());
    case "apple":
      return Boolean(appleOAuthWebClientId());
    case "facebook":
      return Boolean(facebookOAuthWebAppId());
  }
}

export function LinkedOAuthAccountsSection({ loading }: { loading?: boolean }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<LinkedOAuthAccount[]>([]);
  const [hasPassword, setHasPassword] = useState(true);
  const [fetching, setFetching] = useState(true);
  const [busyProvider, setBusyProvider] = useState<OAuthProviderId | null>(null);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [appleReady, setAppleReady] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setFetching(true);
    try {
      const data = await listLinkedOAuthAccountsAPI();
      setAccounts(data.providers ?? []);
      setHasPassword(Boolean(data.hasPassword));
    } catch (e) {
      logClientError("LinkedOAuthAccountsSection.load", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!appleOAuthWebClientId()) {
      setAppleReady(null);
      return;
    }
    let cancelled = false;
    void isAppleSdkAvailable().then((ok) => {
      if (!cancelled) setAppleReady(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const linkedMap = new Map(accounts.map((a) => [a.provider, a]));

  const visibleProviders = OAUTH_PROVIDER_ORDER.filter(
    (p) => providerConfigured(p) || linkedMap.has(p),
  );

  const finishLink = async (provider: OAuthProviderId, idToken: string) => {
    setBusyProvider(provider);
    try {
      await linkOAuthAccountAPI(provider, idToken);
      toast.success(t("business.accountSettings.toastOAuthLinked", { provider: providerDisplayName(provider) }), {
        style: { background: TEAL, color: "#fff" },
      });
      setLinkingGoogle(false);
      await refresh();
    } catch (e) {
      logClientError("LinkedOAuthAccountsSection.link", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleUnlink = async (provider: OAuthProviderId) => {
    setBusyProvider(provider);
    try {
      await unlinkOAuthAccountAPI(provider);
      toast.success(t("business.accountSettings.toastOAuthUnlinked", { provider: providerDisplayName(provider) }), {
        style: { background: TEAL, color: "#fff" },
      });
      await refresh();
    } catch (e) {
      logClientError("LinkedOAuthAccountsSection.unlink", e);
      toast.error(toUserFriendlyMessage(e));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleLink = async (provider: OAuthProviderId) => {
    if (provider === "google") {
      setLinkingGoogle(true);
      return;
    }
    setBusyProvider(provider);
    try {
      const idToken =
        provider === "apple" ? await requestAppleIdToken() : await requestFacebookAccessToken();
      await finishLink(provider, idToken);
    } catch (e) {
      logClientError("LinkedOAuthAccountsSection.linkStart", e);
      toast.error(toUserFriendlyMessage(e));
      setBusyProvider(null);
    }
  };

  if (visibleProviders.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {!hasPassword ? (
        <p className="text-xs text-muted-foreground">
          {t("business.accountSettings.linkedAccountsPasswordHint")}
        </p>
      ) : null}
      {loading || fetching ? (
        <p className="text-sm text-muted-foreground">{t("business.settings.loading")}</p>
      ) : (
        <ul className="space-y-3">
          {visibleProviders.map((provider) => {
            const linked = linkedMap.get(provider);
            const busy = busyProvider === provider;
            const canLink =
              providerConfigured(provider) &&
              !(provider === "apple" && appleReady === false);

            return (
              <li
                key={provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{providerDisplayName(provider)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {linked
                      ? linked.emailAtLink
                        ? t("business.accountSettings.linkedAs", { email: linked.emailAtLink })
                        : t("business.accountSettings.linkedStatus")
                      : t("business.accountSettings.notLinkedStatus")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {linked ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleUnlink(provider)}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      <Unlink className="h-4 w-4" />
                      {t("business.accountSettings.unlinkProvider")}
                    </button>
                  ) : provider === "google" && linkingGoogle ? (
                    <div className="min-w-[220px]">
                      <GoogleLogin
                        onSuccess={(cred) => {
                          if (cred.credential) void finishLink("google", cred.credential);
                        }}
                        onError={() => {
                          toast.error(t("auth.oauth.googleOriginError", {
                            origin: typeof window !== "undefined" ? window.location.origin : "",
                          }));
                          setLinkingGoogle(false);
                        }}
                        useOneTap={false}
                        theme="outline"
                        size="medium"
                        text="continue_with"
                        shape="rectangular"
                        width={220}
                      />
                      <button
                        type="button"
                        className="mt-1 text-xs text-muted-foreground underline"
                        onClick={() => setLinkingGoogle(false)}
                      >
                        {t("business.accountSettings.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !canLink}
                      title={
                        provider === "apple" && appleReady === false
                          ? t("auth.oauth.appleSdkUnavailable")
                          : !canLink
                            ? t("business.accountSettings.providerNotConfigured")
                            : undefined
                      }
                      onClick={() => void handleLink(provider)}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      <Link2 className="h-4 w-4" />
                      {t("business.accountSettings.linkProvider")}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
