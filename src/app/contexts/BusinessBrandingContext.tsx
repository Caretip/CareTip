/**
 * QR Studio single source of truth for branded QR options.
 * Branding page is the only editor; every other Studio surface consumes this snapshot.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchBusinessBrandingSettings,
  fetchBusinessProfile,
  patchBusinessBrandingSettings,
  patchBusinessProfile,
  uploadMyBusinessLogo,
  type BusinessBrandingSettings,
} from "../lib/api";
import {
  pickRegisteredBusinessName,
  trackBrandingClientEvent,
  type QrBrandingOptions,
} from "../lib/businessBranding";
import { buildUnifiedQrBrandingOptions } from "../lib/qrBrandingSnapshot";
import {
  DEFAULT_QR_STUDIO_EXTRAS,
  detectLogoOrientation,
  flushQrStudioDesignExtrasSave,
  loadQrStudioDesignExtras,
  scheduleQrStudioDesignExtrasSave,
  type QrLayoutVariantId,
  type QrStudioDesignExtras,
} from "../lib/qrDesignSystem";
import { withIdleSuppress } from "../lib/idleSuppress";
import {
  DEFAULT_QR_BACKGROUND_COLOR,
  DEFAULT_QR_BORDER_STYLE,
  DEFAULT_QR_SHAPE,
  DEFAULT_QR_TEMPLATE,
  type QrBorderStyleId,
  type QrShapeId,
  type QrTemplateId,
} from "../lib/qrTemplateStyles";
import type { QrTemplateFieldId } from "../lib/qrTemplateEngine/types";
import { resolveMediaUrl, withMediaCacheBust } from "../lib/mediaUrl";
import { logClientError } from "../lib/clientLog";
import { useRequireAuth } from "../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../hooks/useSubscriptionEntitlements";
import { useTranslation } from "react-i18next";

export const QR_STUDIO_SAMPLE_URL = "https://caretip.app/qr-studio-scan-check";

/** Canonical runtime branding object for every QR Studio surface. */
export type BusinessBrandingSnapshot = {
  version: number;
  branding: QrBrandingOptions;
  updatedAt: number;
};

export type BusinessBrandingEditorState = {
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  businessName: string;
  businessId: string | null;
  settings: BusinessBrandingSettings | null;
  extras: QrStudioDesignExtras;
  /** @deprecated Prefer `snapshot.branding` — kept for Branding UI compatibility. */
  previewBranding: QrBrandingOptions;
  snapshot: BusinessBrandingSnapshot;
  sampleUrl: string;
  logoBust: number;
  brandDisplayName: string;
  brandTagline: string;
  registeredAddress: string;
  welcomeMessage: string;
  thankYouMessage: string;
  primaryColor: string;
  secondaryColor: string;
  qrTemplate: QrTemplateId;
  qrBorderStyle: QrBorderStyleId;
  qrShape: QrShapeId;
  qrAccentColor: string;
  qrBackgroundColor: string;
  /** Profile fields needed by gallery (slug, verification) — not branding ownership. */
  profileSlug: string | null;
  profileLogoPath: string | null;
  profileLocation: string | null;
  onboardingVerificationStatus: import("../lib/api").OnboardingVerificationStatus | null;
};

export type BusinessBrandingEditorActions = {
  refresh: () => Promise<void>;
  save: () => Promise<boolean>;
  patchExtras: (patch: Partial<QrStudioDesignExtras>) => void;
  setBrandDisplayName: (v: string) => void;
  setBrandTagline: (v: string) => void;
  setRegisteredAddress: (v: string) => void;
  setWelcomeMessage: (v: string) => void;
  setThankYouMessage: (v: string) => void;
  setPrimaryColor: (v: string) => void;
  setSecondaryColor: (v: string) => void;
  setQrTemplate: (v: QrTemplateId) => void;
  setQrBorderStyle: (v: QrBorderStyleId) => void;
  setQrShape: (v: QrShapeId) => void;
  setQrAccentColor: (v: string) => void;
  setQrBackgroundColor: (v: string) => void;
  setLayoutVariant: (v: QrLayoutVariantId) => void;
  setTemplateFieldVisible: (field: QrTemplateFieldId, visible: boolean) => void;
  uploadLogo: (file: File) => Promise<void>;
};

