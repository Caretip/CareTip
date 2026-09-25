import mariatesterinImg from "@/assets/landing/customerjourney/mariatesterin.webp";
import teamselectionImg from "@/assets/landing/customerjourney/teamselection.webp";
import tipamountImg from "@/assets/landing/customerjourney/tipamount.webp";
import tipsuccessImg from "@/assets/landing/customerjourney/tipsuccess.webp";

const JOURNEY_IMAGE_SRCS = [mariatesterinImg, teamselectionImg, tipamountImg, tipsuccessImg] as const;

/** Decode journey WebPs early so the row does not populate one mockup at a time. */
export function warmLandingCustomerJourneyImages(priority: "high" | "low" = "low"): void {
  if (typeof window === "undefined") return;

  for (const src of JOURNEY_IMAGE_SRCS) {
    const img = new Image();
    img.decoding = "async";
    if (priority === "high") {
      img.setAttribute("fetchpriority", "high");
    }
    img.src = src;
  }
}
