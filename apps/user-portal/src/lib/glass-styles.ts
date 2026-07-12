import { cn } from '@/lib/utils';

/** Frosted panel — cards, sections */
export function glassSurface(className?: string) {
  return cn(
    'rounded-xl border border-white/70 bg-white/72 text-card-foreground',
    'shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_28px_rgba(15,23,42,0.06)]',
    'backdrop-blur-xl backdrop-saturate-150 ring-1 ring-black/[0.04]',
    className,
  );
}

/** Recessed tile — balance blocks, nested fields */
export function glassInset(className?: string) {
  return cn(
    'rounded-xl border border-slate-200/80 bg-slate-100/55',
    'shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)] backdrop-blur-sm',
    className,
  );
}

/** App shell background */
export function glassAppBackground(className?: string) {
  return cn(
    'bg-[linear-gradient(165deg,#f8fafc_0%,#eef2f7_45%,#f1f5f9_100%)]',
    className,
  );
}

/** Sticky top bar */
export function glassHeaderBar(className?: string) {
  return cn(
    'border-b border-white/60 bg-white/78 backdrop-blur-xl backdrop-saturate-150',
    'shadow-[0_1px_0_rgba(15,23,42,0.04)]',
    className,
  );
}

/** Table header row inside glass cards */
export function glassTableHead(className?: string) {
  return cn(
    'border-b border-slate-200/80 bg-white/40 text-xs font-medium uppercase tracking-wide text-muted-foreground',
    className,
  );
}

/** Clickable / hoverable table body row */
export function glassTableRow(
  variant: 'default' | 'attention' = 'default',
  className?: string,
) {
  return cn(
    'transition-colors',
    variant === 'attention'
      ? 'bg-amber-50/40 hover:bg-amber-50/65'
      : 'bg-white/25 hover:bg-white/55',
    className,
  );
}
