export type ItRechtAccountConfig = {
  accountId: string;
  accountName: string;
  locales?: string[];
  countries?: string[];
};

function parseCsvEnv(name: string): string[] | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/** CareTip is a single-account system; multishop mode is opt-in via env. */
export function isItRechtMultishopEnabled(): boolean {
  return process.env.LEGAL_IT_RECHT_MULTISHOP?.trim().toLowerCase() === "true";
}

export function getItRechtAccountList(): ItRechtAccountConfig[] {
  if (isItRechtMultishopEnabled()) {
    const accountsJson = process.env.LEGAL_IT_RECHT_ACCOUNTS_JSON?.trim();
    if (accountsJson) {
      try {
        const parsed = JSON.parse(accountsJson) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item) => {
            const record = item as Record<string, unknown>;
            return {
              accountId: String(record.accountId ?? record.accountid ?? ""),
              accountName: String(record.accountName ?? record.accountname ?? ""),
              locales: Array.isArray(record.locales)
                ? record.locales.map(String)
                : undefined,
              countries: Array.isArray(record.countries)
                ? record.countries.map(String)
                : undefined,
            };
          });
        }
      } catch {
        // fall through to default multishop placeholder
      }
    }
    return [
      { accountId: "default", accountName: "Default" },
    ];
  }

  const locales = parseCsvEnv("LEGAL_IT_RECHT_ACCOUNT_LOCALES");
  const countries = parseCsvEnv("LEGAL_IT_RECHT_ACCOUNT_COUNTRIES");

  return [
    {
      accountId: "0",
      accountName: "",
      ...(locales ? { locales } : {}),
      ...(countries ? { countries } : {}),
    },
  ];
}

export function resolveItRechtAccount(accountId?: string): ItRechtAccountConfig | null {
  const accounts = getItRechtAccountList();
  if (!isItRechtMultishopEnabled()) {
    return accounts[0] ?? null;
  }

  const key = accountId?.trim();
  if (!key) return null;
  return accounts.find((account) => account.accountId === key) ?? null;
}
