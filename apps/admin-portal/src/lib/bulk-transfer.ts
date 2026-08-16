import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { isIfscValid } from '@/lib/transfer-validation';
import { parsePayoutMode, type BankPayoutMode } from '@/lib/payout-mode';

export interface BulkTransferRow {
  rowNumber: number;
  beneficiary_account_name: string;
  beneficiary_account_no: string;
  beneficiary_ifsc: string;
  payout_mode: BankPayoutMode;
  amount: number;
  nameWarning?: boolean;
  accountWarning?: boolean;
  ifscWarning?: boolean;
  modeWarning?: boolean;
  warningMessage?: string;
}

export interface ParsedBulkSheet {
  rows: BulkTransferRow[];
  errors: { rowNumber: number; message: string }[];
}

export const BULK_UPLOAD_HEADERS = [
  'beneficiary_name',
  'account_number',
  'ifsc',
  'payout_mode',
  'amount_inr',
] as const;

const SAMPLE_HEADERS = BULK_UPLOAD_HEADERS;

const SAMPLE_DATA = [
  ['Rahul Sharma', '123456789012', 'HDFC0001234', 'IMPS', 1000],
  ['Priya Patel', '987654321098', 'ICIC0000456', 'NEFT', 2500.5],
  ['Amit Verma', '112233445566', 'SBIN0001234', 'RTGS', 210000],
];

type CanonicalField =
  | 'beneficiary_name'
  | 'account_number'
  | 'ifsc'
  | 'payout_mode'
  | 'amount_inr';

const CANONICAL_FIELDS: CanonicalField[] = [
  'beneficiary_name',
  'account_number',
  'ifsc',
  'payout_mode',
  'amount_inr',
];

const ACCOUNT_HEADER_KEYS = [
  'account_number',
  'account_no',
  'beneficiary_account_no',
  'account',
  'acc_no',
  'ac_no',
  'a_c_no',
];

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function headerField(header: string): CanonicalField | null {
  const h = header.trim();
  if (!h || h.startsWith('_col_')) {
    return null;
  }

  if (h.includes('ifsc')) {
    return 'ifsc';
  }

  if (
    h.includes('amount') ||
    h === 'inr' ||
    h.includes('rupee') ||
    h === 'rs' ||
    h === 'inr_amount'
  ) {
    return 'amount_inr';
  }

  if (
    h.includes('payout') ||
    h.includes('mode') ||
    h === 'imps' ||
    h === 'neft' ||
    h === 'rtgs'
  ) {
    return 'payout_mode';
  }

  if (
    h.includes('account_no') ||
    h.includes('account_number') ||
    h.includes('acc_no') ||
    h.includes('ac_no') ||
    h === 'a_c_no' ||
    h === 'a_c' ||
    h === 'acc' ||
    h === 'account' ||
    (h.includes('account') && !h.includes('name'))
  ) {
    return 'account_number';
  }

  if (
    h.includes('name') ||
    h.includes('beneficiary') ||
    h.includes('payee') ||
    h.includes('customer') ||
    h.includes('holder')
  ) {
    return 'beneficiary_name';
  }

  return null;
}

function pickValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

/** Expand scientific notation without floating-point (e.g. 2.00124E+13). */
function expandScientificNotation(value: string): string {
  const match = /^([+-]?)(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(value.trim());
  if (!match) {
    return value;
  }

  const sign = match[1] === '-' ? '-' : '';
  const mantissa = match[2] ?? '0';
  const exponent = Number.parseInt(match[3] ?? '0', 10);

  const parts = mantissa.split('.');
  const intPart = parts[0] ?? '0';
  const fracPart = parts[1] ?? '';
  const digits = intPart + fracPart;
  const decimalPos = intPart.length;
  const newDecimalPos = decimalPos + exponent;

  if (newDecimalPos <= 0) {
    return '0';
  }

  if (newDecimalPos >= digits.length) {
    return sign + digits + '0'.repeat(newDecimalPos - digits.length);
  }

  return sign + digits.slice(0, newDecimalPos);
}

export function looksLikeRoundedAccount(account: string): boolean {
  return /^\d{12,}0{4,}$/.test(account);
}

function parseRawAccountDigits(raw: string): {
  digits: string;
  precisionWarning: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { digits: '', precisionWarning: false };
  }

  let digits: string;

  if (/^\d+$/.test(trimmed)) {
    digits = trimmed;
  } else if (/^[+-]?[\d.]+[eE][+-]?\d+$/.test(trimmed)) {
    digits = expandScientificNotation(trimmed).replace(/[^\d]/g, '');
  } else {
    digits = normalizeAccountNumber(trimmed);
  }

  return {
    digits,
    precisionWarning: looksLikeRoundedAccount(digits),
  };
}

