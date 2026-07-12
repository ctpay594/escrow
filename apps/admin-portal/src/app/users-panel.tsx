'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CopyButton } from '@/components/copy-button';
import {
  Alert,
  EmptyState,
  inputClassName,
  LoadingBlock,
  SectionCard,
  StatCard,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
} from '@/components/ui';

interface ManagedMerchant {
  id: string;
  username: string;
  password: string;
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  real_balance: number;
  demo_balance: number;
  available_balance: number;
  pending_balance: number;
  created_at: string;
  updated_at: string;
}

interface EscrowPreview {
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  real_balance: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(value);
}

function BalancePanel({
  merchant,
  isEditingDemo,
  editDemoBalance,
  isRefreshing,
  onEditDemoChange,
  onStartEditDemo,
  onSaveDemo,
  onCancelEdit,
  onRefreshReal,
}: {
  merchant: ManagedMerchant;
  isEditingDemo: boolean;
  editDemoBalance: string;
  isRefreshing: boolean;
  onEditDemoChange: (value: string) => void;
  onStartEditDemo: () => void;
  onSaveDemo: () => void;
  onCancelEdit: () => void;
  onRefreshReal: () => void;
}) {
  const balancesMatch = merchant.real_balance === merchant.demo_balance;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
      <div className="grid grid-cols-2 divide-x divide-zinc-200">
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Real balance
            </p>
          </div>
          <p className="mt-3 text-2xl font-semibold text-zinc-900">
            {formatCurrency(merchant.real_balance)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Live from EscrowStack</p>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={onRefreshReal}
            className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRefreshing ? 'Refreshing...' : 'Refresh live'}
          </button>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Demo balance
            </p>
          </div>
          {isEditingDemo ? (
            <div className="mt-3 space-y-3">
              <input
                type="number"
                min={0}
                step="0.01"
                value={editDemoBalance}
                onChange={(event) => onEditDemoChange(event.target.value)}
                className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-amber-400 focus:ring-2"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSaveDemo}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 text-2xl font-semibold text-zinc-900">
                {formatCurrency(merchant.demo_balance)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Shown on user portal</p>
              <button
                type="button"
                onClick={onStartEditDemo}
                className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
              >
                Edit demo amount
              </button>
            </>
          )}
        </div>
      </div>

      {!balancesMatch ? (
        <div className="border-t border-zinc-200 bg-indigo-50 px-4 py-2 text-xs text-indigo-700">
          Demo differs from real by{' '}
          {formatCurrency(Math.abs(merchant.demo_balance - merchant.real_balance))}
        </div>
      ) : (
        <div className="border-t border-zinc-200 px-4 py-2 text-xs text-zinc-500">
          Real and demo balances are in sync
        </div>
      )}
    </div>
  );
}

