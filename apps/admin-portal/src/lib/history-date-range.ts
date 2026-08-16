const IST = 'Asia/Kolkata';

export type HistoryPeriodPreset = '48h' | '7d' | 'all' | 'custom';

export function todayYmdIst(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function defaultCustomRange(now = new Date()) {
  const to = todayYmdIst(now);
  return { from: shiftYmd(to, -6), to };
}

export function formatYmdLong(ymd: string) {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 6, 30)).toLocaleDateString(
    'en-IN',
    { day: 'numeric', month: 'short', year: 'numeric' },
  );
}

function dayStartMs(ymd: string) {
  return new Date(`${ymd}T00:00:00+05:30`).getTime();
}

function dayEndMs(ymd: string) {
  return new Date(`${ymd}T23:59:59.999+05:30`).getTime();
}

export function normalizeRange(from: string, to: string) {
  if (!from || !to) {
    return { from, to };
  }

  if (from <= to) {
    return { from, to };
  }

  return { from: to, to: from };
}

export function createdAtInCustomRange(
  createdAtIso: string,
  fromYmd: string,
  toYmd: string,
) {
  const { from, to } = normalizeRange(fromYmd, toYmd);
  if (!from || !to) {
    return false;
  }

  const created = new Date(createdAtIso).getTime();
  return created >= dayStartMs(from) && created <= dayEndMs(to);
}

export function createdAtInPreset(
  createdAtIso: string,
  period: Exclude<HistoryPeriodPreset, 'custom'>,
  now = Date.now(),
) {
  if (period === 'all') {
    return true;
  }

  const windowMs =
    period === '48h' ? 48 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return now - new Date(createdAtIso).getTime() <= windowMs;
}

export function historyPeriodLabel(
  period: HistoryPeriodPreset,
  fromYmd: string,
  toYmd: string,
) {
  if (period === '48h') {
    return 'Last 48 hours';
  }

  if (period === '7d') {
    return 'Last 7 days';
  }

  if (period === 'all') {
    return 'All time';
  }

  const { from, to } = normalizeRange(fromYmd, toYmd);
  if (!from || !to) {
    return 'Custom range';
  }

  if (from === to) {
    return formatYmdLong(from);
  }

  return `${formatYmdLong(from)} to ${formatYmdLong(to)}`;
}

export function statementRangeMeta(
  period: HistoryPeriodPreset,
  fromYmd: string,
  toYmd: string,
  now = new Date(),
) {
  if (period === 'custom') {
    const { from, to } = normalizeRange(fromYmd, toYmd);
    return {
      fromLabel: from ? formatYmdLong(from) : '—',
      toLabel: to ? formatYmdLong(to) : '—',
      periodLabel: historyPeriodLabel(period, fromYmd, toYmd),
      filenameSlug:
        from && to
          ? from === to
            ? from
            : `${from}_to_${to}`
          : 'custom-range',
    };
  }

  if (period === 'all') {
    return {
      fromLabel: 'Start of available history',
      toLabel: formatYmdLong(todayYmdIst(now)),
      periodLabel: 'All time',
      filenameSlug: 'all-time',
    };
  }

  if (period === '48h') {
    const from = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    return {
      fromLabel: from.toLocaleString('en-IN', { timeZone: IST }),
      toLabel: now.toLocaleString('en-IN', { timeZone: IST }),
      periodLabel: 'Last 48 hours',
      filenameSlug: 'last-48-hours',
    };
  }

  const to = todayYmdIst(now);
  const from = shiftYmd(to, -6);
  return {
    fromLabel: formatYmdLong(from),
    toLabel: formatYmdLong(to),
    periodLabel: 'Last 7 days',
    filenameSlug: `${from}_to_${to}`,
  };
}
