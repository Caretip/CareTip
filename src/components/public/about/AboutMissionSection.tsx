import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePublicScrollReveal } from "@/lib/usePublicScrollReveal";

type BeliefCardProps = {
  index: number;
  title: string;
  body: string;
  delay?: number;
};

function AboutBeliefCard({ index, title, body, delay = 0 }: BeliefCardProps) {
  const reveal = usePublicScrollReveal<HTMLDivElement>(delay);

  return (
    <article
      ref={reveal.ref}
      style={reveal.style}
      className={cn(reveal.className, "caretip-about-belief-card")}
    >
      <span className="caretip-about-belief-card__index" aria-hidden>
        {index}
      </span>
      <h3 className="caretip-about-belief-card__title">{title}</h3>
      <p className="caretip-about-belief-card__body">{body}</p>
    </article>
  );
}

/** Trust grid — “What we stand for” (template: 3-column product & trust grid). */
export function AboutMissionSection() {
  const { t, i18n } = useTranslation();
  const headerReveal = usePublicScrollReveal<HTMLDivElement>(0);

  const items = useMemo(
    () => [
      {
        title: t("staticPages.about.missionSection.m1Title"),
        body: t("staticPages.about.missionSection.m1Body"),
      },
      {
        title: t("staticPages.about.missionSection.m2Title"),
        body: t("staticPages.about.missionSection.m2Body"),
      },
      {
        title: t("staticPages.about.missionSection.m3Title"),
        body: t("staticPages.about.missionSection.m3Body"),
      },
    ],
    [t, i18n.language],
  );

  return (
    <section className="caretip-about-beliefs" aria-labelledby="about-mission-title">
      <div className="caretip-about-page__inner">
        <div
          ref={headerReveal.ref}
          style={headerReveal.style}
          className={cn(headerReveal.className, "caretip-about-beliefs__head")}
        >
          <p className="caretip-about-beliefs__eyebrow">{t("staticPages.about.missionSection.eyebrow")}</p>
          <h2 id="about-mission-title" className="caretip-about-beliefs__title">
            {t("staticPages.about.missionSection.title")}
          </h2>
        </div>

        <div className="caretip-about-beliefs__grid">
          {items.map((item, idx) => (
            <AboutBeliefCard
              key={item.title}
              index={idx + 1}
              title={item.title}
              body={item.body}
              delay={idx * 0.07}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
