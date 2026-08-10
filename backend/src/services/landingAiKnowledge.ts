/** CareTip product knowledge and FAQ grounding for Ask CareTip (landing assistant). */

export const LANDING_AI_SCOPE_REFUSAL =
  "I'm here for CareTip questions: tipping, QR setup, dashboards, pricing, and onboarding. What would you like to know about the product?";

/** Core product context injected into the LLM system prompt (not shown to users). */
export const CARETIP_PRODUCT_CONTEXT = `
CareTip is a digital tipping platform for hospitality (restaurants, hotels, bars, cafes).

GUEST TIPPING FLOW:
- Guests scan a branded QR code (employee, table, or location) in the mobile browser. No guest app required.
- They choose tip amount, pay by card or digital wallet (Stripe), and can leave optional feedback.
- Tips route to the selected employee or team context the QR represents.

BUSINESS WORKFLOWS:
- Business owners sign up, complete onboarding/KYC as required, add locations, invite staff, generate QR codes.
- Managers use dashboards for tips, staff performance, goals, tables/locations, and reporting by timeframe.
- Multiple venues/locations supported on higher tiers; staff and QR codes can be scoped per location.

EMPLOYEE WORKFLOWS:
- Employees activate accounts, complete profile details, and see digital tips recorded in CareTip as guests pay (Stripe).
- Employee dashboard shows earnings, goals, tip activity, and notifications when tips arrive (timing depends on settings/connectivity).

PAYOUTS & PAYMENTS:
- Tips are processed by secure payment partners (PCI-compliant); CareTip does not store full card numbers.
- CareTip records and tracks tips; businesses distribute tips to staff on their own schedule (not instant automated payouts).
- Never state a specific dollar balance, payout date, or that a payment succeeded for this user.

QR & SETUP:
- Typical go-live: create business account, add staff, generate QR codes, print or display (often under ~15 minutes with the setup wizard).
- QR codes can reflect brand logo, colors, venue name; per employee, table, or location for accurate reporting.

PRICING:
- Transparent platform fee on processed tips; tier details on the public Pricing page. Do not invent fee percentages.

SECURITY & GDPR:
- GDPR-aligned handling for EU hospitality; consent-friendly flows; data minimization.
- Users can request data export and account erasure where applicable. Financial tip/payment records may be retained in limited form after access is removed when required for legal or financial purposes.
- Do not claim that all personal data is deleted immediately, or that users have absolute control over every record at all times.

ANALYTICS & NOTIFICATIONS:
- Live dashboards for businesses and employees; analytics by timeframe; push/email notifications where enabled.

HOSPITALITY ADVISORY (general best practices, not account data):
- Tip volume: visible QR at checkout, tables, and rooms; train staff to mention digital tipping once per visit; branded QR builds trust.
- KPIs managers watch: tip volume and count by period, per employee/location, goal progress, guest feedback when enabled, payout completion rates.
- Staff motivation: transparent earnings dashboards, goals, timely notifications; fair QR placement so effort is recognized.
- vs cash: digital tips reduce cash handling, improve reporting, work for card-first guests; guests need no app.
- Service quality: faster checkout, optional feedback, recognizing standout staff via employee-specific QR codes.

SUPPORT:
- Help Center, FAQs, and contact form for account-specific issues. You cannot access user accounts or live data.
`.trim();

