import { transferStatusLabel, transferStatusVariant } from '@/lib/transfer-status';
import { Badge } from '@/components/ui/badge';

export function TransferStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={transferStatusVariant[status] ?? 'secondary'}>
      {transferStatusLabel(status)}
    </Badge>
  );
}
