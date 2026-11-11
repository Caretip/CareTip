import { Link } from "react-router";
import { LayoutGrid, MapPin, MoreHorizontal, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocationDTO, TableDTO } from "@/app/lib/api";
import { Button } from "@/components/ui/button";
import { caretipBtnPrimaryCompact } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

type BusinessLocationVenueCardProps = {
  location: LocationDTO;
  tables: TableDTO[];
  tablesQrHref: string;
  createTableDisabled: boolean;
  showTableQuotaNotice: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCreateTable: () => void;
};

/**
 * Short label for a table's number plate: the last number in the name ("Patio 3" → "3",
 * "12" → "12", "Table 7a" → "7A"), otherwise the initials of its first two words ("Main Bar" → "MB").
 */
export function tablePlateLabel(name: string): string {
  const trimmed = name.trim();
  const numbers = trimmed.match(/\d+[a-z]?/gi);
  if (numbers && numbers.length > 0) return numbers[numbers.length - 1]!.slice(0, 4).toUpperCase();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const initials = words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("");
  return (initials || "·").toUpperCase();
}

function ReviewLinkStatus({ label, configured }: { label: string; configured: boolean }) {
  const { t } = useTranslation();
  const status = configured
    ? t("business.locationsPage.reviewConfigured")
    : t("business.locationsPage.reviewNotConfigured");
  return (
    <span className={cn("venue-chip", configured ? "venue-chip--on" : "venue-chip--off")}>
      <span className="venue-chip__dot" aria-hidden />
      <span className="venue-chip__label">{label}</span>
      <span className="venue-chip__value">{status}</span>
    </span>
  );
}

/**
 * One location and the tables inside it. The location is a section (accent bar, map-pin badge,
 * large title, its own actions); its tables are compact tiles in a tray inside that section, each
 * with a number plate, so the two levels never look alike.
 */
export function BusinessLocationVenueCard({
  location,
  tables,
  tablesQrHref,
  createTableDisabled,
  showTableQuotaNotice,
  onEdit,
  onDelete,
  onCreateTable,
}: BusinessLocationVenueCardProps) {
  const { t } = useTranslation();
  const titleId = `venue-${location.id}-title`;
  const tablesHeadingId = `venue-${location.id}-tables`;
  const googleConfigured = Boolean(location.googlePlaceId?.trim());
  const tripConfigured = Boolean(location.tripadvisorReviewUrl?.trim());
  const createTableProps = {
    onClick: onCreateTable,
    disabled: createTableDisabled,
    "aria-disabled": createTableDisabled,
    "aria-describedby": showTableQuotaNotice ? "tables-quota-notice" : undefined,
    title: showTableQuotaNotice ? t("business.tablesPage.createDisabledAtCapAria") : undefined,
  };

  return (
    <article className="venue-section" aria-labelledby={titleId}>
      <header className="venue-section__header">
        <div className="venue-section__badge" aria-hidden>
          <MapPin className="h-5 w-5" strokeWidth={2.25} />
        </div>

        <div className="venue-section__heading">
          <p className="venue-section__kicker">{t("business.tablesPage.labelLocation")}</p>
          <h2 id={titleId} className="venue-section__title">
            {location.name}
          </h2>
          {location.description ? (
            <p className="venue-section__desc line-clamp-2">{location.description}</p>
          ) : null}
          <div className="venue-section__meta">
            <span className="venue-chip venue-chip--count">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              {t("business.locationsPage.tableCountLabel", { count: tables.length })}
            </span>
            <ReviewLinkStatus
              label={t("business.locationsPage.integrationGoogle")}
              configured={googleConfigured}
            />
            <ReviewLinkStatus
              label={t("business.locationsPage.integrationTripadvisor")}
              configured={tripConfigured}
            />
          </div>
        </div>

        <div className="venue-section__actions">
          <Button
            type="button"
            {...createTableProps}
            className={cn(caretipBtnPrimaryCompact, "venue-section__create gap-1.5")}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("business.locationsPage.createTableShort")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="venue-section__menu h-9 w-9 shrink-0"
                aria-label={t("business.locationsPage.locationActionsAria", { name: location.name })}
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="mr-2 h-4 w-4" aria-hidden />
                {t("business.locationsPage.editLocation")}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                {t("business.locationsPage.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <section className="venue-section__tray" aria-labelledby={tablesHeadingId}>
        <h3 id={tablesHeadingId} className="venue-section__tray-title">
          {t("business.locationsPage.tablesHeading")}
          <span className="venue-section__tray-count" aria-hidden>
            {tables.length}
          </span>
        </h3>

        {tables.length === 0 ? (
          <div className="venue-tables-empty">
            <div className="venue-tables-empty__plate" aria-hidden>
              <Plus className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="venue-tables-empty__title">{t("business.locationsPage.tablesEmptyTitle")}</p>
              <p className="venue-tables-empty__desc">{t("business.locationsPage.tablesEmptyDesc")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              {...createTableProps}
              className="venue-tables-empty__action h-9 shrink-0 gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t("business.locationsPage.createTableShort")}
            </Button>
          </div>
        ) : (
          <ul className="venue-tables">
            {tables.map((row) => (
              <li key={row.id} className="venue-table">
                <div className="venue-table__plate" aria-hidden>
                  {tablePlateLabel(row.name)}
                </div>
                <div className="venue-table__body">
                  <span className="venue-table__kicker">{t("business.tablesPage.thTable")}</span>
                  <span className="venue-table__name" title={row.name}>
                    {row.name}
                  </span>
                </div>
                <Link
                  to={tablesQrHref}
                  className="venue-table__qr"
                  aria-label={`${t("business.locationsPage.viewTableQr")}: ${row.name}`}
                >
                  <QrCode className="h-3.5 w-3.5" aria-hidden />
                  <span>{t("business.locationsPage.viewTableQr")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
