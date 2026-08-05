import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

type OTPInputProps = {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  disabled?: boolean;
  ariaLabel?: string;
};

export function OTPInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  ariaLabel = "One-time code",
}: OTPInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const commit = (nextDigits: string[]) => {
    onChange(nextDigits.join("").slice(0, length));
  };

  const setAt = (index: number, char: string) => {
    const next = [...digits];
    next[index] = char;
    commit(next);
  };

  const focusAt = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) {
        setAt(index, "");
        return;
      }
      if (index > 0) {
        setAt(index - 1, "");
        focusAt(index - 1);
      }
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(index - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(index + 1);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    const next = Array.from({ length }, (_, i) => pasted[i] ?? "");
    commit(next);
    focusAt(Math.min(pasted.length, length - 1));
  };

  return (
    <div className="mw-auth-otp" role="group" aria-label={ariaLabel}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          className={cn("mw-auth-otp__cell", digit && "mw-auth-otp__cell--filled")}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`${ariaLabel} digit ${index + 1}`}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            const char = raw.slice(-1);
            setAt(index, char);
            if (char && index < length - 1) focusAt(index + 1);
          }}
          onKeyDown={(e) => onKeyDown(index, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}
