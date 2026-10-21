// Template download and upload for the bulk import. ExcelJS is loaded on
// demand, so it is only fetched when someone downloads or uploads a file.
import { COLUMNS, columnForHeader, emptyRow, isEmptyRow, type BulkRow } from './columns';

export const TEMPLATE_VERSION = '1';
export const TEMPLATE_NAME = 'bantulex-bulk-import.xlsx';
const SHEET = 'Reflexes';

async function excel(): Promise<any> {
  const mod: any = await import('exceljs');
  return mod.default ?? mod;
}

/** Build the template workbook and let the browser download it. */
export async function downloadTemplate() {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BantuLex admin';

  const ws = wb.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(c => ({ header: c.required ? `${c.label} (required)` : c.label, key: c.key, width: Math.round(c.width / 7) }));
  ws.getRow(1).eachCell((cell: any, n: number) => {
    const col = COLUMNS[n - 1];
    cell.font = { bold: true, color: { argb: col.required ? 'FFFFFFFF' : 'FF1F2937' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? 'FFB91C1C' : 'FFE5E7EB' } };
    cell.alignment = { vertical: 'middle' };
    // Shown as a comment/tooltip on the header in Excel and LibreOffice.
    cell.note = `${col.required ? 'Required.' : 'Optional.'} ${col.help}\nExample: ${col.example}`;
  });
  // Text format, so values like "1/2" or "0012" are not turned into dates or numbers.
  for (let n = 1; n <= COLUMNS.length; n++) ws.getColumn(n).numFmt = '@';

  const info = wb.addWorksheet('Instructions');
  info.columns = [{ width: 22 }, { width: 12 }, { width: 70 }, { width: 26 }];
  const lines: (string | string[])[] = [
    'BantuLex bulk import',
    '',
    `1. Fill in the "${SHEET}" sheet: one word per row, starting on row 2. Keep the header row.`,
    '2. Only Term is required; leave other cells empty when unknown. Extra columns are ignored. At most 20,000 rows per import; split larger files.',
    '3. In the admin, open Lexical data → Reflexes import, set the source and other links, and upload this file.',
    '4. Check the rows, then process: all rows are saved in one transaction and can be undone as a batch.',
    '',
    ['Column', 'Required', 'Description', 'Example'],
    ...COLUMNS.map(c => [c.label, c.required ? 'yes' : 'no', c.help, c.example]),
    '',
    `Template version ${TEMPLATE_VERSION}`,
  ];
  for (const line of lines) info.addRow(Array.isArray(line) ? line : [line]);
  info.getRow(1).font = { bold: true, size: 14 };
  info.getRow(8).font = { bold: true };
  info.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: TEMPLATE_NAME });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Remove cell comments from an xlsx before ExcelJS reads it. The template's
 * header comments come back in every file, and ExcelJS fails on comments it did
 * not write itself (e.g. saved by openpyxl or other tools). Reading needs only
 * the cell values, so the comment parts are dropped.
 */
async function withoutComments(data: ArrayBuffer): Promise<ArrayBuffer> {
  const mod: any = await import('jszip');
  const JSZip = mod.default ?? mod;
  const zip = await JSZip.loadAsync(data);
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(name)) {
      const xml: string = await zip.file(name).async('string');
      const cleaned = xml.replace(/<Relationship\b[^>]*Type="[^"]*\/(comments|vmlDrawing)"[^>]*\/>/g, '');
      if (cleaned !== xml) zip.file(name, cleaned);
    } else if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      const xml: string = await zip.file(name).async('string');
      const cleaned = xml.replace(/<legacyDrawing\b[^>]*\/>/g, '');
      if (cleaned !== xml) zip.file(name, cleaned);
    }
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

export interface ParsedWorkbook {
  rows: BulkRow[];
  /** Excel row number per parsed row (for messages). */
  excelRows: number[];
  /** Column keys found in the header, in file order. */
  columns: string[];
  warnings: string[];
  sheet: string;
}

/** Read a filled-in template (or any sheet whose header row uses the column names). */
export async function readWorkbook(file: File): Promise<ParsedWorkbook> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await withoutComments(await file.arrayBuffer()));
  } catch (error: any) {
    throw new Error(`${file.name} could not be read as an .xlsx file (${error?.message ?? error}).`);
  }
  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  if (!ws) throw new Error('The file has no sheets.');

  const warnings: string[] = [];
  const header: (string | null)[] = [];
  const ignored: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell: any, n: number) => {
    const name = String(cell.text ?? '').trim();
    const key = columnForHeader(name);
    header[n] = key;
    if (!key && name) ignored.push(name);
  });
  const columns = header.filter((k): k is string => !!k);
  if (!columns.includes('term')) throw new Error(`No "Term" column in the header row of sheet "${ws.name}".`);
  if (ignored.length) warnings.push(`Ignored columns (not part of the template): ${ignored.join(', ')}.`);
  const duplicates = columns.filter((k, i) => columns.indexOf(k) !== i);
  if (duplicates.length) warnings.push(`Columns that appear twice (the last one is used): ${[...new Set(duplicates)].join(', ')}.`);

  const rows: BulkRow[] = [];
  const excelRows: number[] = [];
  ws.eachRow({ includeEmpty: false }, (row: any, n: number) => {
    if (n === 1) return;
    const out = emptyRow();
    row.eachCell({ includeEmpty: false }, (cell: any, c: number) => {
      const key = header[c];
      // cell.text: formatted text for numbers, dates, rich text and formula results.
      if (key) out[key] = String(cell.text ?? '').trim();
    });
    if (!isEmptyRow(out)) { rows.push(out); excelRows.push(n); }
  });
  if (!rows.length) warnings.push('The sheet has no data rows below the header.');
  return { rows, excelRows, columns: COLUMNS.map(c => c.key).filter(k => columns.includes(k)), warnings, sheet: ws.name };
}
