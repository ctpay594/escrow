import { PortalLayout } from '@/components/portal-layout';
import { requireUserProfile } from '@/lib/auth';

export default async function PortalGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, merchant } = await requireUserProfile();

  return (
    <PortalLayout user={user} merchant={merchant}>
      {children}
    </PortalLayout>
  );
}