type BusinessBrandingContextValue = BusinessBrandingEditorState & BusinessBrandingEditorActions;

const BusinessBrandingContext = createContext<BusinessBrandingContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
  /** When FeatureGate allows branding edits. Defaults to premium/enterprise tier. */
  canEdit?: boolean;
};

export function BusinessBrandingProvider({ children, canEdit: canEditProp }: ProviderProps) {
  const { t } = useTranslation();
  const { user } = useRequireAuth();
  const { tier } = useSubscriptionEntitlements({
    enabled: user?.role === "business",
    role: user?.role === "business" ? "business" : null,
  });
  const businessId = user?.businessId ?? null;
  const sessionBusinessName =
    String(user?.businessName ?? "").trim() ||
    String(user?.name ?? "").trim() ||
    t("dashboard.venueDashboardFallback");
  const premium = tier === "premium" || tier === "enterprise";
  const canEdit = canEditProp ?? premium;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<BusinessBrandingSettings | null>(null);
  const [extras, setExtras] = useState<QrStudioDesignExtras>(DEFAULT_QR_STUDIO_EXTRAS);
  const [logoBust, setLogoBust] = useState(0);
  const [version, setVersion] = useState(0);
  const [templateProfile, setTemplateProfile] = useState<
    QrBrandingOptions["templateProfile"]
  >(null);
  const [profileSlug, setProfileSlug] = useState<string | null>(null);
  const [profileLogoPath, setProfileLogoPath] = useState<string | null>(null);
  const [profileLocation, setProfileLocation] = useState<string | null>(null);
  const [onboardingVerificationStatus, setOnboardingVerificationStatus] = useState<
    import("../lib/api").OnboardingVerificationStatus | null
  >(null);
  const [registeredBusinessName, setRegisteredBusinessName] = useState(sessionBusinessName);

  const [brandDisplayName, setBrandDisplayName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [thankYouMessage, setThankYouMessage] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#EB992C");
  const [secondaryColor, setSecondaryColor] = useState("#000000");
  const [qrTemplate, setQrTemplate] = useState<QrTemplateId>(DEFAULT_QR_TEMPLATE);
  const [qrBorderStyle, setQrBorderStyle] = useState<QrBorderStyleId>(DEFAULT_QR_BORDER_STYLE);
  const [qrShape, setQrShape] = useState<QrShapeId>(DEFAULT_QR_SHAPE);
  const [qrAccentColor, setQrAccentColor] = useState("#EB992C");
  const [qrBackgroundColor, setQrBackgroundColor] = useState(DEFAULT_QR_BACKGROUND_COLOR);

  const bumpVersion = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, profile] = await Promise.all([fetchBusinessBrandingSettings(), fetchBusinessProfile()]);
      setSettings(s);
      const registeredName = pickRegisteredBusinessName(profile, sessionBusinessName);
      setRegisteredBusinessName(registeredName || sessionBusinessName);
      setTemplateProfile({
        name: registeredName || null,
        registeredAddress: profile.registeredAddress ?? null,
        location: profile.location ?? null,
        contactPhone: profile.contactPhone ?? null,
        website: profile.website ?? null,
      });
      setRegisteredAddress((profile.registeredAddress ?? profile.location ?? "").trim());
      setBrandDisplayName(s.brandDisplayName ?? "");
      setBrandTagline(s.brandTagline ?? "");
      setWelcomeMessage(s.welcomeMessage ?? "");
      setThankYouMessage(s.thankYouMessage ?? "");
      setPrimaryColor(s.brandPrimaryColor);
      setSecondaryColor(s.brandSecondaryColor);
      setQrTemplate(s.qrTemplate);
      setQrBorderStyle(s.qrBorderStyle);
      setQrShape(s.qrShape);
      setQrAccentColor(s.qrAccentColor);
      setQrBackgroundColor(s.qrBackgroundColor);
      setProfileSlug(profile.slug?.trim() || null);
      setProfileLogoPath(profile.logo?.trim() ? profile.logo : null);
      setProfileLocation(String(profile.registeredAddress ?? profile.location ?? "").trim() || null);
      setOnboardingVerificationStatus(profile.onboardingVerificationStatus ?? null);
      setExtras(() => {
        const loaded = loadQrStudioDesignExtras(businessId);
        if (!loaded.websiteUrl.trim() && profile.website?.trim()) {
          return { ...loaded, websiteUrl: profile.website.trim() };
        }
        return loaded;
      });
      bumpVersion();
    } catch (e) {
      logClientError("BusinessBrandingProvider.refresh", e);
    } finally {
      setLoading(false);
    }
  }, [businessId, sessionBusinessName, bumpVersion]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patchExtras = useCallback(
    (patch: Partial<QrStudioDesignExtras>) => {
      setExtras((prev) => {
        const next = { ...prev, ...patch };
        if (businessId) scheduleQrStudioDesignExtrasSave(businessId, next);
        return next;
      });
      bumpVersion();
    },
    [businessId, bumpVersion],
  );

  const setTemplateFieldVisible = useCallback(
    (field: QrTemplateFieldId, visible: boolean) => {
      setExtras((prev) => {
        const next = {
          ...prev,
          templateFieldVisibility: { ...prev.templateFieldVisibility, [field]: visible },
        };
        if (businessId) scheduleQrStudioDesignExtrasSave(businessId, next);
        return next;
      });
      bumpVersion();
    },
    [businessId, bumpVersion],
  );

  const wrapSetter = useCallback(
    <T,>(setter: (v: T) => void) =>
      (v: T) => {
        setter(v);
        bumpVersion();
      },
    [bumpVersion],
  );

  // Stable wrapped setters — bump snapshot version on every draft edit.
  const setBrandDisplayNameV = useMemo(() => wrapSetter(setBrandDisplayName), [wrapSetter]);
  const setBrandTaglineV = useMemo(() => wrapSetter(setBrandTagline), [wrapSetter]);
  const setRegisteredAddressV = useMemo(() => wrapSetter(setRegisteredAddress), [wrapSetter]);
  const setWelcomeMessageV = useMemo(() => wrapSetter(setWelcomeMessage), [wrapSetter]);
  const setThankYouMessageV = useMemo(() => wrapSetter(setThankYouMessage), [wrapSetter]);
  const setPrimaryColorV = useMemo(() => wrapSetter(setPrimaryColor), [wrapSetter]);
  const setSecondaryColorV = useMemo(() => wrapSetter(setSecondaryColor), [wrapSetter]);
  const setQrTemplateV = useMemo(() => wrapSetter(setQrTemplate), [wrapSetter]);
  const setQrBorderStyleV = useMemo(() => wrapSetter(setQrBorderStyle), [wrapSetter]);
  const setQrShapeV = useMemo(() => wrapSetter(setQrShape), [wrapSetter]);
  const setQrAccentColorV = useMemo(() => wrapSetter(setQrAccentColor), [wrapSetter]);
  const setQrBackgroundColorV = useMemo(() => wrapSetter(setQrBackgroundColor), [wrapSetter]);

  const branding = useMemo((): QrBrandingOptions => {
    const businessName = registeredBusinessName || sessionBusinessName;
    const built = buildUnifiedQrBrandingOptions({
      premium,
      settings: {
        logoPath: settings?.logoPath ?? null,
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        brandDisplayName: brandDisplayName.trim() || null,
        brandTagline: brandTagline.trim() || null,
        welcomeMessage: welcomeMessage.trim() || null,
        thankYouMessage: thankYouMessage.trim() || null,
        qrTemplate,
        qrBorderStyle,
        qrShape,
        qrAccentColor,
        qrBackgroundColor,
      },
      registeredBusinessName: businessName,
      profile: {
        ...templateProfile,
        name: businessName || templateProfile?.name || null,
        registeredAddress: registeredAddress.trim() || templateProfile?.registeredAddress || null,
      },
      extras,
      businessId,
      sessionFallbackName: sessionBusinessName,
    });

    if (built.centerLogoUrl && settings?.logoPath) {
      return {
        ...built,
        centerLogoUrl:
          withMediaCacheBust(resolveMediaUrl(settings.logoPath) ?? settings.logoPath, logoBust) ??
          null,
      };
    }
    return built;
  }, [
    premium,
    settings,
    primaryColor,
    secondaryColor,
    brandDisplayName,
    brandTagline,
    welcomeMessage,
    thankYouMessage,
    qrTemplate,
    qrBorderStyle,
    qrShape,
    qrAccentColor,
    qrBackgroundColor,
    registeredBusinessName,
    sessionBusinessName,
    extras,
    logoBust,
    templateProfile,
    registeredAddress,
    businessId,
  ]);

  const snapshot = useMemo(
    (): BusinessBrandingSnapshot => ({
      version,
      branding,
      updatedAt: Date.now(),
    }),
    [version, branding],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!canEdit) return false;
    setSaving(true);
    try {
      const updated = await patchBusinessBrandingSettings({
        brandDisplayName: brandDisplayName.trim() || null,
        brandTagline: brandTagline.trim() || null,
        welcomeMessage: welcomeMessage.trim() || null,
        thankYouMessage: thankYouMessage.trim() || null,
        brandPrimaryColor: primaryColor,
        brandSecondaryColor: secondaryColor,
        qrTemplate,
        qrBorderStyle,
        qrShape,
        qrAccentColor,
        qrBackgroundColor,
      });
      const websiteToSave =
        extras.websiteUrl.trim() || templateProfile?.website?.trim() || null;
      await patchBusinessProfile({
        registeredAddress: registeredAddress.trim() || null,
        website: websiteToSave,
      });
      const extrasToPersist =
        !extras.websiteUrl.trim() && websiteToSave
          ? { ...extras, websiteUrl: websiteToSave }
          : extras;
      if (extrasToPersist !== extras) setExtras(extrasToPersist);
      setTemplateProfile((prev) => ({
        ...prev,
        registeredAddress: registeredAddress.trim() || null,
        website: websiteToSave,
      }));
      setProfileLocation(registeredAddress.trim() || null);
      if (businessId) flushQrStudioDesignExtrasSave(businessId, extrasToPersist);
      setSettings(updated);
      bumpVersion();
      trackBrandingClientEvent("branding_qr_v2_updated");
      return true;
    } catch (e) {
      logClientError("BusinessBrandingProvider.save", e);
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    canEdit,
    brandDisplayName,
    brandTagline,
    registeredAddress,
    welcomeMessage,
    thankYouMessage,
    primaryColor,
    secondaryColor,
    qrTemplate,
    qrBorderStyle,
    qrShape,
    qrAccentColor,
    qrBackgroundColor,
    businessId,
    extras,
    templateProfile?.website,
    bumpVersion,
  ]);

  const uploadLogo = useCallback(
    async (file: File) => {
      await withIdleSuppress("qr-studio-logo-upload", async () => {
        const orientation = await new Promise<QrStudioDesignExtras["logoOrientation"]>((resolve) => {
          const url = URL.createObjectURL(file);
          const img = new Image();
          img.onload = () => {
            resolve(detectLogoOrientation(img.naturalWidth, img.naturalHeight));
            URL.revokeObjectURL(url);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve("square");
          };
          img.src = url;
        });
        await uploadMyBusinessLogo(file);
        await refresh();
        setLogoBust((n) => n + 1);
        setExtras((prev) => ({ ...prev, logoOrientation: orientation }));
        bumpVersion();
        trackBrandingClientEvent("branding_logo_uploaded");
      });
    },
    [refresh, bumpVersion],
  );

  const value = useMemo(
    (): BusinessBrandingContextValue => ({
      loading,
      saving,
      canEdit,
      businessName: registeredBusinessName || sessionBusinessName,
      businessId,
      settings,
      extras,
      previewBranding: branding,
      snapshot,
      sampleUrl: QR_STUDIO_SAMPLE_URL,
      logoBust,
      brandDisplayName,
      brandTagline,
      registeredAddress,
      welcomeMessage,
      thankYouMessage,
      primaryColor,
      secondaryColor,
      qrTemplate,
      qrBorderStyle,
      qrShape,
      qrAccentColor,
      qrBackgroundColor,
      profileSlug,
      profileLogoPath,
      profileLocation,
      onboardingVerificationStatus,
      refresh,
      save,
      patchExtras,
      setBrandDisplayName: setBrandDisplayNameV,
      setBrandTagline: setBrandTaglineV,
      setRegisteredAddress: setRegisteredAddressV,
      setWelcomeMessage: setWelcomeMessageV,
      setThankYouMessage: setThankYouMessageV,
      setPrimaryColor: setPrimaryColorV,
      setSecondaryColor: setSecondaryColorV,
      setQrTemplate: setQrTemplateV,
      setQrBorderStyle: setQrBorderStyleV,
      setQrShape: setQrShapeV,
      setQrAccentColor: setQrAccentColorV,
      setQrBackgroundColor: setQrBackgroundColorV,
      setLayoutVariant: (v) => patchExtras({ layoutVariant: v }),
      setTemplateFieldVisible,
      uploadLogo,
    }),
    [
      loading,
      saving,
      canEdit,
      registeredBusinessName,
      sessionBusinessName,
      businessId,
      settings,
      extras,
      branding,
      snapshot,
      logoBust,
      brandDisplayName,
      brandTagline,
      registeredAddress,
      welcomeMessage,
      thankYouMessage,
      primaryColor,
      secondaryColor,
      qrTemplate,
      qrBorderStyle,
      qrShape,
      qrAccentColor,
      qrBackgroundColor,
      profileSlug,
      profileLogoPath,
      profileLocation,
      onboardingVerificationStatus,
      refresh,
      save,
      patchExtras,
      setBrandDisplayNameV,
      setBrandTaglineV,
      setRegisteredAddressV,
      setWelcomeMessageV,
      setThankYouMessageV,
      setPrimaryColorV,
      setSecondaryColorV,
      setQrTemplateV,
      setQrBorderStyleV,
      setQrShapeV,
      setQrAccentColorV,
      setQrBackgroundColorV,
      setTemplateFieldVisible,
      uploadLogo,
    ],
  );

  return (
    <BusinessBrandingContext.Provider value={value}>{children}</BusinessBrandingContext.Provider>
  );
}

function useBusinessBrandingContext(): BusinessBrandingContextValue {
  const ctx = useContext(BusinessBrandingContext);
  if (!ctx) {
    throw new Error("useBusinessBrandingSnapshot must be used within BusinessBrandingProvider");
  }
  return ctx;
}

/** Consumer-only: the live normalized branding snapshot. */
export function useBusinessBrandingSnapshot(): BusinessBrandingSnapshot {
  return useBusinessBrandingContext().snapshot;
}

/** Optional consumer when a component may render outside QR Studio. */
export function useBusinessBrandingSnapshotOptional(): BusinessBrandingSnapshot | null {
  return useContext(BusinessBrandingContext)?.snapshot ?? null;
}

/** Full Studio branding context, or null outside the provider. */
export function useBusinessBrandingOptional(): BusinessBrandingContextValue | null {
  return useContext(BusinessBrandingContext);
}

/** Branding page editor API (same surface as former useQrStudioDesign). */
export function useBusinessBrandingEditor(): BusinessBrandingContextValue {
  return useBusinessBrandingContext();
}
