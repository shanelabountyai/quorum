// A small RFC 4180 reader (task 1.4; the ask-before-add list names CSV parsers, so this is owned). Text in, rows
// out, no I/O. Quoted fields may contain commas, doubled quotes and line breaks; the first row is the header.
import { InputInvalid } from './errors';

export type CsvRow = Record<string, string>;

export function parseCsv(text: string, name = 'csv'): CsvRow[] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let i = 0;
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field !== '') throw new InputInvalid(name, `quote inside an unquoted field at offset ${i}`);
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
    } else {
      field += ch;
    }
    i += 1;
  }
  if (quoted) throw new InputInvalid(name, 'unterminated quoted field');
  if (field !== '' || row.length) {
    row.push(field);
    records.push(row);
  }
  const header = records.shift();
  if (!header) return [];
  return records
    .filter((r) => !(r.length === 1 && r[0] === ''))
    .map((r, n) => {
      if (r.length !== header.length) throw new InputInvalid(name, `row ${n + 2} has ${r.length} fields, header has ${header.length}`);
      const out: CsvRow = {};
      header.forEach((h, k) => (out[h] = r[k]!));
      return out;
    });
}
