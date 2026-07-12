'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type AdminNav = 'merchants' | 'transfers';

const navItems: { href: string; id: AdminNav; label: string }[] = [
  { href: '/', id: 'merchants', label: 'Merchants' },
  { href: '/transfers', id: 'transfers', label: 'Transfers' },
];

export function AdminNav({ active }: { active: AdminNav }) {
  const [pendingCount, setPendingCount] = useState(0);

  const loadPendingCount = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/transfers?status=PENDING_APPROVAL',
      );

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as unknown[];
      setPendingCount(Array.isArray(data) ? data.length : 0);
    } catch {
      // Ignore — badge is optional feedback
    }
  }, []);

  useEffect(() => {
    void loadPendingCount();
  }, [loadPendingCount]);

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
            active === item.id
              ? 'bg-zinc-900 text-white'
              : 'text-zinc-600 hover:bg-zinc-100'
          }`}
        >
          {item.label}
          {item.id === 'transfers' && pendingCount > 0 ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                active === item.id
                  ? 'bg-amber-400 text-amber-950'
                  : 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
              }`}
            >
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
