import type { ApprovalMode } from '@/components/merchants/approval-mode-toggle';

export async function updateMerchantApprovalMode(
  merchantId: string,
  approvalMode: ApprovalMode,
) {
  const response = await fetch(`/api/users/${merchantId}/approval-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approval_mode: approvalMode }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? 'Failed to update approval mode');
  }

  return data as { approval_mode: ApprovalMode };
}
