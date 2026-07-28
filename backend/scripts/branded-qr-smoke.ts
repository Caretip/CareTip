/**
 * Smoke test branded QR render + HTTP endpoint.
 * Requires TEST_SIGNIN_EMAIL / TEST_SIGNIN_PASSWORD (employee) in backend/.env
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { login } from "../src/services/auth.service.js";
import { renderBrandedQrPngBuffer } from "../src/services/qr/brandedQrRender.service.js";
import { prisma } from "../src/prisma.js";

async function main() {
  const email = process.env.TEST_SIGNIN_EMAIL?.trim();
  const password = process.env.TEST_SIGNIN_PASSWORD;
  if (!email || !password) {
    console.error("Set TEST_SIGNIN_EMAIL and TEST_SIGNIN_PASSWORD in backend/.env");
    process.exit(1);
  }

  const loginResult = await login({ email, password });
  const userId = loginResult.user.id;
  const emp = await prisma.employee.findUnique({
    where: { userId },
    select: { id: true, businessId: true, slug: true, business: { select: { slug: true } } },
  });
  if (!emp) {
    console.error("No employee profile for test user");
    process.exit(1);
  }

  const targetUrl = `https://caretip.de/${emp.business.slug ?? "venue"}/${emp.slug ?? emp.id}`;
  console.log("[smoke] direct render", { businessId: emp.businessId, targetUrl });
  const direct = await renderBrandedQrPngBuffer(emp.businessId, targetUrl, "employee");
  console.log("[smoke] direct render OK", { bytes: direct.buffer.length, etag: direct.etag });

  const apiBase = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  const res = await fetch(`${apiBase}/api/employees/me/qr/branded`, {
    headers: { Authorization: `Bearer ${loginResult.token}` },
  });
  const text = await res.text();
  console.log("[smoke] HTTP", res.status, text.slice(0, 240));
  const json = JSON.parse(text) as { success?: boolean; imageUrl?: string; brandingVersion?: string };
  if (!res.ok || !json.success || !json.imageUrl) process.exit(1);
  console.log("[smoke] HTTP OK", {
    brandingVersion: json.brandingVersion,
    imageChars: json.imageUrl.length,
  });
}

main().catch((err) => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});
