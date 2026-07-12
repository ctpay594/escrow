import { AdminShell } from '@/components/admin-shell';
import { MerchantDetailPanel } from '@/components/merchants/merchant-detail-panel';
import { requireAdminSession } from '@/lib/auth';

export default async function MerchantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminSession();
  const { id } = await params;

  return (
    <AdminShell adminUsername={admin.username} activePath={`/merchants/${id}`}>
      <MerchantDetailPanel merchantId={id} />
    </AdminShell>
  );
}
