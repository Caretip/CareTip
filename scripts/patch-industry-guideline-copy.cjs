const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../src/i18n/locales");

const enPages = {
  gastronomy: {
    pageAria: "CareTip for gastronomy and service teams",
    eyebrow: "For gastronomy & service teams",
    headline: "More tips for your team. Zero hassle for your restaurant.",
    subhead:
      "Delight your guests with cashless tipping via QR code directly at the table. 100% tax-free, lightning-fast, and without any expensive additional hardware.",
    cta: "Start for free now",
    heroAlt:
      "A smiling waiter in a restaurant showing a guest a receipt with the CareTip QR code",
    stepsTitle: "The process",
    steps: {
      s1Title: "Place the QR code",
      s1Body: "On the table, the receipt, or as a counter display.",
      s2Title: "Guest scans & pays",
      s2Body:
        "No app download required, works directly with Apple Pay, Google Pay, or Creditcard.",
      s3Title: "Real-time payout",
      s3Body: "The tip goes directly and tax-free to the waiter.",
    },
    benefitsTitle: "The 3 top benefits",
    benefitsAlt: "CareTip QR code ready for table-side tipping in a restaurant",
    benefits: {
      b1Title: "Faster service",
      b1Body: "No more waiting around to process tips on card terminals.",
      b2Title: "Happier staff",
      b2Body: "Significantly higher tips due to the easy, frictionless cashless option.",
      b3Title: "100% Tax-free",
      b3Body:
        "Fully automated, tax-compliant allocation directly to individual staff accounts.",
    },
    faq: {
      q1: "Does the guest need to download an app?",
      a1: "No. A simple scan with their smartphone camera is all it takes.",
      q2: "How are tips distributed?",
      a2: "You decide: Either directly to the specific waiter or pooled for the whole team.",
    },
    floats: {
      f1Title: "Payment success",
      f1Value: "Tip paid",
      f2Title: "Tip received",
      f2Value: "€8.50",
      f3Title: "Tonight",
      f3Value: "+24% tips",
    },
  },
  hotels: {
    pageAria: "CareTip for hotels",
    eyebrow: "For hotels",
    headline: "Discrete appreciation at the front desk and in housekeeping.",
    subhead:
      "Provide your guests with a classy, digital way to tip your concierge, cleaning staff, and reception team. Seamlessly integrated on counter displays or key card sleeves.",
    cta: "Register your hotel now",
    heroAlt:
      "An elegant hotel reception desk with a subtle CareTip display next to the payment terminal while a guest is checking in",
    stepsTitle: "The process",
    steps: {
      s1Title: "Discreet placement",
      s1Body: "As a stylish display at reception or placed subtly in the guest rooms.",
      s2Title: "Simple scan",
      s2Body: "Guests reward the service directly via their smartphones.",
      s3Title: "Central management",
      s3Body:
        "Hotel management maintains full transparency over all departments in the dashboard.",
    },
    benefitsTitle: "The 3 top benefits",
    benefitsAlt: "Hotel reception desk ready for cashless guest tipping",
    benefits: {
      b1Title: "More appreciation for housekeeping",
      b1Body: "Guests can finally tip the cleaning crew digitally.",
      b2Title: "Seamless integration",
      b2Body: "Fits perfectly with your hotel's aesthetic, with no clunky hardware.",
      b3Title: "Zero bureaucracy",
      b3Body: "Automated, one-click exports for accounting.",
    },
    faq: {
      q1: "Can guests tip specific departments?",
      a1: "Yes. You can generate separate QR codes for reception, housekeeping, or valet.",
      q2: "Is the system secure for international guests?",
      a2: "Absolutely. We support global payment methods including Visa, Mastercard, Apple Pay, and Google Pay.",
    },
    floats: {
      f1Title: "Check-out tip",
      f1Value: "Confirmed",
      f2Title: "Housekeeping",
      f2Value: "€12.00",
      f3Title: "This week",
      f3Value: "148 tips",
    },
  },
  logistics: {
    pageAria: "CareTip for logistics and delivery services",
    eyebrow: "For logistics & delivery services",
    headline: 'A digital "Thank you" right at the doorstep.',
    subhead:
      "Give your drivers and delivery agents the recognition they deserve. With a quick scan on the package, vehicle, or handheld scanner, they receive their tips directly on their smartphones.",
    cta: "Register your depot now",
    heroAlt:
      "A friendly delivery driver in front of their delivery van with a clearly visible CareTip QR code sticker on it",
    stepsTitle: "The process",
    steps: {
      s1Title: "Visible placement",
      s1Body: "Stick the QR code on the vehicle, the parcel, via E-Mail or the driver's badge.",
      s2Title: "Split-second scan",
      s2Body: "The customer scans the code at the doorstep or on the go.",
      s3Title: "Instant joy",
      s3Body: "The tip is credited to the driver immediately.",
    },
    benefitsTitle: "The 3 top benefits",
    benefitsAlt: "Branded CareTip QR code for delivery and logistics teams",
    benefits: {
      b1Title: "Staff booster",
      b1Body:
        "Drastically increases driver motivation through direct feedback and extra earnings.",
      b2Title: "No cash required",
      b2Body: "Customers no longer need to scramble for coins when the doorbell rings.",
      b3Title: "Safe and quick",
      b3Body: "Zero distraction. The scan takes less than 3 seconds.",
    },
    faq: {
      q1: "Does this work with subcontractors?",
      a1: "Yes. You can flexibly assign drivers and manage routes with ease.",
      q2: "Can customers leave feedback?",
      a2: "Yes, alongside the tip, customers can leave a star rating to highlight outstanding service.",
    },
    floats: {
      f1Title: "Delivery tip",
      f1Value: "Received",
      f2Title: "Driver payout",
      f2Value: "€5.00",
      f3Title: "Live route",
      f3Value: "On track",
    },
  },
  midwives: {
    pageAria: "CareTip for freelance midwives",
    eyebrow: "For midwives",
    headline: "More appreciation for your dedication, cashless during home visits.",
    subhead:
      "Receive tips and tokens of appreciation from grateful families contactlessly via QR code on your business card. 100% secure, tax-free, and without the hassle of carrying cash.",
    cta: "Start as a midwife now",
    heroAlt:
      "A midwife visiting a happy young family at home, smiling and presenting her business card with the integrated QR code",
    stepsTitle: "The process",
    steps: {
      s1Title: "Hand over your card",
      s1Body:
        "Your personal QR code is elegantly integrated on your business card or info folder.",
      s2Title: "Relaxed scanning",
      s2Body: "Grateful families scan the code in their own time from the comfort of their couch.",
      s3Title: "Tax-free payouts",
      s3Body: "Tokens of appreciation arrive directly in your bank account, fully documented.",
    },
    benefitsTitle: "The 3 top benefits",
    benefitsAlt: "Business card with CareTip QR code for midwife home visits",
    benefits: {
      b1Title: "No awkward cash talk",
      b1Body: "Families can say thank you without searching for cash or paper envelopes.",
      b2Title: "GDPR-compliant",
      b2Body: "Maximum data security and privacy for you and the families you care for.",
      b3Title: "Fits in your pocket",
      b3Body: "No heavy hardware required: just your QR code on paper or your phone screen.",
    },
    faq: {
      q1: "Are these tips tax-free?",
      a1: "Yes, personal gifts and voluntary tips for midwife professionals are tax-free in Germany.",
      q2: "Can families see my bank details?",
      a2: "No. The payment process is completely anonymized via Stripe. Your bank details remain strictly private.",
    },
    floats: {
      f1Title: "Visit complete",
      f1Value: "Thank you",
      f2Title: "Family tip",
      f2Value: "€20.00",
      f3Title: "This month",
      f3Value: "Secure payout",
    },
  },
  fairs: {
    pageAria: "CareTip for events, hostesses, and trade shows",
    eyebrow: "For events",
    headline: "Reward peak performance at events, trade shows, and promotions.",
    subhead:
      "Make outstanding service at major events instantly rewardable. Your event staff collects tips and feedback in real-time using personalized badges or QR codes at the counters.",
    cta: "Set up event team now",
    heroAlt:
      "Professionally dressed trade show hostesses at a stylish reception counter with subtle QR code badges on their uniforms",
    stepsTitle: "The process",
    steps: {
      s1Title: "Personalized badge",
      s1Body: "Each team member wears a subtle QR code on their name tag.",
      s2Title: "Instant feedback",
      s2Body: "Visitors scan the code at the booth right after an interaction.",
      s3Title: "Live analytics",
      s3Body: "Project managers track team performance and feedback in real-time.",
    },
    benefitsTitle: "The 3 top benefits",
    benefitsAlt: "Mobile tipping experience for event and trade-show teams",
    benefits: {
      b1Title: "Make performance visible",
      b1Body: "Instantly identify which team members are driving the most engagement.",
      b2Title: "Digital feedback loop",
      b2Body: "Use the ratings tool to measure visitor satisfaction live on the show floor.",
      b3Title: "Rapid onboarding",
      b3Body: "Set up profiles for rotating event crews within minutes.",
    },
    faq: {
      q1: "How long does setup take for an event?",
      a1: "Less than 5 minutes. Just upload your team list, and the QR codes are ready to print or display.",
      q2: "Can we customize the branding?",
      a2: "Yes. Starting from the Pro Package the tipping pages can be customized to match the corporate design of the exhibiting client.",
    },
    floats: {
      f1Title: "Booth tip",
      f1Value: "Paid",
      f2Title: "Hostess team",
      f2Value: "€9.00",
      f3Title: "Fair day",
      f3Value: "Live",
    },
  },
};