export type FaqEntry = {
  id: string;
  keywords: string[];
  en: string;
  de: string;
};

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "how_it_works",
    keywords: ["how", "work", "what is", "caretip", "platform", "digital tip"],
    en: "CareTip lets guests tip in seconds by scanning a branded QR code. Tips route to the right employee or team, and managers see live dashboards without cash handling or awkward card readers.",
    de: "Mit CareTip geben Gäste in Sekunden Trinkgeld per QR-Scan. Trinkgelder landen beim richtigen Teammitglied, Manager sehen Live-Dashboards ohne Bargeld oder umständliche Kartenterminals.",
  },
  {
    id: "setup_time",
    keywords: ["setup", "long", "minute", "onboard", "start", "go live", "wizard"],
    en: "Most venues go live in under 15 minutes: create your business account, add staff, generate QR codes, and print or display them. The setup wizard walks you through each step.",
    de: "Die meisten Betriebe sind in unter 15 Minuten live: Konto anlegen, Team einladen, QR-Codes erstellen und ausdrucken oder anzeigen. Der Setup-Assistent führt Sie Schritt für Schritt.",
  },
  {
    id: "qr_customize",
    keywords: ["qr", "custom", "brand", "logo", "color", "table", "print"],
    en: "QR codes can carry your logo, brand colors, and venue name. You can generate codes per employee, table, or location so reporting stays accurate.",
    de: "QR-Codes können Logo, Markenfarben und Venue-Namen tragen. Pro Mitarbeiter, Tisch oder Standort für saubere Auswertungen.",
  },
  {
    id: "gdpr",
    keywords: ["gdpr", "dsgvo", "privacy", "data", "compliance", "eu"],
    en: "CareTip is built for EU hospitality with GDPR-aligned handling and consent-friendly flows. You can request a data export and account erasure where applicable. Some financial tip or payment records may be retained in limited form after access is removed when required. See the Privacy Policy for details—we do not claim every record disappears immediately.",
    de: "CareTip ist für EU-Gastronomie mit DSGVO-orientierter Verarbeitung und einwilligungsfreundlichen Abläufen gebaut. Sie können Datenexport und Löschanfragen stellen, soweit anwendbar. Einige finanzielle Trinkgeld- oder Zahlungsdaten können nach Entzug des Zugangs in begrenzter Form erhalten bleiben, wenn erforderlich. Details in der Datenschutzerklärung—wir behaupten nicht, dass alle Daten sofort verschwinden.",
  },
  {
    id: "employee_tips",
    keywords: ["employee", "staff", "receive", "paid", "payout", "earn", "dashboard"],
    en: "Employees see tips recorded in CareTip as guests pay through Stripe. Dashboards show earnings and goals; managers track performance without handling cash. Businesses distribute tips on their own schedule.",
    de: "Mitarbeitende sehen Trinkgelder in CareTip, sobald Gäste über Stripe zahlen. Dashboards zeigen Verdienste und Ziele; Betriebe verteilen Trinkgelder nach eigenem Rhythmus.",
  },
  {
    id: "multi_venue",
    keywords: ["venue", "location", "multiple", "multi", "franchise", "hotel group"],
    en: "One business account can manage multiple locations, teams, and QR endpoints, ideal for hotel groups, multi-site restaurants, and franchises.",
    de: "Ein Business-Konto verwaltet mehrere Standorte, Teams und QR-Endpunkte, ideal für Hotelgruppen und Filialbetriebe.",
  },
  {
    id: "pricing",
    keywords: ["price", "cost", "fee", "tier", "charge", "expensive"],
    en: "Pricing is transparent: a platform fee on processed tips with no hidden hardware costs. See the Pricing page for current tiers. You only pay when guests tip.",
    de: "Transparente Preise: eine Plattformgebühr auf verarbeitete Trinkgelder, ohne versteckte Hardware-Kosten. Aktuelle Pakete auf der Pricing-Seite.",
  },
  {
    id: "guest_no_app",
    keywords: ["guest", "app", "download", "browser", "phone"],
    en: "Guests tip from their phone browser via QR or link. No app download is required for the guest tipping flow.",
    de: "Gäste geben Trinkgeld im Browser per QR oder Link. Für Gäste ist keine App nötig.",
  },
  {
    id: "security",
    keywords: ["secure", "security", "pci", "card", "safe", "payment"],
    en: "CareTip uses industry-standard security and payment processors that meet PCI standards. Card data is handled by those partners; full card numbers are not stored on CareTip servers.",
    de: "CareTip nutzt etablierte Sicherheitsstandards und PCI-konforme Zahlungsdienstleister. Kartendaten verarbeiten die Partner; vollständige Kartennummern speichern wir nicht.",
  },
  {
    id: "disputes",
    keywords: ["dispute", "chargeback", "refund", "guest dispute"],
    en: "Card networks and banks handle disputes per their rules. CareTip may share transaction details with processors to help resolve cases. Account-specific help goes through support.",
    de: "Streitfälle bearbeiten Kartennetzwerke und Banken nach ihren Regeln. CareTip kann Transaktionsdetails an Prozessoren weitergeben. Für Einzelfälle: Support kontaktieren.",
  },
  {
    id: "realtime_tips",
    keywords: ["real time", "realtime", "notify", "notification", "instant", "live"],
    en: "Employees can be notified when new tips arrive, depending on settings and connectivity. Dashboards update for businesses and staff; exact timing may vary by device and network.",
    de: "Mitarbeitende können bei neuen Trinkgeldern benachrichtigt werden (je nach Einstellung und Verbindung). Dashboards aktualisieren sich; das Timing kann variieren.",
  },
  {
    id: "support",
    keywords: ["support", "help", "contact", "email"],
    en: "Use the Help Center, FAQs, or contact form. Email support is available; response times depend on volume and business hours.",
    de: "Nutzen Sie Help Center, FAQs oder das Kontaktformular. E-Mail-Support ist verfügbar.",
  },
  {
    id: "grow_tips",
    keywords: [
      "increase",
      "grow",
      "boost",
      "more tip",
      "tip volume",
      "lower",
      "decline",
      "down",
      "slow week",
    ],
    en: "Many venues lift tip volume by placing branded QR codes where service ends (tables, bar, reception), training a light mention from staff, and reviewing dashboards to see which locations or shifts perform best. CareTip cannot see your live totals here, but the product is built for that visibility after signup.",
    de: "Viele Betriebe steigern Trinkgelder mit sichtbaren QR-Codes am Serviceende, einer kurzen Erwähnung durch das Team und Dashboards für Standorte und Schichten. Live-Zahlen sehe ich hier nicht, nach der Anmeldung sind sie im Produkt sichtbar.",
  },
  {
    id: "kpis",
    keywords: ["kpi", "metric", "monitor", "track", "analytics", "report", "dashboard"],
    en: "Useful KPIs include tip count and amount by day/week/month, performance by employee or location, goal completion, and feedback trends when guests leave comments. CareTip dashboards are designed around these hospitality metrics.",
    de: "Sinnvolle KPIs: Trinkgeldanzahl und -summe nach Zeitraum, Leistung pro Mitarbeiter oder Standort, Zielerreichung und Feedback-Trends. CareTip-Dashboards sind darauf ausgelegt.",
  },
  {
    id: "onboard_staff",
    keywords: ["onboard", "invite staff", "train team", "roll out", "launch staff"],
    en: "Roll out by inviting staff in CareTip, assigning employee or table QR codes, and a short team briefing on where guests scan. Most venues finish setup in under 15 minutes before staff training.",
    de: "Ausrollen: Team einladen, Mitarbeiter- oder Tisch-QR zuweisen und kurz zeigen, wo Gäste scannen. Viele Betriebe sind in unter 15 Minuten startklar.",
  },
  {
    id: "vs_cash",
    keywords: ["cash", "compare", "versus", "instead of cash", "bargeld"],
    en: "Compared with cash-only jars, digital QR tipping suits card-first guests, reduces cash handling and reconciliation, and gives managers per-employee reporting. Guests still tip in seconds without downloading an app.",
    de: "Im Vergleich zu Bargeld-Trinkgelddosen passt digitales QR-Trinkgeld zu kartenzahlenden Gästen, weniger Bargeldaufwand und besserer Auswertung pro Mitarbeiter. Gäste brauchen keine App.",
  },
  {
    id: "hotel_pitch",
    keywords: ["hotel", "manager", "general manager", "front office", "hospitality group"],
    en: "For hotel leaders, CareTip centralizes multi-location tipping, branded guest QR journeys, and live dashboards for F&B and rooms teams without hardware terminals at every touchpoint.",
    de: "Für Hotel-Manager: CareTip bündelt Trinkgelder über Standorte, gebrandete Gäste-QR und Live-Dashboards für F&B und Rooms ohne Terminal an jedem Punkt.",
  },
  {
    id: "motivation",
    keywords: ["motivation", "morale", "retention", "recognize", "reward staff"],
    en: "Teams stay motivated when tips are visible quickly, goals are tracked in the employee dashboard, and QR codes credit the right person. Transparent reporting beats opaque cash pools.",
    de: "Motivation steigt, wenn Trinkgelder schnell sichtbar sind, Ziele im Mitarbeiter-Dashboard zählen und QR dem richtigen Menschen gutgeschrieben werden.",
  },
  {
    id: "guest_experience",
    keywords: ["customer experience", "guest experience", "service quality", "improve service"],
    en: "CareTip supports experience with frictionless tipping, optional feedback, and less awkward cash moments, while managers see which teams earn guest appreciation.",
    de: "CareTip unterstützt das Erlebnis mit reibungslosem Trinkgeld, optionalem Feedback und weniger unangenehmen Bargeld-Momenten, während Manager sehen, welche Teams Anerkennung erhalten.",
  },
];

