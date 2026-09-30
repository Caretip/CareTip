import { Link } from "react-router";
import { LayoutGrid, MapPin, MoreHorizontal, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LocationDTO, TableDTO } from "@/app/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function IntegrationStatus({
  label,
  configured,
}: {
  label: string;
  configured: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="business-venue-card__integration">
      <span className="business-venue-card__integration-label">{label}</span>
      <Badge
        variant={configured ? "secondary" : "outline"}
        className={configured ? "font-normal text-foreground/90" : "font-normal text-muted-foreground"}
      >
        {configured
          ? t("business.locationsPage.reviewConfigured")
          : t("business.locationsPage.reviewNotConfigured")}
      </Badge>
    </div>
  );
}

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
  const googleConfigured = Boolean(location.googlePlaceId?.trim());
  const tripConfigured = Boolean(location.tripadvisorReviewUrl?.trim());

  return (
    <article className="business-venue-card" aria-labelledby={`venue-${location.id}-title`}>
      <header className="business-venue-card__header">
        <div className="business-venue-card__identity">
          <div
            className="business-venue-card__icon flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"
            aria-hidden
          >
            <MapPin className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={`venue-${location.id}-title`} className="business-venue-card__title">
              {location.name}
            </h2>
            {location.description ? (
              <p className="business-venue-card__desc line-clamp-2">{location.description}</p>
            ) : null}
            <div className="business-venue-card__integrations">
              <IntegrationStatus
                label={t("business.locationsPage.integrationGoogle")}
                configured={googleConfigured}
              />
              <IntegrationStatus
                label={t("business.locationsPage.integrationTripadvisor")}
                configured={tripConfigured}
              />
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label={t("business.locationsPage.locationActionsAria", { name: location.name })}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden />
              {t("business.locationsPage.editLocation")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden />
              {t("business.locationsPage.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="business-venue-card__tables">
        <div className="business-venue-card__tables-head">
          <div>
            <h3 className="business-venue-card__tables-title">
              {t("business.locationsPage.tablesHeading")}
            </h3>
            <p className="business-venue-card__tables-count">
              {t("business.locationsPage.tableCountLabel", { count: tables.length })}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCreateTable}
            disabled={createTableDisabled}
            aria-disabled={createTableDisabled}
            aria-describedby={showTableQuotaNotice ? "tables-quota-notice" : undefined}
            title={
              showTableQuotaNotice ? t("business.tablesPage.createDisabledAtCapAria") : undefined
            }
            className="h-8 shrink-0 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("business.locationsPage.createTableShort")}
          </Button>
        </div>

        {tables.length === 0 ? (
          <div className="business-venue-card__tables-empty">
            <p className="font-medium text-foreground">
              {t("business.locationsPage.tablesEmptyTitle")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("business.locationsPage.tablesEmptyDesc")}
            </p>
          </div>
        ) : (
          <ul className="business-venue-card__table-list">
            {tables.map((row) => (
              <li key={row.id} className="business-venue-card__table-row">
                <div className="flex min-w-0 items-center gap-2">
                  <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
                </div>
                <Link
                  to={tablesQrHref}
                  className="business-venue-card__table-qr"
                >
                  <QrCode className="h-3.5 w-3.5" aria-hidden />
                  {t("business.locationsPage.viewTableQr")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
