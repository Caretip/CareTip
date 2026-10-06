/** Local composer-only state for the CareTip product feedback modal (never historical DB rows). */

export type ProductFeedbackComposerState = {
  rating: number;
  comment: string;
  submitting: boolean;
  showSuccess: boolean;
};

export function emptyProductFeedbackComposerState(): ProductFeedbackComposerState {
  return {
    rating: 0,
    comment: "",
    submitting: false,
    showSuccess: false,
  };
}

export function resetProductFeedbackComposerState(
  state: ProductFeedbackComposerState,
): ProductFeedbackComposerState {
  return emptyProductFeedbackComposerState();
}
