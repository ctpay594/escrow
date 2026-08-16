import { Suspense } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { AdminHistoryPanel } from '@/components/history/admin-history-panel';
import { requireAdminSession } from '@/lib/auth';

export default async function AdminHistoryPage() {
  const admin = await requireAdminSession();

  return (
    <AdminShell adminUsername={admin.username} activePath="/history">
      <Suspense fallback={null}>
        <AdminHistoryPanel />
      </Suspense>
    </AdminShell>
  );
}
