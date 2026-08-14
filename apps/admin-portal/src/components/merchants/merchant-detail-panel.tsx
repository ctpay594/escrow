'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AccountStatusToggle,
  type MerchantAccountStatus,
} from '@/components/merchants/account-status-toggle';
import {
  BalanceModeToggle,
  type BalanceMode,
} from '@/components/merchants/balance-mode-toggle';
import { CopyField } from '@/components/shared/copy-field';
import { ErrorCard } from '@/components/shared/page-header';
import { MerchantTransfersPanel } from '@/components/merchants/merchant-transfers-panel';
import {
  SeriousConfirmDialog,
  type SeriousConfirmOptions,
} from '@/components/shared/serious-confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';
import { updateMerchantBalanceMode } from '@/lib/merchant-balance';
import { updateMerchantAccountStatus } from '@/lib/merchant-account-status';

interface ManagedMerchant {
  id: string;
  username: string;
  password: string;
  merchant_name: string;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  real_balance: number;
  demo_balance: number;
  available_balance: number;
  pending_balance: number;
  balance_mode: BalanceMode;
  account_status: MerchantAccountStatus;
  created_at?: string;
}

interface MerchantDetailPanelProps {
  merchantId: string;
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function MerchantDetailPanel({ merchantId }: MerchantDetailPanelProps) {
  const router = useRouter();
  const [merchant, setMerchant] = useState<ManagedMerchant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [editUsername, setEditUsername] = useState(false);
  const [editPassword, setEditPassword] = useState(false);
  const [editDemo, setEditDemo] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [demoBalance, setDemoBalance] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOptions, setConfirmOptions] =
    useState<SeriousConfirmOptions | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(
    null,
  );

