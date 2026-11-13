import { ArrowLeft } from "lucide-react";
import { PrefetchLink } from "@/app/components/PrefetchLink";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { publicPageUi } from "@/components/public/publicPageUi";

type PublicPageBackLinkProps = {
  to?: string;
  className?: string;
};

/** Homepage back nav — shared across public marketing pages. Touch/hover warms `/` and its hero photo. */
export function PublicPageBackLink({ to = "/", className }: PublicPageBackLinkProps) {
  const { t } = useTranslation();

  return (
    <PrefetchLink to={to} className={cn(publicPageUi.backLink, className)}>
      <ArrowLeft
        className="size-4 shrink-0 transition-transform duration-200 ease-out group-hover:-translate-x-0.5"
        strokeWidth={2}
        aria-hidden
      />
      <span>{t("staticPages.common.backToHome")}</span>
    </PrefetchLink>
  );
}
