/**
 * Class S setup-prompt intelligence client.
 * Server owns dismiss/snooze/resolve — never sessionStorage for these kinds.
 */
import {
  actionSetupPromptApi,
  dismissSetupPromptApi,
  evaluateSetupPromptsApi,
  type SetupPromptEvaluateItem,
  type SetupPromptKind,
  type SetupPromptVisibilityResult,
} from "./api";

export type { SetupPromptKind, SetupPromptEvaluateItem, SetupPromptVisibilityResult };

type PendingEvaluation = {
  items: SetupPromptEvaluateItem[];
  result: Promise<SetupPromptVisibilityResult[]>;
};

let pendingEvaluation: PendingEvaluation | null = null;

/**
 * Prompts mounted in the same commit evaluate together: every dashboard renders more than one, and
 * each used to send its own POST. Callers pick their own row out of the shared results by kind.
 */
export function evaluateSetupPrompts(
  items: SetupPromptEvaluateItem[],
): Promise<SetupPromptVisibilityResult[]> {
  if (pendingEvaluation) {
    pendingEvaluation.items.push(...items);
    return pendingEvaluation.result;
  }
  const batch: PendingEvaluation = {
    items: [...items],
    result: Promise.resolve().then(() => {
      pendingEvaluation = null;
      return evaluateSetupPromptsApi(batch.items);
    }),
  };
  pendingEvaluation = batch;
  return batch.result;
}

export async function dismissSetupPrompt(
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibilityResult> {
  return dismissSetupPromptApi(kind, conditionVersion);
}

export async function actionSetupPrompt(
  kind: SetupPromptKind,
  conditionVersion: string,
): Promise<SetupPromptVisibilityResult> {
  return actionSetupPromptApi(kind, conditionVersion);
}