function normalizeAccountNumber(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }

  if (typeof value === 'number') {
    // Numbers above ~9e15 lose integer precision in JS — flag via rounded check later.
    return Math.trunc(value).toLocaleString('fullwide', {
      useGrouping: false,
      maximumFractionDigits: 0,
    });
  }

  let text = String(value).trim().replace(/\s/g, '');

  if (/^[\d.]+[eE][+-]?\d+$/.test(text)) {
    text = expandScientificNotation(text);
  }

  if (/^\d+\.0+$/.test(text)) {
    text = text.split('.')[0] ?? text;
  }

  return text.replace(/[^\d]/g, '');
}

function normalizeAmount(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  const cleaned = String(value ?? '')
    .trim()
    .replace(/[,₹\s]/g, '');

  return Number.parseFloat(cleaned);
}

function readCellValue(cell?: XLSX.CellObject): unknown {
  if (!cell) {
    return '';
  }

  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== '') {
    return cell.w;
  }

  if (cell.t === 'n' && typeof cell.v === 'number') {
    return cell.v;
  }

  return cell.v ?? '';
}

function scoreCellForField(value: unknown, field: CanonicalField): number {
  const text = String(value ?? '').trim();
  if (!text) {
    return 0;
  }

  const upper = text.toUpperCase();
  const { digits } = parseRawAccountDigits(text);

  if (field === 'ifsc') {
    return isIfscValid(upper) ? 5 : 0;
  }

  if (field === 'payout_mode') {
    return parsePayoutMode(text) ? 5 : 0;
  }

  if (field === 'account_number') {
    if (/^\d{9,18}$/.test(digits) && !isIfscValid(upper)) {
      return 5;
    }

    return 0;
  }

  if (field === 'amount_inr') {
    const amount = normalizeAmount(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }

    if (/[₹,]/.test(text) || /\.\d{1,2}$/.test(text)) {
      return 5;
    }

    if (/^\d{1,8}$/.test(digits)) {
      return 4;
    }

    return 0;
  }

  if (isIfscValid(upper) || parsePayoutMode(text) || /^\d+$/.test(text.replace(/\s/g, ''))) {
    return 0;
  }

  if (/[a-zA-Z]/.test(text) && text.replace(/[^a-zA-Z]/g, '').length >= 2) {
    return 4;
  }

  return 0;
}

function firstRowLooksLikeHeaders(values: unknown[]): boolean {
  const headers = values
    .map((value) => normalizeHeader(value))
    .filter((header) => header.length > 0);
  const mapped = headers.filter((header) => headerField(header)).length;

  if (mapped >= 2) {
    return true;
  }

  return values.some((value) => {
    const text = String(value ?? '').trim();
    if (!text) {
      return false;
    }

    const { digits } = parseRawAccountDigits(text);
    return isIfscValid(text) || /^\d{9,18}$/.test(digits);
  })
    ? false
    : headers.length > 0;
}

