/**
 * Campaign recipients from a file: Excel (.xlsx), CSV or a pasted list. Runs in the browser; nothing
 * is uploaded except the cleaned phone numbers and names. No library: an .xlsx file is a zip of XML
 * files, read with the browser's own decompression.
 */

export type AudienceRow = { phone: string; name: string | null };
export type AudienceFileResult = { rows: AudienceRow[]; invalid: string[]; duplicates: number };

const toLatin = (value: string) =>
  value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

/**
 * International number in digits only (9665xxxxxxxx), or null. «00» and «+» prefixes are removed; a
 * local number starting with 0 gets the default country code when one is given.
 */
export function normalizeCampaignPhone(raw: string, defaultCountryCode = ""): string | null {
  let digits = toLatin(String(raw ?? "")).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) {
    const code = defaultCountryCode.replace(/\D/g, "");
    if (!code) return null;
    digits = code + digits.replace(/^0+/, "");
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** CSV or pasted text into rows of cells; the separator (comma, semicolon or tab) is detected. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const separator = ["\t", ";", ","].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell) quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

const PHONE_HEADER = /phone|mobile|whats|number|tel|رقم|هاتف|جوال|موبايل|واتس|تلفون/i;
const NAME_HEADER = /name|اسم|الاسم|العميل|customer|client/i;

/** Finds the phone and name columns (by header, or the column that holds the most numbers) and cleans the list. */
export function audienceFromRows(table: string[][], defaultCountryCode = ""): AudienceFileResult {
  if (!table.length) return { rows: [], invalid: [], duplicates: 0 };
  const width = Math.max(...table.map((r) => r.length));
  const header = table[0];
  let phoneCol = header.findIndex((c) => PHONE_HEADER.test(c));
  let nameCol = header.findIndex((c, i) => i !== phoneCol && NAME_HEADER.test(c));
  const hasHeader = phoneCol >= 0 || nameCol >= 0;
  const body = hasHeader ? table.slice(1) : table;
  if (phoneCol < 0) {
    const scores = Array.from({ length: width }, (_, col) => body.filter((r) => normalizeCampaignPhone(r[col] ?? "", defaultCountryCode)).length);
    phoneCol = scores.indexOf(Math.max(...scores));
  }
  if (nameCol < 0)
    nameCol = Array.from({ length: width }, (_, i) => i).find(
      (col) => col !== phoneCol && body.some((r) => /\p{L}/u.test(r[col] ?? "")),
    ) ?? -1;

  const seen = new Set<string>();
  const result: AudienceFileResult = { rows: [], invalid: [], duplicates: 0 };
  for (const r of body) {
    const raw = (r[phoneCol] ?? "").trim();
    if (!raw) continue;
    const phone = normalizeCampaignPhone(raw, defaultCountryCode);
    if (!phone) {
      result.invalid.push(raw);
      continue;
    }
    if (seen.has(phone)) {
      result.duplicates++;
      continue;
    }
    seen.add(phone);
    const name = nameCol >= 0 ? (r[nameCol] ?? "").trim().slice(0, 120) : "";
    result.rows.push({ phone, name: name || null });
  }
  return result;
}

/* ------------------------------ .xlsx ------------------------------ */

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a zip archive, by name. */
async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("الملف ليس ملف Excel صالحًا");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, await inflate(data));
  }
  return files;
}

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

const columnIndex = (ref: string) => [...ref.replace(/\d/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** A large number cell written by Excel (9.66512345678E11) back to its digits. */
const numberText = (value: string) => (/e/i.test(value) && Number.isFinite(Number(value)) ? BigInt(Math.round(Number(value))).toString() : value);

/** The first sheet of an .xlsx file as rows of cells. */
export async function readXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buffer);
  const decoder = new TextDecoder();
  const read = (name: string) => (files.has(name) ? decoder.decode(files.get(name)) : "");
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  // The first sheet in the workbook's order, through its relationship id.
  const firstId = read("xl/workbook.xml").match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = firstId && read("xl/_rels/workbook.xml.rels").match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1];
  const sheetName = target ? `xl/${target.replace(/^\/?xl\//, "")}` : [...files.keys()].filter((n) => n.includes("worksheets/")).sort()[0];
  const sheet = sheetName ? read(sheetName) : "";
  if (!sheet) throw new Error("لم أجد ورقة بيانات في ملف Excel");
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const text =
        type === "s" ? (shared[Number(value)] ?? "") : type === "inlineStr" ? texts(inner) : type === "str" ? unescapeXml(value) : numberText(value);
      row[ref ? columnIndex(ref) : row.length] = text.trim();
    }
    rows.push(Array.from(row, (c) => c ?? ""));
  }
  return rows.filter((r) => r.some(Boolean));
}

/** Reads a chosen file (Excel or CSV/text). */
export async function readAudienceFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) return readXlsx(await file.arrayBuffer());
  if (/\.xls$/i.test(file.name)) throw new Error("احفظ الملف بصيغة xlsx أو CSV ثم ارفعه");
  return parseCsv(await file.text());
}
