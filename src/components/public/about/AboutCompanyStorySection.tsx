import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePublicScrollReveal } from "@/lib/usePublicScrollReveal";

const STORY_PARAGRAPH_KEYS = ["p1", "p2", "p3", "p4"] as const;

export function AboutCompanyStorySection() {
  const { t, i18n } = useTranslation();
  const textReveal = usePublicScrollReveal<HTMLDivElement>(0);

  const paragraphs = useMemo(() => {
    return STORY_PARAGRAPH_KEYS.map((key) => {
      const path = `staticPages.about.story.${key}`;
      const value = t(path);
      return value && value !== path ? value : null;
    }).filter((value): value is string => Boolean(value));
  }, [t, i18n.language]);

  return (
    <section className="caretip-about-split" aria-labelledby="about-story-title">
      <div className="caretip-about-page__inner caretip-about-split__grid caretip-about-split__grid--copy-only">
        <div
          ref={textReveal.ref}
          style={textReveal.style}
          className={cn(textReveal.className, "caretip-about-split__copy")}
        >
          <p className="caretip-about-split__eyebrow">{t("staticPages.about.story.eyebrow")}</p>
          <h2 id="about-story-title" className="caretip-about-split__headline">
            {t("staticPages.about.story.title")}
          </h2>
          <div className="caretip-about-split__prose">
            {paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 48)}>{paragraph}</p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
