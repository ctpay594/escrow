'use client';

import { cn } from '@/lib/utils';

export interface GlassSegmentOption<T extends string> {
  value: T;
  label: string;
  /** Extra classes on the sliding thumb when this segment is selected */
  thumbClassName?: string;
  /** Extra classes on the label when this segment is selected */
  selectedLabelClassName?: string;
}

interface GlassSegmentedControlProps<T extends string> {
  value: T;
  options: GlassSegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}

export function GlassSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
  className,
}: GlassSegmentedControlProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const activeOption = options[activeIndex];

  return (
    <div
      className={cn(
        'glass-segment-track relative inline-grid shrink-0 rounded-full p-0.5',
        'border border-slate-200/80 bg-slate-200/45 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.04)]',
        'backdrop-blur-xl backdrop-saturate-150',
        'ring-1 ring-black/[0.04]',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="group"
      aria-label={ariaLabel}
      onClick={(event) => event.stopPropagation()}
    >
      <span
        aria-hidden
        className={cn(
          'glass-segment-thumb pointer-events-none absolute inset-y-0.5 left-0.5 rounded-full',
          'border backdrop-blur-md transition-[transform,background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
          activeOption?.thumbClassName ??
            'border-white/90 bg-white/80 shadow-[0_1px_4px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.9)]',
        )}
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(calc(${activeIndex} * 100%))`,
        }}
      />
      {options.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            className={cn(
              'relative z-10 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide',
              'transition-colors duration-200',
              isActive
                ? cn(
                    'font-bold',
                    option.selectedLabelClassName ?? 'text-foreground',
                  )
                : 'text-muted-foreground/70 hover:text-muted-foreground',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
