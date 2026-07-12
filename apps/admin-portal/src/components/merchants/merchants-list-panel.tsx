'use client';

import { useRouter } from 'next/navigation';
import { ChevronRight, Pencil, Plus, RefreshCw, Search, Users } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { BalanceMode } from '@/components/merchants/balance-mode-toggle';
import { BalanceModeToggle } from '@/components/merchants/balance-mode-toggle';
import {
  EmptyStateIllustrated,
  ErrorCard,
  PageHeader,
} from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { glassInset, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { updateMerchantBalanceMode } from '@/lib/merchant-balance';
import { cn } from '@/lib/utils';

interface ManagedMerchant {
  id: string;
  username: string;
  merchant_name: string;
  available_balance: number;
  real_balance: number;
  demo_balance: number;
  pending_balance: number;
  balance_mode: BalanceMode;
  account_status?: 'active' | 'on_hold' | 'terminated';
}

interface EscrowPreview {
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  real_balance: number;
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function MerchantsListPanel() {
  const router = useRouter();
  const [merchants, setMerchants] = useState<ManagedMerchant[]>([]);
  const [pendingByUser, setPendingByUser] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [escrowApiKey, setEscrowApiKey] = useState('');
  const [escrowPrivateKey, setEscrowPrivateKey] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [fetchedDetails, setFetchedDetails] = useState<EscrowPreview | null>(null);
  const [newMerchantName, setNewMerchantName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDemoBalance, setNewDemoBalance] = useState('');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [editingDemoId, setEditingDemoId] = useState<string | null>(null);
  const [demoDraft, setDemoDraft] = useState('');
  const [savingDemoId, setSavingDemoId] = useState<string | null>(null);
  const [updatingModeId, setUpdatingModeId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);

    try {
      const [usersResponse, pendingResponse] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/transfers?status=PENDING_APPROVAL', { cache: 'no-store' }),
      ]);

      const usersData = await usersResponse.json();
      const pendingData = await pendingResponse.json();

      if (redirectToLoginIfUnauthorized(usersResponse)) {
        return;
      }

      if (!usersResponse.ok) {
        throw new Error(usersData.message ?? 'Failed to load merchants');
      }

      setMerchants(
        (usersData as ManagedMerchant[]).map((merchant) => ({
          ...merchant,
          balance_mode: merchant.balance_mode ?? 'demo',
        })),
      );

      if (Array.isArray(pendingData)) {
        const counts: Record<string, number> = {};
        for (const transfer of pendingData as { user_id: string }[]) {
          counts[transfer.user_id] = (counts[transfer.user_id] ?? 0) + 1;
        }
        setPendingByUser(counts);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load merchants',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isLoading) {
      setOnboardingOpen(merchants.length === 0);
    }
  }, [isLoading, merchants.length]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return merchants;

    return merchants.filter(
      (merchant) =>
        merchant.merchant_name.toLowerCase().includes(query) ||
        merchant.username.toLowerCase().includes(query),
    );
  }, [merchants, search]);

  const totalPendingApprovals = useMemo(
    () => Object.values(pendingByUser).reduce((sum, count) => sum + count, 0),
    [pendingByUser],
  );

  const totalPendingBalance = useMemo(
    () =>
      merchants.reduce(
        (sum, merchant) => sum + Number(merchant.pending_balance ?? 0),
        0,
      ),
    [merchants],
  );

  const totalBankBalance = useMemo(
    () =>
      merchants.reduce(
        (sum, merchant) => sum + Number(merchant.real_balance ?? 0),
        0,
      ),
    [merchants],
  );

  async function changeMerchantBalanceMode(
    merchant: ManagedMerchant,
    balanceMode: BalanceMode,
  ) {
    if (merchant.balance_mode === balanceMode) {
      return;
    }

    setUpdatingModeId(merchant.id);

    try {
      const data = await updateMerchantBalanceMode(merchant.id, balanceMode);

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                balance_mode: balanceMode,
                available_balance: Number(data.available_balance),
              }
            : row,
        ),
      );
      toast.success(`${merchant.merchant_name}: portal shows ${balanceMode}`);
    } catch (modeError) {
      toast.error(
        modeError instanceof Error
          ? modeError.message
          : 'Failed to update balance mode',
      );
    } finally {
      setUpdatingModeId(null);
    }
  }

  async function refreshMerchantBalance(merchant: ManagedMerchant) {
    setRefreshingId(merchant.id);

    try {
      const response = await fetch(
        `/api/users/${merchant.id}/refresh-balance`,
        { method: 'POST' },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to fetch real balance');
      }

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                real_balance: Number(data.real_balance),
                available_balance:
                  row.balance_mode === 'real'
                    ? Math.max(Number(data.real_balance) - row.pending_balance, 0)
                    : row.available_balance,
              }
            : row,
        ),
      );
      toast.success(
        `${merchant.merchant_name}: ${formatCurrency(Number(data.real_balance))} (bank)`,
      );
    } catch (refreshError) {
      toast.error(
        refreshError instanceof Error
          ? refreshError.message
          : 'Failed to fetch real balance',
      );
    } finally {
      setRefreshingId(null);
    }
  }

  async function saveMerchantDemoBalance(merchant: ManagedMerchant) {
    const nextBalance = Number(demoDraft);
    if (!Number.isFinite(nextBalance) || nextBalance < 0) {
      toast.error('Enter a valid demo balance');
      return;
    }

    setSavingDemoId(merchant.id);

    try {
      const response = await fetch(`/api/users/${merchant.id}/demo-balance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo_balance: nextBalance }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update demo balance');
      }

      setMerchants((current) =>
        current.map((row) =>
          row.id === merchant.id
            ? {
                ...row,
                demo_balance: nextBalance,
                available_balance:
                  row.balance_mode === 'demo' ? nextBalance : row.available_balance,
              }
            : row,
        ),
      );
      setEditingDemoId(null);
      toast.success(`${merchant.merchant_name}: demo ${formatCurrency(nextBalance)}`);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : 'Failed to update demo balance',
      );
    } finally {
      setSavingDemoId(null);
    }
  }

  async function handleFetchDetails() {
    setIsFetching(true);

    try {
      const response = await fetch('/api/users/fetch-escrow-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_api_key: escrowApiKey.trim(),
          escrow_private_key: escrowPrivateKey.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to fetch EscrowStack details');
      }

      setFetchedDetails(data);
      setNewDemoBalance(String(data.real_balance ?? 0));
      toast.success('EscrowStack details loaded');
    } catch (fetchError) {
      toast.error(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to fetch details',
      );
    } finally {
      setIsFetching(false);
    }
  }

  async function handleCreateMerchant(event: FormEvent) {
    event.preventDefault();
    setIsCreating(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          escrow_api_key: escrowApiKey.trim(),
          escrow_private_key: escrowPrivateKey.trim(),
          merchant_name: newMerchantName.trim(),
          username: newUsername.trim(),
          password: newPassword.trim(),
          demo_balance: Number(newDemoBalance),
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to create merchant');
      }

      toast.success(`Merchant "${newMerchantName}" created`);
      setEscrowApiKey('');
      setEscrowPrivateKey('');
      setFetchedDetails(null);
      setNewMerchantName('');
      setNewUsername('');
      setNewPassword('');
      setNewDemoBalance('');
      setOnboardingOpen(false);
      await loadData();
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : 'Failed to create merchant',
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merchants"
        description="Open a merchant to approve transfers and manage balances."
        action={
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh list
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard>
          <GlassCardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Merchants
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : merchants.length}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">On platform</p>
          </GlassCardContent>
        </GlassCard>
        <GlassCard>
          <GlassCardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pending approvals
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : totalPendingApprovals}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Transfers awaiting action
            </p>
          </GlassCardContent>
        </GlassCard>
        <GlassCard>
          <GlassCardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total pending balance
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : formatCurrency(totalPendingBalance)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sum of all merchants
            </p>
          </GlassCardContent>
        </GlassCard>
        <GlassCard>
          <GlassCardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Total bank (real)
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">
              {isLoading ? '—' : formatCurrency(totalBankBalance)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sum of all merchants
            </p>
          </GlassCardContent>
        </GlassCard>
      </div>

      <GlassCard className="overflow-hidden border-dashed border-slate-300/80">
        <GlassCardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b border-white/50 px-5 py-4">
          <div>
            <GlassCardTitle className="text-sm font-medium">Onboard merchant</GlassCardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              EscrowStack keys are encrypted at rest and never shown again.
            </p>
          </div>
          <Button
            variant={onboardingOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setOnboardingOpen((open) => !open)}
          >
            <Plus className="mr-2 h-4 w-4" />
            {onboardingOpen ? 'Hide form' : 'Add merchant'}
          </Button>
        </GlassCardHeader>
        {onboardingOpen ? (
          <GlassCardContent className="space-y-4 border-t border-white/50 pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>EscrowStack API key</Label>
                <textarea
                  rows={2}
                  value={escrowApiKey}
                  onChange={(e) => {
                    setEscrowApiKey(e.target.value);
                    setFetchedDetails(null);
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  placeholder="JWT apikey"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Private key</Label>
                <textarea
                  rows={4}
                  value={escrowPrivateKey}
                  onChange={(e) => {
                    setEscrowPrivateKey(e.target.value);
                    setFetchedDetails(null);
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
                  placeholder="-----BEGIN PRIVATE KEY-----"
                />
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={isFetching || !escrowApiKey.trim() || !escrowPrivateKey.trim()}
              onClick={() => void handleFetchDetails()}
            >
              {isFetching ? 'Fetching…' : 'Fetch EscrowStack details'}
            </Button>

            {fetchedDetails ? (
              <form onSubmit={(e) => void handleCreateMerchant(e)} className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-muted-foreground">Real balance</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(fetchedDetails.real_balance)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Virtual account</p>
                    <p className="font-mono text-xs">
                      {fetchedDetails.virtual_account_no ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">IFSC</p>
                    <p className="font-mono text-xs">
                      {fetchedDetails.escrow_ifsc ?? '—'}
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Merchant name</Label>
                    <Input
                      required
                      value={newMerchantName}
                      onChange={(e) => setNewMerchantName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Demo balance</Label>
                    <Input
                      required
                      type="number"
                      min={0}
                      step="0.01"
                      value={newDemoBalance}
                      onChange={(e) => setNewDemoBalance(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Portal username</Label>
                    <Input
                      required
                      minLength={3}
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Portal password</Label>
                    <Input
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? 'Creating…' : 'Create merchant'}
                </Button>
              </form>
            ) : null}
          </GlassCardContent>
        ) : null}
      </GlassCard>

      <GlassCard className="overflow-hidden">
        <GlassCardHeader className="flex flex-col gap-4 border-b border-white/50 bg-white/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <GlassCardTitle className="text-base font-semibold">Merchant accounts</GlassCardTitle>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isLoading
                ? 'Loading…'
                : `${filtered.length} merchant${filtered.length === 1 ? '' : 's'} · click a row to open`}
            </p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search merchants..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 bg-white/60 pl-9 backdrop-blur-sm"
            />
          </div>
        </GlassCardHeader>
        <GlassCardContent className="p-0">
          {error ? (
            <div className="p-5">
              <ErrorCard message={error} onRetry={() => void loadData()} />
            </div>
          ) : isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="mx-5 my-4 h-12 rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyStateIllustrated
                icon={Users}
                title={merchants.length === 0 ? 'No merchants yet' : 'No matches'}
                description={
                  merchants.length === 0
                    ? 'Onboard your first merchant to get started.'
                    : 'Try a different search term.'
                }
                action={
                  merchants.length === 0 ? (
                    <Button size="sm" onClick={() => setOnboardingOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add merchant
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className={glassTableHead()}>
                    <th className="px-5 py-3 text-left">Merchant</th>
                    <th className="px-4 py-3 text-right">Real (bank)</th>
                    <th className="px-4 py-3 text-right">Demo (portal)</th>
                    <th className="px-4 py-3 text-right">Pending</th>
                    <th className="px-4 py-3 text-center">Portal</th>
                    <th className="w-36 px-5 py-3 text-right" aria-hidden />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/50">
                  {filtered.map((merchant) => {
                    const pendingApprovals = pendingByUser[merchant.id] ?? 0;
                    const isRefreshing = refreshingId === merchant.id;
                    const isEditingDemo = editingDemoId === merchant.id;
                    const isSavingDemo = savingDemoId === merchant.id;
                    const isUpdatingMode = updatingModeId === merchant.id;
                    const usesReal = merchant.balance_mode === 'real';

                    return (
                      <tr
                        key={merchant.id}
                        className={cn(
                          'cursor-pointer',
                          glassTableRow(
                            pendingApprovals > 0 ? 'attention' : 'default',
                          ),
                        )}
                        onClick={() => router.push(`/merchants/${merchant.id}`)}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                glassInset(),
                                'flex h-9 w-9 shrink-0 items-center justify-center text-xs font-semibold uppercase text-muted-foreground',
                              )}
                            >
                              {merchant.merchant_name.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-foreground">
                                  {merchant.merchant_name}
                                </span>
                                {merchant.account_status === 'on_hold' ? (
                                  <Badge variant="warning" className="text-[10px]">
                                    On hold
                                  </Badge>
                                ) : null}
                                {merchant.account_status === 'terminated' ? (
                                  <Badge variant="destructive" className="text-[10px]">
                                    Terminated
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {merchant.username}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <span
                              className={
                                usesReal
                                  ? 'font-semibold tabular-nums text-foreground'
                                  : 'font-medium tabular-nums text-muted-foreground'
                              }
                            >
                              {formatCurrency(merchant.real_balance)}
                            </span>
                            <button
                              type="button"
                              disabled={isRefreshing}
                              aria-label={`Refresh bank balance for ${merchant.merchant_name}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground disabled:opacity-50"
                              onClick={(event) => {
                                event.stopPropagation();
                                void refreshMerchantBalance(merchant);
                              }}
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                              />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {isEditingDemo ? (
                            <div
                              className="ml-auto inline-flex flex-col items-end gap-2"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={demoDraft}
                                onChange={(e) => setDemoDraft(e.target.value)}
                                className="h-8 w-28 text-right tabular-nums"
                              />
                              <div className="flex gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={isSavingDemo}
                                  onClick={() => void saveMerchantDemoBalance(merchant)}
                                >
                                  Save
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={isSavingDemo}
                                  onClick={() => setEditingDemoId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <span
                                className={
                                  usesReal
                                    ? 'font-medium tabular-nums text-muted-foreground'
                                    : 'font-semibold tabular-nums text-foreground'
                                }
                              >
                                {formatCurrency(merchant.demo_balance)}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Edit demo balance for ${merchant.merchant_name}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setEditingDemoId(merchant.id);
                                  setDemoDraft(String(merchant.demo_balance));
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-medium tabular-nums text-foreground">
                          {formatCurrency(merchant.pending_balance)}
                        </td>
                        <td
                          className="px-4 py-3.5 text-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <BalanceModeToggle
                            value={merchant.balance_mode}
                            disabled={isUpdatingMode}
                            onChange={(mode) =>
                              void changeMerchantBalanceMode(merchant, mode)
                            }
                          />
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {pendingApprovals > 0 ? (
                              <Badge variant="warning" className="text-[10px]">
                                {pendingApprovals} to approve
                              </Badge>
                            ) : null}
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
