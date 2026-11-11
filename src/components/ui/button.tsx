import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { caretipBtnSizeCompact, caretipBtnSizePrimary } from "@/lib/caretipButtonSystem";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-xl font-sans !leading-none tracking-tight",
    "touch-manipulation transition-[box-shadow,background-color,border-color,opacity] duration-200 ease-out",
    "active:opacity-[0.96]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eb992c]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "caretip-btn-primary border-0 text-white font-bold shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90",
        outline: "caretip-btn-secondary font-semibold",
        secondary: "caretip-btn-secondary font-semibold",
        ghost: "caretip-btn-ghost font-semibold",
        link: "font-semibold text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: caretipBtnSizePrimary,
        sm: caretipBtnSizeCompact,
        lg: caretipBtnSizePrimary,
        icon: "h-11 w-11 min-h-11 min-w-11 px-0 lg:h-12 lg:w-12 lg:min-h-12 lg:min-w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
