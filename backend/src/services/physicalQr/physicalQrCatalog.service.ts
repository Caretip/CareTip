import { prisma } from "../../prisma.js";
import {
  PHYSICAL_QR_CURRENCY,
  PHYSICAL_QR_PRODUCT_ADDRESS_ID,
  PHYSICAL_QR_PRODUCT_NO_ADDRESS_ID,
  PHYSICAL_QR_TEMPLATE_ID,
  PHYSICAL_QR_TEST_UNIT_PRICE_CENTS,
} from "../../lib/physicalQr/types.js";
import {
  assertPhysicalQrCheckoutReady,
  isPhysicalQrCheckoutEnvEnabled,
  PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED,
  PHYSICAL_QR_PRICE_NOT_CONFIGURED,
} from "../../config/physicalQrCheckout.js";

function flyerPair(input: {
  addressId: string;
  noAddressId: string;
  templateId: string;
  name: string;
  withAddressDescription: string;
  withoutAddressDescription: string;
}) {
  return [
    {
      id: input.addressId,
      name: `${input.name} with address`,
      description: input.withAddressDescription,
      templateId: input.templateId,
      supportsAddress: true,
      active: true,
      orderable: true,
      priceCents: PHYSICAL_QR_TEST_UNIT_PRICE_CENTS,
      currency: PHYSICAL_QR_CURRENCY,
    },
    {
      id: input.noAddressId,
      name: `${input.name} without address`,
      description: input.withoutAddressDescription,
      templateId: input.templateId,
      supportsAddress: false,
      active: true,
      orderable: true,
      priceCents: PHYSICAL_QR_TEST_UNIT_PRICE_CENTS,
      currency: PHYSICAL_QR_CURRENCY,
    },
  ] as const;
}

export const PHYSICAL_QR_CATALOG_SEED = [
  ...flyerPair({
    addressId: PHYSICAL_QR_PRODUCT_ADDRESS_ID,
    noAddressId: PHYSICAL_QR_PRODUCT_NO_ADDRESS_ID,
    templateId: PHYSICAL_QR_TEMPLATE_ID,
    name: "CareTip A5 flyer",
    withAddressDescription: "A5 print with QR, business name, and printed address.",
    withoutAddressDescription: "A5 print with QR and business name only.",
  }),
] as const;

/** Retired design SKUs — keep rows for historical orders; never list or sell. */
export const RETIRED_PHYSICAL_QR_PRODUCT_IDS = [
  "caretip-classic-address",
  "caretip-classic-no-address",
  "caretip-light-address",
  "caretip-light-no-address",
  "caretip-midnight-address",
  "caretip-midnight-no-address",
  "caretip-nature-address",
  "caretip-nature-no-address",
] as const;

export async function ensurePhysicalQrCatalog(): Promise<void> {
  for (const product of PHYSICAL_QR_CATALOG_SEED) {
    await prisma.physicalQrProduct.upsert({
      where: { id: product.id },
      create: { ...product },
      update: {
        name: product.name,
        description: product.description,
        templateId: product.templateId,
        supportsAddress: product.supportsAddress,
        currency: product.currency,
        orderable: product.orderable,
        priceCents: product.priceCents,
        active: true,
      },
    });
  }
  await prisma.physicalQrProduct.updateMany({
    where: { id: { in: [...RETIRED_PHYSICAL_QR_PRODUCT_IDS] } },
    data: { active: false, orderable: false },
  });
}

export function catalogPublicDto(product: {
  id: string;
  name: string;
  description: string;
  templateId: string;
  previewAsset: string | null;
  supportsAddress: boolean;
  active: boolean;
  orderable: boolean;
  priceCents: number | null;
  currency: string;
}) {
  const priceBlocked = product.priceCents == null || product.priceCents <= 0;
  let checkoutBlock: typeof PHYSICAL_QR_PRICE_NOT_CONFIGURED | typeof PHYSICAL_QR_CHECKOUT_NOT_ACTIVATED | null =
    null;
  try {
    assertPhysicalQrCheckoutReady(product);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      checkoutBlock = (err as { code: typeof checkoutBlock }).code;
    } else {
      checkoutBlock = PHYSICAL_QR_PRICE_NOT_CONFIGURED;
    }
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    templateId: product.templateId,
    previewAsset: product.previewAsset,
    supportsAddress: product.supportsAddress,
    active: product.active,
    orderable: product.orderable && !priceBlocked && isPhysicalQrCheckoutEnvEnabled(),
    currency: product.currency,
    priceCents: product.priceCents,
    priceConfigured: !priceBlocked,
    checkoutReady: checkoutBlock === null,
    checkoutBlock,
  };
}

export async function listActivePhysicalQrProducts() {
  await ensurePhysicalQrCatalog();
  const rows = await prisma.physicalQrProduct.findMany({
    where: { active: true, templateId: PHYSICAL_QR_TEMPLATE_ID },
    orderBy: { name: "asc" },
  });
  return rows.map(catalogPublicDto);
}

export async function getPhysicalQrProductOrThrow(id: string) {
  await ensurePhysicalQrCatalog();
  const row = await prisma.physicalQrProduct.findUnique({ where: { id } });
  if (!row || !row.active || row.templateId !== PHYSICAL_QR_TEMPLATE_ID) {
    throw new Error("PHYSICAL_QR_PRODUCT_NOT_FOUND");
  }
  return row;
}
