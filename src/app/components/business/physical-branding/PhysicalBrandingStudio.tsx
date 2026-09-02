import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Package, Truck } from "lucide-react";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  PHYSICAL_QR_DEFAULT_COLOR_TOKENS,
  classifyPhysicalQrProcessingClient,
} from "@/app/lib/physicalQrTemplate";
import {
  QR_STUDIO_SAMPLE_URL,
  useBusinessBrandingOptional,
} from "../../../contexts/BusinessBrandingContext";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { UpgradeCta } from "@/app/components/subscription/UpgradeCta";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/app/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import {
  fetchBusinessProfile,
  checkoutPhysicalQrOrder,
  createPhysicalQrOrder,
  fetchPhysicalQrCatalog,
  fetchPhysicalQrContexts,
  fetchPhysicalQrOrders,
  resolvePhysicalQrContext,
  type PhysicalQrCatalogProduct,
  type PhysicalQrContextOptions,
  type PhysicalQrCustomerOrder,
} from "@/app/lib/api";
import { PhysicalQrPreview } from "./PhysicalQrPreview";
import { PhysicalQrOrderCard } from "./PhysicalQrOrderCard";
import { cn } from "@/lib/utils";
import {
  PHYSICAL_QR_SHIP_COUNTRY,
  physicalQrDeliveryIsComplete,
  physicalQrTemplateDisplayName,
} from "@/app/lib/physicalQrOrderUi";
import { quotePhysicalQrPrints } from "@/app/lib/physicalQrPricing";

const QTY_MIN = 1;
const QTY_MAX = 50;

