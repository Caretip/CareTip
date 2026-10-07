/**
 * Deterministic Facebook OAuth web layer tests (no Meta credentials).
 * Run: npm run test:facebook-oauth-web
 */
import assert from "node:assert/strict";

const TEST_APP_ID = "1801849467618260";

type ImportMetaEnv = ImportMeta & { env?: Record<string, string | undefined> };
const importMetaEnv = import.meta as ImportMetaEnv;
importMetaEnv.env = { ...importMetaEnv.env, VITE_FACEBOOK_APP_ID: TEST_APP_ID };

const {
  classifySdkLoginFailure,
} = await import("./facebookOAuthClassification");
const {
  noObservablePopupInteraction,
  setNoCallbackNoPopupGraceAfterProbeMsForTesting,
  shouldEarlyTerminateNoCallbackAttempt,
} = await import("./facebookOAuthNoInteraction");
const { facebookLoginErrorToastAction } = await import("./facebookOAuthPresent");
const { getFacebookOAuthDiagnosticId } = await import("./facebookOAuthDiagnostic");
const {
  captureFacebookOAuthClickContext,
  markFacebookSdkReadyForTesting,
  registerFacebookOrphanedTokenHandler,
  requestFacebookAccessToken,
  resetFacebookOAuthWebStateForTesting,
} = await import("./facebookOAuthWeb");

type FbLoginStatus = {
  status: string;
  authResponse?: { accessToken?: string; userID?: string } | null;
};

