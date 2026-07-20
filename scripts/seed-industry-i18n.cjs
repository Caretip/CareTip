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
  headline: "Appreciation that travels with you, cashless on every job.",
  subhead:
    "Give customers an easy way to tip after on-site work. Show a QR on your phone, van, or card. No cash, no awkward moments.",
  cta: "Start for free now",
  heroAlt: "Field service professional ready for on-site tipping with CareTip",
  stepsTitle: "The process",
  steps: {
    s1Title: "Show your QR",
    s1Body: "On your phone, van door, or business card after the job is done.",
    s2Title: "Customer scans & pays",
    s2Body: "No app download. Apple Pay, Google Pay, or card in seconds.",
    s3Title: "Tip lands with you",
    s3Body: "Funds go to the right technician, documented and transparent.",
  },
  benefitsTitle: "The 3 top benefits",
  benefitsAlt: "CareTip QR ready for on-site field service visits",
  benefits: {
    b1Title: "On-site tipping",
    b1Body: "Show a QR when the work is finished, and tip in the moment of appreciation.",
    b2Title: "Per-technician codes",
    b2Body: "Keep tips fair across solo pros and multi-van crews.",
    b3Title: "Light setup",
    b3Body: "Go live without terminals or heavy hardware. Paper or phone is enough.",
  },
  faq: {
    q1: "Does the customer need an app?",
    a1: "No. A smartphone camera scan is enough.",
    q2: "Can each technician have their own QR?",
    a2: "Yes. Create individual codes or a shared crew pool. You choose.",
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
  headline: "Wertschätzung, die mitgeht, bargeldlos nach jedem Einsatz.",
  subhead:
    "Gib Kundinnen und Kunden eine einfache Möglichkeit, nach dem Vor-Ort-Termin Trinkgeld zu geben. QR auf Handy, Fahrzeug oder Karte. Ohne Bargeld und ohne peinliche Momente.",
  cta: "Jetzt kostenlos starten",
  heroAlt: "Außendienst-Profi bereit für Trinkgeld vor Ort mit CareTip",
  stepsTitle: "Der Ablauf",
  steps: {
    s1Title: "QR zeigen",
    s1Body: "Auf dem Handy, der Fahrzeugtür oder der Visitenkarte nach dem Einsatz.",
    s2Title: "Kunde scannt & zahlt",
    s2Body: "Ohne App. Apple Pay, Google Pay oder Karte in Sekunden.",
    s3Title: "Trinkgeld kommt an",
    s3Body: "Das Geld landet bei der richtigen Person, dokumentiert und transparent.",
  },
  benefitsTitle: "Die 3 Top-Vorteile",
  benefitsAlt: "CareTip-QR bereit für Vor-Ort-Einsätze im Außendienst",
  benefits: {
    b1Title: "Trinkgeld vor Ort",
    b1Body: "QR zeigen, wenn die Arbeit erledigt ist: Wertschätzung im Moment.",
    b2Title: "Codes pro Techniker",
    b2Body: "Fair und klar für Einzelprofis und Mehrwagen-Teams.",
    b3Title: "Leichtes Setup",
    b3Body: "Ohne Terminals oder schwere Hardware. Papier oder Handy reicht.",
  },
  faq: {
    q1: "Braucht der Kunde eine App?",
    a1: "Nein. Ein Scan mit der Smartphone-Kamera genügt.",
    q2: "Kann jede Person einen eigenen QR haben?",
    a2: "Ja. Individuelle Codes oder ein gemeinsamer Team-Pool. Du entscheidest.",
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
  eyebrow: "IN USE EVERYWHERE...",
  overviewHeadline: "CareTip adapts to your industry.",
  overviewSubheadline:
    "Discover how easy digital tipping works in your field.\nClick on any industry to see the details.",
  teasersAria: "All industries",
  learnMore: "Learn more",
  cards: {
    gastronomy: {
      title: "Gastronomy",
      body: "Fast tipping via QR code directly at table.",
    },
    hotels: {
      title: "Hotels & Hospitality",
      body: "For room service, front desk & concierge staff.",
    },
    logistics: {
      title: "Logistics",
      body: "Rewards for couriers and delivery drivers.",
    },
    midwives: {
      title: "Midwives",
      body: "Easy appreciation after home visits.",
    },
    fairs: {
      title: "Trade Fairs & Events",
      body: "Perfect for on-site service teams.",
    },
    "field-service": {
      title: "Field Service & Care",
      body: "The mobile solution for crews out in the field.",
    },
  },
};

const teaserDe = {
  eyebrow: "ÜBERALL DORT IM EINSATZ...",
  overviewHeadline: "CareTip passt sich Ihrer Branche an.",
  overviewSubheadline:
    "Entdecken Sie, wie einfach digitales Trinkgeld in Ihrem Bereich funktioniert.\nEin Klick bringt Sie zu den Details.",
  teasersAria: "Alle Branchen",
  learnMore: "Mehr erfahren",
  cards: {
    gastronomy: {
      title: "Gastronomie",
      body: "Trinkgeld per QR-Code direkt am Tisch.",
    },
    hotels: {
      title: "Hotellerie",
      body: "Für Zimmerservice, Rezeption & Concierge.",
    },
    logistics: {
      title: "Logistik",
      body: "Belohnung für Paketboten & Lieferdienste.",
    },
    midwives: {
      title: "Hebammen",
      body: "Wertschätzung nach dem Hausbesuch.",
    },
    fairs: {
      title: "Messen & Events",
      body: "Perfekt für temporäre Service-Teams vor Ort.",
    },
    "field-service": {
      title: "Außendienst & Pflege",
      body: "Die mobile Lösung für Kräfte im Einsatz.",
    },
  },
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
