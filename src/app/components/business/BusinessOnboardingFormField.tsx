import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  onboardingFieldHint,
  onboardingFileInput,
  onboardingInput,
  onboardingLabel,
  onboardingOptionalBadge,
  onboardingRequiredMark,
  onboardingSelect,
} from "./businessOnboardingUi";

function OnboardingFieldLabel({ label, optional }: { label: string; optional?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={onboardingLabel}>
      {label}
      {!optional ? <span className={onboardingRequiredMark} aria-hidden="true"> *</span> : null}
      {optional ? (
        <span className={onboardingOptionalBadge}>{t("business.onboarding.fields.optional")}</span>
      ) : null}
    </span>
  );
}

type TextFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function BusinessOnboardingTextField({
  label,
  placeholder,
  value,
  onChange,
  hint,
  error,
  optional,
}: TextFieldProps) {
  return (
    <label className="business-onboarding-field block min-w-0">
      <OnboardingFieldLabel label={label} optional={optional} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={onboardingInput}
        aria-invalid={error ? true : undefined}
        aria-required={optional ? undefined : true}
        required={!optional}
      />
      {error ? <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {!error && hint ? <p className={onboardingFieldHint}>{hint}</p> : null}
    </label>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
};

export function BusinessOnboardingSelectField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  optional,
  children,
}: SelectFieldProps) {
  return (
    <label className="business-onboarding-field block min-w-0">
      <OnboardingFieldLabel label={label} optional={optional} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={onboardingSelect}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-required={optional ? undefined : true}
        required={!optional}
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
      {error ? <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {!error && hint ? <p className={onboardingFieldHint}>{hint}</p> : null}
    </label>
  );
}

export function BusinessOnboardingFileField({
  label,
  hint,
  onFile,
  optional,
}: {
  label: string;
  hint: string;
  onFile: (file: File | null) => void;
  optional?: boolean;
}) {
  return (
    <label className="business-onboarding-field block min-w-0">
      <OnboardingFieldLabel label={label} optional={optional} />
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className={onboardingFileInput}
      />
      <p className={onboardingFieldHint}>{hint}</p>
    </label>
  );
}
