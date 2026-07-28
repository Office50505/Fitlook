import { CheckBadge } from "@/components/atoms/check-badge";

export interface FeaturePillProps {
  label: string;
}

export function FeaturePill({ label }: FeaturePillProps) {
  return (
    <li className="flex h-[104px] min-w-0 items-center gap-7 rounded-[15px] border border-white/14 bg-black/22 px-8 text-[23px] leading-none text-white shadow-glass backdrop-blur-[18px] lg:h-[102px] lg:px-[34px] lg:text-[24px]">
      <CheckBadge label={`${label} included`} />
      <span>{label}</span>
    </li>
  );
}
