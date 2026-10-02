import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const control = (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
        aria-required={props.required || undefined}
        onChange={(event) => { event.currentTarget.setCustomValidity(""); event.currentTarget.removeAttribute("aria-invalid"); props.onChange?.(event); }}
        onInvalid={(event) => { event.currentTarget.setCustomValidity(`${props["aria-label"] ?? "الحقل"}: ${event.currentTarget.validity.valueMissing ? "هذا الحقل إلزامي" : "أدخل قيمة صحيحة"}`); props.onInvalid?.(event); }}
      />
    );
    return props.required ? <div className="min-w-0 w-full"><span className="mb-1 block text-xs text-muted-foreground">إلزامي <span className="text-destructive" aria-hidden="true">*</span></span>{control}</div> : control;
  },
);
Input.displayName = "Input";

export { Input };
