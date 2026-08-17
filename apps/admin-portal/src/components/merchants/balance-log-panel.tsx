'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { GlassSegmentedControl } from '@/components/ui/glass-segmented-control';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface LedgerEntry {
  id: string;
  direction: 'credit' | 'debit';
  amount: number;
  reason: string;
  ref_id: string;
  note: string | null;
  real_before: number | null;
  real_after: number | null;
  created_at: string;
}

const PAGE_SIZE = 20;

const STATEMENT_REASONS = new Set([
  'deposit',
  'payout_success',
  'payout_release',
  'payout_bank_reversal',
  'demo_adjust',
  'balance_correction',
]);

const LEDGER_REASON_LABELS: Record<string, string> = {
  deposit: 'Money in',
  payout_hold: 'On hold',
  payout_success: 'Paid out',
  payout_release: 'Hold released',
  payout_bank_reversal: 'Returned by bank',
  demo_adjust: 'Demo balance edit',
  balance_correction: 'Balance correction',
};

type LedgerView = 'statement' | 'audit';

type LedgerRow =
  | { kind: 'single'; entry: LedgerEntry }
  | { kind: 'group'; key: string; entries: LedgerEntry[] };

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
  });
}

function istSecondKey(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function groupStatementRows(entries: LedgerEntry[]): LedgerRow[] {
  const rows: LedgerRow[] = [];

  for (const entry of entries) {
    const last = rows[rows.length - 1];

    if (
      entry.reason === 'payout_success' &&
      last?.kind === 'group' &&
      last.entries[0]?.reason === 'payout_success' &&
      istSecondKey(last.entries[0].created_at) === istSecondKey(entry.created_at)
    ) {
      last.entries.push(entry);
      continue;
    }

    if (
      entry.reason === 'payout_success' &&
      last?.kind === 'single' &&
      last.entry.reason === 'payout_success' &&
      istSecondKey(last.entry.created_at) === istSecondKey(entry.created_at)
    ) {
      rows[rows.length - 1] = {
        kind: 'group',
        key: `${istSecondKey(entry.created_at)}:${entry.id}`,
        entries: [last.entry, entry],
      };
      continue;
    }

    rows.push({ kind: 'single', entry });
  }

  return rows;
}

function amountClass(
  entry: LedgerEntry,
  audit: boolean,
): string {
  if (audit && (entry.reason === 'payout_hold' || entry.reason === 'payout_release')) {
    return 'text-muted-foreground';
  }

  return entry.direction === 'credit' ? 'text-emerald-600' : 'text-red-600';
}

function amountPrefix(entry: LedgerEntry, audit: boolean) {
  if (audit && entry.reason === 'payout_hold') {
    return '';
  }

  return entry.direction === 'credit' ? '+' : '−';
}

function LedgerEntryCells({
  entry,
  audit,
}: {
  entry: LedgerEntry;
  audit: boolean;
}) {
  const holdUnchanged =
    entry.reason === 'payout_hold' || entry.reason === 'payout_release';

  return (
    <>
      <td className="whitespace-nowrap px-4 py-2 text-xs">
        {formatWhen(entry.created_at)}
      </td>
      <td className="px-4 py-2">
        {LEDGER_REASON_LABELS[entry.reason] ?? entry.reason}
        {entry.note ? (
          <span className="block text-xs text-muted-foreground">{entry.note}</span>
        ) : null}
        {audit && holdUnchanged ? (
          <span className="block text-xs text-muted-foreground">
            Collected not changed
          </span>
        ) : null}
      </td>
      <td className={cn('px-4 py-2 font-medium', amountClass(entry, audit))}>
        {amountPrefix(entry, audit)}
        {formatCurrency(entry.amount)}
      </td>
      <td className="px-4 py-2">
        {entry.real_after == null ? '—' : formatCurrency(entry.real_after)}
      </td>
    </>
  );
}

interface BalanceLogPanelProps {
  ledger: LedgerEntry[];
}

export function BalanceLogPanel({ ledger }: BalanceLogPanelProps) {
  const [view, setView] = useState<LedgerView>('statement');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => {
    if (view === 'audit') {
      return ledger.map((entry) => ({ kind: 'single' as const, entry }));
    }

    const visible = ledger.filter((entry) => STATEMENT_REASONS.has(entry.reason));
    return groupStatementRows(visible);
  }, [ledger, view]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function changeView(next: LedgerView) {
    setView(next);
    setPage(1);
    setExpanded({});
  }

  return (
    <GlassCard>
      <GlassCardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <GlassCardTitle>
          {view === 'statement' ? 'Collected statement' : 'Audit log'}
        </GlassCardTitle>
        <GlassSegmentedControl
          ariaLabel="Ledger view"
          value={view}
          onChange={changeView}
          options={[
            { value: 'statement', label: 'Statement' },
            { value: 'audit', label: 'Audit' },
          ]}
        />
      </GlassCardHeader>
      <GlassCardContent>
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          {view === 'statement'
            ? 'Money that actually moved in or out of collected balance. Same-second bulk payouts are grouped. Holds are hidden.'
            : 'Every internal step, including holds. A hold is a reserve, not a second payout.'}
        </p>
        {ledger.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No log rows yet. New balance changes will appear here.
          </p>
        ) : paged.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No statement rows in this view.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">What</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Collected after</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row) => {
                    if (row.kind === 'single') {
                      return (
                        <tr key={row.entry.id} className="border-b last:border-0">
                          <LedgerEntryCells
                            entry={row.entry}
                            audit={view === 'audit'}
                          />
                        </tr>
                      );
                    }

                    const total = row.entries.reduce(
                      (sum, entry) => sum + entry.amount,
                      0,
                    );
                    const latest = row.entries[0];
                    const open = Boolean(expanded[row.key]);

                    return (
                      <Fragment key={row.key}>
                        <tr className="border-b last:border-0">
                          <td className="whitespace-nowrap px-4 py-2 text-xs">
                            {formatWhen(latest.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-medium"
                              onClick={() =>
                                setExpanded((current) => ({
                                  ...current,
                                  [row.key]: !current[row.key],
                                }))
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  'h-3.5 w-3.5 transition-transform',
                                  open ? 'rotate-0' : '-rotate-90',
                                )}
                              />
                              {row.entries.length} payouts
                            </button>
                          </td>
                          <td className="px-4 py-2 font-medium text-red-600">
                            −{formatCurrency(total)}
                          </td>
                          <td className="px-4 py-2">
                            {latest.real_after == null
                              ? '—'
                              : formatCurrency(latest.real_after)}
                          </td>
                        </tr>
                        {open
                          ? row.entries.map((entry) => (
                              <tr
                                key={entry.id}
                                className="border-b bg-muted/30 last:border-0"
                              >
                                <LedgerEntryCells entry={entry} audit={false} />
                              </tr>
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-white/50 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {rows.length} row{rows.length === 1 ? '' : 's'} · {PAGE_SIZE} per
                page
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm tabular-nums">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </GlassCardContent>
    </GlassCard>
  );
}
