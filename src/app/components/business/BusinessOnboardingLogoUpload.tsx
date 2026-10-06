import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { onboardingFieldHint, onboardingLabel, onboardingOptionalBadge } from "./businessOnboardingUi";

const ACCEPT = "image/png,image/jpeg,image/jpg,image/webp,image/gif,image/heic,image/heif,image/avif";

type BusinessOnboardingLogoUploadProps = {
  file: File | null;
  onFile: (file: File | null) => void;
};

export function BusinessOnboardingLogoUpload({ file, onFile }: BusinessOnboardingLogoUploadProps) {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const applyFile = useCallback(
    (next: File | null) => {
      if (!next) {
        onFile(null);
        return;
      }
      if (!next.type.startsWith("image/")) return;
      onFile(next);
    },
    [onFile],
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    applyFile(e.target.files?.[0] ?? null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    applyFile(e.dataTransfer.files?.[0] ?? null);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const replace = (e: React.MouseEvent) => {
    e.stopPropagation();
    inputRef.current?.click();
  };

  return (
    <div className="min-w-0">
      <span className={onboardingLabel} id={`${inputId}-label`}>
        {t("business.onboarding.fields.logo")}
        <span className={onboardingOptionalBadge}>{t("business.onboarding.fields.optional")}</span>
      </span>
      <p className={cn(onboardingFieldHint, "-mt-1 mb-3")}>{t("business.onboarding.fields.logoHint")}</p>

      <motion.div
        role="button"
        tabIndex={0}
        aria-labelledby={`${inputId}-label`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => !previewUrl && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        animate={{
          scale: dragging ? 1.01 : 1,
          borderColor: dragging ? "rgba(249, 115, 22, 0.55)" : undefined,
        }}
        transition={{ duration: 0.2 }}
        className={cn(
          "business-onboarding-logo-drop relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-200",
          dragging
            ? "border-orange-500 bg-orange-500/5 ring-4 ring-orange-500/10"
            : "border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-white hover:border-zinc-300 hover:shadow-[0_4px_20px_-12px_rgba(0,0,0,0.12)] dark:border-zinc-700 dark:from-zinc-900/40 dark:to-zinc-950/60 dark:hover:border-zinc-600",
          previewUrl && "cursor-default py-6",
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={onInputChange}
        />

        <AnimatePresence mode="wait">
          {previewUrl ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.25 }}
              className="flex w-full flex-col items-center gap-4"
            >
              <div className="flex h-28 w-28 items-center justify-center rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="min-w-0 text-center">
                <p className="max-w-full truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {file?.name}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("business.onboarding.upload.previewReady")}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={replace}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-orange-300 hover:text-orange-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-orange-500/40 dark:hover:text-orange-300"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {t("business.onboarding.upload.replace")}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-red-200 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-red-500/30 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t("business.onboarding.upload.remove")}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center"
            >
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/10 to-orange-500/5 shadow-sm ring-1 ring-orange-500/15 dark:from-orange-500/15 dark:to-orange-500/5">
                <Upload className="h-6 w-6 text-orange-600 dark:text-orange-400" aria-hidden />
              </span>
              <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {t("business.onboarding.upload.cta")}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t("business.onboarding.upload.formats")}
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <ImagePlus className="h-3.5 w-3.5 text-orange-500" aria-hidden />
                {t("business.onboarding.upload.dragHint")}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