function installMockFb(handlers: {
  login?: (cb: (r: FbLoginStatus) => void) => void;
  getLoginStatus?: (cb: (r: FbLoginStatus) => void, force?: boolean) => void;
}) {
  const win = globalThis as Window & {
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
  win.addEventListener = () => {};
  win.removeEventListener = () => {};
  Object.defineProperty(win, "location", {
    value: { origin: "https://caretip.test", hostname: "caretip.test" },
    configurable: true,
  });
  Object.defineProperty(win, "isSecureContext", { value: true, configurable: true });
  (globalThis as { window?: Window }).window = win;
  const doc = {
    visibilityState: "visible",
    hasFocus: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    hasStorageAccess: async () => true,
  };
  if (typeof globalThis.document === "undefined") {
    Object.defineProperty(globalThis, "document", {
      value: doc as unknown as Document,
      configurable: true,
    });
  }
  if (typeof globalThis.performance === "undefined") {
    Object.defineProperty(globalThis, "performance", {
      value: { now: () => Date.now() } as Performance,
      configurable: true,
    });
  }
  Object.defineProperty(globalThis, "navigator", {
    value: {
      cookieEnabled: true,
      userActivation: { isActive: true, hasBeenActive: true },
    } as Navigator,
    configurable: true,
  });

  window.FB = {
    init: () => {},
    login: (cb) => handlers.login?.(cb),
    getLoginStatus: (cb, force) => handlers.getLoginStatus?.(cb, force),
  };
  markFacebookSdkReadyForTesting(TEST_APP_ID);
}

async function run(name: string, fn: () => void | Promise<void>) {
  await fn();
  console.log(`ok ${name}`);
}

async function main() {
  await run("classify unknown -> session_bridge_unverified", () => {
    const kind = classifySdkLoginFailure({
      status: "unknown",
      hasAuthResponse: false,
      hasAccessToken: false,
      outcome: "unknown",
    });
    assert.equal(kind, "session_bridge_unverified");
  });

  await run("classify not_authorized -> cancelled", () => {
    const kind = classifySdkLoginFailure({
      status: "not_authorized",
      hasAuthResponse: false,
      hasAccessToken: false,
      outcome: "not_authorized",
    });
    assert.equal(kind, "cancelled");
  });

  await run("presenter maps session_bridge to callback missing auth key", () => {
    const action = facebookLoginErrorToastAction("session_bridge_unverified");
    assert.equal(action.type, "toast_error");
    if (action.type === "toast_error") {
      assert.equal(action.messageKey, "auth.oauth.facebookCallbackMissingAuth");
    }
  });

  await run("connected + token resolves", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: (cb) => {
        cb({
          status: "connected",
          authResponse: { accessToken: "token_ok", userID: "1" },
        });
      },
    });
    const token = await requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_test_1");
    assert.equal(token, "token_ok");
  });

  await run("unknown + failed recovery rejects session_bridge_unverified", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: (cb) => {
        cb({ status: "unknown", authResponse: null });
      },
      getLoginStatus: (cb) => {
        cb({ status: "unknown", authResponse: null });
      },
    });
    await assert.rejects(
      () => requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_test_2"),
      (e: unknown) => {
        assert.ok(e && typeof e === "object" && "kind" in e);
        assert.equal((e as { kind: string }).kind, "session_bridge_unverified");
        return true;
      },
    );
  });

  await run("not_authorized -> cancelled", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: (cb) => {
        cb({ status: "not_authorized", authResponse: null });
      },
      getLoginStatus: (cb) => {
        cb({ status: "not_authorized", authResponse: null });
      },
    });
    await assert.rejects(
      () => requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_cancel"),
      (e: unknown) => {
        assert.equal((e as { kind?: string }).kind, "cancelled");
        return true;
      },
    );
  });

  await run("correlationId preserved through token success", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: (cb) => {
        cb({
          status: "connected",
          authResponse: { accessToken: "token_corr", userID: "2" },
        });
      },
    });
    const correlationId = "fb_web_corr_keep";
    await requestFacebookAccessToken(captureFacebookOAuthClickContext(), correlationId);
    assert.equal(getFacebookOAuthDiagnosticId(), correlationId);
  });

  await run("late token after reject triggers orphan once", async () => {
    resetFacebookOAuthWebStateForTesting();
    let loginCb: ((r: FbLoginStatus) => void) | null = null;
    installMockFb({
      login: (cb) => {
        loginCb = cb;
        cb({ status: "unknown", authResponse: null });
      },
      getLoginStatus: (cb) => {
        cb({ status: "unknown", authResponse: null });
      },
    });
    let orphanToken: string | null = null;
    registerFacebookOrphanedTokenHandler((token) => {
      orphanToken = token;
    });
    await assert.rejects(() =>
      requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_orphan"),
    );
    assert.ok(loginCb);
    loginCb({
      status: "connected",
      authResponse: { accessToken: "late_token", userID: "9" },
    });
    assert.equal(orphanToken, "late_token");
    assert.equal(getFacebookOAuthDiagnosticId(), "fb_web_orphan");
    registerFacebookOrphanedTokenHandler(null);
  });

  await run("concurrent attempt rejected", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: (cb) => {
        setTimeout(() => {
          cb({
            status: "connected",
            authResponse: { accessToken: "slow", userID: "1" },
          });
        }, 50);
      },
    });
    const first = requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_conc_a");
    try {
      await requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_conc_b");
      assert.fail("expected concurrent_login rejection");
    } catch (e: unknown) {
      assert.equal((e as { kind?: string }).kind, "concurrent");
    }
    await first;
  });

  await run("focus shift prevents early no-interaction terminate", () => {
    assert.equal(
      shouldEarlyTerminateNoCallbackAttempt({
        callbackReceived: false,
        deliveryPending: true,
        lifecycle: {
          visibilityChangeCount: 1,
          focusEventCount: 0,
          blurEventCount: 1,
          pagehideCount: 0,
          pageshowCount: 0,
          sawHiddenWhileAttemptActive: false,
          sawVisibleAfterHidden: false,
          sawBlurWhileAttemptActive: true,
          sawFocusAfterBlur: false,
          lastVisibilityState: "visible",
          lastDocumentHasFocus: false,
          sawBlurAfterFbLoginInvoke: true,
          popupLifecycleObserved: "focus_shift_after_invoke",
        },
      }),
      false,
    );
  });

  await run("no callback + no popup observation -> early oauth_interaction_not_observed", async () => {
    resetFacebookOAuthWebStateForTesting();
    setNoCallbackNoPopupGraceAfterProbeMsForTesting(20);
    installMockFb({
      login: () => {
        /* never calls callback */
      },
    });
    const start = Date.now();
    await assert.rejects(
      () => requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_no_interaction"),
      (e: unknown) => {
        assert.equal((e as { kind?: string }).kind, "oauth_interaction_not_observed");
        return true;
      },
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 15_000, `expected early terminate, took ${elapsed}ms`);
    setNoCallbackNoPopupGraceAfterProbeMsForTesting(null);
  });

  await run("callback after probe still succeeds", async () => {
    resetFacebookOAuthWebStateForTesting();
    setNoCallbackNoPopupGraceAfterProbeMsForTesting(3_000);
    installMockFb({
      login: (cb) => {
        setTimeout(() => {
          cb({
            status: "connected",
            authResponse: { accessToken: "late_ok", userID: "3" },
          });
        }, 5_500);
      },
    });
    const token = await requestFacebookAccessToken(
      captureFacebookOAuthClickContext(),
      "fb_web_late_cb",
    );
    assert.equal(token, "late_ok");
    setNoCallbackNoPopupGraceAfterProbeMsForTesting(null);
  });

  await run("FB.login throw -> generic", async () => {
    resetFacebookOAuthWebStateForTesting();
    installMockFb({
      login: () => {
        throw new Error("sdk throw");
      },
    });
    await assert.rejects(
      () => requestFacebookAccessToken(captureFacebookOAuthClickContext(), "fb_web_throw"),
      (e: unknown) => {
        assert.equal((e as { kind?: string }).kind, "generic");
        return true;
      },
    );
  });

  console.log("\nfacebookOAuthWeb.runtime: all passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
