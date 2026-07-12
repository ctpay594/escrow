'use client';

import { useState } from 'react';

export function CopyButton({
  value,
  label = 'Copy',
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable
    }
  }

  if (!value || value === '—') {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="mt-1 text-xs font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}
