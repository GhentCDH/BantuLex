/**
 * Parse tab-separated clipboard text as Excel, LibreOffice and Google Sheets
 * write it: rows end in \n or \r\n, and a cell that contains a tab, newline or
 * quote is wrapped in double quotes with "" for a literal quote.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Cells → clipboard text, quoting where needed (inverse of parseTsv). */
export function toTsv(rows: string[][]): string {
  const q = (v: string) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map(r => r.map(c => q(c ?? '')).join('\t')).join('\n');
}
