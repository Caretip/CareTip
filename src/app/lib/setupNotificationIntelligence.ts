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

export async function evaluateSetupPrompts(
  items: SetupPromptEvaluateItem[],
): Promise<SetupPromptVisibilityResult[]> {
  return evaluateSetupPromptsApi(items);
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
