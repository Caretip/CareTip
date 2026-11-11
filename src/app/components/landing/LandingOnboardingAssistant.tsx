import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { MessageCircle, Send, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { postLandingAiChat, type LandingChatMessage } from "../../lib/landingAiApi";
import { trackLandingAiEvent } from "../../lib/landingAiAnalytics";
import { toDisplayErrorMessage } from "@/app/lib/errorMessages";

export const LANDING_AI_PROMPT_IDS = [
  "how_it_works",
  "setup_time",
  "qr_customize",
  "gdpr",
  "employee_tips",
  "multi_venue",
] as const;

export type LandingAiPromptId = (typeof LANDING_AI_PROMPT_IDS)[number];

type UiMessage = LandingChatMessage & {
  id: string;
  source?: "openai" | "knowledge";
  usingKnowledgeFallback?: boolean;
};

type LandingOnboardingAssistantProps = {
  launcherVisible: boolean;
  autoOpenOnce?: boolean;
  onAutoOpenConsumed?: () => void;
};

function nextId(): string {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function LandingOnboardingAssistant({
  launcherVisible,
  autoOpenOnce,
  onAutoOpenConsumed,
}: LandingOnboardingAssistantProps) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudgeLauncher, setNudgeLauncher] = useState(false);
  const [interactedWithAi, setInteractedWithAi] = useState(false);
  const [knowledgeFallbackActive, setKnowledgeFallbackActive] = useState(false);
  const [devSourceHint, setDevSourceHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoOpenedRef = useRef(false);

  const promptItems = LANDING_AI_PROMPT_IDS.map((id) => ({
    id,
    label: t(`landing.assistant.prompts.${id}`),
  }));

  const showPrompts = messages.length === 0 && !loading;

  useEffect(() => {
    if (!launcherVisible) return;
    trackLandingAiEvent("launcher_visible");
    setNudgeLauncher(true);
    const tmr = window.setTimeout(() => setNudgeLauncher(false), 2600);
    return () => window.clearTimeout(tmr);
  }, [launcherVisible]);

  useEffect(() => {
    if (!autoOpenOnce || autoOpenedRef.current || !launcherVisible) return;
    autoOpenedRef.current = true;
    const delay = reduceMotion ? 0 : 1800;
    const tmr = window.setTimeout(() => {
      setOpen(true);
      trackLandingAiEvent("popup_open", { trigger: "intent_auto" });
      onAutoOpenConsumed?.();
    }, delay);
    return () => window.clearTimeout(tmr);
  }, [autoOpenOnce, launcherVisible, reduceMotion, onAutoOpenConsumed]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, loading]);

  const sendMessages = useCallback(
    async (nextMessages: LandingChatMessage[], promptId?: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const { reply, source, fallbackReason, usingKnowledgeFallback } = await postLandingAiChat({
          messages: nextMessages,
          promptId,
          locale: i18n.language,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (import.meta.env.DEV) {
          const hint = `${source ?? "?"}${fallbackReason ? ` · ${fallbackReason}` : ""}`;
          setDevSourceHint(hint);
          console.info("[Ask CareTip]", { source, fallbackReason: fallbackReason ?? "none", usingKnowledgeFallback });
        }
        if (usingKnowledgeFallback) setKnowledgeFallbackActive(true);
        trackLandingAiEvent("question_asked", {
          via: promptId ? "prompt" : "typed",
          ...(promptId ? { promptId } : {}),
          aiSource: source ?? "unknown",
          usingKnowledgeFallback: usingKnowledgeFallback === true,
          ...(fallbackReason ? { fallbackReason } : {}),
        });
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            role: "assistant",
            content: reply,
            source,
            usingKnowledgeFallback,
          },
        ]);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(toDisplayErrorMessage(e, t("landing.assistant.error")));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [i18n.language, t],
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    trackLandingAiEvent("popup_open", { trigger: "launcher" });
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setKnowledgeFallbackActive(false);
    setDevSourceHint(null);
    trackLandingAiEvent("panel_dismiss");
    abortRef.current?.abort();
  }, []);

  const handlePrompt = useCallback(
    (id: LandingAiPromptId) => {
      setInteractedWithAi(true);
      trackLandingAiEvent("prompt_click", { promptId: id });
      const userMsg: UiMessage = {
        id: nextId(),
        role: "user",
        content: t(`landing.assistant.prompts.${id}`),
      };
      const history: LandingChatMessage[] = [...messages, userMsg];
      setMessages((prev) => [...prev, userMsg]);
      void sendMessages(history, id);
    },
    [messages, sendMessages, t],
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const text = input.trim();
      if (!text || loading) return;
      setInteractedWithAi(true);
      setInput("");
      const userMsg: UiMessage = { id: nextId(), role: "user", content: text };
      const history: LandingChatMessage[] = [...messages, userMsg];
      setMessages((prev) => [...prev, userMsg]);
      void sendMessages(history);
    },
    [input, loading, messages, sendMessages],
  );

  if (!launcherVisible) return null;

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.button
            type="button"
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="caretip-landing-ai-backdrop md:hidden"
            aria-label={t("landing.assistant.close")}
            onClick={closePanel}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="caretip-landing-ai-title"
            initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="caretip-landing-ai-panel"
          >
            <div className="caretip-landing-ai-panel__handle md:hidden" aria-hidden />
            <header className="caretip-landing-ai-panel__header">
              <div className="min-w-0">
                <p
                  id="caretip-landing-ai-title"
                  className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
                >
                  <Sparkles className="h-4 w-4 text-primary" aria-hidden />
                  {t("landing.assistant.title")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("landing.assistant.subtitle")}</p>
                {import.meta.env.DEV && devSourceHint ? (
                  <p className="mt-1 font-mono text-[10px] text-amber-700 dark:text-amber-400" aria-hidden>
                    DEV · {devSourceHint}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                aria-label={t("landing.assistant.close")}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>

            {knowledgeFallbackActive ? (
              <p
                className="caretip-landing-ai-fallback-notice"
                role="status"
                aria-live="polite"
              >
                {t("landing.assistant.knowledgeFallbackNotice")}
              </p>
            ) : null}

            <div ref={listRef} className="caretip-landing-ai-panel__messages">
              {messages.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{t("landing.assistant.welcome")}</p>
              ) : null}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "caretip-landing-ai-bubble",
                    m.role === "user" ? "caretip-landing-ai-bubble--user" : "caretip-landing-ai-bubble--assistant",
                  )}
                >
                  {m.content}
                </div>
              ))}
              {loading ? (
                <div className="caretip-landing-ai-bubble caretip-landing-ai-bubble--assistant opacity-80">
                  <span className="inline-flex gap-1" aria-live="polite">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                  </span>
                </div>
              ) : null}
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>

            {showPrompts ? (
              <div className="caretip-landing-ai-prompts" role="list">
                {promptItems.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="listitem"
                    disabled={loading}
                    className="caretip-landing-ai-prompt-btn"
                    onClick={() => handlePrompt(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}

            <form className="caretip-landing-ai-compose" onSubmit={handleSubmit}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("landing.assistant.inputPlaceholder")}
                maxLength={600}
                disabled={loading}
                aria-label={t("landing.assistant.inputPlaceholder")}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                aria-label={t("landing.assistant.send")}
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </form>

            {interactedWithAi ? (
              <div className="border-t border-border/50 px-4 pb-3 pt-2">
                <Link
                  to="/signup"
                  className="text-xs font-semibold text-primary hover:underline"
                  onClick={() => trackLandingAiEvent("cta_after_ai")}
                >
                  {t("landing.assistant.ctaSignup")}
                </Link>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {!open ? (
        <button
          type="button"
          className={cn("caretip-landing-ai-launcher", nudgeLauncher && "caretip-landing-ai-launcher--nudge")}
          onClick={openPanel}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="caretip-landing-ai-launcher__icon" aria-hidden>
            <MessageCircle className="h-4 w-4" />
          </span>
          <span className="hidden sm:inline">{t("landing.assistant.launcherLabel")}</span>
          <span className="sm:hidden">{t("landing.assistant.launcherShort")}</span>
        </button>
      ) : null}
    </>
  );
}
