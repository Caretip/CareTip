import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ShoppingBag, Trash2, Minus, Plus } from "lucide-react";
import { performExternalStripeRedirect } from "@/app/lib/externalStripeRedirect";
import {
  checkoutPhysicalQrBatch,
  createPhysicalQrBatch,
  fetchBusinessProfile,
  fetchPhysicalQrCatalog,
  fetchPhysicalQrContexts,
  resolvePhysicalQrContext,
  type PhysicalQrCatalogProduct,
  type PhysicalQrContextOptions,
} from "@/app/lib/api";
import { PHYSICAL_QR_DEFAULT_COLOR_TOKENS } from "@/app/lib/physicalQrTemplate";
import { QR_STUDIO_SAMPLE_URL, useBusinessBrandingOptional } from "../../../contexts/BusinessBrandingContext";
import { useRequireAuth } from "../../../hooks/useRequireAuth";
import { useSubscriptionEntitlements } from "../../../hooks/useSubscriptionEntitlements";
import { useBusinessEntitlementsContext } from "../../../contexts/BusinessEntitlementsContext";
import { UpgradeCta } from "@/app/components/subscription/UpgradeCta";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PhysicalQrPreview } from "./PhysicalQrPreview";
import { cn } from "@/lib/utils";
import {
  PHYSICAL_QR_SHIP_COUNTRY,
  physicalQrDeliveryIsComplete,
  PHYSICAL_QR_QUANTITY_MIN,
  PHYSICAL_QR_QUANTITY_MAX,
  clampPhysicalQrQuantity,
} from "@/app/lib/physicalQrOrderUi";
import { businessUi } from "@/app/components/business/businessDashboardUi";
import { PrintQrStudioSkeleton } from "@/app/components/business/qr-studio/QrStudioLoadingSkeletons";
import {
  parseQrStudioPrintFocus,
  printFocusForGroup,
  printFocusSectionId,
} from "@/app/lib/qrStudioNav";

