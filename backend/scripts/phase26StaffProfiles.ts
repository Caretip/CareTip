/**
 * Phase26 E2E demo staff — display names + repo template/ avatar sources.
 * Scoped to mgr_p26_1786691378148@caretip-test.local (Maria Testerin).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateImageBufferForUpload } from "../src/lib/imageUploadValidation.js";
import {
  assertUploadedObjectReadableInBucket,
  isSupabaseStorageConfigured,
  uploadBufferToSupabasePublicUrl,
} from "../src/lib/supabaseStorageClient.js";

export const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
export const TAG = "p26_1786691378148";
export const PHASE26_PASSWORD = "Phase26E2E!23";

export type Phase26StaffProfile = {
  key: string;
  slug: string;
  email: string | null;
  name: string;
  jobTitle: string;
  phone: string;
  monthlyGoal: number;
  bio: string;
  templateFile: string;
};

export const PHASE26_STAFF_PROFILES: Phase26StaffProfile[] = [
  {
    key: "jordan",
    slug: `${TAG}-jordan`,
    email: `jordan.${TAG}@caretip-test.local`,
    name: "Lukas Schneider",
    jobTitle: "Host",
    phone: "+49 30 11110001",
    monthlyGoal: 420,
    bio: "Greets guests at the door and seats the floor with a calm, premium service style.",
    templateFile: "professional-bartender-service-stockcake.jpg",
  },
  {
    key: "maria",
    slug: `${TAG}-maria`,
    email: `maria.${TAG}@caretip-test.local`,
    name: "Anna Müller",
    jobTitle: "Head server",
    phone: "+49 30 11110003",
    monthlyGoal: 560,
    bio: "Leads the dining room and looks after regulars with attentive, unhurried service.",
    templateFile: "welcoming-receptionist-smiling-stockcake.jpg",
  },
  {
    key: "luca",
    slug: `${TAG}-luca`,
    email: `luca.${TAG}@caretip-test.local`,
    name: "Felix Wagner",
    jobTitle: "Sous chef",
    phone: "+49 30 11110002",
    monthlyGoal: 510,
    bio: "Runs the pass on busy nights and keeps the kitchen line precise and on time.",
    templateFile: "focused-bartender-working-stockcake.jpg",
  },
  {
    key: "sam",
    slug: `${TAG}-sam`,
    email: `sam.${TAG}@caretip-test.local`,
    name: "Sophie Weber",
    jobTitle: "Bartender",
    phone: "+49 30 11110004",
    monthlyGoal: 480,
    bio: "Builds classic cocktails and keeps the bar moving without rushing guests.",
    templateFile: "focused-receptionist-working-stockcake.jpg",
  },
  {
    key: "sonwa",
    slug: "sonwa-maky",
    email: null,
    name: "Jonas Fischer",
    jobTitle: "Server",
    phone: "+49 30 11110010",
    monthlyGoal: 400,
    bio: "Supports the floor team with attentive table service during busy shifts.",
    templateFile: "StockCake-Friendly_Delivery_Man-843938-medium.jpg",
  },
  {
    key: "lena",
    slug: `${TAG}-lena`,
    email: `lena.${TAG}@caretip-test.local`,
    name: "Lea Hoffmann",
    jobTitle: "Pastry chef",
    phone: "+49 30 11110007",
    monthlyGoal: 400,
    bio: "Finishes desserts for the room and supports the pastry station through service.",
    templateFile: "welcoming-receptionist-desk-stockcake.jpg",
  },
  {
    key: "noah",
    slug: `${TAG}-noah`,
    email: `noah.${TAG}@caretip-test.local`,
    name: "Maximilian Becker",
    jobTitle: "Sommelier",
    phone: "+49 30 11110006",
    monthlyGoal: 530,
    bio: "Guides wine pairings and keeps the cellar list accurate for service.",
    templateFile: "StockCake-Confident_Healthcare_Professional-4705781-medium.jpg",
  },
  {
    key: "sarah",
    slug: `${TAG}-sarah`,
    email: `sarah.${TAG}@caretip-test.local`,
    name: "Clara Schmidt",
    jobTitle: "Senior server",
    phone: "+49 30 11110005",
    monthlyGoal: 450,
    bio: "Handles larger tables and tasting menus with a warm, detail-first approach.",
    templateFile: "receptionist-at-desk-stockcake.jpg",
  },
  {
    key: "iris",
    slug: `${TAG}-iris`,
    email: `iris.${TAG}@caretip-test.local`,
    name: "Leon Neumann",
    jobTitle: "Reception",
    phone: "+49 30 11110009",
    monthlyGoal: 360,
    bio: "Takes bookings, welcomes walk-ins, and keeps the front desk calm at peak times.",
    templateFile: "delivery-person-waiting-stockcake.jpg",
  },
  {
    key: "omar",
    slug: `${TAG}-omar`,
    email: `omar.${TAG}@caretip-test.local`,
    name: "Hannah Krüger",
    jobTitle: "Floor manager",
    phone: "+49 30 11110008",
    monthlyGoal: 390,
    bio: "Coordinates stations, covers breaks, and keeps service timing tight.",
    templateFile: "StockCake-Delivery_Service_Smile-444877-medium.jpg",
  },
];

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export function repoTemplatePath(fileName: string): string {
  return join(scriptsDir, "..", "..", "template", fileName);
}

export function phase26AvatarObjectKey(key: string): string {
  return `avatars/phase26-demo/${TAG}-${key}.jpg`;
}

export async function uploadPhase26StaffAvatar(key: string, templateFile: string): Promise<string> {
  if (!isSupabaseStorageConfigured()) {
    throw new Error(
      "Supabase Storage is required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). Cannot upload Phase26 staff avatars.",
    );
  }
  const buffer = readFileSync(repoTemplatePath(templateFile));
  validateImageBufferForUpload(buffer, "image/jpeg");
  const publicUrl = await uploadBufferToSupabasePublicUrl(
    phase26AvatarObjectKey(key),
    buffer,
    "image/jpeg",
  );
  await assertUploadedObjectReadableInBucket(publicUrl);
  return publicUrl;
}
