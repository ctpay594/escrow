import { AdminShell } from '@/components/admin-shell';
import { CompanyTransferPanel } from '@/components/transfer/company-transfer-panel';
import { requireAdminSession } from '@/lib/auth';

export default async function TransfersPage() {
  const session = await requireAdminSession();

  return (
    <AdminShell adminUsername={session.username} activePath="/transfers">
      <CompanyTransferPanel />
    </AdminShell>
  );
}
