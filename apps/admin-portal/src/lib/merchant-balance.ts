export type BalanceMode = 'real' | 'demo';

export function realAvailable(realBalance: number, pendingBalance: number) {
  return Math.max(realBalance - pendingBalance, 0);
}

export function activeBalanceForMerchant(merchant: {
  balance_mode: BalanceMode;
  real_balance: number;
  demo_balance: number;
  pending_balance: number;
}) {
  if (merchant.balance_mode === 'real') {
    return realAvailable(merchant.real_balance, merchant.pending_balance);
  }

  return merchant.demo_balance;
}

export async function updateMerchantBalanceMode(
  merchantId: string,
  balanceMode: BalanceMode,
) {
  const response = await fetch(`/api/users/${merchantId}/balance-mode`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ balance_mode: balanceMode }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? 'Failed to update balance mode');
  }

  return data as { balance_mode: BalanceMode; available_balance: number };
}