function inferFieldByKey(
  rawRows: Record<string, unknown>[],
): Map<string, CanonicalField> {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const row of rawRows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const assigned = new Map<string, CanonicalField>();
  const used = new Set<CanonicalField>();

  for (const key of keys) {
    const field = headerField(key);
    if (field && !used.has(field)) {
      assigned.set(key, field);
      used.add(field);
    }
  }

  for (const field of CANONICAL_FIELDS) {
    if (used.has(field)) {
      continue;
    }

    let bestKey: string | null = null;
    let bestScore = 0;

    for (const key of keys) {
      if (assigned.has(key)) {
        continue;
      }

      let score = 0;
      for (const row of rawRows) {
        score += scoreCellForField(row[key], field);
      }

      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    if (bestKey && bestScore > 0) {
      assigned.set(bestKey, field);
      used.add(field);
    }
  }

  return assigned;
}

function extractFieldsFromCells(values: unknown[]): Record<string, unknown> {
  const remaining = values.filter((value) => String(value ?? '').trim() !== '');
  const mapped: Record<string, unknown> = {};
  const order: CanonicalField[] = [
    'ifsc',
    'payout_mode',
    'account_number',
    'amount_inr',
    'beneficiary_name',
  ];

  for (const field of order) {
    let bestIndex = -1;
    let bestScore = 0;

    remaining.forEach((value, index) => {
      const score = scoreCellForField(value, field);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      mapped[field] = remaining.splice(bestIndex, 1)[0];
    }
  }

  return mapped;
}

function remapRowsToCanonical(
  rawRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const fieldByKey = inferFieldByKey(rawRows);

  return rawRows.map((row) => {
    const fromColumns: Record<string, unknown> = {};

    for (const [key, field] of fieldByKey) {
      const value = row[key];
      if (scoreCellForField(value, field) > 0) {
        fromColumns[field] = value;
      }
    }

    const inferred = extractFieldsFromCells(Object.values(row));
    const mapped: Record<string, unknown> = {};

    for (const field of CANONICAL_FIELDS) {
      mapped[field] = fromColumns[field] ?? inferred[field] ?? '';
    }

    return mapped;
  });
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSharedStrings(xml: string): string[] {
  const values: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;

  for (const match of xml.matchAll(siRegex)) {
    const inner = match[1] ?? '';
    const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) =>
      decodeXmlText(part[1] ?? ''),
    );
    values.push(parts.join(''));
  }

  return values;
}

function parseSheetXmlRawValues(
  xml: string,
  sharedStrings: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;

  for (const match of xml.matchAll(cellRegex)) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';
    const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
    if (!ref) {
      continue;
    }

    const type = attrs.match(/\bt="([^"]+)"/)?.[1];

    if (type === 's') {
      const index = Number.parseInt(inner.match(/<v>([^<]*)<\/v>/)?.[1] ?? '', 10);
      if (Number.isInteger(index) && sharedStrings[index] !== undefined) {
        map.set(ref, sharedStrings[index]);
      }
      continue;
    }

    const inlineText = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((part) => decodeXmlText(part[1] ?? ''))
      .join('');
    if (inlineText) {
      map.set(ref, inlineText);
      continue;
    }

    const vMatch = inner.match(/<v>([^<]*)<\/v>/);
    if (vMatch?.[1] !== undefined) {
      map.set(ref, decodeXmlText(vMatch[1]));
    }
  }

  return map;
}

async function loadRawXlsxCellMap(buffer: ArrayBuffer): Promise<Map<string, string>> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const sharedStringsFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsFile
      ? parseSharedStrings(await sharedStringsFile.async('text'))
      : [];
    const sheetPaths = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort();

    const sheetPath = sheetPaths[0];
    if (!sheetPath) {
      return new Map();
    }

    const xml = await zip.file(sheetPath)?.async('text');
    if (!xml) {
      return new Map();
    }

    return parseSheetXmlRawValues(xml, sharedStrings);
  } catch {
    return new Map();
  }
}

function readSheetRowValues(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
  rowIndex: number,
  rawCells?: Map<string, string>,
): unknown[] {
  const values: unknown[] = [];

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: column });
    const parsedValue = readCellValue(sheet[cellRef]);
    const raw = rawCells?.get(cellRef);

    if (raw !== undefined && String(raw).trim() !== '') {
      values.push(raw);
      continue;
    }

    values.push(parsedValue);
  }

  return values;
}