const FALLBACK_INTROS_EN = [
  "Here's how I'd put it:",
  "In short:",
  "Happy to explain:",
  "Sure thing:",
];
const FALLBACK_INTROS_DE = [
  "Kurz gesagt:",
  "Gerne erklärt:",
  "So funktioniert es:",
  "Gute Frage:",
];

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function scoreFaqEntry(entry: FaqEntry, userText: string, promptId?: string): number {
  let score = 0;
  if (promptId && entry.id === promptId) score += 120;
  const lower = userText.toLowerCase();
  for (const kw of entry.keywords) {
    const k = kw.toLowerCase();
    if (lower.includes(k)) score += k.length >= 8 ? 18 : 12;
  }
  const userTokens = tokenize(userText);
  const entryTokens = tokenize(`${entry.id} ${entry.keywords.join(" ")}`);
  for (const t of userTokens) {
    if (entryTokens.has(t)) score += 4;
  }
  // Deprioritize generic "how it works" unless the question is clearly introductory.
  if (entry.id === "how_it_works" && !/\b(what is|how does|work|platform)\b/i.test(lower)) {
    score -= 8;
  }
  if (entry.id === "employee_tips" && /\b(motivation|morale|kpi|metric|increase|grow|compare|cash)\b/i.test(lower)) {
    score -= 14;
  }
  return score;
}

