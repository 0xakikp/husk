import { type ComponentProps, useState } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const isOn = checked !== undefined ? checked : internal;

  const handleChange = (v: boolean) => {
    if (checked === undefined) setInternal(v);
    onCheckedChange?.(v);
  };

  return (
    <div
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center",
        className,
      )}
    >
      {/* Track — theme-aware OFF color, green ON */}
      <span
        className={cn(
          "absolute inset-0 rounded-full transition-colors",
          isOn ? "bg-primary" : "bg-muted-foreground/30",
        )}
      />
      {/* Thumb — white in light, white when off in dark, black when on in dark */}
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 h-5 w-5 rounded-full shadow transition-transform",
          isOn ? "translate-x-5" : "translate-x-0.5",
          isOn
            ? "bg-white dark:bg-black"
            : "bg-white",
        )}
      />
      {/* Invisible Radix switch for interaction */}
      <SwitchPrimitive.Root
        className="absolute inset-0 z-20 opacity-0"
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={handleChange}
        {...props}
      >
        <SwitchPrimitive.Thumb className="block" />
      </SwitchPrimitive.Root>
    </div>
  );
}