function StudioField({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="lg:col-start-1">
      <h3 className="text-sm font-medium tracking-tight">{title}</h3>
      {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function PhysicalBrandingStudio() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const returningOrderId = searchParams.get("physicalOrder") ?? "";
  const checkoutFlag = searchParams.get("checkout");
  const { user } = useRequireAuth();
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
  const canOrder = entitlements.hasFeature("brandingCustomization");
  const printingIncluded = entitlements.hasFeature("physicalQrPrintingIncluded");

  const [products, setProducts] = useState<PhysicalQrCatalogProduct[]>([]);
  const [productId, setProductId] = useState<string>("");
  const [contexts, setContexts] = useState<PhysicalQrContextOptions | null>(null);
  const [qrContextType, setQrContextType] = useState<"storefront" | "employee" | "table" | "location">(
    "storefront",
  );
  const [qrSubjectId, setQrSubjectId] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [printAddress, setPrintAddress] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [recipientName, setRecipientName] = useState("");
  const [streetLine, setStreetLine] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [useRegisteredShipping, setUseRegisteredShipping] = useState(false);
  const [registeredAddressBlob, setRegisteredAddressBlob] = useState("");
  const [locationPrefill, setLocationPrefill] = useState("");
  const [orders, setOrders] = useState<PhysicalQrCustomerOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payingOrderId, setPayingOrderId] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(
    checkoutFlag === "success" && returningOrderId ? returningOrderId : null,
  );

  const product = products.find((p) => p.id === productId) ?? products[0] ?? null;
  const supportsAddress = Boolean(product?.supportsAddress);

  useEffect(() => {
    const fromContext = branding?.registeredAddress?.trim() ?? "";
    if (fromContext) {
      setPrintAddress(fromContext);
      setRegisteredAddressBlob(fromContext);
    }
    let cancelled = false;
    void fetchBusinessProfile()
      .then((profile) => {
        if (cancelled) return;
        const registered = (profile.registeredAddress ?? fromContext).trim();
        const location = (profile.location ?? "").trim();
        setRegisteredAddressBlob(registered);
        setLocationPrefill(location);
        setPrintAddress((prev) => prev || registered || location);
        setRecipientName((prev) => prev || (profile.legalContactName ?? user?.name ?? "").trim());
        setContactEmail((prev) => prev || (profile.contactEmail ?? user?.email ?? "").trim());
        setContactPhone((prev) => prev || (profile.contactPhone ?? "").trim());
      })
      .catch(() => {
        if (cancelled) return;
        setRecipientName((prev) => prev || (user?.name ?? "").trim());
        setContactEmail((prev) => prev || (user?.email ?? "").trim());
      });
    return () => {
      cancelled = true;
    };
  }, [branding?.registeredAddress, user?.email, user?.name]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [catalog, ctx, history] = await Promise.all([
          fetchPhysicalQrCatalog(),
          fetchPhysicalQrContexts(),
          fetchPhysicalQrOrders().catch(() => ({ orders: [] as PhysicalQrCustomerOrder[] })),
        ]);
        if (cancelled) return;
        setProducts(catalog.products);
        setProductId((prev) => prev || catalog.products[0]?.id || "");
        setContexts(ctx);
        setOrders(history.orders);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (checkoutFlag !== "success" || !returningOrderId) return;
    setConfirmingOrderId(returningOrderId);
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const history = await fetchPhysicalQrOrders();
        if (cancelled) return;
        setOrders(history.orders);
        const current = history.orders.find((o) => o.id === returningOrderId);
        if (current?.paymentStatus === "PAID" || current?.paymentStatus === "FAILED" || attempts >= 15) {
          setConfirmingOrderId(null);
          return;
        }
      } catch {
        /* keep polling */
      }
      window.setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      cancelled = true;
    };
  }, [checkoutFlag, returningOrderId]);

  const resolveUrl = useCallback(async () => {
    try {
      const resolved = await resolvePhysicalQrContext({
        qrContextType,
        qrSubjectId: qrContextType === "storefront" ? undefined : qrSubjectId || undefined,
      });
      if (resolved.qrTargetUrl === QR_STUDIO_SAMPLE_URL) {
        setTargetUrl("");
        return;
      }
      setTargetUrl(resolved.qrTargetUrl);
    } catch {
      setTargetUrl("");
    }
  }, [qrContextType, qrSubjectId]);

  useEffect(() => {
    if (qrContextType !== "storefront" && !qrSubjectId) {
      setTargetUrl("");
      return;
    }
    void resolveUrl();
  }, [qrContextType, qrSubjectId, resolveUrl]);

  const processingNow = classifyPhysicalQrProcessingClient(new Date());
  const formatEur = (cents: number) =>
    new Intl.NumberFormat(i18n.language.startsWith("de") ? "de-DE" : "en-GB", {
      style: "currency",
      currency: product?.currency || "EUR",
    }).format(cents / 100);
  const quote = quotePhysicalQrPrints({
    printCount: quantity,
    printingIncludedEligible: printingIncluded,
    freeOrderAvailable: Boolean(contexts?.freeOrderAvailable) && printingIncluded,
  });
  const missingQr = !targetUrl || (qrContextType !== "storefront" && !qrSubjectId);
  const missingAddress = supportsAddress && !printAddress.trim();
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
  const missingDelivery = !physicalQrDeliveryIsComplete(deliveryForm);
  const canSubmit =
    canOrder &&
    Boolean(product?.checkoutReady) &&
    !missingQr &&
    !missingAddress &&
    !missingDelivery &&
    !submitting;
  const setQty = (next: number) => setQuantity(Math.min(QTY_MAX, Math.max(QTY_MIN, next)));

  const startCheckout = useCallback(async (orderId: string) => {
    const session = await checkoutPhysicalQrOrder(orderId);
    const redirected = performExternalStripeRedirect(session.url, "checkout");
    if (!redirected.ok) {
      throw new Error(t("business.qrStudio.physical.orderError"));
    }
  }, [t]);

  const placeOrder = useCallback(async () => {
    if (!product || !canSubmit) return;
    setSubmitting(true);
    try {
      const order = await createPhysicalQrOrder({
        productId: product.id,
        qrContextType,
        qrSubjectId: qrContextType === "storefront" ? undefined : qrSubjectId,
        quantity,
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
      await startCheckout(order.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
      setSubmitting(false);
      void fetchPhysicalQrOrders()
        .then((history) => setOrders(history.orders))
        .catch(() => {});
    }
  }, [
    canSubmit,
    city,
    contactEmail,
    contactPhone,
    printAddress,
    product,
    qrContextType,
    qrSubjectId,
    quantity,
    recipientName,
    startCheckout,
    streetLine,
    addressLine2,
    supportsAddress,
    t,
  ]);

  const payExisting = useCallback(
    async (orderId: string) => {
      setPayingOrderId(orderId);
      try {
        await startCheckout(orderId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
        setPayingOrderId(null);
      }
    },
    [startCheckout, t],
  );

  const subjectOptions =
    qrContextType === "employee"
      ? contexts?.employees ?? []
      : qrContextType === "location"
        ? contexts?.locations ?? []
        : qrContextType === "table"
          ? contexts?.tables ?? []
          : [];

  return (
    <section className="mb-10 space-y-10" aria-labelledby="physical-branding-title">
      <div>
        <h2 id="physical-branding-title" className="text-xl font-semibold tracking-tight">
          {t("business.qrStudio.physical.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.physical.subtitle")}</p>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      {!canOrder ? (
        <div className="space-y-3 rounded-lg border border-border px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t("business.qrStudio.physical.basicLockedTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.physical.basicLockedBody")}</p>
          </div>
          <UpgradeCta featureKey="brandingCustomization" />
        </div>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]">
        <StudioField
          title={t("business.qrStudio.physical.chooseProduct")}
          hint={t("business.qrStudio.physical.chooseProductHint")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setProductId(item.id)}
                className={cn(
                  "rounded-lg border p-2.5 text-left transition-colors",
                  productId === item.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <PhysicalQrPreview
                  compact
                  businessName={businessName}
                  address={item.supportsAddress ? printAddress : null}
                  supportsAddress={item.supportsAddress}
                  colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
                  targetUrl={targetUrl}
                />
                <p className="mt-2 text-sm font-medium leading-tight">
                  {physicalQrTemplateDisplayName(t, {
                    templateId: item.templateId,
                    productName: item.name,
                  })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.supportsAddress
                    ? t("business.qrStudio.physical.withAddress")
                    : t("business.qrStudio.physical.withoutAddress")}
                </p>
              </button>
            ))}
          </div>
        </StudioField>

        <aside className="h-fit space-y-2 lg:sticky lg:top-4 lg:col-start-2 lg:row-span-7 lg:row-start-1">
          <p className="text-sm font-medium tracking-tight lg:hidden">
            {t("business.qrStudio.physical.preview")}
          </p>
          <PhysicalQrPreview
            businessName={businessName}
            address={supportsAddress ? printAddress : null}
            supportsAddress={supportsAddress}
            colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
            targetUrl={targetUrl}
          />
          <p className="text-xs text-muted-foreground">{t("business.qrStudio.physical.previewHint")}</p>
        </aside>

        <StudioField title={t("business.qrStudio.physical.qrType")} hint={t("business.qrStudio.physical.qrTypeHint")}>
          <div className="space-y-3">
            <Select
              value={qrContextType}
              onValueChange={(v) => {
                setQrContextType(v as typeof qrContextType);
                setQrSubjectId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="storefront">{t("business.qrStudio.gallery.assetType.storefront")}</SelectItem>
                <SelectItem value="employee">{t("business.qrStudio.gallery.assetType.employee")}</SelectItem>
                <SelectItem value="table">{t("business.qrStudio.gallery.assetType.table")}</SelectItem>
                <SelectItem value="location">{t("business.qrStudio.gallery.assetType.location")}</SelectItem>
              </SelectContent>
            </Select>
            {qrContextType !== "storefront" ? (
              <Select value={qrSubjectId} onValueChange={setQrSubjectId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("business.qrStudio.physical.selectSubject")} />
                </SelectTrigger>
                <SelectContent>
                  {subjectOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </StudioField>

        {supportsAddress ? (
          <StudioField
            title={t("business.qrStudio.physical.printedAddress")}
            hint={t("business.qrStudio.physical.printedAddressHint")}
          >
            <Textarea
              value={printAddress}
              onChange={(e) => setPrintAddress(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </StudioField>
        ) : (
          <p className="text-sm text-muted-foreground lg:col-start-1">{t("business.qrStudio.physical.noAddressNote")}</p>
        )}

        <StudioField
          title={t("business.qrStudio.physical.deliveryTitle")}
          hint={t("business.qrStudio.physical.deliveryHint")}
        >
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={useRegisteredShipping}
                onChange={(e) => {
                  const next = e.target.checked;
                  setUseRegisteredShipping(next);
                  if (next) {
                    setStreetLine(registeredAddressBlob);
                    if (locationPrefill) setCity(locationPrefill);
                  }
                }}
              />
              <span>{t("business.qrStudio.physical.useRegisteredAddress")}</span>
            </label>
            <div className="space-y-1">
              <Label htmlFor="physical-recipient">{t("business.qrStudio.physical.recipientName")}</Label>
              <Input
                id="physical-recipient"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                autoComplete="name"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="physical-street">{t("business.qrStudio.physical.streetLine")}</Label>
              <Input
                id="physical-street"
                value={streetLine}
                onChange={(e) => setStreetLine(e.target.value)}
                autoComplete="address-line1"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="physical-street2">{t("business.qrStudio.physical.addressLine2")}</Label>
              <Input
                id="physical-street2"
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                autoComplete="address-line2"
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="physical-city">{t("business.qrStudio.physical.city")}</Label>
              <Input
                id="physical-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                autoComplete="address-level2"
                maxLength={100}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="physical-country">{t("business.qrStudio.physical.country")}</Label>
              <Input
                id="physical-country"
                value={t("business.qrStudio.physical.countryGermany")}
                readOnly
                disabled
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="physical-email">{t("business.qrStudio.physical.email")}</Label>
                <Input
                  id="physical-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={160}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="physical-phone">{t("business.qrStudio.physical.phone")}</Label>
                <Input
                  id="physical-phone"
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  autoComplete="tel"
                  maxLength={32}
                />
              </div>
            </div>
          </div>
        </StudioField>

        <StudioField title={t("business.qrStudio.physical.order")}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Label htmlFor="physical-qty">{t("business.qrStudio.physical.quantity")}</Label>
              <div className="inline-flex items-center overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  className="px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => setQty(quantity - 1)}
                  aria-label={t("business.qrStudio.physical.quantityDecrease")}
                >
                  ÔêÆ
                </button>
                <input
                  id="physical-qty"
                  type="number"
                  min={QTY_MIN}
                  max={QTY_MAX}
                  value={quantity}
                  onChange={(e) => setQty(Number(e.target.value) || QTY_MIN)}
                  className="w-10 border-x border-border bg-transparent py-1.5 text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  className="px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                  onClick={() => setQty(quantity + 1)}
                  aria-label={t("business.qrStudio.physical.quantityIncrease")}
                >
                  +
                </button>
              </div>
            </div>

            {product ? (
              <div>
                <p className="text-2xl font-semibold tracking-tight tabular-nums">
                  {formatEur(quote.totalCents)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {quote.freeOrderApplied
                    ? t("business.qrStudio.print.quotaApplied")
                    : t("business.qrStudio.print.basePackage", { count: quote.includedPrints })}
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <Package className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  {processingNow === "SAME_DAY"
                    ? t("business.qrStudio.physical.processingSameDay")
                    : t("business.qrStudio.physical.processing24h")}
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Truck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{t("business.qrStudio.physical.deliveryAfterShip")}</span>
              </p>
            </div>

            {missingQr ? <p className="text-sm text-muted-foreground">{t("business.qrStudio.physical.needQr")}</p> : null}
            {missingAddress ? (
              <p className="text-sm text-muted-foreground">{t("business.qrStudio.physical.needAddress")}</p>
            ) : null}
            {missingDelivery ? (
              <p className="text-sm text-muted-foreground">{t("business.qrStudio.physical.needDelivery")}</p>
            ) : null}

            {!missingDelivery && product ? (
              <div className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
                <p className="font-medium">{t("business.qrStudio.physical.reviewTitle")}</p>
                <p className="text-muted-foreground">
                  {physicalQrTemplateDisplayName(t, {
                    templateId: product.templateId,
                    productName: product.name,
                  })}{" "}
                  · {t("business.qrStudio.physical.orders.qtyShort", { count: quantity })}
                  {` · ${formatEur(quote.totalCents)}`}
                </p>
                <p>
                  {t("business.qrStudio.physical.reviewShipTo")}: {recipientName}, {streetLine}, {city},{" "}
                  {PHYSICAL_QR_SHIP_COUNTRY}
                </p>
              </div>
            ) : null}

            <Button type="button" disabled={!canSubmit} onClick={() => void placeOrder()}>
              {submitting ? t("business.qrStudio.physical.ordering") : t("business.qrStudio.physical.placeOrder")}
            </Button>
          </div>
        </StudioField>
      </div>

      <section className="border-t border-border pt-8" aria-labelledby="physical-orders-title">
        <h2 id="physical-orders-title" className="text-lg font-semibold tracking-tight">
          {t("business.qrStudio.physical.historyTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("business.qrStudio.physical.historyHint")}</p>
        {orders.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("business.qrStudio.physical.historyEmpty")}</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {orders.map((order) => (
              <PhysicalQrOrderCard
                key={order.id}
                order={order}
                confirming={confirmingOrderId === order.id}
                paying={payingOrderId === order.id}
                onPay={(id) => void payExisting(id)}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
