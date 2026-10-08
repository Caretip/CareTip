import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ImagePlus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { onboardingLabel, onboardingOptionalBadge } from "./businessOnboardingUi";

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
          borderColor: dragging ? "rgba(249, 115, 22, 0.45)" : undefined,
        }}
        transition={{ duration: 0.2 }}
        className={cn(
          "business-onboarding-logo-drop relative flex cursor-pointer items-center gap-4 rounded-md border border-dashed px-4 py-4 transition-colors duration-200 sm:px-5",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border/80 bg-muted/20 hover:border-foreground/20 hover:bg-muted/30",
          previewUrl && "cursor-default",
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background p-2">
                  <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{file?.name}</p>
                  <p className="text-xs text-muted-foreground">{t("business.onboarding.upload.previewReady")}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={replace}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  {t("business.onboarding.upload.replace")}
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t("business.onboarding.upload.remove")}
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex w-full items-center gap-4"
            >
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background"
                aria-hidden
              >
                <Upload className="h-5 w-5 text-primary" />
              </span>
              <div className="min-w-0 flex-1 text-left">
                <p className="text-sm font-semibold text-foreground">{t("business.onboarding.upload.cta")}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("business.onboarding.upload.formats")}</p>
                <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <ImagePlus className="h-3.5 w-3.5 text-primary" aria-hidden />
                  {t("business.onboarding.upload.dragHint")}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
