'use client';

import {
  GlassSegmentedControl,
  type GlassSegmentOption,
} from '@/components/ui/glass-segmented-control';

export type MerchantAccountStatus = 'active' | 'on_hold' | 'terminated';

const OPTIONS: GlassSegmentOption<MerchantAccountStatus>[] = [
  {
    value: 'active',
    label: 'Active',
    thumbClassName:
      'border-emerald-400/45 bg-emerald-600/88 shadow-[0_2px_8px_rgba(5,150,105,0.32),inset_0_1px_0_rgba(255,255,255,0.22)]',
    selectedLabelClassName: 'text-white',
  },
  {
    value: 'on_hold',
    label: 'On hold',
    thumbClassName:
      'border-amber-300/60 bg-amber-500/88 shadow-[0_2px_8px_rgba(245,158,11,0.35),inset_0_1px_0_rgba(255,255,255,0.28)]',
    selectedLabelClassName: 'text-white',
  },
  {
    value: 'terminated',
    label: 'Terminated',
    thumbClassName:
      'border-red-400/50 bg-red-600/90 shadow-[0_2px_8px_rgba(220,38,38,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]',
    selectedLabelClassName: 'text-white',
  },
];

interface AccountStatusToggleProps {
  value: MerchantAccountStatus;
  disabled?: boolean;
  onChange: (status: MerchantAccountStatus) => void;
}

export function AccountStatusToggle({
  value,
  disabled = false,
  onChange,
}: AccountStatusToggleProps) {
  return (
    <GlassSegmentedControl
      value={value}
      options={OPTIONS}
      disabled={disabled}
      ariaLabel="Account status"
      className="h-9"
      onChange={onChange}
    />
  );
}

export function accountStatusLabel(status: MerchantAccountStatus) {
  return OPTIONS.find((option) => option.value === status)?.label ?? status;
}
