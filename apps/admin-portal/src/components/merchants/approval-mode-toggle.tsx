'use client';

import {
  GlassSegmentedControl,
  type GlassSegmentOption,
} from '@/components/ui/glass-segmented-control';

export type ApprovalMode = 'auto' | 'manual';

const OPTIONS: GlassSegmentOption<ApprovalMode>[] = [
  {
    value: 'auto',
    label: 'Auto',
    thumbClassName:
      'border-emerald-400/45 bg-emerald-600/88 shadow-[0_2px_8px_rgba(5,150,105,0.32),inset_0_1px_0_rgba(255,255,255,0.22)]',
    selectedLabelClassName: 'text-white',
  },
  {
    value: 'manual',
    label: 'Manual',
    thumbClassName:
      'border-slate-700/40 bg-slate-900/92 shadow-[0_2px_8px_rgba(15,23,42,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]',
    selectedLabelClassName: 'text-white',
  },
];

interface ApprovalModeToggleProps {
  value: ApprovalMode;
  disabled?: boolean;
  onChange: (mode: ApprovalMode) => void;
}

export function ApprovalModeToggle({
  value,
  disabled = false,
  onChange,
}: ApprovalModeToggleProps) {
  return (
    <GlassSegmentedControl
      value={value}
      options={OPTIONS}
      disabled={disabled}
      ariaLabel="Payout approval mode"
      className="h-9 min-w-[8.25rem]"
      onChange={onChange}
    />
  );
}
