import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type AuthInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  passwordToggle?: boolean;
  trailing?: ReactNode;
};

export const AuthInput = forwardRef<HTMLInputElement, AuthInputProps>(function AuthInput(
  { label, passwordToggle = false, trailing, className, type, id, ...props },
  ref,
) {
  const [revealed, setRevealed] = useState(false);
  const inputId = id ?? props.name;
  const resolvedType = passwordToggle ? (revealed ? "text" : "password") : type;

  return (
    <div className="mw-auth-field">
      <label htmlFor={inputId} className="mw-auth-field__label">
        {label}
      </label>
      <div className="mw-auth-field__control">
        <input
          ref={ref}
          id={inputId}
          type={resolvedType}
          className={cn("mw-auth-input", passwordToggle && "mw-auth-input--password", className)}
          {...props}
        />
        {passwordToggle ? (
          <button
            type="button"
            className="mw-auth-input__toggle"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
        {trailing}
      </div>
    </div>
  );
});
