import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShoppingBag, Trash2, Minus, Plus, Eye, ChevronDown } from "lucide-react";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import { ApiRequestError } from "@/app/lib/apiError";
import {
  payPhysicalQrBatch,
  fetchBusinessProfile,
  fetchPhysicalQrCatalog,
  fetchPhysicalQrContexts,
  invalidatePhysicalQrContextsClientCache,
  primePhysicalQrOrderClientCache,
  quotePhysicalQrCart,
  resolvePhysicalQrContext,
  type PhysicalQrCatalogProduct,
  type PhysicalQrContextOptions,
  type ConnectStatus,
} from "@/app/lib/api";
import {
  readPrintQrStudioSnapshot,
  writePrintQrStudioSnapshot,
  type PrintQrStudioCartLine,
} from "@/app/lib/printQrStudioSessionCache";
import { upsertPhysicalQrOrderInListSnapshot } from "@/app/lib/physicalQrOrdersSessionCache";
import { PHYSICAL_QR_DEFAULT_COLOR_TOKENS } from "@/app/lib/physicalQrTemplate";
import { logPhysicalQrPerf, physicalQrPerfNow } from "@/app/lib/physicalQrPerf";
import { QR_STUDIO_SAMPLE_URL, useBusinessBrandingOptional } from "../../../contexts/BusinessBrandingContext";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { UpgradeCta } from "@/app/components/subscription/UpgradeCta";
import { PhysicalQrPreview, useSharedPhysicalQrDataUrl } from "./PhysicalQrPreview";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  PHYSICAL_QR_SHIP_COUNTRY,
  physicalQrDeliveryIsComplete,
  PHYSICAL_QR_QUANTITY_MIN,
  PHYSICAL_QR_QUANTITY_MAX,
  clampPhysicalQrQuantity,
  physicalQrTemplateDisplayName,
} from "@/app/lib/physicalQrOrderUi";
import {
  quotePhysicalQrPrints,
  type PhysicalQrQuote,
} from "@/app/lib/physicalQrPricing";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { PrintQrStudioSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/app/components/ui/collapsible";
import {
  parseQrStudioPrintFocus,
  printFocusForGroup,
  printFocusSectionId,
} from "@/app/lib/qrStudioNav";
import {
  fetchConnectStatusCached,
  readConnectStatusSnapshot,
} from "@/app/lib/stripeConnectStatusCache";
import {
  stripeConnectPrintBadgeKey,
  stripeConnectTrafficLight,
} from "@/app/lib/stripeConnectPresentation";

export type PrintCartLine = PrintQrStudioCartLine;

function cartLineKey(type: string, subjectId?: string) {
  return `${type}:${subjectId ?? "storefront"}`;
}

export function PrintQrStudio() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const printFocus = parseQrStudioPrintFocus(searchParams.get("focus"));
  const focusScrolledRef = useRef(false);
  const { user } = useRequireAuth();
  const businessId = user?.businessId?.trim() || "";
  const initialSnapshot = readPrintQrStudioSnapshot(businessId || user?.businessId);
  const branding = useBusinessBrandingOptional();
  const businessName =
    branding?.businessName?.trim() ||
    user?.businessName?.trim() ||
    user?.name?.trim() ||
    "";

  const sharedEntitlements = useBusinessEntitlementsContext();
  const fallbackEntitlements = useSubscriptionEntitlements({
    enabled: sharedEntitlements == null,
    role: "business",
  });
  const entitlements = sharedEntitlements ?? fallbackEntitlements;
  const canOrder = entitlements.hasFeature("physicalQrPrinting");
  const printingIncluded = entitlements.hasFeature("physicalQrPrintingIncluded");
  const canMultiLocation = printingIncluded;

  const [step, setStep] = useState<"select" | "shipping" | "review">("select");
  const [products, setProducts] = useState<PhysicalQrCatalogProduct[]>(() => initialSnapshot?.products ?? []);
  const [productId, setProductId] = useState(initialSnapshot?.productId ?? "");
  const [contexts, setContexts] = useState<PhysicalQrContextOptions | null>(
    () => initialSnapshot?.contexts ?? null,
  );
  const [cart, setCart] = useState<PrintCartLine[]>(() => initialSnapshot?.cart ?? []);
  const [printAddress, setPrintAddress] = useState(initialSnapshot?.printAddress ?? "");
  const [recipientName, setRecipientName] = useState(initialSnapshot?.recipientName ?? "");
  const [streetLine, setStreetLine] = useState(initialSnapshot?.streetLine ?? "");
  const [addressLine2] = useState("");
  const [city, setCity] = useState(initialSnapshot?.city ?? "");
  const [contactEmail, setContactEmail] = useState(initialSnapshot?.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initialSnapshot?.contactPhone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [bootLoading, setBootLoading] = useState(() => !initialSnapshot);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewTargetUrl, setPreviewTargetUrl] = useState(initialSnapshot?.previewTargetUrl ?? "");
  const sharedQrDataUrl = useSharedPhysicalQrDataUrl(previewTargetUrl, businessId);
  const [serverQuote, setServerQuote] = useState<PhysicalQrQuote | null>(null);
  const [previewProductId, setPreviewProductId] = useState<string | null>(null);
  const [designFilter, setDesignFilter] = useState("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(() => readConnectStatusSnapshot());
  const hydratedBusinessIdRef = useRef<string | null>(initialSnapshot?.businessId ?? null);

  const product = products.find((p) => p.id === productId) ?? products[0] ?? null;
  const supportsAddress = Boolean(product?.supportsAddress);
  const previewProduct = products.find((p) => p.id === previewProductId) ?? null;

  const templateLabel = useCallback(
    (item: PhysicalQrCatalogProduct) => {
      const design = physicalQrTemplateDisplayName(t, {
        templateId: item.templateId,
        productName: item.name,
      });
      const layout = item.supportsAddress
        ? t("business.qrStudio.physical.withAddress")
        : t("business.qrStudio.physical.withoutAddress");
      return `${design} · ${layout}`;
    },
    [t],
  );

  const designOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; label: string }[] = [];
    for (const item of products) {
      if (seen.has(item.templateId)) continue;
      seen.add(item.templateId);
      options.push({
        id: item.templateId,
        label: physicalQrTemplateDisplayName(t, {
          templateId: item.templateId,
          productName: item.name,
        }),
      });
    }
    return options;
  }, [products, t]);

  const visibleProducts = useMemo(() => {
    return products.filter((item) => {
      if (designFilter !== "all" && item.templateId !== designFilter) return false;
      return true;
    });
  }, [designFilter, products]);

  useEffect(() => {
    let cancelled = false;
    void fetchConnectStatusCached()
      .then((status) => {
        if (!cancelled) setConnectStatus(status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const snap = readPrintQrStudioSnapshot(businessId);
    const switchedBusiness =
      Boolean(hydratedBusinessIdRef.current) && hydratedBusinessIdRef.current !== businessId;
    if (switchedBusiness) {
      if (snap) {
        setProducts(snap.products);
        setProductId(snap.productId);
        setContexts(snap.contexts);
        setCart(snap.cart);
        setPrintAddress(snap.printAddress);
        setRecipientName(snap.recipientName);
        setStreetLine(snap.streetLine);
        setCity(snap.city);
        setContactEmail(snap.contactEmail);
        setContactPhone(snap.contactPhone);
        setPreviewTargetUrl(snap.previewTargetUrl);
        setBootLoading(false);
        setLoadError(null);
      } else {
        setProducts([]);
        setProductId("");
        setContexts(null);
        setCart([]);
        setPreviewTargetUrl("");
        setBootLoading(true);
        setLoadError(null);
      }
      hydratedBusinessIdRef.current = businessId;
    } else if (snap && hydratedBusinessIdRef.current !== businessId) {
      hydratedBusinessIdRef.current = businessId;
      setProducts(snap.products);
      setProductId((prev) => prev || snap.productId);
      setContexts(snap.contexts);
      setCart(snap.cart);
      setPrintAddress((prev) => prev || snap.printAddress);
      setRecipientName((prev) => prev || snap.recipientName);
      setStreetLine((prev) => prev || snap.streetLine);
      setCity((prev) => prev || snap.city);
      setContactEmail((prev) => prev || snap.contactEmail);
      setContactPhone((prev) => prev || snap.contactPhone);
      setPreviewTargetUrl((prev) => prev || snap.previewTargetUrl);
      setBootLoading(false);
      setLoadError(null);
    } else if (snap) {
      setBootLoading(false);
    }
    void (async () => {
      try {
        const [catalog, ctx] = await Promise.all([
          fetchPhysicalQrCatalog(),
          fetchPhysicalQrContexts({ revalidate: true }),
        ]);
        if (cancelled) return;
        setProducts(catalog.products);
        setProductId((prev) => prev || catalog.products[0]?.id || "");
        setContexts(ctx);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        if (!snap) {
          setLoadError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
        }
      } finally {
        if (!cancelled) setBootLoading(false);
      }
    })();
    void fetchBusinessProfile()
      .then((profile) => {
        const registered = (profile.registeredAddress ?? "").trim();
        setPrintAddress((prev) => prev || registered || (profile.location ?? "").trim());
        setRecipientName((prev) => prev || (profile.legalContactName ?? user?.name ?? "").trim());
        setContactEmail((prev) => prev || (profile.contactEmail ?? user?.email ?? "").trim());
        setContactPhone((prev) => prev || (profile.contactPhone ?? "").trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [businessId, t, user?.email, user?.name]);

  const formatEur = (cents: number) =>
    new Intl.NumberFormat(i18n.language.startsWith("de") ? "de-DE" : "en-GB", {
      style: "currency",
      currency: product?.currency || "EUR",
    }).format(cents / 100);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const primaryLocationId = contexts?.primaryLocationId ?? null;
  const primaryLocationName =
    contexts?.locations.find((l) => l.id === primaryLocationId)?.label ||
    contexts?.storefront.label ||
    "";
  const localQuote = quotePhysicalQrPrints({
    printCount: cartCount,
    printingIncludedEligible: printingIncluded,
    freeOrderAvailable: Boolean(contexts?.freeOrderAvailable) && printingIncluded,
  });
  const quote =
    serverQuote && serverQuote.printCount === cartCount ? serverQuote : localQuote;
  const printSubtotal = quote.totalCents;

  useEffect(() => {
    if (!businessId || bootLoading || products.length === 0 || !contexts) return;
    writePrintQrStudioSnapshot({
      businessId,
      products,
      productId,
      contexts,
      cart,
      printAddress,
      recipientName,
      streetLine,
      city,
      contactEmail,
      contactPhone,
      previewTargetUrl,
    });
  }, [
    bootLoading,
    businessId,
    cart,
    city,
    contactEmail,
    contactPhone,
    contexts,
    previewTargetUrl,
    printAddress,
    productId,
    products,
    recipientName,
    streetLine,
  ]);

  const previewContext = useMemo(() => {
    const first = cart[0];
    if (first) {
      return {
        qrContextType: first.qrContextType,
        qrSubjectId: first.qrSubjectId,
      };
    }
    return { qrContextType: "storefront" as const, qrSubjectId: undefined };
  }, [cart]);

  const previewTargetUrlRef = useRef(previewTargetUrl);
  previewTargetUrlRef.current = previewTargetUrl;

  useEffect(() => {
    let cancelled = false;
    const hadUrl = Boolean(previewTargetUrlRef.current.trim());
    void resolvePhysicalQrContext({
      qrContextType: previewContext.qrContextType,
      qrSubjectId:
        previewContext.qrContextType === "storefront" ? undefined : previewContext.qrSubjectId,
    })
      .then((resolved) => {
        if (cancelled) return;
        setPreviewTargetUrl(
          resolved.qrTargetUrl === QR_STUDIO_SAMPLE_URL ? "" : resolved.qrTargetUrl,
        );
      })
      .catch(() => {
        if (!cancelled && !hadUrl) setPreviewTargetUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [previewContext.qrContextType, previewContext.qrSubjectId]);

  useEffect(() => {
    if (canMultiLocation) return;
    setCart((prev) => {
      const ids = new Set(
        prev.map((line) => line.locationId || primaryLocationId).filter((id): id is string => Boolean(id)),
      );
      if (ids.size <= 1) return prev;
      toast.error(t("business.qrStudio.print.downgradeCartReset"));
      return [];
    });
  }, [canMultiLocation, primaryLocationId, t]);

  useEffect(() => {
    if (!product || cart.length === 0) {
      setServerQuote(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void quotePhysicalQrCart({
        lineItems: cart.map((line) => ({
          productId: product.id,
          qrContextType: line.qrContextType,
          qrSubjectId: line.qrContextType === "storefront" ? undefined : line.qrSubjectId,
          quantity: line.quantity,
        })),
      })
        .then((result) => {
          if (cancelled) return;
          setServerQuote(result.quote);
          setContexts((prev) =>
            prev ? { ...prev, freeOrderAvailable: result.freeOrderAvailable } : prev,
          );
        })
        .catch((err) => {
          if (cancelled) return;
          const code = err instanceof ApiRequestError ? err.code : undefined;
          if (code === "BASIC_SINGLE_LOCATION_REQUIRED" || code === "BASIC_PRIMARY_LOCATION_REQUIRED") {
            toast.error(t("business.qrStudio.print.downgradeCartReset"));
            setCart([]);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cart, product, t]);

  const toggleLine = useCallback((line: Omit<PrintCartLine, "quantity"> & { quantity?: number }) => {
    const key = cartLineKey(line.qrContextType, line.qrSubjectId);
    const lineLocationId = line.locationId || primaryLocationId;
    if (!canMultiLocation && primaryLocationId && lineLocationId && lineLocationId !== primaryLocationId) {
      toast.error(
        t("business.qrStudio.print.locationLocked", {
          name: primaryLocationName || t("business.qrStudio.overview.businessTitle"),
        }),
      );
      return;
    }
    setCart((prev) => {
      const exists = prev.find((p) => cartLineKey(p.qrContextType, p.qrSubjectId) === key);
      if (exists) {
        return prev.filter((p) => cartLineKey(p.qrContextType, p.qrSubjectId) !== key);
      }
      return [...prev, { ...line, quantity: clampPhysicalQrQuantity(line.quantity ?? 1) }];
    });
  }, [canMultiLocation, primaryLocationId, primaryLocationName, t]);

  const setLineQuantity = useCallback((key: string, next: number) => {
    const qty = clampPhysicalQrQuantity(next);
    setCart((prev) =>
      prev.map((line) =>
        cartLineKey(line.qrContextType, line.qrSubjectId) === key ? { ...line, quantity: qty } : line,
      ),
    );
  }, []);

  const isSelected = useCallback(
    (type: string, subjectId?: string) =>
      cart.some((l) => cartLineKey(l.qrContextType, l.qrSubjectId) === cartLineKey(type, subjectId)),
    [cart],
  );

  const selectionGroups = useMemo(() => {
    if (!contexts) return [];
    return [
      {
        title: t("business.qrStudio.print.groupBusiness"),
        items: [
          {
            qrContextType: "storefront" as const,
            qrSubjectId: undefined as string | undefined,
            label: contexts.storefront.label || t("business.qrStudio.overview.businessTitle"),
            locationId: contexts.storefront.locationId ?? primaryLocationId,
            locationName: primaryLocationName || contexts.storefront.label,
          },
        ],
      },
      {
        title: t("business.qrStudio.nav.employees"),
        items: contexts.employees.map((e) => ({
          qrContextType: "employee" as const,
          qrSubjectId: e.id,
          label: e.label,
          locationId: e.locationId ?? primaryLocationId,
          locationName:
            contexts.locations.find((l) => l.id === (e.locationId || primaryLocationId))?.label ||
            primaryLocationName,
        })),
      },
      {
        title: t("business.qrStudio.nav.tables"),
        items: contexts.tables.map((e) => ({
          qrContextType: "table" as const,
          qrSubjectId: e.id,
          label: e.label,
          locationId: e.locationId ?? primaryLocationId,
          locationName:
            contexts.locations.find((l) => l.id === e.locationId)?.label || primaryLocationName,
        })),
      },
      {
        title: t("business.qrStudio.nav.locations"),
        items: contexts.locations.map((e) => ({
          qrContextType: "location" as const,
          qrSubjectId: e.id,
          label: e.label,
          locationId: e.id,
          locationName: e.label,
        })),
      },
    ];
  }, [contexts, primaryLocationId, primaryLocationName, t]);

  const catalogHasItems = selectionGroups.some((group) => group.items.length > 0);

  useEffect(() => {
    if (!printFocus || !contexts || focusScrolledRef.current) return;
    const id = printFocusSectionId(printFocus);
    const el = document.getElementById(id);
    if (!el) return;
    focusScrolledRef.current = true;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [contexts, printFocus]);

  const deliveryForm = {
    recipientName,
    streetLine,
    addressLine2,
    postalCode: "",
    city,
    country: PHYSICAL_QR_SHIP_COUNTRY,
    email: contactEmail,
    phone: contactPhone,
  };
  const missingAddress = supportsAddress && !printAddress.trim();
  const missingDelivery = !physicalQrDeliveryIsComplete(deliveryForm);
  const canCheckout =
    canOrder &&
    Boolean(product?.checkoutReady) &&
    cart.length > 0 &&
    !missingAddress &&
    !missingDelivery &&
    !submitting;

  const placeBatchOrder = useCallback(async () => {
    if (!product || !canCheckout) return;
    setSubmitting(true);
    const tClick = physicalQrPerfNow();
    logPhysicalQrPerf("pay-click", 0);
    try {
      const tApi = physicalQrPerfNow();
      logPhysicalQrPerf("create-and-checkout-started", 0);
      const session = await payPhysicalQrBatch({
        lineItems: cart.map((line) => ({
          productId: product.id,
          qrContextType: line.qrContextType,
          qrSubjectId: line.qrContextType === "storefront" ? undefined : line.qrSubjectId,
          quantity: line.quantity,
        })),
        address: supportsAddress ? printAddress : undefined,
        shipping: {
          recipientName: recipientName.trim(),
          streetLine: streetLine.trim(),
          addressLine2: addressLine2.trim() || undefined,
          postalCode: "",
          city: city.trim(),
          country: PHYSICAL_QR_SHIP_COUNTRY,
        },
        contact: {
          name: recipientName.trim(),
          email: contactEmail.trim(),
          phone: contactPhone.trim(),
        },
        colorTokens: PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
      });
      logPhysicalQrPerf("create-and-checkout-received", physicalQrPerfNow() - tApi, {
        zeroCost: Boolean(session.zeroCost),
      });
      invalidatePhysicalQrContextsClientCache();
      setCart([]);
      primePhysicalQrOrderClientCache(session.order);
      if (businessId) upsertPhysicalQrOrderInListSnapshot(businessId, session.order);
      if (session.zeroCost) {
        logPhysicalQrPerf("redirect-initiated", physicalQrPerfNow() - tClick, { zeroCost: true });
        navigate(`/dashboard/qr-studio/orders/${encodeURIComponent(session.order.id)}?checkout=success`);
        return;
      }
      logPhysicalQrPerf("redirect-initiated", physicalQrPerfNow() - tClick, { zeroCost: false });
      const redirected = performExternalStripeRedirect(session.url, "checkout");
      if (!redirected.ok) throw new Error(t("business.qrStudio.physical.orderError"));
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : undefined;
      if (code === "QUOTA_CHANGED") {
        toast.error(t("business.qrStudio.print.quotaChanged"));
        void fetchPhysicalQrContexts({ revalidate: true })
          .then((ctx) => setContexts(ctx))
          .catch(() => {});
      } else if (code === "BASIC_SINGLE_LOCATION_REQUIRED" || code === "BASIC_PRIMARY_LOCATION_REQUIRED") {
        toast.error(t("business.qrStudio.print.downgradeCartReset"));
        setCart([]);
      } else {
        toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
      }
      setSubmitting(false);
    }
  }, [
    addressLine2,
    businessId,
    canCheckout,
    cart,
    city,
    contactEmail,
    contactPhone,
    navigate,
    printAddress,
    product,
    recipientName,
    streetLine,
    supportsAddress,
    t,
  ]);

  if (!canOrder) {
    return (
      <div className="space-y-3 rounded-lg border border-border px-4 py-3 max-lg:border-0 max-lg:px-0">
        <p className="text-sm font-medium">{t("business.qrStudio.physical.basicLockedTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.physical.basicLockedBody")}</p>
        <UpgradeCta featureKey="physicalQrPrinting" />
      </div>
    );
  }

  if (bootLoading) {
    return (
      <div className="print-qr-studio min-w-0 w-full max-w-full space-y-4 max-lg:space-y-4">
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.print.intro")}</p>
        <PrintQrStudioSkeleton />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="print-qr-studio min-w-0 w-full max-w-full space-y-4 max-lg:space-y-4">
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.print.intro")}</p>
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="print-qr-studio min-w-0 w-full max-w-full space-y-4 max-lg:space-y-4">
      {step === "select" ? (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-snug text-muted-foreground">{t("business.qrStudio.print.intro")}</p>
          {connectStatus ? (
            <p
              className={cn(
                "shrink-0 text-xs font-medium",
                stripeConnectTrafficLight(connectStatus) === "green" && "text-emerald-700 dark:text-emerald-400",
                stripeConnectTrafficLight(connectStatus) === "yellow" && "text-amber-700 dark:text-amber-400",
                stripeConnectTrafficLight(connectStatus) === "red" && "text-red-700 dark:text-red-400",
              )}
              role="status"
            >
              {t(stripeConnectPrintBadgeKey(connectStatus))}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "select" ? (
        <div className="print-qr-studio__workspace">
          <section className="min-w-0 space-y-2">
            <div className="space-y-1.5">
              <h2 className="print-qr-studio__col-title">{t("business.qrStudio.physical.chooseProduct")}</h2>
              <p className="text-xs leading-snug text-muted-foreground">{t("business.qrStudio.physical.chooseProductHint")}</p>
              {designOptions.length > 1 ? (
              <div className="flex flex-wrap gap-1" role="group" aria-label={t("business.qrStudio.print.designFilter")}>
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-medium",
                    designFilter === "all" ? "border-foreground bg-foreground text-background" : "border-border",
                  )}
                  aria-pressed={designFilter === "all"}
                  onClick={() => setDesignFilter("all")}
                >
                  {t("business.qrStudio.print.designFilterAll")}
                </button>
                {designOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={cn(
                      "inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-medium",
                      designFilter === opt.id ? "border-foreground bg-foreground text-background" : "border-border",
                    )}
                    aria-pressed={designFilter === opt.id}
                    onClick={() => setDesignFilter(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              ) : null}
            </div>
            {visibleProducts.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{t("business.qrStudio.physical.noTemplates")}</p>
            ) : (
            <div className="grid min-w-0 grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
              {visibleProducts.map((item) => {
                const selected = productId === item.id;
                return (
                <div
                  key={item.id}
                  className={cn(
                    "print-qr-product-card flex min-w-0 flex-col rounded-md border p-2 text-left",
                    selected ? "is-selected" : "border-border hover:border-foreground/30",
                  )}
                >
                  <div className="flex w-full min-w-0 flex-col items-center text-left">
                    {item.previewAsset ? (
                      <img
                        src={item.previewAsset}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="mx-auto h-auto w-full max-w-[8.5rem] object-contain"
                      />
                    ) : (
                      <PhysicalQrPreview
                        compact
                        className="mx-auto w-full max-w-[8.5rem]"
                        templateId={item.templateId}
                        businessName={businessName}
                        address={item.supportsAddress ? printAddress : null}
                        supportsAddress={item.supportsAddress}
                        colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
                        targetUrl={previewTargetUrl}
                        qrDataUrl={sharedQrDataUrl}
                      />
                    )}
                    <p className="mt-1.5 w-full min-w-0 break-words text-sm font-medium leading-tight">
                      {physicalQrTemplateDisplayName(t, {
                        templateId: item.templateId,
                        productName: item.name,
                      })}
                    </p>
                    <p className="mt-0.5 w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">
                      {item.description?.trim()
                        ? item.description
                        : item.supportsAddress
                          ? t("business.qrStudio.physical.withAddress")
                          : t("business.qrStudio.physical.withoutAddress")}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      className="h-8"
                      aria-pressed={selected}
                      aria-label={templateLabel(item)}
                      onClick={() => setProductId(item.id)}
                    >
                      {selected
                        ? t("business.qrStudio.print.selectedProduct")
                        : t("business.qrStudio.print.selectProduct")}
                    </Button>
                    <button
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => setPreviewProductId(item.id)}
                      aria-label={t("business.qrStudio.physical.previewTemplateAria", { name: templateLabel(item) })}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      {t("business.qrStudio.physical.previewAction")}
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
            )}
          </section>

          <section className="min-w-0 space-y-2">
            <h2 className="print-qr-studio__col-title">{t("business.qrStudio.print.selectQrCodes")}</h2>
            {!catalogHasItems ? (
              <p className="py-3 text-sm text-muted-foreground">
                {t("business.qrStudio.print.emptyLocation")}
              </p>
            ) : (
            selectionGroups.map((group) =>
              group.items.length === 0 ? null : (
                (() => {
                  const groupFocus = printFocusForGroup(group.items[0]!.qrContextType);
                  const isFocused = printFocus === groupFocus;
                  const isLocationGroup = group.items[0]?.qrContextType === "location";
                  const assigned = group.items.filter((item) =>
                    isSelected(item.qrContextType, item.qrSubjectId),
                  ).length;
                  const expanded = openGroups[group.title] ?? true;
                  return (
                <Collapsible
                  key={group.title}
                  open={expanded}
                  onOpenChange={(next) => setOpenGroups((prev) => ({ ...prev, [group.title]: next }))}
                >
                <div
                  id={printFocusSectionId(groupFocus)}
                  className={cn(
                    "scroll-mt-24 rounded-md border border-border/80",
                    isFocused && "border-foreground/40 ring-1 ring-inset ring-foreground/15",
                  )}
                >
                  <CollapsibleTrigger type="button" className="flex min-h-10 w-full items-center justify-between gap-2 px-2.5 py-2 text-left">
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.title}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("business.qrStudio.print.assignedCount", { count: assigned })}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                  {!canMultiLocation && isLocationGroup ? (
                    <p className="px-2.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
                      {t("business.qrStudio.print.locationLocked", {
                        name: primaryLocationName || t("business.qrStudio.overview.businessTitle"),
                      })}
                    </p>
                  ) : null}
                  <ul className="border-t border-border/80">
                    {group.items.map((item) => {
                      const selected = isSelected(item.qrContextType, item.qrSubjectId);
                      const lineId = cartLineKey(item.qrContextType, item.qrSubjectId);
                      return (
                        <li key={lineId} className="border-b border-border/60 last:border-b-0">
                          <label className="flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2.5 px-2.5 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 accent-foreground"
                              checked={selected}
                              onChange={() =>
                                toggleLine({
                                  id: lineId,
                                  qrContextType: item.qrContextType,
                                  qrSubjectId: item.qrSubjectId,
                                  label: item.label,
                                  locationId: item.locationId,
                                  locationName: item.locationName,
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 break-words font-medium">{item.label}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  </CollapsibleContent>
                </div>
                </Collapsible>
                  );
                })()
              ),
            ))}
          </section>

          <aside className="print-qr-studio__summary min-w-0 space-y-2">
            <h2 className="print-qr-studio__col-title">
              {t("business.qrStudio.print.cartTitle", { count: cartCount })}
            </h2>
            <CartSummary
              cart={cart}
              cartCount={cartCount}
              printSubtotal={printSubtotal}
              formatEur={formatEur}
              quote={quote}
              printingIncluded={printingIncluded}
              onContinue={() => setStep("shipping")}
              continueDisabled={cart.length === 0}
              onQuantityChange={setLineQuantity}
              hideTitle
              compact
              t={t}
            />
          </aside>
        </div>
      ) : null}

      {step === "shipping" ? (
        <div className="space-y-4">
            <h2 className="text-sm font-semibold">{t("business.qrStudio.physical.deliveryTitle")}</h2>
            {supportsAddress ? (
              <div className="space-y-2">
                <Label htmlFor="print-address">{t("business.qrStudio.physical.printedAddress")}</Label>
                <Input id="print-address" value={printAddress} onChange={(e) => setPrintAddress(e.target.value)} />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ship-name">{t("business.qrStudio.physical.recipientName")}</Label>
                <Input id="ship-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ship-street">{t("business.qrStudio.physical.streetLine")}</Label>
                <Input id="ship-street" value={streetLine} onChange={(e) => setStreetLine(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ship-city">{t("business.qrStudio.physical.city")}</Label>
                <Input id="ship-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ship-email">{t("business.qrStudio.physical.email")}</Label>
                <Input id="ship-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ship-phone">{t("business.qrStudio.physical.phone")}</Label>
                <Input id="ship-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
              </div>
            </div>
            <div className="print-qr-studio__actions flex flex-col-reverse gap-2 pt-2 sm:flex-row">
              <Button type="button" variant="outline" className="h-auto whitespace-normal sm:w-auto" onClick={() => setStep("select")}>
                {t("business.qrStudio.print.backToSelect")}
              </Button>
              <Button
                type="button"
                className={cn(businessUi.btnPrimary, "h-auto whitespace-normal sm:w-auto")}
                disabled={missingDelivery || missingAddress}
                onClick={() => setStep("review")}
              >
                {t("business.qrStudio.print.continueToReview")}
              </Button>
            </div>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-6">
          <CartSummary
            cart={cart}
            cartCount={cartCount}
            printSubtotal={printSubtotal}
            formatEur={formatEur}
            quote={quote}
            printingIncluded={printingIncluded}
            detailed
            quantityEditable={false}
            onRemove={
              submitting
                ? undefined
                : (key) => setCart((prev) => prev.filter((l) => cartLineKey(l.qrContextType, l.qrSubjectId) !== key))
            }
            t={t}
          />
          <div className="print-qr-studio__actions flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="outline" className="h-auto whitespace-normal sm:w-auto" disabled={submitting} onClick={() => setStep("shipping")}>
              {t("business.qrStudio.print.backToShipping")}
            </Button>
            <Button type="button" className={cn(businessUi.btnPrimary, "h-auto whitespace-normal sm:w-auto")} disabled={!canCheckout} onClick={() => void placeBatchOrder()}>
              {submitting
                ? quote.totalCents === 0
                  ? t("business.qrStudio.print.placingOrder", { defaultValue: "Placing order…" })
                  : t("business.qrStudio.physical.ordering")
                : quote.totalCents === 0
                  ? t("business.qrStudio.print.placeOrder", { defaultValue: "Place order" })
                  : t("business.qrStudio.print.checkout")}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(previewProduct)} onOpenChange={(open) => { if (!open) setPreviewProductId(null); }}>
        <DialogContent className="max-w-[min(100%-1.5rem,28rem)] sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>
              {previewProduct
                ? t(`business.qrStudio.physical.templates.${previewProduct.templateId}`, {
                    defaultValue: previewProduct.name,
                  })
                : t("business.qrStudio.physical.preview")}
            </DialogTitle>
            <DialogDescription>
              {previewProduct?.supportsAddress
                ? t("business.qrStudio.physical.withAddress")
                : t("business.qrStudio.physical.withoutAddress")}
            </DialogDescription>
          </DialogHeader>
          {previewProduct ? (
            <PhysicalQrPreview
              className="mx-auto w-full max-w-[22rem]"
              templateId={previewProduct.templateId}
              businessName={businessName}
              address={previewProduct.supportsAddress ? printAddress : null}
              supportsAddress={previewProduct.supportsAddress}
              colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
              targetUrl={previewTargetUrl}
              qrDataUrl={sharedQrDataUrl}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CartSummary({
  cart,
  cartCount,
  printSubtotal,
  formatEur,
  quote,
  printingIncluded,
  onContinue,
  continueDisabled,
  detailed,
  onRemove,
  onQuantityChange,
  quantityEditable = true,
  hideTitle = false,
  compact = false,
  t,
}: {
  cart: PrintCartLine[];
  cartCount: number;
  printSubtotal: number;
  formatEur: (cents: number) => string;
  quote: ReturnType<typeof quotePhysicalQrPrints>;
  printingIncluded?: boolean;
  onContinue?: () => void;
  continueDisabled?: boolean;
  detailed?: boolean;
  onRemove?: (key: string) => void;
  onQuantityChange?: (key: string, quantity: number) => void;
  quantityEditable?: boolean;
  hideTitle?: boolean;
  compact?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (cart.length === 0) {
    return (
      <div className="space-y-2.5">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border border-dashed border-border text-sm text-muted-foreground max-lg:border-0 max-lg:px-0",
            compact ? "px-3 py-3" : "px-4 py-6",
          )}
        >
          <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
          {t("business.qrStudio.print.cartEmpty")}
        </div>
        {onContinue ? (
          <Button type="button" className={cn(businessUi.btnPrimary, "w-full")} disabled={continueDisabled} onClick={onContinue}>
            {t("business.qrStudio.print.continueToShipping")}
          </Button>
        ) : null}
      </div>
    );
  }

  const grouped = new Map<string, PrintCartLine[]>();
  for (const line of cart) {
    const name = line.locationName?.trim() || t("business.qrStudio.print.locationBusiness");
    const rows = grouped.get(name) ?? [];
    rows.push(line);
    grouped.set(name, rows);
  }

  return (
    <div className={cn("space-y-2.5", !detailed && !compact && "border-t border-border pt-4 max-lg:pt-3")}>
      {hideTitle ? null : (
        <p className="text-sm font-semibold">{t("business.qrStudio.print.cartTitle", { count: cartCount })}</p>
      )}
      <div className="space-y-3">
        {[...grouped.entries()].map(([locationName, lines]) => (
          <div key={locationName}>
            {grouped.size > 1 || detailed ? (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {locationName}
              </p>
            ) : null}
            <ul className="space-y-2 text-sm">
              {lines.map((line) => {
                const key = cartLineKey(line.qrContextType, line.qrSubjectId);
                return (
                  <li key={key} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 break-words text-foreground">{line.label}</span>
                    <span className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                      {quantityEditable && onQuantityChange ? (
                        <QuantityStepper
                          quantity={line.quantity}
                          onDecrement={() => onQuantityChange(key, line.quantity - 1)}
                          onIncrement={() => onQuantityChange(key, line.quantity + 1)}
                          ariaLabel={t("business.qrStudio.print.quantityFor", {
                            label: line.label,
                            defaultValue: "Quantity for {{label}}",
                          })}
                        />
                      ) : (
                        <span
                          className="inline-flex min-w-[2.5rem] items-center justify-center rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-sm font-medium tabular-nums text-foreground"
                          aria-label={t("business.qrStudio.print.quantityFor", {
                            label: line.label,
                            defaultValue: "Quantity for {{label}}",
                          })}
                        >
                          ×{line.quantity}
                        </span>
                      )}
                      {detailed && onRemove ? (
                        <button
                          type="button"
                          className="text-destructive"
                          onClick={() => onRemove(key)}
                          aria-label={t("business.qrStudio.print.removeItem", { defaultValue: "Remove" })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-border/80 pt-3 text-sm">
        {printingIncluded && quote.freeOrderApplied ? (
          <p className="text-xs text-muted-foreground">{t("business.qrStudio.print.quotaApplied")}</p>
        ) : printingIncluded && quote.printCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("business.qrStudio.print.quotaUsed")}
          </p>
        ) : null}
        <div className="flex justify-between gap-3 text-muted-foreground">
          <span className="min-w-0 break-words">
            {quote.freeOrderApplied
              ? t("business.qrStudio.print.freePrints", { count: quote.includedPrints })
              : t("business.qrStudio.print.basePackage", { count: quote.includedPrints })}
          </span>
          <span className="shrink-0 tabular-nums">{quote.packageCents === 0 ? formatEur(0) : formatEur(quote.packageCents)}</span>
        </div>
        {quote.extraPrints > 0 ? (
          <div className="flex justify-between gap-3 text-muted-foreground">
            <span className="min-w-0 break-words">
              {t("business.qrStudio.print.extraPrints", {
                count: quote.extraPrints,
                price: formatEur(quote.extraUnitCents),
              })}
            </span>
            <span className="shrink-0 tabular-nums">{formatEur(quote.extraCents)}</span>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 font-semibold">
          <span className="min-w-0 break-words">{t("business.qrStudio.print.total")}</span>
          <span className="shrink-0 tabular-nums">{formatEur(printSubtotal)}</span>
        </div>
      </div>
      {onContinue ? (
        <Button type="button" className={cn(businessUi.btnPrimary, "w-full")} disabled={continueDisabled} onClick={onContinue}>
          {t("business.qrStudio.print.continueToShipping")}
        </Button>
      ) : null}
    </div>
  );
}

function QuantityStepper({
  quantity,
  onDecrement,
  onIncrement,
  ariaLabel,
}: {
  quantity: number;
  onDecrement: () => void;
  onIncrement: () => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-md border border-border bg-background"
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-40"
        onClick={onDecrement}
        disabled={quantity <= PHYSICAL_QR_QUANTITY_MIN}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="min-w-[2rem] px-1 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-40"
        onClick={onIncrement}
        disabled={quantity >= PHYSICAL_QR_QUANTITY_MAX}
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
