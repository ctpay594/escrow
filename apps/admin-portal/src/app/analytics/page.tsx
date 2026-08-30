import { Suspense } from 'react';
import { AdminShell } from '@/components/admin-shell';
import { AdminAnalyticsPanel } from '@/components/analytics/admin-analytics-panel';
import { requireAdminSession } from '@/lib/auth';

export default async function AdminAnalyticsPage() {
  const admin = await requireAdminSession();

  return (
    <AdminShell adminUsername={admin.username} activePath="/analytics">
      <Suspense fallback={null}>
        <AdminAnalyticsPanel />
      </Suspense>
    </AdminShell>
  );
}
