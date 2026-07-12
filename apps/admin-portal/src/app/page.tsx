import { AdminShell } from '@/components/admin-shell';
import { MerchantsListPanel } from '@/components/merchants/merchants-list-panel';
import { requireAdminSession } from '@/lib/auth';

export default async function AdminHomePage() {
  const admin = await requireAdminSession();

  return (
    <AdminShell adminUsername={admin.username} activePath="/">
      <MerchantsListPanel />
    </AdminShell>
  );
}
