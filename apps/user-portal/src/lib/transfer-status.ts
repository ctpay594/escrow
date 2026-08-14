import type { BadgeProps } from '@/components/ui/badge';

export const transferStatusVariant: Record<string, BadgeProps['variant']> = {
  PENDING_APPROVAL: 'warning',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  CREDITED: 'success',
  FAILED: 'destructive',
  REJECTED: 'secondary',
};

export function userTransferStatus(status: string): string {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'Pending approval';
    case 'PROCESSING':
      return 'Processing';
    case 'SUCCESS':
      return 'Completed';
    case 'CREDITED':
      return 'Credited';
    case 'FAILED':
      return 'Failed';
    case 'REJECTED':
      return 'Cancelled';
    default:
      return status.replaceAll('_', ' ');
  }
}