/** Rank FAQ snippets for grounding (highest relevance first). */
export function rankFaqEntries(
  userText: string,
  promptId?: string,
  limit = 4,
): FaqEntry[] {
  const scored = FAQ_ENTRIES.map((entry) => ({
    entry,
    score: scoreFaqEntry(entry, userText, promptId),
  }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 && promptId) {
    const pinned = FAQ_ENTRIES.find((e) => e.id === promptId);
    if (pinned) return [pinned];
  }

  if (scored.length === 0) {
    return [FAQ_ENTRIES.find((e) => e.id === "how_it_works")!].filter(Boolean);
  }

  return scored.slice(0, limit).map((x) => x.entry);
}

export function buildFaqGroundingBlock(entries: FaqEntry[], locale: string): string {
  if (entries.length === 0) return "(No specific FAQ snippet matched; use product context only.)";
  const isDe = locale.toLowerCase().startsWith("de");
  return entries
    .map((e, i) => `[${i + 1}] (${e.id}) ${isDe ? e.de : e.en}`)
    .join("\n");
}

export function getKnowledgeReply(promptId: string | undefined, locale: string): string {
  const isDe = locale.toLowerCase().startsWith("de");
  const entry = promptId ? FAQ_ENTRIES.find((e) => e.id === promptId) : undefined;
  if (entry) return isDe ? entry.de : entry.en;
  const defaultEntry = FAQ_ENTRIES.find((e) => e.id === "how_it_works");
  return isDe ? (defaultEntry?.de ?? DE_DEFAULT) : (defaultEntry?.en ?? EN_DEFAULT);
}

const EN_DEFAULT =
  "CareTip helps hospitality teams collect digital tips via QR codes with live reporting for staff and managers. Ask about setup, pricing, GDPR, or how employees get paid.";
const DE_DEFAULT =
  "CareTip digitalisiert Trinkgelder per QR mit Live-Reporting für Teams und Manager. Fragen Sie zu Setup, Preisen, DSGVO oder Auszahlungen.";

/** Conversational fallback when OpenAI is unavailable (topic-aware, not generic FAQ dump). */
export function composeFallbackReply(input: {
  userText: string;
  locale: string;
  promptId?: string;
}): string {
  const isDe = input.locale.toLowerCase().startsWith("de");
  const ranked = rankFaqEntries(input.userText, input.promptId, 2);
  const intros = isDe ? FALLBACK_INTROS_DE : FALLBACK_INTROS_EN;
  const intro = intros[Math.abs(hashString(input.userText)) % intros.length];

  if (ranked.length === 0) {
    const tail = isDe
      ? " Worüber möchten Sie mehr erfahren: Setup, QR-Codes, Preise oder Auszahlungen?"
      : " What should we dig into next: setup, QR codes, pricing, or payouts?";
    return `${intro} ${getKnowledgeReply(undefined, input.locale)}${tail}`;
  }

  const primary = isDe ? ranked[0].de : ranked[0].en;
  const secondary =
    ranked.length > 1 && ranked[1].id !== ranked[0].id
      ? isDe
        ? ranked[1].de
        : ranked[1].en
      : null;

  const clarify = isDe
    ? " Nennen Sie gern Ihr Szenario (z. B. Restaurant, Hotel, ein oder mehrere Standorte)."
    : " Share your scenario if helpful (e.g. restaurant vs hotel, single or multi-site).";

  if (!secondary) {
    return `${intro} ${primary} ${clarify}`;
  }

  const bridge = isDe ? " Zusätzlich:" : " Also:";
  const secondaryShort =
    secondary.length > 140 ? `${secondary.slice(0, 137).trim()}…` : secondary;
  return `${intro} ${primary} ${bridge} ${secondaryShort} ${clarify}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const OFF_TOPIC =
  /\b(write\s+code|homework|weather|bitcoin|crypto|stock|recipe|joke|poem|politics|dating|medical\s+advice)\b/i;

/** Only block clearly abusive/off-scope requests; product questions go to the model. */
export function isLikelyOffTopic(message: string): boolean {
  const m = message.trim();
  if (m.length < 8) return false;
  return OFF_TOPIC.test(m);
}
