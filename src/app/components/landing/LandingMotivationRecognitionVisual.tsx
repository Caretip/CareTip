import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import aminaWebp from "../../../../images/amina.webp";
import aminaAvif from "../../../../images/amina.avif";

export function LandingMotivationRecognitionVisual() {
  const { t } = useTranslation();
  const reduceMotion = usePrefersReducedMotion();

  const primaryMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  const secondaryMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 } };

  return (
    <figure
      className="caretip-motivation-recognition"
      aria-labelledby="caretip-motivation-recognition-caption"
    >
      <div className="caretip-motivation-recognition__photo">
        <picture>
          <source type="image/avif" srcSet={aminaAvif} />
          <source type="image/webp" srcSet={aminaWebp} />
          <img
            src={aminaWebp}
            alt=""
            className="caretip-motivation-recognition__img"
            loading="lazy"
            decoding="async"
            onError={(event) => {
              const img = event.currentTarget;
              const picture = img.parentElement;
              if (picture?.tagName === "PICTURE") {
                picture
                  .querySelectorAll('source[type="image/avif"]')
                  .forEach((source) => source.remove());
              }
              if (img.getAttribute("src") !== aminaWebp) {
                img.src = aminaWebp;
              }
            }}
          />
        </picture>

        <div className="caretip-motivation-recognition__scrim" aria-hidden />

        <motion.div
          className="caretip-motivation-recognition__moment caretip-motivation-recognition__moment--primary"
          {...primaryMotion}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: reduceMotion ? 0 : 0.18 }}
        >
          <p className="caretip-motivation-recognition__amount">
            {t("landing.motivation.recognitionVisual.primaryAmount")}
          </p>
          <p className="caretip-motivation-recognition__name">
            {t("landing.motivation.recognitionVisual.primaryName")}
          </p>
          <p className="caretip-motivation-recognition__quote">
            {t("landing.motivation.recognitionVisual.primaryQuote")}
          </p>
        </motion.div>

        <motion.div
          className="caretip-motivation-recognition__moment caretip-motivation-recognition__moment--secondary"
          {...secondaryMotion}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: reduceMotion ? 0 : 0.48 }}
          aria-hidden
        >
          <span className="caretip-motivation-recognition__secondary-stars">
            {t("landing.motivation.recognitionVisual.secondaryStars")}
          </span>
          <span className="caretip-motivation-recognition__secondary-name">
            {t("landing.motivation.recognitionVisual.secondaryName")}
          </span>
        </motion.div>
      </div>

      <figcaption id="caretip-motivation-recognition-caption" className="sr-only">
        {t("landing.motivation.recognitionVisual.caption")}
      </figcaption>
    </figure>
  );
}
