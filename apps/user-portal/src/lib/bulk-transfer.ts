import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { isIfscValid } from '@/lib/transfer-validation';

export interface BulkTransferRow {
  rowNumber: number;
  beneficiary_account_name: string;
  beneficiary_account_no: string;
  beneficiary_ifsc: string;
  amount: number;
  accountWarning?: boolean;
}

export interface ParsedBulkSheet {
  rows: BulkTransferRow[];
  errors: { rowNumber: number; message: string }[];
}

const SAMPLE_HEADERS = [
  'beneficiary_name',
  'account_number',
  'ifsc',
  'amount_inr',
] as const;

const SAMPLE_DATA = [
  ['Rahul Sharma', '123456789012', 'HDFC0001234', 1000],
  ['Priya Patel', '987654321098', 'ICIC0000456', 2500.5],
];

const ACCOUNT_HEADER_KEYS = [
  'account_number',
  'account_no',
  'beneficiary_account_no',
  'account',
];

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

function isAccountHeader(header: string) {
  return ACCOUNT_HEADER_KEYS.some(
    (key) => header === key || header.includes('account'),
  );
}

function parseSheetXmlRawValues(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const cellRegex = /<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/g;

  for (const match of xml.matchAll(cellRegex)) {
    const ref = match[1];
    const inner = match[2];
    if (!ref || inner === undefined) {
      continue;
    }

    const vMatch = inner.match(/<v>([^<]*)<\/v>/);
    if (vMatch?.[1] !== undefined) {
      map.set(ref, vMatch[1]);
      continue;
    }

    const inlineText = inner.match(/<is>\s*<t(?:\s+[^>]*)?>([^<]*)<\/t>/);
    if (inlineText?.[1] !== undefined) {
      map.set(ref, inlineText[1]);
    }
  }

  return map;
}

async function loadRawXlsxCellMap(buffer: ArrayBuffer): Promise<Map<string, string>> {
  try {
    const zip = await JSZip.loadAsync(buffer);
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

    return parseSheetXmlRawValues(xml);
  } catch {
    return new Map();
  }
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
  const headers: string[] = [];
  let accountColIndex = -1;

  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })];
    const header = normalizeHeader(readCellValue(headerCell));
    headers.push(header);

    if (accountColIndex < 0 && isAccountHeader(header)) {
      accountColIndex = column - range.s.c;
    }
  }

  const rows: Record<string, unknown>[] = [];

  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const row: Record<string, unknown> = {};

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const headerIndex = column - range.s.c;
      const header = headers[headerIndex];
      if (!header) {
        continue;
      }

      const cellRef = XLSX.utils.encode_cell({ r: rowIndex, c: column });

      if (rawCells && headerIndex === accountColIndex) {
        const raw = rawCells.get(cellRef);
        if (raw !== undefined) {
          row[header] = raw;
          continue;
        }
      }

      const cell = sheet[cellRef];
      row[header] = readCellValue(cell);
    }

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

  const headerLine = lines[0] ?? '';
  const headers = parseDelimitedLine(headerLine, delimiter).map((value) =>
    normalizeHeader(value),
  );

  const accountColIndex = headers.findIndex((header) => isAccountHeader(header));

  return lines.slice(1).map((line) => {
    const values = parseDelimitedLine(line, delimiter);
    const row: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      if (!header) {
        return;
      }

      const raw = values[index] ?? '';
      if (index === accountColIndex) {
        row[header] = raw.trim();
        return;
      }

      row[header] = raw.trim();
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

  rawRows.forEach((normalized, index) => {
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
    const { digits: accountNo, precisionWarning } = parseRawAccountDigits(
      String(rawAccount),
    );

    const ifsc = String(pickValue(normalized, ['ifsc', 'beneficiary_ifsc']))
      .trim()
      .toUpperCase();
    const amount = normalizeAmount(
      pickValue(normalized, ['amount_inr', 'amount', 'inr']),
    );

    if (!beneficiaryName && !accountNo && !ifsc && !Number.isFinite(amount)) {
      return;
    }

    if (!beneficiaryName || beneficiaryName.length < 2) {
      errors.push({ rowNumber, message: 'Beneficiary name is required' });
      return;
    }

    if (!/^\d{9,18}$/.test(accountNo)) {
      errors.push({
        rowNumber,
        message:
          'Invalid account number — use 9–18 digits. Format the account column as Text in Excel, or paste data using the Paste tab.',
      });
      return;
    }

    if (!isIfscValid(ifsc)) {
      errors.push({ rowNumber, message: 'Invalid IFSC code' });
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      errors.push({ rowNumber, message: 'Invalid amount' });
      return;
    }

    rows.push({
      rowNumber,
      beneficiary_account_name: beneficiaryName,
      beneficiary_account_no: accountNo,
      beneficiary_ifsc: ifsc,
      amount: Number(amount.toFixed(2)),
      accountWarning: precisionWarning,
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

  worksheet['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 14 }, { wch: 12 }];

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
  return rows.some((row) => row.accountWarning);
}
