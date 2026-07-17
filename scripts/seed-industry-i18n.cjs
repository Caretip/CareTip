/**
 * Seed / restore industry marketing i18n + client-friendly nav labels.
 * Re-runnable. Only touches nav industries keys, industries.*, landing.industriesTeaser.
 */
const fs = require("fs");
const path = require("path");
const { enPages, dePages } = require("./patch-industry-guideline-copy.cjs");

const root = path.join(__dirname, "../src/i18n/locales");

const fieldServiceEn = {
  pageAria: "CareTip for field service and trades",
  eyebrow: "For field service & trades",
  headline: "Appreciation that travels with you — cashless on every job.",
  subhead:
    "Give customers an easy way to tip after on-site work. Show a QR on your phone, van, or card — no cash, no awkward moments.",
  cta: "Start for free now",
  heroAlt: "Field service professional ready for on-site tipping with CareTip",
  stepsTitle: "The process",
  steps: {
    s1Title: "Show your QR",
    s1Body: "On your phone, van door, or business card after the job is done.",
    s2Title: "Customer scans & pays",
    s2Body: "No app download — Apple Pay, Google Pay, or card in seconds.",
    s3Title: "Tip lands with you",
    s3Body: "Funds go to the right technician, documented and transparent.",
  },
  benefitsTitle: "The 3 top benefits",
  benefitsAlt: "CareTip QR ready for on-site field service visits",
  benefits: {
    b1Title: "On-site tipping",
    b1Body: "Show a QR when the work is finished — tip in the moment of appreciation.",
    b2Title: "Per-technician codes",
    b2Body: "Keep tips fair across solo pros and multi-van crews.",
    b3Title: "Light setup",
    b3Body: "Go live without terminals or heavy hardware — paper or phone is enough.",
  },
  faq: {
    q1: "Does the customer need an app?",
    a1: "No. A smartphone camera scan is enough.",
    q2: "Can each technician have their own QR?",
    a2: "Yes. Create individual codes or a shared crew pool — you choose.",
  },
  floats: {
    f1Title: "Job done",
    f1Value: "Tip ready",
    f2Title: "On-site tip",
    f2Value: "€15.00",
    f3Title: "Crew today",
    f3Value: "Synced",
  },
};

const fieldServiceDe = {
  pageAria: "CareTip für Außendienst und Handwerk",
  eyebrow: "Für Außendienst & Handwerk",
  headline: "Wertschätzung, die mitgeht — bargeldlos nach jedem Einsatz.",
  subhead:
    "Gib Kundinnen und Kunden eine einfache Möglichkeit, nach dem Vor-Ort-Termin Trinkgeld zu geben. QR auf Handy, Fahrzeug oder Karte — ohne Bargeld und ohne peinliche Momente.",
  cta: "Jetzt kostenlos starten",
  heroAlt: "Außendienst-Profi bereit für Trinkgeld vor Ort mit CareTip",
  stepsTitle: "Der Ablauf",
  steps: {
    s1Title: "QR zeigen",
    s1Body: "Auf dem Handy, der Fahrzeugtür oder der Visitenkarte nach dem Einsatz.",
    s2Title: "Kunde scannt & zahlt",
    s2Body: "Ohne App — Apple Pay, Google Pay oder Karte in Sekunden.",
    s3Title: "Trinkgeld kommt an",
    s3Body: "Das Geld landet bei der richtigen Person — dokumentiert und transparent.",
  },
  benefitsTitle: "Die 3 Top-Vorteile",
  benefitsAlt: "CareTip-QR bereit für Vor-Ort-Einsätze im Außendienst",
  benefits: {
    b1Title: "Trinkgeld vor Ort",
    b1Body: "QR zeigen, wenn die Arbeit erledigt ist — Wertschätzung im Moment.",
    b2Title: "Codes pro Techniker",
    b2Body: "Fair und klar für Einzelprofis und Mehrwagen-Teams.",
    b3Title: "Leichtes Setup",
    b3Body: "Ohne Terminals oder schwere Hardware — Papier oder Handy reicht.",
  },
  faq: {
    q1: "Braucht der Kunde eine App?",
    a1: "Nein. Ein Scan mit der Smartphone-Kamera genügt.",
    q2: "Kann jede Person einen eigenen QR haben?",
    a2: "Ja. Individuelle Codes oder ein gemeinsamer Team-Pool — du entscheidest.",
  },
  floats: {
    f1Title: "Auftrag erledigt",
    f1Value: "Trinkgeld bereit",
    f2Title: "Vor-Ort-Trinkgeld",
    f2Value: "15,00 €",
    f3Title: "Crew heute",
    f3Value: "Synchron",
  },
};

function fixDeTipWording(pages) {
  const walk = (obj) => {
    if (typeof obj === "string") {
      return obj
        .replace(/\bTipp\b/g, "Trinkgeld")
        .replace(/Familien-Tipp/g, "Familien-Trinkgeld")
        .replace(/Stand-Tipp/g, "Stand-Trinkgeld")
        .replace(/Check-out-Tipp/g, "Check-out-Trinkgeld")
        .replace(/Delivery-Tipp/g, "Liefer-Trinkgeld")
        .replace(/Vor-Ort-Tipp/g, "Vor-Ort-Trinkgeld");
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = walk(v);
      return out;
    }
    return obj;
  };
  return walk(pages);
}