function sheetToNormalizedRows(
  sheet: XLSX.WorkSheet,
  rawCells?: Map<string, string>,
): Record<string, unknown>[] {
  const ref = sheet['!ref'];

  if (!ref) {
    return [];
  }

  const range = XLSX.utils.decode_range(ref);
  const firstValues = readSheetRowValues(sheet, range, range.s.r, rawCells);
  const hasHeaderRow = firstRowLooksLikeHeaders(firstValues);
  const headers = firstValues.map((value, index) => {
    if (!hasHeaderRow) {
      return `_col_${index}`;
    }

    return normalizeHeader(value) || `_col_${index}`;
  });
  const dataStart = hasHeaderRow ? range.s.r + 1 : range.s.r;
  const rows: Record<string, unknown>[] = [];

  for (let rowIndex = dataStart; rowIndex <= range.e.r; rowIndex += 1) {
    const values = readSheetRowValues(sheet, range, rowIndex, rawCells);
    const row: Record<string, unknown> = {};

    values.forEach((value, index) => {
      const header = headers[index] ?? `_col_${index}`;
      row[header] = value;
    });

    rows.push(row);
  }

  return rows;
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function parseDelimitedText(text: string, delimiter: string): Record<string, unknown>[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return [];
  }

  const firstValues = parseDelimitedLine(lines[0] ?? '', delimiter);
  const hasHeaderRow = firstRowLooksLikeHeaders(firstValues);
  const headers = firstValues.map((value, index) => {
    if (!hasHeaderRow) {
      return `_col_${index}`;
    }

    return normalizeHeader(value) || `_col_${index}`;
  });
  const dataLines = hasHeaderRow ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const row: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim();
    });

    return row;
  });
}

function buildBulkRowsFromNormalized(
  rawRows: Record<string, unknown>[],
  startRowNumber = 2,
): ParsedBulkSheet {
  const rows: BulkTransferRow[] = [];
  const errors: ParsedBulkSheet['errors'] = [];
  const mappedRows = remapRowsToCanonical(rawRows);

  mappedRows.forEach((normalized, index) => {
    const rowNumber = startRowNumber + index;

    const beneficiaryName = String(
      pickValue(normalized, [
        'beneficiary_name',
        'account_name',
        'name',
        'beneficiary',
      ]),
    ).trim();

    const rawAccount = pickValue(normalized, ACCOUNT_HEADER_KEYS);
    const { digits: accountNo, precisionWarning: rawPrecisionWarning } =
      parseRawAccountDigits(String(rawAccount));

    const ifsc = String(pickValue(normalized, ['ifsc', 'beneficiary_ifsc']))
      .trim()
      .toUpperCase();
    const amount = normalizeAmount(
      pickValue(normalized, ['amount_inr', 'amount', 'inr']),
    );

    const payoutModeRaw = String(
      pickValue(normalized, ['payout_mode', 'mode', 'transfer_mode', 'payout']),
    );

    if (
      !beneficiaryName &&
      !accountNo &&
      !ifsc &&
      !payoutModeRaw.trim() &&
      !Number.isFinite(amount)
    ) {
      return;
    }

    const payoutMode = parsePayoutMode(payoutModeRaw) ?? 'IMPS';
    const modeWarning = Boolean(payoutModeRaw.trim()) && !parsePayoutMode(payoutModeRaw);
    const nameWarning = !beneficiaryName || beneficiaryName.length < 2;
    const accountValid = /^\d{9,18}$/.test(accountNo);
    const ifscValid = isIfscValid(ifsc);
    const amountValid = Number.isFinite(amount) && amount > 0;
    const precisionWarning = rawPrecisionWarning && accountValid;
    const warnings: string[] = [];

    if (nameWarning) {
      warnings.push('Beneficiary name is missing. Add the name.');
    }

    if (!accountValid) {
      warnings.push(
        accountNo
          ? `Account number ${accountNo} is wrong. Use 9–18 digits.`
          : 'Account number is missing. Enter 9–18 digits.',
      );
    } else if (precisionWarning) {
      warnings.push(
        `Account number ${accountNo} looks truncated. Correct it to the full digits.`,
      );
    }

    if (!ifscValid) {
      warnings.push(
        ifsc
          ? `IFSC ${ifsc} is wrong. Use a valid code like HDFC0001234.`
          : 'IFSC is missing. Enter a valid code like HDFC0001234.',
      );
    }

    if (modeWarning) {
      warnings.push(
        `Payout mode ${payoutModeRaw.trim()} is wrong. Use IMPS, NEFT, or RTGS.`,
      );
    }

    if (payoutMode === 'RTGS' && amountValid && amount < 200_000) {
      warnings.push('RTGS requires a minimum of ₹2,00,000. Correct the amount or mode.');
    }

    if (!amountValid) {
      warnings.push('Amount is missing or invalid. Enter the transfer amount.');
    }

    rows.push({
      rowNumber,
      beneficiary_account_name: beneficiaryName,
      beneficiary_account_no: accountNo,
      beneficiary_ifsc: ifsc,
      payout_mode: payoutMode,
      amount: amountValid ? Number(amount.toFixed(2)) : 0,
      nameWarning,
      accountWarning: !accountValid || precisionWarning,
      ifscWarning: !ifscValid,
      modeWarning,
      warningMessage: warnings.join(' '),
    });
  });

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ rowNumber: 0, message: 'No valid transfer rows found' });
  }

  if (rows.length > 500) {
    return {
      rows: [],
      errors: [{ rowNumber: 0, message: 'Maximum 500 transfers per upload' }],
    };
  }

  return { rows, errors };
}

