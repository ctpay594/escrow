import { AlertTriangle, BadgeCheck, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { glassSurface } from '@/lib/glass-styles';
import type { MerchantAccountStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<
  MerchantAccountStatus,
  {
    label: string;
    variant: 'success' | 'warning' | 'destructive';
    Icon: typeof BadgeCheck;
  }
> = {
  active: {
    label: 'Active',
    variant: 'success',
    Icon: BadgeCheck,
  },
  on_hold: {
    label: 'On hold',
    variant: 'warning',
    Icon: AlertTriangle,
  },
  terminated: {
    label: 'Terminated',
    variant: 'destructive',
    Icon: Ban,
  },
};

export function accountStatusLabel(status: MerchantAccountStatus) {
  return STATUS_CONFIG[status]?.label ?? status;
}

interface AccountStatusBannerProps {
  status: MerchantAccountStatus;
}

const copy: Record<
  Exclude<MerchantAccountStatus, 'active'>,
  { title: string; description: string; className: string; Icon: typeof AlertTriangle }
> = {
  on_hold: {
    title: 'Account on hold',
    description:
      'You can view your balance and transaction history, but new transfers are disabled. Contact support if you have questions.',
    className: 'border-amber-200/80 bg-amber-50/75 text-amber-950 backdrop-blur-md',
    Icon: AlertTriangle,
  },
  terminated: {
    title: 'Account terminated',
    description:
      'Your portal access is read-only. You cannot submit new transfers. Contact support for assistance.',
    className: 'border-red-200/80 bg-red-50/75 text-red-950 backdrop-blur-md',
    Icon: Ban,
  },
};

export function AccountStatusBanner({ status }: AccountStatusBannerProps) {
  if (status === 'active') {
    return null;
  }

  const config = copy[status];
  const Icon = config.Icon;

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6"
      role="status"
    >
      <div
        className={cn(
          glassSurface(),
          'flex gap-3 px-4 py-3 text-sm',
          config.className,
        )}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">{config.title}</p>
          <p className="mt-0.5 text-xs opacity-90">{config.description}</p>
        </div>
      </div>
    </div>
  );
}

export function canMerchantTransfer(status: MerchantAccountStatus | undefined) {
  return !status || status === 'active';
}

interface AccountStatusBadgeProps {
  status: MerchantAccountStatus;
  className?: string;
}

export function AccountStatusBadge({ status, className }: AccountStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.active;
  const Icon = config.Icon;

  return (
    <Badge variant={config.variant} className={cn('text-[10px]', className)}>
      <Icon className="mr-1 h-3 w-3" aria-hidden />
      {config.label}
    </Badge>
  );
}
