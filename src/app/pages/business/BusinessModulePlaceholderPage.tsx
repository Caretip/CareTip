import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export function BusinessModulePlaceholderPage({
  titleKey,
  descriptionKey,
}: {
  titleKey: string;
  descriptionKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[55vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/15">
          <Sparkles className="h-8 w-8 text-primary" aria-hidden />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
          {t("common.comingSoonBadge")}
        </span>
        <h1 className="mt-5 font-hero-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t(titleKey)}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t(descriptionKey)}
        </p>
        <p className="mt-4 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
          {t("common.comingSoonInDevelopment")}
        </p>
      </div>
    </div>
  );
}
