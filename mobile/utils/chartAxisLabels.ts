const WEEKDAY_KEYS: Record<string, string> = {
  Mon: "charts.weekdays.mon",
  Tue: "charts.weekdays.tue",
  Wed: "charts.weekdays.wed",
  Thu: "charts.weekdays.thu",
  Fri: "charts.weekdays.fri",
  Sat: "charts.weekdays.sat",
  Sun: "charts.weekdays.sun",
};

const MONTH_KEYS: Record<string, string> = {
  Jan: "charts.months.jan",
  Feb: "charts.months.feb",
  Mar: "charts.months.mar",
  Apr: "charts.months.apr",
  May: "charts.months.may",
  Jun: "charts.months.jun",
  Jul: "charts.months.jul",
  Aug: "charts.months.aug",
  Sep: "charts.months.sep",
  Oct: "charts.months.oct",
  Nov: "charts.months.nov",
  Dec: "charts.months.dec",
};

type TranslateFn = (key: string) => string;

export function translateChartWeekdayLabel(day: string, t: TranslateFn): string {
  const key = WEEKDAY_KEYS[day];
  return key ? t(key) : day;
}

export function translateChartMonthLabel(month: string, t: TranslateFn): string {
  const key = MONTH_KEYS[month];
  return key ? t(key) : month;
}
