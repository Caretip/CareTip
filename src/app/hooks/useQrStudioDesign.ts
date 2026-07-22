import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBusinessBrandingSettings,
  fetchBusinessProfile,
  patchBusinessBrandingSettings,
  patchBusinessProfile,
  uploadMyBusinessLogo,
  type BusinessBrandingSettings,
} from "../lib/api";
import {
  notifyBusinessBrandingChanged,
  qrOptionsFromBrandingFields,
  trackBrandingClientEvent,
  type QrBrandingOptions,
} from "../lib/businessBranding";
import {
  DEFAULT_QR_STUDIO_EXTRAS,
  detectLogoOrientation,
  flushQrStudioDesignExtrasSave,
  loadQrStudioDesignExtras,
  mergeQrStudioBranding,
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

export const QR_STUDIO_SAMPLE_URL = "https://caretip.app/qr-studio-scan-check";

export type QrStudioDesignState = {
  loading: boolean;
  saving: boolean;
  canEdit: boolean;
  businessName: string;
  businessId: string | null;
  settings: BusinessBrandingSettings | null;
  extras: QrStudioDesignExtras;
  previewBranding: QrBrandingOptions;
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
};

export type QrStudioDesignActions = {
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

export function useQrStudioDesign(opts: {
  businessId: string | null | undefined;
  businessName: string;
  canEdit: boolean;
}): QrStudioDesignState & QrStudioDesignActions {
  const { businessId, businessName, canEdit } = opts;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<BusinessBrandingSettings | null>(null);
  const [extras, setExtras] = useState<QrStudioDesignExtras>(DEFAULT_QR_STUDIO_EXTRAS);
  const [logoBust, setLogoBust] = useState(0);
  const [templateProfile, setTemplateProfile] = useState<
    import("../lib/businessBranding").QrBrandingOptions["templateProfile"]
  >(null);

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

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [s, profile] = await Promise.all([fetchBusinessBrandingSettings(), fetchBusinessProfile()]);
      setSettings(s);
      setTemplateProfile({
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
      setExtras(loadQrStudioDesignExtras(businessId));
    } catch (e) {
      logClientError("useQrStudioDesign.refresh", e);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

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
    },
    [businessId],
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
    },
    [businessId],
  );

  const previewBranding = useMemo(() => {
    const base = qrOptionsFromBrandingFields(
      canEdit,
      {
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
      brandDisplayName.trim() || businessName,
    );
    const merged = mergeQrStudioBranding(base, extras);
    const withProfile = {
      ...merged,
      templateProfile: {
        ...templateProfile,
        registeredAddress: registeredAddress.trim() || templateProfile?.registeredAddress || null,
        location: templateProfile?.location ?? null,
        contactPhone: templateProfile?.contactPhone ?? null,
        website: templateProfile?.website ?? null,
      },
    };
    if (withProfile.centerLogoUrl && settings?.logoPath) {
      return {
        ...withProfile,
        centerLogoUrl:
          withMediaCacheBust(resolveMediaUrl(settings.logoPath) ?? settings.logoPath, logoBust) ?? null,
      };
    }
    return withProfile;
  }, [
    canEdit,
    settings?.logoPath,
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
    businessName,
    extras,
    logoBust,
    templateProfile,
    registeredAddress,
  ]);

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
      await patchBusinessProfile({
        registeredAddress: registeredAddress.trim() || null,
      });
      setTemplateProfile((prev) => ({
        ...prev,
        registeredAddress: registeredAddress.trim() || null,
      }));
      setSettings(updated);
      if (businessId) flushQrStudioDesignExtrasSave(businessId, extras);
      notifyBusinessBrandingChanged();
      trackBrandingClientEvent("branding_qr_v2_updated");
      return true;
    } catch (e) {
      logClientError("useQrStudioDesign.save", e);
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
  ]);

  const uploadLogo = useCallback(async (file: File) => {
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
      notifyBusinessBrandingChanged();
      trackBrandingClientEvent("branding_logo_uploaded");
    });
  }, [refresh]);

  return {
    loading,
    saving,
    canEdit,
    businessName,
    businessId: businessId ?? null,
    settings,
    extras,
    previewBranding,
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
    refresh,
    save,
    patchExtras,
    setBrandDisplayName,
    setBrandTagline,
    setRegisteredAddress,
    setWelcomeMessage,
    setThankYouMessage,
    setPrimaryColor,
    setSecondaryColor,
    setQrTemplate,
    setQrBorderStyle,
    setQrShape,
    setQrAccentColor,
    setQrBackgroundColor,
    setLayoutVariant: (v) => patchExtras({ layoutVariant: v }),
    setTemplateFieldVisible,
    uploadLogo,
  };
}
