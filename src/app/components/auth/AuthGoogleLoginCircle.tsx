import { GoogleLogin, useGoogleOAuth, type CredentialResponse } from "@react-oauth/google";

type AuthGoogleLoginCircleProps = {
  onSuccess: (cred: CredentialResponse) => void;
  onError: () => void;
};

/**
 * Official GIS icon button inside the 44px OAuth circle.
 * Mounts only after gsi/client loads — avoids renderButton races on undefined containers.
 */
export function AuthGoogleLoginCircle({ onSuccess, onError }: AuthGoogleLoginCircleProps) {
  const { scriptLoadedSuccessfully } = useGoogleOAuth();

  if (!scriptLoadedSuccessfully) {
    return (
      <div
        className="caretip-oauth-gsi-host"
        style={{ width: 44, height: 44 }}
        aria-hidden
      />
    );
  }

  return (
    <GoogleLogin
      onSuccess={onSuccess}
      onError={onError}
      useOneTap={false}
      type="icon"
      shape="circle"
      theme="outline"
      size="large"
      containerProps={{
        className: "caretip-oauth-gsi-host",
        style: { width: 44, height: 44 },
      }}
    />
  );
}
