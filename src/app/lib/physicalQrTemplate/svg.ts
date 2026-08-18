import authoredCareTipA5Svg from "../../../assets/physical-qr/caretip-a5.svg?raw";
import { injectPhysicalQrSvg } from "./inject";
import type { PhysicalQrRenderInput } from "./types";

export { escapePhysicalQrXml } from "./inject";

/**
 * Injects live nodes into the authored A5 SVG.
 * Production source: `src/assets/physical-qr/caretip-a5.svg`.
 */
export function renderPhysicalQrSvg(input: PhysicalQrRenderInput): string {
  return injectPhysicalQrSvg(authoredCareTipA5Svg, input);
}
