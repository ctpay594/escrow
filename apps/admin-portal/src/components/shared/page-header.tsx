import type { LucideIcon } from 'lucide-react';
import { glassInset, glassSurface } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyStateIllustrated({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        glassSurface(),
        'flex flex-col items-center justify-center border-dashed border-slate-300/80 px-6 py-16 text-center',
      )}
    >
      <div
        className={cn(
          glassInset(),
          'flex h-14 w-14 items-center justify-center rounded-full',
        )}
      >
        <Icon className="h-7 w-7 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-4 text-base font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function ErrorCard({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        glassSurface(),
        'border-destructive/25 bg-red-50/55 p-6 backdrop-blur-md',
      )}
    >
      <p className="font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 text-sm font-medium text-foreground underline underline-offset-4 hover:no-underline"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
