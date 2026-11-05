import * as React from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { useMinWidthMedia } from "@/lib/motionPerf";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type DashboardHeroProps = {
  className?: string;
  /** Optional pill above the title; omit when redundant with sidebar branding. */
  badge?: React.ReactNode;
  title: React.ReactNode;
  /** Optional single-line tagline under the title; omitted when empty. */
  description?: string;
  /** Static hero image (ignored when `image` is set). */
  imageSrc?: string;
  /** Custom visual (e.g. WebGL); uses tight intrinsic layout instead of stretched cover. */
  image?: React.ReactNode;
  imageCaption?: string;
  overview?: React.ReactNode;
  shortcuts?: React.ReactNode;
  /** Primary hero CTAs; omit when navigation lives elsewhere (e.g. sidebar). */
  actions?: React.ReactNode;
  /** @deprecated Border beam removed — kept for API compatibility. */
  beamSize?: number;
  /** When true, omit the right-hand image column (single-column hero). */
  hideImage?: boolean;
  /** When false, skips the bottom gradient scrim over the media column (e.g. for WebGL / custom visuals). */
  imageOverlay?: boolean;
  /**
   * Dashboard-only: when true, omit the Overview/Shortcuts tabs entirely.
   * Use to keep certain dashboards (e.g. employee hero) compact and purpose-driven.
   */
  hideTabs?: boolean;
  /**
   * Dashboard-only: where action buttons live on large screens when `stackHeroOnMobile`.
   * - `belowTabs` (default): actions live in the second row under the tabs.
   * - `belowText`: actions sit directly under the headline/tagline (more compact, summary-like).
   */
  actionsPlacement?: "belowTabs" | "belowText";
  /**
   * Dashboard routes only: on small screens, stack hero as heading → media → tabs/overview → actions.
   * Large screens keep the two-column layout. Does not affect landing or marketing pages unless they pass this flag.
   */
  stackHeroOnMobile?: boolean;
  /**
   * Mobile-only alignment for stacked heroes.
   * Use `center` for premium, zero-slant, centered hero cards (e.g. Business Team Performance).
   */
  mobileAlign?: "left" | "center";
  /** Optional class overrides (e.g. employee hero tone). */
  badgeClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  cardClassName?: string;
  textColumnClassName?: string;
};

/**
 * Shared hero shell: two-column grid on large screens, tight vertical rhythm, no dead space under media.
 */