  const loadMerchant = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/users', { cache: 'no-store' });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load merchant');
      }

      const found = (data as ManagedMerchant[]).find(
        (item) => item.id === merchantId,
      );

      if (!found) {
        setError('Merchant not found');
        setMerchant(null);
        return;
      }

      const normalized = {
        ...found,
        balance_mode: found.balance_mode ?? 'demo',
        account_status: found.account_status ?? 'active',
        created_at: found.created_at,
      };

      setMerchant(normalized);
      setUsername(normalized.username);
      setPassword(normalized.password);
      setDemoBalance(String(normalized.demo_balance));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load merchant',
      );
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    void loadMerchant();
  }, [loadMerchant]);

  function askConfirmation(
    options: SeriousConfirmOptions,
    action: () => Promise<void>,
  ) {
    setConfirmOptions(options);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;

    setConfirmOpen(false);
    await confirmAction();
    setConfirmAction(null);
    setConfirmOptions(null);
  }

  async function changeBalanceMode(balanceMode: BalanceMode) {
    if (!merchant || merchant.balance_mode === balanceMode) {
      return;
    }

    askConfirmation(
      {
        title: `Switch portal to ${balanceMode === 'real' ? 'real bank' : 'demo'} balance?`,
        description: `${merchant.merchant_name} will see ${balanceMode === 'real' ? 'live bank' : 'demo ledger'} balance on CTPay.`,
        confirmLabel: 'Yes, switch',
      },
      async () => {
        setIsUpdatingMode(true);

        try {
          const data = await updateMerchantBalanceMode(merchant.id, balanceMode);

          setMerchant((current) =>
            current
              ? {
                  ...current,
                  balance_mode: balanceMode,
                  available_balance: Number(data.available_balance),
                }
              : current,
          );
          toast.success('Portal balance source updated');
        } catch (modeError) {
          toast.error(
            modeError instanceof Error
              ? modeError.message
              : 'Failed to update balance mode',
          );
        } finally {
          setIsUpdatingMode(false);
        }
      },
    );
  }

  async function changeAccountStatus(accountStatus: MerchantAccountStatus) {
    if (!merchant || merchant.account_status === accountStatus) {
      return;
    }

    const statusCopy = {
      active: 'Active — full portal access including transfers.',
      on_hold:
        'On hold — merchant can view balance and history, but cannot submit transfers.',
      terminated:
        'Terminated — read-only portal access, no new transfers.',
    } as const;

    askConfirmation(
      {
        title: `Set account to ${accountStatus.replace('_', ' ')}?`,
        description: `${merchant.merchant_name}: ${statusCopy[accountStatus]}`,
        confirmLabel: 'Yes, update',
        destructive: accountStatus === 'terminated',
      },
      async () => {
        setIsUpdatingStatus(true);

        try {
          const data = await updateMerchantAccountStatus(
            merchant.id,
            accountStatus,
          );

          setMerchant((current) =>
            current
              ? {
                  ...current,
                  account_status: data.account_status,
                }
              : current,
          );
          toast.success('Account status updated');
        } catch (statusError) {
          toast.error(
            statusError instanceof Error
              ? statusError.message
              : 'Failed to update account status',
          );
        } finally {
          setIsUpdatingStatus(false);
        }
      },
    );
  }

  async function saveUsername() {
    if (!merchant) return;

    askConfirmation(
      {
        title: 'Update portal username?',
        description: `Change login username for ${merchant.merchant_name}.`,
        confirmLabel: 'Yes, update',
      },
      async () => {
        const response = await fetch(`/api/users/${merchant.id}/username`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });

        if (!response.ok) {
          const data = await response.json();
          toast.error(data.message ?? 'Failed to update username');
          return;
        }

        toast.success('Username updated');
        setEditUsername(false);
        await loadMerchant();
      },
    );
  }

  async function savePassword() {
    if (!merchant) return;

    askConfirmation(
      {
        title: 'Update portal password?',
        description: `Set a new password for ${merchant.merchant_name}.`,
        confirmLabel: 'Yes, update',
      },
      async () => {
        const response = await fetch(`/api/users/${merchant.id}/password`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        if (!response.ok) {
          const data = await response.json();
          toast.error(data.message ?? 'Failed to update password');
          return;
        }

        toast.success('Password updated');
        setEditPassword(false);
        await loadMerchant();
      },
    );
  }

  async function saveDemoBalance() {
    if (!merchant) return;

    askConfirmation(
      {
        title: 'Update demo balance?',
        description: `Set demo ledger to ${formatCurrency(Number(demoBalance))} for ${merchant.merchant_name}.`,
        confirmLabel: 'Yes, save',
      },
      async () => {
        const response = await fetch(`/api/users/${merchant.id}/demo-balance`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ demo_balance: Number(demoBalance) }),
        });

        if (!response.ok) {
          const data = await response.json();
          toast.error(data.message ?? 'Failed to update demo balance');
          return;
        }

        toast.success('Demo balance updated');
        setEditDemo(false);
        await loadMerchant();
      },
    );
  }

  function requestDeleteMerchant() {
    if (!merchant) return;

    askConfirmation(
      {
        title: 'Delete merchant permanently?',
        description: `This removes ${merchant.merchant_name} (${merchant.username}), portal access, and stored credentials. Transfers may remain in history.`,
        confirmLabel: 'Yes, delete',
        destructive: true,
      },
      async () => {
        const response = await fetch(`/api/users/${merchant.id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          const data = await response.json();
          toast.error(data.message ?? 'Failed to delete merchant');
          return;
        }

        toast.success('Merchant deleted');
        router.push('/');
        router.refresh();
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" className="-ml-2 w-fit" asChild>
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Merchants
          </Link>
        </Button>
        <ErrorCard message={error ?? 'Merchant not found'} />
      </div>
    );
  }

  const usesReal = merchant.balance_mode === 'real';

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1 h-8 px-2" asChild>
            <Link href="/">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Merchants
            </Link>
          </Button>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {merchant.merchant_name}
          </h1>
          <p className="text-sm text-muted-foreground">{merchant.username}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={requestDeleteMerchant}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          Delete
        </Button>
      </div>

      <GlassCard>
        <GlassCardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/50 pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">Portal status</span>
              <AccountStatusToggle
                value={merchant.account_status}
                disabled={isUpdatingStatus}
                onChange={(status) => void changeAccountStatus(status)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">CTPay shows</span>
              <BalanceModeToggle
                value={merchant.balance_mode}
                disabled={isUpdatingMode}
                onChange={(mode) => void changeBalanceMode(mode)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Real (collected)
              </p>
              <div className="mt-1 flex items-center gap-2">
                <p
                  className={
                    usesReal
                      ? 'text-xl font-semibold tabular-nums text-foreground'
                      : 'text-xl font-semibold tabular-nums text-muted-foreground'
                  }
                >
                  {formatCurrency(merchant.real_balance)}
                </p>
              </div>
              {merchant.pending_balance > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Pending{' '}
                  <span className="font-medium tabular-nums text-amber-700">
                    {formatCurrency(merchant.pending_balance)}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  From VA deposit callbacks
                </p>
              )}
            </div>

            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Demo (manual)
              </p>
              {editDemo ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={demoBalance}
                    onChange={(e) => setDemoBalance(e.target.value)}
                    className="h-8 max-w-[8rem]"
                  />
                  <Button size="sm" onClick={() => void saveDemoBalance()}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditDemo(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-2">
                  <p
                    className={
                      usesReal
                        ? 'text-xl font-semibold tabular-nums text-muted-foreground'
                        : 'text-xl font-semibold tabular-nums text-foreground'
                    }
                  >
                    {formatCurrency(merchant.demo_balance)}
                  </p>
                  <button
                    type="button"
                    aria-label="Edit demo balance"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setEditDemo(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      <GlassCard>
        <GlassCardHeader className="border-b border-white/50 py-3">
          <GlassCardTitle className="text-sm font-medium">Portal access</GlassCardTitle>
        </GlassCardHeader>
        <GlassCardContent className="divide-y divide-white/50 p-0">
          <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Username</p>
              {editUsername ? (
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="mt-1 h-8 max-w-xs"
                />
              ) : (
                <p className="font-medium">{merchant.username}</p>
              )}
            </div>
            <div className="flex gap-2">
              {editUsername ? (
                <>
                  <Button size="sm" onClick={() => void saveUsername()}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditUsername(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditUsername(true)}
                >
                  Edit
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Password</p>
              {editPassword ? (
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 h-8 max-w-xs"
                />
              ) : (
                <p className="font-mono text-sm">
                  {showPassword ? merchant.password : '••••••••'}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {editPassword ? (
                <>
                  <Button size="sm" onClick={() => void savePassword()}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditPassword(false)}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditPassword(true)}
                  >
                    Edit
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
            <CopyField label="Load account" value={merchant.virtual_account_no ?? ''} />
            <CopyField label="IFSC" value={merchant.escrow_ifsc ?? ''} />
          </div>
        </GlassCardContent>
      </GlassCard>

      <MerchantTransfersPanel
        merchantId={merchant.id}
        merchantName={merchant.merchant_name}
        embedded
      />

      <SeriousConfirmDialog
        open={confirmOpen}
        options={confirmOptions}
        onConfirm={() => void runConfirmedAction()}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmAction(null);
          setConfirmOptions(null);
        }}
      />
    </div>
  );
}
