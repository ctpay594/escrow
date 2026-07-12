'use client';

import {
  GlassSegmentedControl,
  type GlassSegmentOption,
} from '@/components/ui/glass-segmented-control';

export type BalanceMode = 'real' | 'demo';

const OPTIONS: GlassSegmentOption<BalanceMode>[] = [
  {
    value: 'real',
    label: 'Real',
    thumbClassName:
      'border-slate-700/40 bg-slate-900/92 shadow-[0_2px_8px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]',
    selectedLabelClassName: 'text-white',
  },
  {
    value: 'demo',
    label: 'Demo',
    thumbClassName:
      'border-slate-400/50 bg-slate-500/88 shadow-[0_2px_8px_rgba(100,116,139,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]',
    selectedLabelClassName: 'text-white',
  },
];

interface BalanceModeToggleProps {
  value: BalanceMode;
  disabled?: boolean;
  onChange: (mode: BalanceMode) => void;
}

export function BalanceModeToggle({
  value,
  disabled = false,
  onChange,
}: BalanceModeToggleProps) {
  return (
    <GlassSegmentedControl
      value={value}
      options={OPTIONS}
      disabled={disabled}
      ariaLabel="Balance source"
      className="h-9 min-w-[7.5rem]"
      onChange={onChange}
    />
  );
}
