export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(value);
}

export function formatDate(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SectionCard({
  title,
  description,
  children,
  action,
  collapsible,
  open,
  onToggle,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
        <div className="flex-1">
          {collapsible ? (
            <button
              type="button"
              onClick={onToggle}
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="text-zinc-400">{open ? '▾' : '▸'}</span>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
                {description ? (
                  <p className="mt-1 text-sm text-zinc-600">{description}</p>
                ) : null}
              </div>
            </button>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
              {description ? (
                <p className="mt-1 text-sm text-zinc-600">{description}</p>
              ) : null}
            </>
          )}
        </div>
        {action}
      </div>
      {(!collapsible || open) && <div className="p-6">{children}</div>}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-zinc-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: 'error' | 'success';
  children: React.ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };

  return (
    <p className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      {children}
    </p>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING_APPROVAL: 'bg-amber-100 text-amber-800 ring-amber-200',
    PROCESSING: 'bg-blue-100 text-blue-800 ring-blue-200',
    SUCCESS: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    FAILED: 'bg-red-100 text-red-800 ring-red-200',
    REJECTED: 'bg-red-100 text-red-800 ring-red-200',
  };

  const labels: Record<string, string> = {
    PENDING_APPROVAL: 'Pending approval',
    PROCESSING: 'Processing',
    SUCCESS: 'Completed',
    FAILED: 'Failed',
    REJECTED: 'Rejected',
  };

  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status] ?? 'bg-zinc-100 text-zinc-700 ring-zinc-200'}`}
    >
      {labels[status] ?? status.replaceAll('_', ' ')}
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center">
      <p className="text-sm font-medium text-zinc-800">{title}</p>
      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

export function LoadingBlock({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 px-6 py-10 text-sm text-zinc-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      {label}
    </div>
  );
}

export function inputClassName() {
  return 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-400 placeholder:text-zinc-400 focus:ring-2';
}

export function buttonPrimaryClassName() {
  return 'rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60';
}

export function buttonSecondaryClassName() {
  return 'rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60';
}
