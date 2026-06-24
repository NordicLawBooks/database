// Pure TSV parsing. No DOM, no fetch — feed it text, get {headers, rows}.
//
// This intentionally does only the mechanical split. Field enrichment (Depository
// expansion, Main text group, Dating-derived years, language normalization) is
// model-building and lives in the model layer, not here.

/**
 * Parse tab-separated text into headers + row objects.
 *
 * @param {string} text  The raw TSV content.
 * @param {{keepBlankLines?: boolean}} [opts]
 *   By default, blank/whitespace-only lines are dropped (matches the combined
 *   `NordicLaw_data.tsv` path). Pass `keepBlankLines: true` for the raw
 *   Excel-identical exports, where every data row must be preserved so its index
 *   stays aligned with the merge-geometry JSON.
 * @returns {{headers: string[], rows: Array<Record<string,string>>}}
 */
export function parseTSV(text, { keepBlankLines = false } = {}) {
  const str = text === null || text === undefined ? "" : String(text);
  let lines = str.split(/\r?\n/);

  if (keepBlankLines) {
    // Drop only the trailing empty line a final newline produces; keep interior
    // blank rows so row indices line up with the merges JSON.
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
  } else {
    lines = lines.filter((line) => line.trim() !== "");
  }

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const values = line.split("\t");
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] !== undefined ? values[i] : "";
    });
    return obj;
  });

  return { headers, rows };
}
