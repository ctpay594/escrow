'use client';

import { Toaster } from 'sonner';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: 'border border-border bg-card text-card-foreground shadow-lg',
          },
        }}
      />
    </>
  );
}
