import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/app/components/ui/chart";
import { platformUi } from "./platformDashboardUi";
import { CHART_ANIMATION_OFF } from "../../lib/lightweightChartProps";

type SubscriptionTierChartProps = {
  byTier: { basic: number; premium: number; enterprise: number };
};

export function PlatformBusinessSubscriptionTierChart({ byTier }: SubscriptionTierChartProps) {
  const { t } = useTranslation();
  const data = [
    { tier: t("admin.businessAnalyticsPage.tierBasic"), count: byTier.basic },
    { tier: t("admin.businessAnalyticsPage.tierPremium"), count: byTier.premium },
    { tier: t("admin.businessAnalyticsPage.tierEnterprise"), count: byTier.enterprise },
  ];

  const config: ChartConfig = {
    count: { label: t("admin.businessAnalyticsPage.subscriptions"), color: "#e9781c" },
  };

  return (
    <Card className={`${platformUi.analyticsCard} mt-5`}>
      <CardHeader className={platformUi.analyticsCardHeader}>
        <CardTitle className={platformUi.analyticsCardTitle}>
          {t("admin.businessAnalyticsPage.chartSubscriptions")}
        </CardTitle>
        <CardDescription className={platformUi.analyticsCardDesc}>
          {t("admin.businessAnalyticsPage.chartSubscriptionsDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent className={platformUi.analyticsCardBody}>
        <div className={platformUi.analyticsChartWrap}>
          <ChartContainer config={config} className="aspect-auto h-full w-full min-h-0">
            <BarChart data={data} margin={{ left: 6, right: 6, top: 12, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="tier" tickMargin={8} />
              <YAxis allowDecimals={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={[8, 8, 0, 0]} {...CHART_ANIMATION_OFF} />
            </BarChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
