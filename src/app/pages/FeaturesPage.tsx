import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PublicPageShell } from "@/components/public/PublicPageShell";
import { FeaturesPageHero } from "@/components/public/features/FeaturesPageHero";
import { FeaturesPageFinalCta } from "@/components/public/features/FeaturesPageFinalCta";
import { FeatureShowcaseCard } from "@/components/public/features/FeatureShowcaseCard";
import { FEATURES_PAGE_ITEMS } from "@/components/public/features/featuresPageConfig";
import { usePublicMountProbe } from "@/lib/publicMountProbe";

function FeaturesStandardGrid({
  items,
}: {
  items: Array<(typeof FEATURES_PAGE_ITEMS)[number] & { title: string; description: string; tag: string }>;
}) {
  return (
    <section className="caretip-features-grid-wise caretip-features-grid-wise--standard" aria-label="More features">
      <div className="caretip-features-page__inner">
        <div className="caretip-features-grid-wise__grid">
          {items.map((f, idx) => (
            <FeatureShowcaseCard
              key={f.id}
              title={f.title}
              description={f.description}
              tag={f.tag}
              Icon={f.Icon}
              visual={f.visual}
              index={idx + 2}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function FeaturesPage() {
  usePublicMountProbe("FeaturesPage");
  const { t, i18n } = useTranslation();

  const items = useMemo(
    () =>
      FEATURES_PAGE_ITEMS.map((item) => ({
        ...item,
        title: t(`staticPages.features.f${item.id}Title`),
        description: t(`staticPages.features.f${item.id}Desc`),
        tag: t(`staticPages.features.${item.tagKey}`),
      })),
    [t, i18n.language],
  );

  const featured = items.filter((f) => f.featured);
  const standard = items.filter((f) => !f.featured);

  return (
    <PublicPageShell maxWidth="full" contentClassName="pb-0" className="bg-background">
      <main
        id="features"
        className="caretip-features-page caretip-features-page--wise"
        aria-label={t("nav.features")}
      >
        <FeaturesPageHero />

        <section className="caretip-features-grid-wise caretip-features-grid-wise--featured" aria-label="Featured features">
          <div className="caretip-features-page__inner">
            <div className="caretip-features-grid-wise__grid">
              {featured.map((f, idx) => (
                <FeatureShowcaseCard
                  key={f.id}
                  title={f.title}
                  description={f.description}
                  tag={f.tag}
                  Icon={f.Icon}
                  visual={f.visual}
                  featured
                  index={idx}
                />
              ))}
            </div>
          </div>
        </section>

        <FeaturesStandardGrid items={standard} />

        <FeaturesPageFinalCta />
      </main>
    </PublicPageShell>
  );
}
