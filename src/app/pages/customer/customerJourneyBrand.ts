import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { getBusinessById } from "../../lib/api";
import { logClientError } from "../../lib/clientLog";
import type { PublicGuestBranding } from "../../lib/businessBranding";
import { resolveGuestDisplayName } from "../../lib/businessBranding";
import type { ResolvedCustomerEmployee } from "../../lib/resolveCustomerEmployeeContext";

/** Primary — venue the guest is tipping at. */
export type CustomerJourneyVenueBrand = {
  name: string;
  tagline?: string | null;
  logo?: string | null;
  contextLine?: ReactNode;
  branding?: PublicGuestBranding | null;
};

/** Secondary — team member receiving the tip. */
export type CustomerJourneyEmployeeIdentity = {
  name: string;
  role?: string | null;
};

export function venueBrandFromResolved(
  resolved: Pick<ResolvedCustomerEmployee, "businessName" | "businessLogo" | "branding">,
  contextLine?: ReactNode,
): CustomerJourneyVenueBrand {
  const branding = resolved.branding ?? null;
  const name = branding ? resolveGuestDisplayName(branding) : resolved.businessName;
  const tagline =
    branding?.premium && branding.brandTagline?.trim() ? branding.brandTagline.trim() : undefined;
  return {
    name,
    tagline,
    logo: resolved.businessLogo ?? branding?.logoPath ?? null,
    contextLine,
    branding,
  };
}

export function venueBrandFromFields(
  name: string,
  logo?: string | null,
  contextLine?: ReactNode,
  branding?: PublicGuestBranding | null,
): CustomerJourneyVenueBrand {
  const displayName = branding ? resolveGuestDisplayName(branding) : name;
  const tagline =
    branding?.premium && branding.brandTagline?.trim() ? branding.brandTagline.trim() : undefined;
  return {
    name: displayName,
    tagline,
    logo: logo ?? branding?.logoPath ?? null,
    contextLine,
    branding: branding ?? null,
  };
}

export function venueBrandFromBusiness(
  business: {
    name: string;
    logo?: string | null;
    location?: string | null;
    type?: string | null;
    branding?: PublicGuestBranding | null;
  },
  contextLine?: ReactNode,
): CustomerJourneyVenueBrand {
  const branding = business.branding ?? null;
  const displayName = branding
    ? resolveGuestDisplayName({ businessName: business.name, brandDisplayName: branding.brandDisplayName })
    : business.name;
  const tagline =
    branding?.premium && branding.brandTagline?.trim() ? branding.brandTagline.trim() : undefined;
  const derivedContext =
    contextLine ??
    (branding?.premium && branding.welcomeMessage
      ? branding.welcomeMessage
      : business.type || business.location
        ? [business.type, business.location].filter(Boolean).join(" · ")
        : undefined);

  return {
    name: displayName,
    tagline,
    logo: business.logo ?? branding?.logoPath ?? null,
    contextLine: derivedContext || undefined,
    branding,
  };
}

/**
 * Prefer the fetched venue brand (includes type · address) while optionally
 * keeping a faster name/logo snapshot and an extra table/location line.
 */
export function mergeCustomerVenueBrand(
  fetched: CustomerJourneyVenueBrand,
  options?: {
    snapshot?: { name: string; logo: string | null } | null;
    extraContextLine?: string | null;
    fallbackName?: string;
  },
): CustomerJourneyVenueBrand {
  const snapshot = options?.snapshot ?? null;
  const fallbackName = options?.fallbackName;
  const name =
    fetched.name && (!fallbackName || fetched.name !== fallbackName)
      ? fetched.name
      : (snapshot?.name?.trim() || fetched.name);
  const logo = fetched.logo ?? snapshot?.logo ?? null;

  const base =
    typeof fetched.contextLine === "string" && fetched.contextLine.trim()
      ? fetched.contextLine.trim()
      : null;
  const extra = options?.extraContextLine?.trim() || "";

  let contextLine: ReactNode | undefined = fetched.contextLine;
  if (extra) {
    contextLine = base ? `${base} · ${extra}` : extra;
  }

  return {
    ...fetched,
    name,
    logo,
    contextLine: contextLine || undefined,
  };
}

/** Resolve venue name/logo/branding for post-payment pages that only hold `businessId`. */
export function useCustomerVenueBrand(
  businessId: string | null | undefined,
  fallbackName: string,
): CustomerJourneyVenueBrand {
  const [venue, setVenue] = useState<CustomerJourneyVenueBrand>(() => ({
    name: fallbackName,
    logo: null,
    branding: null,
  }));

  useEffect(() => {
    const id = businessId?.trim();
    if (!id) {
      setVenue({ name: fallbackName, logo: null, branding: null });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const biz = await getBusinessById(id);
        if (cancelled) return;
        if (!biz) {
          setVenue({ name: fallbackName, logo: null, branding: null });
          return;
        }
        setVenue(
          venueBrandFromBusiness({
            name: biz.name?.trim() || fallbackName,
            logo: biz.logo ?? null,
            location: biz.location ?? null,
            type: biz.type ?? null,
            branding: biz.branding ?? null,
          }),
        );
      } catch (err) {
        logClientError("useCustomerVenueBrand", err);
        if (!cancelled) setVenue({ name: fallbackName, logo: null, branding: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, fallbackName]);

  return venue;
}
