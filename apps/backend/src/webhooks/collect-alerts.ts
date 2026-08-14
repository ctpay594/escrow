export interface CollectAlert {
  amount: number;
  virtualAccount: string;
  utr: string | null;
  dedupeKey: string;
  remitterName: string | null;
  remitterAccount: string | null;
  debitCredit: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function fieldMap(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    mapped[key.trim().toLowerCase().replace(/\s+/g, '_')] = value;
  }

  return mapped;
}

function readString(
  mapped: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = mapped[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readAmount(mapped: Record<string, unknown>): number | null {
  const raw = readString(mapped, ['amount', 'credit_amount', 'txn_amount']);

  if (!raw) {
    return null;
  }

  const parsed = Number(raw.replace(/,/g, ''));

  return Number.isFinite(parsed) ? parsed : null;
}

function collectAlertRows(body: Record<string, unknown>): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const nested = body.GenericCorporateAlertRequest ?? body._array;

  if (Array.isArray(nested)) {
    for (const item of nested) {
      const row = asRecord(item);

      if (row) {
        rows.push(row);
      }
    }
  }

  const self = fieldMap(body);

  if (readString(self, ['virtual_account', 'virtual_account_no'])) {
    rows.push(body);
  }

  return rows;
}

export function parseCollectAlerts(
  body: Record<string, unknown>,
): CollectAlert[] {
  const alerts: CollectAlert[] = [];

  for (const row of collectAlertRows(body)) {
    const mapped = fieldMap(row);
    const debitCredit = (
      readString(mapped, ['debit_credit', 'txn_type', 'type']) ?? ''
    ).toLowerCase();

    if (debitCredit && debitCredit !== 'credit') {
      continue;
    }

    const amount = readAmount(mapped);
    const virtualAccount = readString(mapped, [
      'virtual_account',
      'virtual_account_no',
      'virtual_account_number',
    ]);

    if (amount === null || amount <= 0 || !virtualAccount) {
      continue;
    }

    const utr = readString(mapped, [
      'user_reference_number',
      'utr',
      'bank_ref',
      'bankref',
    ]);
    const sequence = readString(mapped, [
      'alert_sequence_no',
      'alert_sequence_number',
    ]);
    const dedupeKey = utr || sequence;

    if (!dedupeKey) {
      continue;
    }

    alerts.push({
      amount: Number(amount.toFixed(2)),
      virtualAccount: virtualAccount.toUpperCase(),
      utr,
      dedupeKey,
      remitterName: readString(mapped, ['remitter_name']),
      remitterAccount: readString(mapped, ['remitter_account']),
      debitCredit: debitCredit || 'credit',
    });
  }

  return alerts;
}
