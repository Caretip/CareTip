export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export const MOBILE_FAQ_ITEMS: FaqItem[] = [
  {
    id: "what-is-caretip",
    question: "What is CareTip?",
    answer:
      "CareTip is a digital tipping platform built for hospitality and service teams. Guests scan a QR code and tip securely in seconds — no cash, no app download required for guests.",
  },
  {
    id: "how-tips-work",
    question: "How do tips reach employees?",
    answer:
      "Tips are processed securely through Stripe and attributed to the right team member or venue QR. Employees can track earnings in their CareTip dashboard.",
  },
  {
    id: "is-secure",
    question: "Is CareTip secure?",
    answer:
      "Yes. Payments run through Stripe Checkout with industry-standard encryption. CareTip never stores full card details on our servers.",
  },
  {
    id: "invite-code",
    question: "How do I join with an invite code?",
    answer:
      "Your manager sends an invite. Open Register or Enter Invite Code from the sign-in screen, enter the code, and complete your profile.",
  },
  {
    id: "qr-branded",
    question: "Why does my QR look different in the app?",
    answer:
      "Your branded QR is rendered by CareTip’s shared backend — the same artwork used on the web. The mobile app displays that image exactly as produced.",
  },
  {
    id: "forgot-password",
    question: "I forgot my password. What should I do?",
    answer:
      "Tap Forgot password on the login screen to reset securely through CareTip’s web recovery flow, then return to the app to sign in.",
  },
  {
    id: "support",
    question: "How do I contact support?",
    answer:
      "Use Contact Us in Explore CareTip, or email support@caretip.de. Business customers can also open a support ticket from the Contact screen.",
  },
];

export const ABOUT_CONTENT = {
  storyTitle: "Two cities. One mission.",
  storyBody:
    "CareTip was founded by Albertina & Fanny — Berliners with a deep love for hospitality. After experiencing effortless digital tipping in London, they built CareTip so service teams in Europe can receive appreciation that actually reaches their accounts.",
  missionTitle: "Mission",
  missionBody:
    "Make tipping effortless, fair, and transparent — so every guest thank-you becomes real recognition for the people who deliver great service.",
  visionTitle: "Vision",
  visionBody:
    "A world where hospitality and care work are celebrated digitally — premium for guests, empowering for teams, and trusted by venues.",
  copyright: `© ${new Date().getFullYear()} CareTip. All rights reserved.`,
} as const;

export const CONTACT_CHANNELS = [
  {
    id: "whatsapp",
    title: "WhatsApp",
    subtitle: "Chat with CareTip support",
    icon: "logo-whatsapp" as const,
    href: "https://wa.me/4915200000000",
  },
  {
    id: "email",
    title: "Email",
    subtitle: "support@caretip.de",
    icon: "mail-outline" as const,
    href: "mailto:support@caretip.de",
  },
  {
    id: "ticket",
    title: "Support ticket",
    subtitle: "Open a request on caretip.de",
    icon: "ticket-outline" as const,
    href: "/contact?intent=support",
  },
  {
    id: "phone",
    title: "Phone",
    subtitle: "+49 (0) 30 000000 (Mon–Fri)",
    icon: "call-outline" as const,
    href: "tel:+49300000000",
  },
] as const;

export const BUSINESS_HOURS = [
  { day: "Monday – Friday", hours: "09:00 – 18:00 CET" },
  { day: "Saturday", hours: "10:00 – 14:00 CET" },
  { day: "Sunday", hours: "Closed" },
] as const;
