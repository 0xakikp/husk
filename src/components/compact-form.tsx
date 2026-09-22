import type { ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Label } from "./ui/label";
import { SelectTrigger, SelectContent, SelectItem } from "./ui/select";
import "./compact-form.css";

/** Opt-in compact controls for sidebar forms. No global primitive overrides. */
export function CompactForm({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("compact-form", className)} {...props} />;
}
export function CompactInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn("compact-control", className)} {...props} />;
}
export function CompactTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea className={cn("compact-control compact-textarea", className)} {...props} />;
}
export function CompactLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label className={cn("compact-label", className)} {...props} />;
}
export function CompactSelect({ className, ...props }: ComponentProps<"select">) {
  return <span className="compact-native-select"><select className={cn("compact-control compact-select", className)} {...props} /><HugeiconsIcon icon={UnfoldMoreIcon} size={13} aria-hidden="true" /></span>;
}
export function CompactSelectTrigger({ className, ...props }: ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className={cn("compact-control compact-select-trigger", className)} {...props} />;
}
export function CompactSelectContent({ className, ...props }: ComponentProps<typeof SelectContent>) {
  return <SelectContent className={cn("compact-select-content", className)} {...props} />;
}
export function CompactSelectItem({ className, ...props }: ComponentProps<typeof SelectItem>) {
  return <SelectItem className={cn("compact-select-item", className)} {...props} />;
}
type ButtonProps = Omit<ComponentProps<typeof Button>, "variant" | "size" | "asChild"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  compact?: boolean;
  icon?: boolean;
};
export function CompactButton({ className, variant = "secondary", compact = false, icon = false, type = "button", ...props }: ButtonProps) {
  return <Button type={type} variant={variant === "primary" ? "default" : variant === "danger" ? "destructive" : variant === "secondary" ? "outline" : "ghost"}
    size={icon ? "icon-xs" : compact ? "xs" : "sm"} data-compact-variant={variant} data-compact-size={compact || icon ? "small" : "normal"}
    className={cn("compact-button", icon && "compact-icon-button", className)} {...props} />;
}
