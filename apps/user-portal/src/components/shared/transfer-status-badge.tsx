import { userTransferStatus, transferStatusVariant } from '@/lib/transfer-status';
import { Badge } from '@/components/ui/badge';

export function TransferStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant={transferStatusVariant[status] ?? 'secondary'}
      className="w-fit max-w-full shrink-0 whitespace-nowrap px-2 py-0.5 leading-none"
    >
      {userTransferStatus(status)}
    </Badge>
  );
}
