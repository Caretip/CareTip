/**
 * Facebook mobile OAuth policy — public App ID only.
 * FACEBOOK_APP_SECRET must never appear in the mobile bundle.
 */

export type FacebookMobileConfig = {
  appId?: string;
  clientToken?: string;
  nativeSdkAvailable: boolean;
};

export function isFacebookMobileReady(config: FacebookMobileConfig): boolean {
  return (
    Boolean(config.appId?.trim()) &&
    Boolean(config.clientToken?.trim()) &&
    config.nativeSdkAvailable
  );
}

export const FACEBOOK_UNAVAILABLE_I18N_KEY = "auth.facebookNotConfigured" as const;

/** Native Facebook login still posts to the existing CareTip OAuth endpoint. */
export const FACEBOOK_OAUTH_PROVIDER = "facebook" as const;