export function DashboardHero({
  className,
  badge,
  title,
  description,
  imageSrc,
  image,
  imageCaption,
  overview = null,
  shortcuts = null,
  actions,
  hideImage = false,
  imageOverlay = false,
  hideTabs = false,
  actionsPlacement = "belowTabs",
  stackHeroOnMobile = false,
  mobileAlign = "left",
  badgeClassName,
  titleClassName,
  descriptionClassName,
  cardClassName,
  textColumnClassName,
}: DashboardHeroProps) {
  const { t } = useTranslation();
  const isLargeScreen = useMinWidthMedia(1024);
  const hasCustomMedia = Boolean(image);
  const hasPhoto = Boolean(imageSrc) && !hasCustomMedia;
  const tagline = description?.trim() ?? "";
  const caption = imageCaption?.trim() ?? "";

  const badgeRow =
    badge != null ? (
      <div
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 font-sans text-meta font-semibold uppercase text-foreground max-lg:gap-1.5 max-lg:px-2 max-lg:py-0.5 sm:px-2.5",
          stackHeroOnMobile && mobileAlign === "center" && "mx-auto",
          badgeClassName,
        )}
      >
        {badge}
      </div>
    ) : null;

  const titleRow = (
    <CardTitle
      as="h1"
      className={cn(
        "break-words text-foreground",
        stackHeroOnMobile
          ? mobileAlign === "center"
            ? cn(
                "text-balance font-sans text-app-title font-bold text-pretty max-lg:leading-[1.05]",
                "mx-auto max-w-[24ch] text-center sm:max-w-[28ch] md:max-w-[32ch]",
              )
            : cn(
                "w-full font-sans text-app-title font-bold max-lg:transform-none max-lg:leading-[1.05] max-lg:text-left",
                "max-w-[22ch] text-left sm:max-w-[28ch]",
              )
          : "text-balance font-sans text-app-title font-bold text-pretty lg:text-section-title",
        titleClassName,
      )}
    >
      {title}
    </CardTitle>
  );

  const taglineBlock =
    tagline ? (
      <CardDescription
        className={cn(
          "max-w-xl shrink-0 break-words pt-0 text-muted-foreground",
          stackHeroOnMobile
            ? "font-sans text-body-copy line-clamp-2 max-lg:max-w-[36ch]"
            : "font-sans text-body-copy line-clamp-1",
          stackHeroOnMobile && mobileAlign === "center" ? "mx-auto text-center lg:line-clamp-2" : "text-left",
          descriptionClassName,
        )}
      >
        {tagline}
      </CardDescription>
    ) : null;

  const tabsCluster = (
    <Tabs defaultValue="overview" className={cn("w-full pt-0", stackHeroOnMobile ? "max-w-none sm:pt-0" : "max-w-md sm:pt-1")}>
      <TabsList
        className={cn(
          "grid h-11 w-full grid-cols-2 gap-1 p-1",
          stackHeroOnMobile && mobileAlign === "center" && "mx-auto",
          stackHeroOnMobile ? "rounded-full bg-muted" : "rounded-md bg-muted",
        )}
      >
        <TabsTrigger
          value="overview"
          className={cn(
            stackHeroOnMobile && "font-sans text-feature-copy font-semibold",
            stackHeroOnMobile &&
              "rounded-full border-0 shadow-none data-[state=inactive]:bg-transparent data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-none data-[state=active]:ring-0",
          )}
        >
          {t("dashboardHero.overview")}
        </TabsTrigger>
        <TabsTrigger
          value="links"
          className={cn(
            stackHeroOnMobile && "font-sans text-feature-copy font-semibold",
            stackHeroOnMobile &&
              "rounded-full border-0 shadow-none data-[state=inactive]:bg-transparent data-[state=active]:bg-primary data-[state=active]:text-black data-[state=active]:shadow-none data-[state=active]:ring-0",
          )}
        >
          {t("dashboardHero.shortcuts")}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="overview"
        className={cn(
          "text-foreground",
          stackHeroOnMobile
            ? "mt-3 border-0 bg-transparent p-0 font-sans text-body-copy shadow-none"
            : "rounded-md border border-border bg-background p-4 font-sans text-body-copy sm:p-5",
        )}
      >
        {overview}
      </TabsContent>
      <TabsContent
        value="links"
        className={cn(
          stackHeroOnMobile
            ? "mt-3 space-y-2 border-0 bg-transparent p-0 font-sans text-body-copy shadow-none"
            : "space-y-2 rounded-md border border-border bg-background p-4 font-sans text-body-copy sm:p-5",
        )}
      >
        {shortcuts}
      </TabsContent>
    </Tabs>
  );

  const supportingCluster = hideTabs ? null : tabsCluster;

  const actionsRow =
    actions != null ? (
      <div
        className={cn(
          "dashboard-hero-actions flex min-w-0 shrink-0 flex-row flex-wrap items-center gap-2 pt-1 sm:gap-3 sm:pt-2 lg:pt-0",
          stackHeroOnMobile && "dashboard-hero-actions--premium-grid max-lg:pt-0",
        )}
      >
        {actions}
      </div>
    ) : null;

  const mediaShellClass = (opts: { forStackedMobile: boolean }) =>
    cn(
      "dashboard-hero-media relative w-full min-w-0",
      opts.forStackedMobile && stackHeroOnMobile
        ? cn(
            "max-lg:overflow-visible max-lg:rounded-3xl max-lg:bg-transparent max-lg:p-0 max-lg:shadow-none",
            mobileAlign === "center" &&
              // Business Dashboard (stacked + centered): keep media perfectly straight, centered, and symmetrical.
              "max-lg:transform-none max-lg:flex max-lg:items-center max-lg:justify-center",
          )
        : imageOverlay === false
          ? "bg-transparent p-0 sm:p-0 lg:pt-0"
          : cn(
              "border-t border-border bg-muted p-2.5 sm:p-4 lg:border-t-0 lg:pt-6",
              opts.forStackedMobile && "max-lg:border-t-0 max-lg:bg-transparent max-lg:p-0",
            ),
      "lg:mx-0 lg:max-w-none",
    );

  const mediaInner = (opts: { stackedMobileFrame: boolean }) => (
    <div
      className={cn(
        "relative w-full min-w-0 touch-manipulation [&_canvas]:block [&_canvas]:h-full [&_canvas]:w-full [&_canvas]:max-w-full [&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_svg]:mx-auto [&_svg]:block",
        stackHeroOnMobile && mobileAlign === "center" && "transform-none",
        opts.stackedMobileFrame &&
          (stackHeroOnMobile
            ? "max-lg:w-full max-lg:min-h-0"
            : "max-lg:mx-auto max-lg:w-[min(92%,min(560px,95vw))]"),
      )}
    >
      {image}
    </div>
  );

  const renderMediaColumn = (opts: { stackedLayout: boolean }) => {
    if (hideImage) return null;
    return (
      <CardContent
        className={cn(
          "dashboard-hero-media-column relative flex min-h-0 min-w-0 flex-col p-0 lg:border-border",
          !(hasCustomMedia && imageOverlay === false) && "lg:border-l",
          hasPhoto && "min-h-[220px] lg:min-h-[min(100%,28rem)]",
          hasCustomMedia && "lg:justify-center",
          opts.stackedLayout &&
            "max-lg:w-full max-lg:max-w-none lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:justify-center",
        )}
      >
        {hasCustomMedia ? (
          <>
            <div className={mediaShellClass({ forStackedMobile: opts.stackedLayout })}>
              {mediaInner({ stackedMobileFrame: opts.stackedLayout })}
            </div>
            {caption ? (
              <div
                className={cn(
                  "shrink-0 border-t border-border/80 bg-muted/90 px-4 py-4 sm:px-5 sm:py-5 lg:bg-muted/90",
                  opts.stackedLayout && stackHeroOnMobile
                    ? "max-lg:border-t-0 max-lg:bg-transparent max-lg:px-0 max-lg:py-2"
                    : "max-lg:border-t-0 max-lg:bg-transparent max-lg:px-0 max-lg:py-3",
                )}
              >
                <p className="max-w-prose text-left font-sans text-body-copy font-medium text-foreground line-clamp-1">
                  {caption}
                </p>
              </div>
            ) : null}
          </>
        ) : hasPhoto ? (
          <div
            className={cn(
              "relative flex min-h-[220px] flex-1 flex-col lg:min-h-[min(100%,28rem)]",
              opts.stackedLayout && stackHeroOnMobile && "max-lg:min-h-0 max-lg:flex-none",
            )}
          >
            <div
              className={cn(
                "relative min-h-0 flex-1 bg-muted lg:bg-muted",
                opts.stackedLayout && !stackHeroOnMobile && "max-lg:bg-transparent",
                opts.stackedLayout && stackHeroOnMobile && "max-lg:h-auto max-lg:flex-none max-lg:bg-transparent",
              )}
            >
              <img
                src={imageSrc}
                alt=""
                className={cn(
                  "h-full min-h-[220px] w-full object-cover lg:min-h-0",
                  opts.stackedLayout &&
                    stackHeroOnMobile &&
                    "max-lg:h-auto max-lg:min-h-0 max-lg:w-full max-lg:max-h-[min(55vh,480px)] max-lg:rounded-3xl max-lg:object-contain max-lg:object-center max-lg:shadow-none",
                  opts.stackedLayout &&
                    !stackHeroOnMobile &&
                    "max-lg:mx-auto max-lg:min-h-0 max-lg:w-[min(92%,min(560px,95vw))] max-lg:object-contain",
                )}
                loading="lazy"
                decoding="async"
              />
              {imageOverlay ? (
                <div className="pointer-events-none absolute inset-0 bg-background/10 max-lg:hidden" />
              ) : null}
            </div>
            {caption ? (
              <div
                className={cn(
                  "relative shrink-0 px-4 py-3 sm:px-5 sm:py-4 max-lg:px-0",
                  opts.stackedLayout && stackHeroOnMobile && "max-lg:pt-2",
                )}
              >
                <p className="max-w-sm text-left font-sans text-feature-copy font-semibold text-foreground line-clamp-1">{caption}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    );
  };

  return (
    <div className={cn("mb-4 max-lg:mb-3.5 lg:mb-6", className)}>
      <div
        className={cn(
          stackHeroOnMobile &&
            "max-lg:bg-transparent max-lg:px-4 max-lg:py-3 sm:max-lg:px-5 sm:max-lg:py-4",
        )}
      >
        <Card
          className={cn(
            "relative overflow-hidden",
            stackHeroOnMobile
              ? "max-lg:overflow-visible max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none lg:border-2 lg:border-border lg:bg-card lg:shadow-sm"
              : "border-2 border-border bg-card shadow-sm",
            cardClassName,
          )}
        >
        {stackHeroOnMobile ? (
          isLargeScreen ? (
            <div
              className={cn(
                "dashboard-hero-container grid min-w-0",
                hideImage
                  ? "grid-flow-row grid-cols-1 gap-y-6 px-8 pb-8 pt-8"
                  : "grid-cols-12 items-center gap-x-12 gap-y-6 px-8 pb-8 pt-8",
                mobileAlign === "center" && "px-6",
              )}
            >
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-4 text-left min-h-0 flex-none justify-center gap-4 text-left xl:gap-5",
                  hideImage ? "col-span-12 row-start-1" : "col-span-5 row-start-1",
                  textColumnClassName,
                )}
              >
                <div className="min-h-0 space-y-4 lg:space-y-5">
                  {badgeRow}
                  {titleRow}
                </div>
                {taglineBlock}
                {actionsPlacement === "belowText" && actionsRow ? <div className="pt-2 lg:pt-3">{actionsRow}</div> : null}
              </div>
              {!hideImage ? renderMediaColumn({ stackedLayout: true }) : null}
              {hideTabs && actionsPlacement === "belowText" ? null : (
                <div className="flex min-w-0 flex-col gap-6 col-span-12 row-start-2 w-full">
                  {supportingCluster}
                  {actionsPlacement === "belowTabs" ? actionsRow : null}
                </div>
              )}
            </div>
          ) : (
            <div className="dashboard-hero-container flex min-w-0 flex-col gap-2.5 p-0 max-lg:gap-2.5 sm:gap-4">
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-2 max-lg:gap-2 sm:gap-3",
                  mobileAlign === "center" ? "text-center" : "text-left",
                )}
              >
                {mobileAlign === "center" ? (
                  <div className="min-h-0 space-y-3 sm:space-y-4">
                    {badgeRow}
                    {titleRow}
                  </div>
                ) : (
                  <div className="min-h-0 space-y-2 max-lg:space-y-2 sm:space-y-3">
                    {badgeRow}
                    {titleRow}
                  </div>
                )}
                {taglineBlock ? <div className={cn(mobileAlign === "center" ? "" : "-mt-0.5")}>{taglineBlock}</div> : null}
              </div>

              {actionsRow ? <div className="min-w-0">{actionsRow}</div> : null}

              {supportingCluster ? <div className="flex min-w-0 flex-col gap-3">{supportingCluster}</div> : null}

              {!hideImage ? (
                <div className="min-w-0 pt-1">{renderMediaColumn({ stackedLayout: true })}</div>
              ) : null}
            </div>
          )
        ) : (
          <div
            className={cn(
              "dashboard-hero-container grid min-w-0 gap-0 lg:grid-cols-2 lg:items-start lg:gap-8",
            )}
          >
            <CardHeader className="min-w-0 space-y-5 px-4 pb-6 pt-6 sm:space-y-6 sm:px-6 sm:pb-6 sm:pt-7 lg:pl-8 lg:pr-2 lg:pt-8">
              {badgeRow}
              {titleRow}
              {tagline ? (
                <CardDescription className="max-w-xl break-words font-sans text-body-copy text-muted-foreground line-clamp-1">
                  {tagline}
                </CardDescription>
              ) : null}

              {hideTabs ? null : (
                <Tabs defaultValue="overview" className={cn("w-full max-w-md", tagline ? "pt-2 sm:pt-3" : "pt-0 sm:pt-1")}>
                  <TabsList className="grid w-full grid-cols-2 bg-muted">
                    <TabsTrigger value="overview" className="font-sans text-feature-copy font-semibold">
                      {t("dashboardHero.overview")}
                    </TabsTrigger>
                    <TabsTrigger value="links" className="font-sans text-feature-copy font-semibold">
                      {t("dashboardHero.shortcuts")}
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent
                    value="overview"
                    className="rounded-md border border-border bg-background p-4 font-sans text-body-copy text-foreground sm:p-5"
                  >
                    {overview}
                  </TabsContent>
                  <TabsContent
                    value="links"
                    className="space-y-2 rounded-md border border-border bg-background p-4 font-sans text-body-copy sm:p-5"
                  >
                    {shortcuts}
                  </TabsContent>
                </Tabs>
              )}

              {actionsRow ? (
                <div className="dashboard-hero-actions flex min-w-0 flex-row flex-wrap items-center gap-2 pt-4 sm:gap-3 sm:pt-5">
                  {actions}
                </div>
              ) : null}
            </CardHeader>

            {renderMediaColumn({ stackedLayout: false })}
          </div>
        )}
        </Card>
      </div>
    </div>
  );
}