export function downloadBulkTransferSample() {
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...SAMPLE_HEADERS],
    ...SAMPLE_DATA,
  ]);
  const accountColumnIndex = 1;

  for (let rowIndex = 1; rowIndex <= SAMPLE_DATA.length; rowIndex += 1) {
    const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: accountColumnIndex });
    const accountValue = String(SAMPLE_DATA[rowIndex - 1]?.[accountColumnIndex] ?? '');

    worksheet[cellRef] = { t: 's', v: accountValue };
  }

  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk transfers');
  XLSX.writeFile(workbook, 'ctpay-bulk-transfer-sample.xlsx');
}

export function parseBulkTransferPaste(text: string): ParsedBulkSheet {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const rawRows = parseDelimitedText(text, delimiter);
  return buildBulkRowsFromNormalized(rawRows);
}

export async function parseBulkTransferFile(file: File): Promise<ParsedBulkSheet> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv')) {
    const text = await file.text();
    return buildBulkRowsFromNormalized(parseDelimitedText(text, ','));
  }

  const buffer = await file.arrayBuffer();
  const [rawCells, workbook] = await Promise.all([
    loadRawXlsxCellMap(buffer),
    Promise.resolve(
      XLSX.read(buffer, {
        type: 'array',
        cellText: true,
        cellDates: false,
        raw: true,
      }),
    ),
  ]);

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return { rows: [], errors: [{ rowNumber: 0, message: 'Sheet is empty' }] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rawRows = sheetToNormalizedRows(sheet, rawCells);

  return buildBulkRowsFromNormalized(rawRows);
}

export function bulkRowsTotal(rows: BulkTransferRow[]) {
  return Number(rows.reduce((sum, row) => sum + row.amount, 0).toFixed(2));
}

export function bulkRowsHaveAccountWarnings(rows: BulkTransferRow[]) {
  return rows.some((row) => bulkRowNeedsCorrection(row));
}

export function bulkRowNeedsCorrection(row: BulkTransferRow) {
  return Boolean(
    row.nameWarning ||
      row.accountWarning ||
      row.ifscWarning ||
      row.modeWarning ||
      row.amount <= 0,
  );
}
