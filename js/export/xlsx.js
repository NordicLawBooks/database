// A minimal .xlsx writer: one worksheet of text cells (inline strings), bold
// frozen header row with an autofilter, column widths fitted to the content,
// optional merged ranges, and top-aligned cells (so a merged value reads at the
// top of its range).
// The package is a ZIP written here too (CRC-32, stored or deflated entries), so
// there is no dependency. DOM-free (tested).

const enc = new TextEncoder();

// --- XML -------------------------------------------------------------------

// Characters XML 1.0 can't carry (C0 controls other than tab/LF/CR, lone
// surrogates, U+FFFE/FFFF) are dropped.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const MAX_CELL = 32767; // Excel's per-cell character limit

export function xmlEscape(s) {
  return String(s ?? "")
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0-based column index -> spreadsheet letters (0 -> A, 26 -> AA). */
export function columnLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";

function sheetXml(matrix, merges = []) {
  const nCols = Math.max(1, ...matrix.map((r) => r.length));
  const last = `${columnLetter(nCols - 1)}${Math.max(1, matrix.length)}`;
  const widths = Array.from({ length: nCols }, (_, c) => {
    const longest = Math.max(0, ...matrix.map((r) => String(r[c] ?? "").length));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const cols = widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join("");
  const rows = matrix
    .map((r, i) => {
      const style = i === 0 ? ' s="1"' : ' s="2"';
      const cells = r
        .map((v, c) => {
          const text = String(v ?? "");
          if (!text) return "";
          const t = xmlEscape(text.length > MAX_CELL ? text.slice(0, MAX_CELL) : text);
          return `<c r="${columnLetter(c)}${i + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${t}</t></is></c>`;
        })
        .join("");
      return `<row r="${i + 1}">${cells}</row>`;
    })
    .join("");
  const frozen =
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${last}"/>${frozen}<cols>${cols}</cols><sheetData>${rows}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>${mergeCellsXml(merges)}</worksheet>`
  );
}

/** A merge {r0,c0,r1,c1} (0-based, inclusive) as a range like "A2:C5". */
export function rangeRef({ r0, c0, r1, c1 }) {
  return `${columnLetter(c0)}${r0 + 1}:${columnLetter(c1)}${r1 + 1}`;
}

function mergeCellsXml(merges) {
  if (!merges.length) return "";
  return `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${rangeRef(m)}"/>`).join("")}</mergeCells>`;
}

function workbookXml(sheetName, filterRef) {
  const name = xmlEscape(sheetName);
  return (
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>` +
    `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!${filterRef}</definedName></definedNames>` +
    `</workbook>`
  );
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;

/**
 * The package's parts, path -> XML text.
 * @param {string[][]} matrix
 * @param {string} [sheetName]
 * @param {{r0,c0,r1,c1}[]} [merges] non-overlapping, 0-based inclusive ranges
 */
export function xlsxParts(matrix, sheetName = "Sheet1", merges = []) {
  const nCols = Math.max(1, ...matrix.map((r) => r.length));
  const filterRef = `$A$1:$${columnLetter(nCols - 1)}$${Math.max(1, matrix.length)}`;
  // Sheet names: max 31 chars, none of []:*?/\
  const safeName = String(sheetName).replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1";
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(safeName, filterRef),
    "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheetXml(matrix, merges),
  };
}

// --- ZIP -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Raw DEFLATE via the browser's CompressionStream; null where unsupported. */
export async function deflateRawBrowser(bytes) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Build a ZIP archive.
 * @param {{name:string, data:Uint8Array}[]} files
 * @param {{deflate?:(bytes:Uint8Array)=>Promise<Uint8Array|null>|Uint8Array|null, date?:Date}} [opts]
 *   deflate: raw-DEFLATE compressor; an entry is stored when it returns null or
 *   doesn't shrink the data.
 * @returns {Promise<Uint8Array>}
 */
export async function zip(files, { deflate = null, date = new Date() } = {}) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data;
    let method = 0;
    const packed = deflate ? await deflate(f.data) : null;
    if (packed && packed.length < f.data.length) {
      body = packed;
      method = 8;
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), name, body);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, method, true);
    central.setUint16(12, time, true);
    central.setUint16(14, day, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, f.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true); // other fields stay 0
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/**
 * A matrix of text cells (first row = header) as .xlsx bytes.
 * @param {string[][]} matrix
 * @param {{sheetName?:string, merges?:{r0,c0,r1,c1}[], deflate?:Function, date?:Date}} [opts]
 */
export async function buildXlsx(matrix, { sheetName = "Sheet1", merges = [], deflate = deflateRawBrowser, date } = {}) {
  const parts = xlsxParts(matrix, sheetName, merges);
  const files = Object.entries(parts).map(([name, xml]) => ({ name, data: enc.encode(xml) }));
  return zip(files, { deflate, date });
}