const sharedEn = {
  benefitsEyebrow: "Why CareTip",
  faqTitle: "Top FAQs",
  trustAria: "Trust and compliance",
  trust: {
    gdpr: "GDPR-ready",
    tax: "Tax-compliant tips",
    stripe: "Secure payments via Stripe",
  },
  moreIndustriesTitle: "Explore other industries",
  moreIndustriesBody: "See how CareTip fits teams like yours.",
  finalCtaTitle: "Ready to get started?",
  finalCtaBody: "Create your free account and set up your first QR in minutes.",
  finalCtaButton: "Start for free",
  finalCtaSecondary: "View pricing",
};

const sharedDe = {
  benefitsEyebrow: "Warum CareTip",
  faqTitle: "Die Top-FAQs",
  trustAria: "Vertrauen und Compliance",
  trust: {
    gdpr: "DSGVO-konform",
    tax: "Steuerkonforme Trinkgelder",
    stripe: "Sichere Zahlungen über Stripe",
  },
  moreIndustriesTitle: "Weitere Branchen entdecken",
  moreIndustriesBody: "So passt CareTip zu Teams wie deinem.",
  finalCtaTitle: "Bereit loszulegen?",
  finalCtaBody: "Erstelle dein kostenloses Konto und richte deinen ersten QR in Minuten ein.",
  finalCtaButton: "Jetzt kostenlos starten",
  finalCtaSecondary: "Preise ansehen",
};

const teaserEn = {
  headline: "Take your team to the next level.",
  subheadline: "More motivation. Less turnover. Full shifts.",
  benefitsAria: "Core CareTip benefits",
  b1Title: "Everyday usability",
  b1Body: "Use QR codes at tables, stations, or directly on the go.",
  b2Title: "Full transparency",
  b2Body: "Track tips in real-time & pay out securely via Apple/Google Pay.",
  b3Title: "Motivation boost",
  b3Body: "Boost appreciation for every shift and the entire team.",
  teasersLabel: "Perfect for mobile teams…",
  teasersAria: "Featured industries",
  teaser1Title: "Midwife care",
  teaser1Body:
    "Cashless tips during postpartum home visits – simple and easy via a custom QR code.",
  teaser1Alt: "Midwife visiting a family with a CareTip QR business card",
  teaser2Title: "Field service & care",
  teaser2Body: "The perfect tip solution for mobile teams, crafts, and on-site care workers.",
  teaser2Alt: "Field service professional with CareTip QR for on-site tipping",
  learnMore: "Learn more",
};

const teaserDe = {
  headline: "Bring dein Team aufs nächste Level.",
  subheadline: "Mehr Motivation. Weniger Fluktuation. Volle Schichten.",
  benefitsAria: "Zentrale CareTip-Vorteile",
  b1Title: "Alltagstauglich",
  b1Body: "QR-Codes für Tisch, Station oder direkt auf Tour nutzen.",
  b2Title: "Voller Durchblick",
  b2Body: "Trinkgelder in Echtzeit sehen & sicher auszahlen per Apple/Google Pay.",
  b3Title: "Motivations-Boost",
  b3Body: "Mehr Anerkennung für jede Schicht und das gesamte Team.",
  teasersLabel: "Überall dort im Einsatz…",
  teasersAria: "Ausgewählte Branchen",
  teaser1Title: "Hebammen-Betreuung",
  teaser1Body:
    "Trinkgeld im Wochenbett nach dem Hausbesuch – komplett bargeldlos per QR-Code.",
  teaser1Alt: "Hebamme bei einer Familie mit CareTip-QR-Visitenkarte",
  teaser2Title: "Außendienst & Pflege",
  teaser2Body: "Die perfekte Lösung für mobile Teams, Handwerk & Pflegekräfte vor Ort.",
  teaser2Alt: "Außendienst-Profi mit CareTip-QR für Trinkgeld vor Ort",
  learnMore: "Mehr erfahren",
};

function patch(file, lang) {
  const full = path.join(root, file);
  const data = JSON.parse(fs.readFileSync(full, "utf8"));

  data.nav.industries = lang === "en" ? "Industries" : "Branchen";
  data.nav.industriesMenu = {
    gastronomy: lang === "en" ? "Gastronomy" : "Gastronomie",
    hotels: lang === "en" ? "Hotels" : "Hotellerie",
    logistics: lang === "en" ? "Logistics" : "Logistik",
    midwives: lang === "en" ? "Midwives" : "Hebammen",
    fairs: lang === "en" ? "Events" : "Events & Messen",
    "field-service": lang === "en" ? "Field service" : "Außendienst",
  };

  const pages =
    lang === "en"
      ? { ...enPages, "field-service": fieldServiceEn }
      : fixDeTipWording({ ...dePages, "field-service": fieldServiceDe });

  data.industries = {
    shared: lang === "en" ? sharedEn : sharedDe,
    pages,
  };

  data.landing.industriesTeaser = lang === "en" ? teaserEn : teaserDe;

  fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
  console.log("seeded", file);
}

patch("en.json", "en");
patch("de.json", "de");
