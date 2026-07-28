import { Check } from "lucide-react";

export interface CheckBadgeProps {
  label: string;
}

export function CheckBadge({ label }: CheckBadgeProps) {
  return (
    <span
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-blush text-ink"
    >
      <Check aria-hidden="true" className="size-5 stroke-[3]" />
    </span>
  );
}
