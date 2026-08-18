import { PhysicalBrandingStudio } from "../../../components/business/physical-branding/PhysicalBrandingStudio";
import { useRequireAuth } from "../../../hooks/useRequireAuth";

/** QR Studio Branding is physical A5 print. Digital designer stays available elsewhere. */
export function QrStudioBrandingPage() {
  useRequireAuth();
  return <PhysicalBrandingStudio />;
}
