'use client';

import { ExternalLink } from 'lucide-react';
import { CTPayMark } from '@/components/ctpay-mark';
import { USER_PORTAL_URL } from '@/lib/constants';
import { cn } from '@/lib/utils';

export function UserPortalLiveLink({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <a
      href={USER_PORTAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Open live merchant portal"
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md',
        compact ? 'h-9 w-9 justify-center' : 'h-9 pl-1 pr-3',
        className,
      )}
    >
      <span className="relative inline-flex">
        <CTPayMark size={28} className="rounded-full" />
        {compact ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-white">
            <ExternalLink className="h-2.5 w-2.5" />
          </span>
        ) : null}
      </span>
      {compact ? (
        <span className="sr-only">Open live merchant portal</span>
      ) : (
        <>
          <span className="flex flex-col leading-none">
            <span className="text-xs font-semibold text-foreground">
              Merchant portal
            </span>
            <span className="text-[10px] text-muted-foreground">Live</span>
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </>
      )}
    </a>
  );
}
