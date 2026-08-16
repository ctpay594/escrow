export const PAYOUT_MODES = ['IMPS', 'NEFT', 'RTGS'] as const;

export type BankPayoutMode = (typeof PAYOUT_MODES)[number];

export function parsePayoutMode(value: unknown): BankPayoutMode | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();

  if (normalized === 'IMPS' || normalized === 'NEFT' || normalized === 'RTGS') {
    return normalized;
  }

  return null;
}

export function payoutModeLabel(mode: string | null | undefined) {
  const parsed = parsePayoutMode(mode);
  return parsed ?? 'IMPS';
}