const dePages = {
  gastronomy: {
    pageAria: "CareTip für Gastronomie und Service-Teams",
    eyebrow: "Für Gastronomie & Service-Teams",
    headline: "Mehr Trinkgeld für dein Team. Null Aufwand für dein Restaurant.",
    subhead:
      "Begeistere deine Gäste mit bargeldlosem Bezahlen per QR-Code direkt am Tisch. Garantiert steuerfrei, sekundenschnell und ohne teure Zusatz-Hardware.",
    cta: "Jetzt kostenlos starten",
    heroAlt:
      "Ein lächelnder Kellner im Restaurant zeigt einem Gast einen Beleg mit dem CareTip-QR-Code",
    stepsTitle: "Der Ablauf",
    steps: {
      s1Title: "QR-Code platzieren",
      s1Body: "Am Tisch, auf der Rechnung oder als Aufsteller.",
      s2Title: "Gast scannt & zahlt",
      s2Body: "Ohne App-Download, direkt mit Apple Pay, Google Pay oder Kreditkarte.",
      s3Title: "Echtzeit-Auszahlung",
      s3Body: "Das Trinkgeld landet direkt und steuerfrei beim Kellner.",
    },
    benefitsTitle: "Die 3 Top-Vorteile",
    benefitsAlt: "CareTip-QR-Code bereit für Trinkgeld am Tisch",
    benefits: {
      b1Title: "Schnellerer Service",
      b1Body: "Keine Wartezeiten mehr beim Suchen nach dem EC-Gerät für Trinkgelder.",
      b2Title: "Glücklicheres Personal",
      b2Body: "Deutlich höhere Trinkgelder durch die einfache, bargeldlose Option.",
      b3Title: "100% Steuerfrei",
      b3Body:
        "Vollautomatische, finanzamtskonforme Zuordnung direkt auf die Mitarbeiterkonten.",
    },
    faq: {
      q1: "Muss der Gast eine App herunterladen?",
      a1: "Nein. Ein einfacher Scan mit der Smartphone-Kamera genügt.",
      q2: "Wie wird das Trinkgeld aufgeteilt?",
      a2: "Du entscheidest: Entweder geht es direkt an den Kellner des Tisches, oder es fließt in einen gemeinsamen Team-Pool.",
    },
    floats: {
      f1Title: "Zahlung erfolgreich",
      f1Value: "Trinkgeld bezahlt",
      f2Title: "Trinkgeld erhalten",
      f2Value: "8,50 €",
      f3Title: "Heute Abend",
      f3Value: "+24 % Trinkgeld",
    },
  },
  hotels: {
    pageAria: "CareTip für Hotellerie",
    eyebrow: "Für Hotellerie",
    headline: "Diskrete Wertschätzung am Front Desk und im Zimmerservice.",
    subhead:
      "Ermögliche deinen Hotelgästen ein stilvolles, digitales Trinkgeld für Concierge, Housekeeping und Rezeption. Nahtlos integriert als Aufsteller oder auf der Zimmerkarte.",
    cta: "Jetzt Hotel anmelden",
    heroAlt:
      "Elegante Hotelrezeption mit dezentem CareTip-Aufsteller neben dem Zahlungsterminal beim Check-in",
    stepsTitle: "Der Ablauf",
    steps: {
      s1Title: "Dezent platzieren",
      s1Body: "Als stylischer Aufsteller an der Rezeption oder diskret im Zimmer.",
      s2Title: "Einfach scannen",
      s2Body: "Gäste belohnen den Service direkt über ihr Smartphone.",
      s3Title: "Zentral verwalten",
      s3Body:
        "Die Hotelleitung behält im Dashboard die volle Transparenz über alle Stationen.",
    },
    benefitsTitle: "Die 3 Top-Vorteile",
    benefitsAlt: "Hotelrezeption bereit für bargeldloses Gäste-Trinkgeld",
    benefits: {
      b1Title: "Mehr Wertschätzung fürs Housekeeping",
      b1Body: "Endlich können Gäste auch dem Reinigungsteam digital danken.",
      b2Title: "Nahtlose Integration",
      b2Body: "Passt perfekt zum Design deines Hotels, ohne störende Fremdkörper.",
      b3Title: "Kein bürokratischer Aufwand",
      b3Body: "Automatische Exporte für die Buchhaltung auf Knopfdruck.",
    },
    faq: {
      q1: "Können Gäste bestimmten Abteilungen Trinkgeld geben?",
      a1: "Ja. Du kannst separate QR-Codes für Rezeption, Housekeeping oder Gepäckservice erstellen.",
      q2: "Ist das System sicher für internationale Gäste?",
      a2: "Absolut. Wir unterstützen globale Zahlungsmittel wie Visa, Mastercard, Apple Pay und Google Pay.",
    },
    floats: {
      f1Title: "Check-out-Tipp",
      f1Value: "Bestätigt",
      f2Title: "Housekeeping",
      f2Value: "12,00 €",
      f3Title: "Diese Woche",
      f3Value: "148 Tipps",
    },
  },
  logistics: {
    pageAria: "CareTip für Logistik und Lieferdienste",
    eyebrow: "Für Logistik & Lieferdienste",
    headline: "Ein digitales „Danke“ direkt an der Haustür.",
    subhead:
      "Gib deinen Fahrern und Zustellern die Anerkennung, die sie verdienen. Mit einem schnellen Scan auf dem Paket, dem Fahrzeug, Handscanner oder per E-Mail erhalten sie ihr Trinkgeld direkt aufs Smartphone.",
    cta: "Depot jetzt registrieren",
    heroAlt:
      "Ein freundlicher Paketbote vor seinem Lieferfahrzeug mit gut sichtbarem CareTip-QR-Code",
    stepsTitle: "Der Ablauf",
    steps: {
      s1Title: "Sichtbar anbringen",
      s1Body: "QR-Code auf dem Zustellfahrzeug, dem Paket oder der Jacke platzieren.",
      s2Title: "Sekundenschneller Scan",
      s2Body: "Der Kunde scannt den Code an der Haustür oder im Vorbeigehen.",
      s3Title: "Direkte Freude",
      s3Body: "Das Trinkgeld wird dem Fahrer sofort gutgeschrieben.",
    },
    benefitsTitle: "Die 3 Top-Vorteile",
    benefitsAlt: "Branded CareTip-QR-Code für Delivery- und Logistikteams",
    benefits: {
      b1Title: "Mitarbeiter-Booster",
      b1Body:
        "Extrem hohe Motivation für Fahrer durch direktes Feedback und extra Einnahmen.",
      b2Title: "Kein Bargeld-Zwang",
      b2Body: "Kunden müssen nicht mehr panisch nach Münzen suchen, wenn das Paket kommt.",
      b3Title: "Sicher im Straßenverkehr",
      b3Body: "Keine Ablenkung. Der Scan dauert nur 3 Sekunden.",
    },
    faq: {
      q1: "Funktioniert das auch bei Subunternehmern?",
      a1: "Ja. Du kannst Fahrer flexibel zuweisen und Routen unkompliziert verwalten.",
      q2: "Können Kunden Feedback hinterlassen?",
      a2: "Ja, neben dem Trinkgeld können Kunden eine Sternebewertung abgeben, um die Servicequalität sichtbar zu machen.",
    },
    floats: {
      f1Title: "Delivery-Tipp",
      f1Value: "Erhalten",
      f2Title: "Fahrer-Auszahlung",
      f2Value: "5,00 €",
      f3Title: "Live-Tour",
      f3Value: "Im Plan",
    },
  },
  midwives: {
    pageAria: "CareTip für selbstständige Hebammen",
    eyebrow: "Für selbstständige Hebammen",
    headline: "Mehr Wertschätzung für deine Fürsorge, bargeldlos im Hausbesuch.",
    subhead:
      "Empfange Aufmerksamkeiten von dankbaren Familien, ganz einfach kontaktlos per QR-Code auf deiner Visitenkarte. Komplett sicher, steuerfrei und ganz ohne Bargeldstress unterwegs.",
    cta: "Jetzt als Hebamme starten",
    heroAlt:
      "Hebamme bei einer glücklichen jungen Familie zu Hause mit Visitenkarte und integriertem QR-Code",
    stepsTitle: "Der Ablauf",
    steps: {
      s1Title: "Visitenkarte übergeben",
      s1Body:
        "Dein persönlicher QR-Code ist elegant auf deiner Karte oder Infomappe integriert.",
      s2Title: "Entspanntes Scannen",
      s2Body: "Die Familie scannt den Code in Ruhe vom Sofa aus.",
      s3Title: "Steuerfrei empfangen",
      s3Body: "Aufmerksamkeiten landen direkt auf deinem Bankkonto, lückenlos dokumentiert.",
    },
    benefitsTitle: "Die 3 Top-Vorteile",
    benefitsAlt: "Visitenkarte mit CareTip-QR-Code für Hebammenbesuche",
    benefits: {
      b1Title: "Kein unangenehmes Bargeld-Thema",
      b1Body: "Familien können sich ohne Umschläge und Bargeld-Suche bedanken.",
      b2Title: "Absolut DSGVO-konform",
      b2Body: "Höchste Datensicherheit für dich und die betreuten Familien.",
      b3Title: "Passt in die Tasche",
      b3Body: "Keine schwere Hardware: dein QR-Code auf Papier oder auf dem Smartphone reicht.",
    },
    faq: {
      q1: "Sind die Trinkgelder steuerfrei?",
      a1: "Ja, persönliche Schenkungen und Trinkgelder für freiberufliche Hebammen sind in Deutschland steuerfrei.",
      q2: "Sehen die Familien meine Bankdaten?",
      a2: "Nein. Der Bezahlvorgang läuft komplett anonymisiert über Stripe. Deine Kontodaten bleiben absolut geheim.",
    },
    floats: {
      f1Title: "Besuch abgeschlossen",
      f1Value: "Danke",
      f2Title: "Familien-Tipp",
      f2Value: "20,00 €",
      f3Title: "Diesen Monat",
      f3Value: "Sichere Auszahlung",
    },
  },
  fairs: {
    pageAria: "CareTip für Messen, Events und Hostessen",
    eyebrow: "Für Messen, Events & Hostessen",
    headline: "Belohne Spitzenleistung auf Events, Messen und Promotions.",
    subhead:
      "Mach hervorragenden Service bei Großveranstaltungen sofort belohnbar. Dein Event-Team sammelt Trinkgelder und Feedback in Echtzeit über personalisierte Badges oder QR-Codes am Counter.",
    cta: "Jetzt Event-Team anlegen",
    heroAlt:
      "Professionell gekleidete Messe-Hostessen an einem stilvollen Counter mit dezenten QR-Code-Badges",
    stepsTitle: "Der Ablauf",
    steps: {
      s1Title: "Personalisiertes Badge",
      s1Body: "Jedes Teammitglied trägt einen diskreten QR-Code auf dem Namensschild.",
      s2Title: "Schnelles Feedback",
      s2Body: "Besucher scannen den Code am Messestand nach einem Gespräch.",
      s3Title: "Live-Statistiken",
      s3Body: "Projektleiter sehen Performance und Feedback in Echtzeit im Dashboard.",
    },
    benefitsTitle: "Die 3 Top-Vorteile",
    benefitsAlt: "Mobiles Tippen für Event- und Messe-Teams",
    benefits: {
      b1Title: "Leistung sichtbar machen",
      b1Body: "Erkenne sofort, welche Mitarbeiter auf der Messefläche am aktivsten sind.",
      b2Title: "Digitaler Lead-Magnet",
      b2Body: "Nutze das Feedback-Tool, um die Service-Zufriedenheit live zu messen.",
      b3Title: "Einfaches Onboarding",
      b3Body:
        "Profile können innerhalb von Minuten für wechselnde Event-Teams angelegt werden.",
    },
    faq: {
      q1: "Wie lange dauert die Einrichtung für ein Event?",
      a1: "Weniger als 5 Minuten. Du lädst dein Team hoch und die QR-Codes sind sofort einsatzbereit.",
      q2: "Können wir das Branding anpassen?",
      a2: "Ja, ab dem Pro-Paket können die Trinkgeldseiten an das Corporate Design des Messekunden angepasst werden. (Im Basic-Paket leider nicht möglich.)",
    },
    floats: {
      f1Title: "Stand-Tipp",
      f1Value: "Bezahlt",
      f2Title: "Hostessen-Team",
      f2Value: "9,00 €",
      f3Title: "Messetag",
      f3Value: "Live",
    },
  },
};

module.exports = { enPages, dePages };

// Optional CLI: node scripts/patch-industry-guideline-copy.cjs
if (require.main === module) {
  function patch(file, pages, lang) {
    const full = path.join(root, file);
    const data = JSON.parse(fs.readFileSync(full, "utf8"));

    data.industries.shared.faqTitle = lang === "en" ? "Top FAQs" : "Die Top-FAQs";

    for (const [id, content] of Object.entries(pages)) {
      data.industries.pages[id] = {
        ...data.industries.pages[id],
        ...content,
      };
      delete data.industries.pages[id].testimonial;
      delete data.industries.pages[id].faq?.q3;
      delete data.industries.pages[id].faq?.a3;
    }

    if (data.industries.pages["field-service"]?.faq) {
      delete data.industries.pages["field-service"].faq.q3;
      delete data.industries.pages["field-service"].faq.a3;
    }

    fs.writeFileSync(full, JSON.stringify(data, null, 2) + "\n");
    console.log("patched", file);
  }

  patch("en.json", enPages, "en");
  patch("de.json", dePages, "de");
}