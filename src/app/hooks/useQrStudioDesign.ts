/**
 * Branding Studio editor — thin wrapper over BusinessBrandingProvider.
 * All branding ownership lives in the provider; this hook only consumes it.
 */

import {
  useBusinessBrandingEditor,
  QR_STUDIO_SAMPLE_URL,
  type BusinessBrandingEditorState,
  type BusinessBrandingEditorActions,
} from "../contexts/BusinessBrandingContext";

export { QR_STUDIO_SAMPLE_URL };
export type QrStudioDesignState = BusinessBrandingEditorState;
export type QrStudioDesignActions = BusinessBrandingEditorActions;

/** opts are ignored — branding is owned by BusinessBrandingProvider. */
export function useQrStudioDesign(_opts?: {
  businessId?: string | null;
  businessName?: string;
  canEdit?: boolean;
}): BusinessBrandingEditorState & BusinessBrandingEditorActions {
  return useBusinessBrandingEditor();
}
