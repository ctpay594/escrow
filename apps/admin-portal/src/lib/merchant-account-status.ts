import type { MerchantAccountStatus } from '@/components/merchants/account-status-toggle';

export async function updateMerchantAccountStatus(
  merchantId: string,
  accountStatus: MerchantAccountStatus,
) {
  const response = await fetch(`/api/users/${merchantId}/account-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_status: accountStatus }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? 'Failed to update account status');
  }

  return data as { account_status: MerchantAccountStatus; message: string };
}
