import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

type RequiredFieldLabelProps = {
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
};

/** Form label with optional required-field asterisk. */
export function RequiredFieldLabel({ htmlFor, required = false, children }: RequiredFieldLabelProps) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}
    </Label>
  );
}
