const IST = 'Asia/Kolkata';

export type HistoryPeriodPreset = '48h' | '7d' | '30d' | 'all' | 'custom';

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

export function rangeForPreset(
  preset: HistoryPeriodPreset,
  now = new Date(),
): { from: string; to: string } | null {
  const to = todayYmdIst(now);

  if (preset === 'all') {
    return null;
  }

  if (preset === '48h') {
    return { from: shiftYmd(to, -1), to };
  }

  if (preset === '7d') {
    return { from: shiftYmd(to, -6), to };
  }

  if (preset === '30d') {
    return { from: shiftYmd(to, -29), to };
  }

  return defaultCustomRange(now);
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

export function historyPeriodLabel(
  period: HistoryPeriodPreset,
  fromYmd: string,
  toYmd: string,
) {
  if (period === 'all') {
    return 'All time';
  }

  const { from, to } = normalizeRange(fromYmd, toYmd);
  if (!from || !to) {
    return 'Select dates';
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
  if (period === 'all') {
    return {
      fromLabel: 'Start of available history',
      toLabel: formatYmdLong(todayYmdIst(now)),
      periodLabel: 'All time',
      filenameSlug: 'all-time',
    };
  }

  const { from, to } = normalizeRange(fromYmd, toYmd);
  return {
    fromLabel: from ? formatYmdLong(from) : '—',
    toLabel: to ? formatYmdLong(to) : '—',
    periodLabel: historyPeriodLabel(period, fromYmd, toYmd),
    filenameSlug:
      from && to ? (from === to ? from : `${from}_to_${to}`) : 'custom-range',
  };
}
