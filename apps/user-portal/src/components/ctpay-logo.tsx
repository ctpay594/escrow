import Link from 'next/link';
import { CTPayMark } from '@/components/ctpay-mark';

export function CTPayLogo({ linked = false }: { linked?: boolean }) {
  const logo = (
    <span className="inline-flex items-center gap-3">
      <CTPayMark size={36} className="shrink-0 rounded-lg" />
      <span className="text-xl font-semibold tracking-tight text-zinc-900">
        CTPay
      </span>
    </span>
  );

  if (linked) {
    return (
      <Link href="/" className="inline-flex items-center transition hover:opacity-80">
        {logo}
      </Link>
    );
  }

  return logo;
}