function MerchantCard({
  merchant,
  editingUsernameId,
  editingPasswordId,
  editingDemoBalanceId,
  editUsername,
  editPassword,
  editDemoBalance,
  refreshingBalanceId,
  onEditUsernameChange,
  onEditPasswordChange,
  onEditDemoChange,
  onStartEditUsername,
  onStartEditPassword,
  onStartEditDemo,
  onSaveUsername,
  onSavePassword,
  onSaveDemo,
  onClearEdit,
  onRefreshReal,
  onDelete,
}: {
  merchant: ManagedMerchant;
  editingUsernameId: string | null;
  editingPasswordId: string | null;
  editingDemoBalanceId: string | null;
  editUsername: string;
  editPassword: string;
  editDemoBalance: string;
  refreshingBalanceId: string | null;
  onEditUsernameChange: (value: string) => void;
  onEditPasswordChange: (value: string) => void;
  onEditDemoChange: (value: string) => void;
  onStartEditUsername: () => void;
  onStartEditPassword: () => void;
  onStartEditDemo: () => void;
  onSaveUsername: () => void;
  onSavePassword: () => void;
  onSaveDemo: () => void;
  onClearEdit: () => void;
  onRefreshReal: () => void;
  onDelete: () => void;
}) {
  const isEditingUsername = editingUsernameId === merchant.id;
  const isEditingPassword = editingPasswordId === merchant.id;
  const isEditingDemo = editingDemoBalanceId === merchant.id;
  const [showPassword, setShowPassword] = useState(false);

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900">
            {merchant.merchant_name}
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            Portal user ·{' '}
            {isEditingUsername ? (
              <span className="inline-flex items-center gap-2">
                <input
                  type="text"
                  minLength={3}
                  value={editUsername}
                  onChange={(event) => onEditUsernameChange(event.target.value)}
                  className="rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-sm text-zinc-900"
                />
                <button
                  type="button"
                  onClick={onSaveUsername}
                  className="text-zinc-700 hover:text-zinc-900"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onClearEdit}
                  className="text-zinc-600 hover:text-zinc-700"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <span className="font-medium text-zinc-800">{merchant.username}</span>
            )}
          </p>
          {merchant.pending_balance > 0 ? (
            <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
              {formatCurrency(merchant.pending_balance)} pending
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50"
        >
          Delete merchant
        </button>
      </div>

      <div className="mt-5">
        <BalancePanel
          merchant={merchant}
          isEditingDemo={isEditingDemo}
          editDemoBalance={editDemoBalance}
          isRefreshing={refreshingBalanceId === merchant.id}
          onEditDemoChange={onEditDemoChange}
          onStartEditDemo={onStartEditDemo}
          onSaveDemo={onSaveDemo}
          onCancelEdit={onClearEdit}
          onRefreshReal={onRefreshReal}
        />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-emerald-700">
            Available (portal)
          </p>
          <p className="mt-1 text-lg font-semibold text-emerald-900">
            {formatCurrency(merchant.available_balance)}
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-amber-700">
            Pending transfers
          </p>
          <p className="mt-1 text-lg font-semibold text-amber-900">
            {formatCurrency(merchant.pending_balance)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Password</p>
          {isEditingPassword ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                minLength={6}
                value={editPassword}
                onChange={(event) => onEditPasswordChange(event.target.value)}
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900"
              />
              <button
                type="button"
                onClick={onSavePassword}
                className="shrink-0 text-zinc-700 hover:text-zinc-900"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-zinc-800">
                {showPassword ? merchant.password : '••••••••'}
              </p>
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Load account</p>
          <p className="mt-1 font-mono text-sm text-zinc-800">
            {merchant.virtual_account_no ?? '—'}
          </p>
          <CopyButton value={merchant.virtual_account_no ?? ''} />
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-zinc-500">IFSC</p>
          <p className="mt-1 font-mono text-sm text-zinc-800">
            {merchant.escrow_ifsc ?? '—'}
          </p>
          <CopyButton value={merchant.escrow_ifsc ?? ''} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-200 pt-4">
        {!isEditingUsername ? (
          <button
            type="button"
            onClick={onStartEditUsername}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Edit username
          </button>
        ) : null}
        {!isEditingPassword ? (
          <button
            type="button"
            onClick={onStartEditPassword}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          >
            Edit password
          </button>
        ) : null}
        {isEditingPassword ? (
          <button
            type="button"
            onClick={onClearEdit}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100"
          >
            Cancel password edit
          </button>
        ) : null}
      </div>
    </article>
  );
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function UsersPanel() {
  const [merchants, setMerchants] = useState<ManagedMerchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [escrowApiKey, setEscrowApiKey] = useState('');
  const [escrowPrivateKey, setEscrowPrivateKey] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [fetchedDetails, setFetchedDetails] = useState<EscrowPreview | null>(
    null,
  );

  const [newMerchantName, setNewMerchantName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDemoBalance, setNewDemoBalance] = useState('');

  const [editingUsernameId, setEditingUsernameId] = useState<string | null>(
    null,
  );
  const [editUsername, setEditUsername] = useState('');

  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(
    null,
  );
  const [editPassword, setEditPassword] = useState('');

  const [editingDemoBalanceId, setEditingDemoBalanceId] = useState<string | null>(
    null,
  );
  const [editDemoBalance, setEditDemoBalance] = useState('');

  const [refreshingBalanceId, setRefreshingBalanceId] = useState<string | null>(
    null,
  );
  const [merchantSearch, setMerchantSearch] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(true);

  const loadMerchants = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/users');
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load merchants');
      }

      setMerchants(data);
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
    void loadMerchants();
  }, [loadMerchants]);

  useEffect(() => {
    if (!isLoading) {
      setOnboardingOpen(merchants.length === 0);
    }
  }, [isLoading, merchants.length]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  const filteredMerchants = useMemo(() => {
    const query = merchantSearch.trim().toLowerCase();

    if (!query) {
      return merchants;
    }

    return merchants.filter(
      (merchant) =>
        merchant.merchant_name.toLowerCase().includes(query) ||
        merchant.username.toLowerCase().includes(query) ||
        (merchant.user_ref?.toLowerCase().includes(query) ?? false),
    );
  }, [merchants, merchantSearch]);

  const totalPending = useMemo(
    () => merchants.reduce((sum, m) => sum + m.pending_balance, 0),
    [merchants],
  );

  function clearEditState() {
    setEditingUsernameId(null);
    setEditUsername('');
    setEditingPasswordId(null);
    setEditPassword('');
    setEditingDemoBalanceId(null);
    setEditDemoBalance('');
  }

  function resetOnboardingForm() {
    setEscrowApiKey('');
    setEscrowPrivateKey('');
    setFetchedDetails(null);
    setNewMerchantName('');
    setNewUsername('');
    setNewPassword('');
    setNewDemoBalance('');
  }

  async function handleFetchDetails() {
    setIsFetching(true);
    setError(null);
    setSuccess(null);
    setFetchedDetails(null);

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

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to fetch EscrowStack details');
      }

      setFetchedDetails(data as EscrowPreview);
      setNewDemoBalance(String((data as EscrowPreview).real_balance));
      setSuccess('EscrowStack details fetched. Set portal login below.');
    } catch (fetchError) {
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : 'Failed to fetch EscrowStack details',
      );
    } finally {
      setIsFetching(false);
    }
  }

  async function handleCreateMerchant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!fetchedDetails) {
      setError('Fetch EscrowStack details before creating the merchant.');
      return;
    }

    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          merchant_name: newMerchantName,
          demo_balance: Number.parseFloat(newDemoBalance) || 0,
          escrow_api_key: escrowApiKey.trim(),
          escrow_private_key: escrowPrivateKey.trim(),
        }),
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to onboard merchant');
      }

      resetOnboardingForm();
      setSuccess(
        `Merchant "${data.merchant.merchant_name}" created. Demo balance: ${formatCurrency(data.merchant.available_balance)}`,
      );
      await loadMerchants();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to onboard merchant',
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function handleUpdateUsername(userId: string) {
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/users/${userId}/username`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: editUsername }),
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update username');
      }

      clearEditState();
      setSuccess(`Username updated to "${data.username}".`);
      await loadMerchants();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update username',
      );
    }
  }

  async function handleUpdatePassword(userId: string) {
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/users/${userId}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: editPassword }),
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update password');
      }

      clearEditState();
      setSuccess(`Password updated for "${data.user.username}".`);
      await loadMerchants();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update password',
      );
    }
  }

  async function handleUpdateDemoBalance(userId: string) {
    setError(null);
    setSuccess(null);

    const demoBalance = Number.parseFloat(editDemoBalance);

    if (Number.isNaN(demoBalance) || demoBalance < 0) {
      setError('Enter a valid demo balance (0 or more).');
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}/demo-balance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo_balance: demoBalance }),
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to update demo balance');
      }

      clearEditState();
      setSuccess(`Demo balance updated to ${formatCurrency(demoBalance)}.`);
      await loadMerchants();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update demo balance',
      );
    }
  }

  async function handleRefreshRealBalance(userId: string) {
    setError(null);
    setSuccess(null);
    setRefreshingBalanceId(userId);

    try {
      const response = await fetch(`/api/users/${userId}/refresh-balance`, {
        method: 'POST',
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to refresh real balance');
      }

      setSuccess(
        `Real balance refreshed: ${formatCurrency(data.real_balance)}.`,
      );
      await loadMerchants();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Failed to refresh real balance',
      );
    } finally {
      setRefreshingBalanceId(null);
    }
  }

  async function handleDeleteMerchant(merchant: ManagedMerchant) {
    const confirmed = window.confirm(
      `Delete merchant "${merchant.merchant_name}" (${merchant.username})?`,
    );

    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/users/${merchant.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to delete merchant');
      }

      clearEditState();
      setSuccess(`Merchant "${merchant.merchant_name}" deleted.`);
      await loadMerchants();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete merchant',
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Merchants" value={String(merchants.length)} />
        <StatCard
          label="Total pending"
          value={formatCurrency(totalPending)}
          hint="Across all merchants"
        />
        <StatCard
          label="Demo balance (total)"
          value={formatCurrency(
            merchants.reduce((sum, m) => sum + m.demo_balance, 0),
          )}
          hint="Shown on user portals"
        />
      </section>

      <SectionCard
        title="Onboard merchant"
        description="EscrowStack keys are encrypted — never shown again after save."
        collapsible
        open={onboardingOpen}
        onToggle={() => setOnboardingOpen((open) => !open)}
      >
        <div className="grid gap-4">
          <textarea
            rows={3}
            placeholder="EscrowStack API key (JWT)"
            value={escrowApiKey}
            onChange={(event) => {
              setEscrowApiKey(event.target.value);
              setFetchedDetails(null);
            }}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
          />

          <textarea
            rows={5}
            placeholder="EscrowStack private key (PEM)"
            value={escrowPrivateKey}
            onChange={(event) => {
              setEscrowPrivateKey(event.target.value);
              setFetchedDetails(null);
            }}
            className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleFetchDetails()}
              disabled={
                isFetching ||
                escrowApiKey.trim().length < 20 ||
                escrowPrivateKey.trim().length < 20
              }
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFetching ? 'Fetching from EscrowStack...' : 'Fetch details'}
            </button>

            {fetchedDetails ? (
              <button
                type="button"
                onClick={resetOnboardingForm}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
              >
                Start over
              </button>
            ) : null}
          </div>
        </div>

        {fetchedDetails ? (
          <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
              EscrowStack details
            </h3>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                  Real balance (EscrowStack)
                </p>
                <p className="mt-2 text-2xl font-semibold text-emerald-800">
                  {formatCurrency(fetchedDetails.real_balance)}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                  Load account (AC_NO)
                </p>
                <p className="mt-2 font-mono text-sm text-zinc-900">
                  {fetchedDetails.virtual_account_no ?? '—'}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                  IFSC
                </p>
                <p className="mt-2 font-mono text-sm text-zinc-900">
                  {fetchedDetails.escrow_ifsc ?? '—'}
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateMerchant} className="mt-6 border-t border-zinc-200 pt-6">
              <h3 className="text-sm font-semibold text-zinc-900">
                Portal login
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Set merchant name, portal credentials, and the demo balance
                shown on the user portal.
              </p>

              <div className="mt-4 grid gap-4">
                <input
                  type="text"
                  required
                  minLength={2}
                  placeholder="Merchant name"
                  value={newMerchantName}
                  onChange={(event) => setNewMerchantName(event.target.value)}
                  className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                />
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                    Demo balance (user portal)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    step="0.01"
                    placeholder="Amount merchants will see"
                    value={newDemoBalance}
                    onChange={(event) => setNewDemoBalance(event.target.value)}
                    className="mt-2 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Defaults to real EscrowStack balance. Change this to show a
                    different amount on the user portal.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <input
                    type="text"
                    required
                    minLength={3}
                    placeholder="Portal username"
                    value={newUsername}
                    onChange={(event) => setNewUsername(event.target.value)}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                  />
                  <input
                    type="text"
                    required
                    minLength={6}
                    placeholder="Portal password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 focus:ring-2"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="mt-4 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
              >
                {isCreating ? 'Creating merchant...' : 'Create merchant'}
              </button>
            </form>
          </div>
        ) : null}
      </SectionCard>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}

      <SectionCard
        title="All merchants"
        description="Manage balances and portal credentials. Keys stay encrypted."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {merchants.length > 0 ? (
              <input
                type="search"
                value={merchantSearch}
                onChange={(event) => setMerchantSearch(event.target.value)}
                placeholder="Search merchants..."
                className={`${inputClassName()} max-w-xs`}
              />
            ) : null}
            <button
              type="button"
              onClick={() => {
                setIsLoading(true);
                void loadMerchants();
              }}
              className={buttonSecondaryClassName()}
            >
              Refresh
            </button>
          </div>
        }
      >
        {isLoading ? (
          <LoadingBlock label="Loading merchants..." />
        ) : merchants.length === 0 ? (
          <EmptyState
            title="No merchants yet"
            description="Onboard your first merchant using the form above."
          />
        ) : filteredMerchants.length === 0 ? (
          <EmptyState
            title="No matches"
            description="Try a different search term."
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {filteredMerchants.map((merchant) => (
              <MerchantCard
                key={merchant.id}
                merchant={merchant}
                editingUsernameId={editingUsernameId}
                editingPasswordId={editingPasswordId}
                editingDemoBalanceId={editingDemoBalanceId}
                editUsername={editUsername}
                editPassword={editPassword}
                editDemoBalance={editDemoBalance}
                refreshingBalanceId={refreshingBalanceId}
                onEditUsernameChange={setEditUsername}
                onEditPasswordChange={setEditPassword}
                onEditDemoChange={setEditDemoBalance}
                onStartEditUsername={() => {
                  setEditingUsernameId(merchant.id);
                  setEditUsername(merchant.username);
                  setEditingPasswordId(null);
                  setEditingDemoBalanceId(null);
                }}
                onStartEditPassword={() => {
                  setEditingPasswordId(merchant.id);
                  setEditPassword(merchant.password);
                  setEditingUsernameId(null);
                  setEditingDemoBalanceId(null);
                }}
                onStartEditDemo={() => {
                  setEditingDemoBalanceId(merchant.id);
                  setEditDemoBalance(String(merchant.demo_balance));
                  setEditingUsernameId(null);
                  setEditingPasswordId(null);
                }}
                onSaveUsername={() => void handleUpdateUsername(merchant.id)}
                onSavePassword={() => void handleUpdatePassword(merchant.id)}
                onSaveDemo={() => void handleUpdateDemoBalance(merchant.id)}
                onClearEdit={clearEditState}
                onRefreshReal={() => void handleRefreshRealBalance(merchant.id)}
                onDelete={() => void handleDeleteMerchant(merchant)}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
