import Link from 'next/link';
import { CTPayMark } from '@/components/ctpay-mark';

export function AdminLogo({ linked = false }: { linked?: boolean }) {
  const logo = (
    <span className="inline-flex items-center gap-3">
      <CTPayMark size={36} className="shrink-0 rounded-lg" />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-semibold tracking-tight text-foreground">
          CTPay
        </span>
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Admin
        </span>
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
