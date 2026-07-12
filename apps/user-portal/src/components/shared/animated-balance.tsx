'use client';

import { animate } from 'framer-motion';
import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/format';

export function AnimatedBalance({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const controls = animate(display, value, {
      duration: 0.65,
      ease: 'easeOut',
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <span className="tabular-nums tracking-tight">{formatCurrency(display)}</span>
  );
}
