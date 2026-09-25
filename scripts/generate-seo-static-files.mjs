/**
 * Generates public/robots.txt and public/sitemap.xml for production crawlers.
 * Invoked from npm prebuild.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARETIP_SEO_SITE_ORIGIN, CARETIP_SITEMAP_PATHS } from "./seo-sitemap-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const origin = CARETIP_SEO_SITE_ORIGIN;
const today = new Date().toISOString().slice(0, 10);

const robots = `# CareTip — public marketing crawl rules
# https://caretip.de

User-agent: *
Allow: /

# Private application surfaces (also protected via noindex meta)
Disallow: /dashboard/
Disallow: /employee/
Disallow: /platform-admin/
Disallow: /admin/
Disallow: /login
Disallow: /auth
Disallow: /signup
Disallow: /join/
Disallow: /employee/login
Disallow: /forgot-password
Disallow: /reset-password/
Disallow: /activate
Disallow: /verify
Disallow: /verify-email
Disallow: /check-email
Disallow: /mobile-auth
Disallow: /onboarding
Disallow: /awaiting-approval
Disallow: /verification-pending
Disallow: /subscription/
Disallow: /payment
Disallow: /tip-amount
Disallow: /success
Disallow: /rating
Disallow: /tip-complete
Disallow: /qr/
Disallow: /qr-landing/
Disallow: /table/
Disallow: /staff/
Disallow: /hero-demo
Disallow: /hero-animation-demo
Disallow: /saas-3d-hero
Disallow: /unauthorized

Sitemap: ${origin}/sitemap.xml
`;

const urlEntries = CARETIP_SITEMAP_PATHS.map((pathname) => {
  const loc = pathname === "/" ? `${origin}/` : `${origin}${pathname}`;
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
  </url>`;
});

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join("\n")}
</urlset>
`;

writeFileSync(path.join(publicDir, "robots.txt"), robots, "utf8");
writeFileSync(path.join(publicDir, "sitemap.xml"), sitemap, "utf8");

console.log(`[seo] wrote robots.txt and sitemap.xml (${CARETIP_SITEMAP_PATHS.length} URLs) for ${origin}`);