export type PrintCartLine = {
  id: string;
  qrContextType: "storefront" | "employee" | "table" | "location";
  qrSubjectId?: string;
  label: string;
  quantity: number;
};

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

  const [step, setStep] = useState<"select" | "shipping" | "review">("select");
  const [products, setProducts] = useState<PhysicalQrCatalogProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [contexts, setContexts] = useState<PhysicalQrContextOptions | null>(null);
  const [cart, setCart] = useState<PrintCartLine[]>([]);
  const [printAddress, setPrintAddress] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [streetLine, setStreetLine] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bootLoading, setBootLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewTargetUrl, setPreviewTargetUrl] = useState("");

  const product = products.find((p) => p.id === productId) ?? products[0] ?? null;
  const supportsAddress = Boolean(product?.supportsAddress);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [catalog, ctx] = await Promise.all([
          fetchPhysicalQrCatalog(),
          fetchPhysicalQrContexts(),
        ]);
        if (cancelled) return;
        setProducts(catalog.products);
        setProductId((prev) => prev || catalog.products[0]?.id || "");
        setContexts(ctx);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : t("business.qrStudio.physical.loadError"));
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
  }, [t, user?.email, user?.name]);

  const formatEur = (cents: number) =>
    new Intl.NumberFormat(i18n.language.startsWith("de") ? "de-DE" : "en-GB", {
      style: "currency",
      currency: product?.currency || "EUR",
    }).format(cents / 100);

  const unitCents = printingIncluded ? 0 : (product?.priceCents ?? 0);
  const printSubtotal = cart.reduce((sum, line) => sum + unitCents * line.quantity, 0);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

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

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled) setPreviewTargetUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [previewContext.qrContextType, previewContext.qrSubjectId]);

  const toggleLine = useCallback((line: Omit<PrintCartLine, "quantity"> & { quantity?: number }) => {
    const key = cartLineKey(line.qrContextType, line.qrSubjectId);
    setCart((prev) => {
      const exists = prev.find((p) => cartLineKey(p.qrContextType, p.qrSubjectId) === key);
      if (exists) {
        return prev.filter((p) => cartLineKey(p.qrContextType, p.qrSubjectId) !== key);
      }
      return [...prev, { ...line, quantity: clampPhysicalQrQuantity(line.quantity ?? 1) }];
    });
  }, []);

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
            qrSubjectId: undefined,
            label: contexts.storefront.label || t("business.qrStudio.overview.businessTitle"),
          },
        ],
      },
      {
        title: t("business.qrStudio.nav.employees"),
        items: contexts.employees.map((e) => ({
          qrContextType: "employee" as const,
          qrSubjectId: e.id,
          label: e.label,
        })),
      },
      {
        title: t("business.qrStudio.nav.tables"),
        items: contexts.tables.map((e) => ({
          qrContextType: "table" as const,
          qrSubjectId: e.id,
          label: e.label,
        })),
      },
      {
        title: t("business.qrStudio.nav.locations"),
        items: contexts.locations.map((e) => ({
          qrContextType: "location" as const,
          qrSubjectId: e.id,
          label: e.label,
        })),
      },
    ];
  }, [contexts, t]);

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
    try {
      const batch = await createPhysicalQrBatch({
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
      const session = await checkoutPhysicalQrBatch(batch.order.id);
      if (session.zeroCost) {
        navigate(`/dashboard/qr-studio/orders/${encodeURIComponent(batch.order.id)}?checkout=success`);
        return;
      }
      const redirected = performExternalStripeRedirect(session.url, "checkout");
      if (!redirected.ok) throw new Error(t("business.qrStudio.physical.orderError"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("business.qrStudio.physical.orderError"));
      setSubmitting(false);
    }
  }, [
    addressLine2,
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
      <div className="print-qr-studio space-y-8 max-lg:space-y-5">
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.print.intro")}</p>
        <PrintQrStudioSkeleton />
      </div>
    );
  }

  return (
    <div className="print-qr-studio space-y-8 max-lg:space-y-5">
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {step === "select" ? (
        <p className="text-sm text-muted-foreground">{t("business.qrStudio.print.intro")}</p>
      ) : null}

      {step === "select" ? (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
          <div className="space-y-8 max-lg:space-y-5">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("business.qrStudio.physical.chooseProduct")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("business.qrStudio.physical.chooseProductHint")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {products.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProductId(item.id)}
                  className={cn(
                    "rounded-lg border p-2.5 text-left transition-colors",
                    productId === item.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <PhysicalQrPreview
                    compact
                    businessName={businessName}
                    address={item.supportsAddress ? printAddress : null}
                    supportsAddress={item.supportsAddress}
                    colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
                    targetUrl={previewTargetUrl}
                  />
                  <p className="mt-2 text-sm font-medium leading-tight">
                    {item.supportsAddress
                      ? t("business.qrStudio.physical.withAddress")
                      : t("business.qrStudio.physical.withoutAddress")}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {printingIncluded
                      ? t("business.qrStudio.print.includedInPlan")
                      : formatEur(item.priceCents ?? 0)}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">{t("business.qrStudio.print.selectQrCodes")}</h2>
            {selectionGroups.map((group) =>
              group.items.length === 0 ? null : (
                (() => {
                  const groupFocus = printFocusForGroup(group.items[0]!.qrContextType);
                  const isFocused = printFocus === groupFocus;
                  return (
                <div
                  key={group.title}
                  id={printFocusSectionId(groupFocus)}
                  className={cn(
                    "scroll-mt-24 space-y-1 rounded-lg transition-colors",
                    isFocused && "ring-2 ring-primary/25 bg-primary/[0.03] p-3 -mx-3",
                  )}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
                  <ul className="divide-y divide-border/80 border-y border-border/80">
                    {group.items.map((item) => {
                      const selected = isSelected(item.qrContextType, item.qrSubjectId);
                      return (
                        <li key={cartLineKey(item.qrContextType, item.qrSubjectId)}>
                          <button
                            type="button"
                            onClick={() =>
                              toggleLine({
                                id: cartLineKey(item.qrContextType, item.qrSubjectId),
                                qrContextType: item.qrContextType,
                                qrSubjectId: item.qrSubjectId,
                                label: item.label,
                              })
                            }
                            className={cn(
                              "flex w-full items-center gap-3 py-2.5 text-left text-sm transition-colors",
                              selected && "bg-primary/[0.04]",
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs",
                                selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                              )}
                              aria-hidden
                            >
                              {selected ? "✓" : ""}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                  );
                })()
              ),
            )}
          </section>

          <CartSummary
            cart={cart}
            cartCount={cartCount}
            printSubtotal={printSubtotal}
            formatEur={formatEur}
            printingIncluded={printingIncluded}
            onContinue={() => setStep("shipping")}
            continueDisabled={cart.length === 0}
            onQuantityChange={setLineQuantity}
            t={t}
          />
          </div>

          <aside className="space-y-2 lg:sticky lg:top-4">
            <p className="text-sm font-medium tracking-tight">{t("business.qrStudio.physical.preview")}</p>
            <PhysicalQrPreview
              businessName={businessName}
              address={supportsAddress ? printAddress : null}
              supportsAddress={supportsAddress}
              colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
              targetUrl={previewTargetUrl}
            />
            <p className="text-xs text-muted-foreground">{t("business.qrStudio.physical.previewHint")}</p>
          </aside>
        </div>
      ) : null}

      {step === "shipping" ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
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
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setStep("select")}>
                {t("business.qrStudio.print.backToSelect")}
              </Button>
              <Button
                type="button"
                className={businessUi.btnPrimary}
                disabled={missingDelivery || missingAddress}
                onClick={() => setStep("review")}
              >
                {t("business.qrStudio.print.continueToReview")}
              </Button>
            </div>
          </div>
          <aside className="hidden lg:block">
            <PhysicalQrPreview
              businessName={businessName}
              address={supportsAddress ? printAddress : null}
              supportsAddress={supportsAddress}
              colorTokens={PHYSICAL_QR_DEFAULT_COLOR_TOKENS}
              targetUrl={previewTargetUrl}
            />
          </aside>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="space-y-6">
          <CartSummary
            cart={cart}
            cartCount={cartCount}
            printSubtotal={printSubtotal}
            formatEur={formatEur}
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep("shipping")}>
              {t("business.qrStudio.print.backToShipping")}
            </Button>
            <Button type="button" className={businessUi.btnPrimary} disabled={!canCheckout} onClick={() => void placeBatchOrder()}>
              {submitting
                ? printingIncluded
                  ? t("business.qrStudio.print.placingOrder", { defaultValue: "Placing order…" })
                  : t("business.qrStudio.physical.ordering")
                : printingIncluded
                  ? t("business.qrStudio.print.placeOrder", { defaultValue: "Place order" })
                  : t("business.qrStudio.print.checkout")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CartSummary({
  cart,
  cartCount,
  printSubtotal,
  formatEur,
  printingIncluded,
  onContinue,
  continueDisabled,
  detailed,
  onRemove,
  onQuantityChange,
  quantityEditable = true,
  t,
}: {
  cart: PrintCartLine[];
  cartCount: number;
  printSubtotal: number;
  formatEur: (cents: number) => string;
  printingIncluded: boolean;
  onContinue?: () => void;
  continueDisabled?: boolean;
  detailed?: boolean;
  onRemove?: (key: string) => void;
  onQuantityChange?: (key: string, quantity: number) => void;
  /** When false (review / pay step), show quantity as read-only — no +/- controls. */
  quantityEditable?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (cart.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground max-lg:border-0 max-lg:px-0">
        <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden />
        {t("business.qrStudio.print.cartEmpty")}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", !detailed && "border-t border-border pt-4 max-lg:pt-3")}>
      <p className="text-sm font-semibold">{t("business.qrStudio.print.cartTitle", { count: cartCount })}</p>
      <ul className="space-y-2 text-sm">
        {cart.map((line) => {
          const key = cartLineKey(line.qrContextType, line.qrSubjectId);
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-foreground">{line.label}</span>
              <span className="flex shrink-0 items-center gap-2">
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
      <div className="space-y-1 border-t border-border/80 pt-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("business.qrStudio.print.printing")}</span>
          <span>{printingIncluded ? t("business.qrStudio.print.includedInPlan") : formatEur(printSubtotal)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>{t("business.qrStudio.print.total")}</span>
          <span>{formatEur(printSubtotal)}</span>
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
