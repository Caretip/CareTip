import { useEffect, useRef, useState } from "react";
import { GoogleLogin, useGoogleOAuth, type CredentialResponse } from "@react-oauth/google";
type AuthGoogleLoginButtonProps = {
  onSuccess: (cred: CredentialResponse) => void;
  onError: () => void;
};

/** GIS only accepts a pixel width between 200 and 400. */
const GSI_MIN_WIDTH = 200;
const GSI_MAX_WIDTH = 400;
const GSI_BUTTON_HEIGHT = 40;

function clampGsiWidth(px: number): number {
  return Math.round(Math.min(GSI_MAX_WIDTH, Math.max(GSI_MIN_WIDTH, px)));
}

/**
 * Official GIS "Continue with Google" button, sized to the auth form width.
 * Mounts only after gsi/client loads — avoids renderButton races on undefined containers.
 */
export function AuthGoogleLoginButton({ onSuccess, onError }: AuthGoogleLoginButtonProps) {
  const { scriptLoadedSuccessfully } = useGoogleOAuth();
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(GSI_MIN_WIDTH);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const next = clampGsiWidth(el.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="caretip-oauth-google-button">
      {scriptLoadedSuccessfully ? (
        <GoogleLogin
          onSuccess={onSuccess}
          onError={onError}
          useOneTap={false}
          type="standard"
          theme="outline"
          size="large"
          text="continue_with"
          shape="rectangular"
          logo_alignment="center"
          width={width}
          containerProps={{
            className: "caretip-oauth-gsi-host",
            style: { width, minHeight: GSI_BUTTON_HEIGHT },
          }}
        />
      ) : (
        <div
          className="caretip-oauth-google-button__placeholder"
          style={{ width, height: GSI_BUTTON_HEIGHT }}
          aria-hidden
        />
      )}
    </div>
  );
}
