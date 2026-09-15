import { localizeFeedbackTag } from "../src/app/lib/feedbackTagLabels.ts";

const en: Record<string, string> = {
  "tipFlow.rating.tags.excellentService": "Excellent service",
  "tipFlow.rating.tags.veryFriendly": "Very friendly",
  "tipFlow.rating.tags.fastProfessional": "Fast and professional",
  "tipFlow.rating.tags.attentive": "Attentive",
};
const de: Record<string, string> = {
  "tipFlow.rating.tags.excellentService": "Hervorragender Service",
  "tipFlow.rating.tags.veryFriendly": "Sehr freundlich",
  "tipFlow.rating.tags.fastProfessional": "Schnell und professionell",
  "tipFlow.rating.tags.attentive": "Aufmerksam",
};

function tFor(table: Record<string, string>) {
  return (key: string) => table[key] ?? key;
}

const enT = tFor(en);
const deT = tFor(de);

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(localizeFeedbackTag("Excellent service", enT) === "Excellent service", "en api");
assert(localizeFeedbackTag("Excellent service", deT) === "Hervorragender Service", "de api");
assert(localizeFeedbackTag("excellentService", deT) === "Hervorragender Service", "de seed key");
assert(localizeFeedbackTag("Custom guest note", deT) === "Custom guest note", "custom passthrough");
assert(localizeFeedbackTag("Excellent service", enT) !== "excellentService", "does not use db key as label");

console.log("feedbackTagLabels.unit.ts: ok");
