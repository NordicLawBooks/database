import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRawSource, assembleModel } from "../js/data/load.js";

// A miniature raw export: blank cells preserved, one blank line, a duplicate row,
// and a trailing newline — the shapes the real Metadata_<Lang>_raw.tsv files have.
const HEADERS = ["Shelf mark", "Name", "Depository", "Main text", "Links to Database", "Gatherings", "Leaves/Pages"];
const TSV =
  [
    HEADERS,
    ["AM 1", "Book", "AM", "K", "[HR](https://h/1)", "", "ff. 1-2"], // 0: top of a 2-row manuscript
    ["", "", "", "KF", "HR; NorS", "", "ff. 3-4"], //                    1: covered by the merges
    [""], //                                                             2: completely blank line
    ["B 2", "Other", "KB", "MEL", "", "Unavailable", ""], //            3
    ["B 2", "Other", "KB", "MEL", "", "Unavailable", ""], //            4: exact duplicate of 3
  ]
    .map((r) => r.join("\t"))
    .join("\n") + "\n";

// Merges list the raw sheet columns (no injected Language), like the real files.
// Shelf mark, Name and Depository are merged over rows 0-1; Main text is not.
const MERGES = {
  columns: HEADERS,
  merges: [0, 1, 2].map((c) => ({ minRow: 0, maxRow: 1, minColIndex: c, maxColIndex: c })),
};
const SRC = { id: "dan", lang: "da" };
const DEPOSITORIES = { AM: "Arnamagnæan Collection", KB: "National Library" };

function parse() {
  return parseRawSource(TSV, SRC, DEPOSITORIES);
}

/** Group parsed rows into the rawByKey shape loadRawSources builds. */
function rawFrom(parsed, merges = MERGES) {
  const rawByKey = new Map();
  for (const row of parsed.rows) {
    if (!rawByKey.has(row.__msKey)) rawByKey.set(row.__msKey, { rows: [], sourceId: SRC.id });
    rawByKey.get(row.__msKey).rows.push(row);
  }
  return { rawByKey, mergesBySource: new Map(merges ? [[SRC.id, merges]] : []), headers: parsed.headers };
}

// --- parseRawSource ---------------------------------------------------------

test("parseRawSource injects Language after Shelf mark, from the source's code (shown as its name)", () => {
  const { headers, rows } = parse();
  assert.deepEqual(headers.slice(0, 3), ["Shelf mark", "Language", "Name"]);
  assert.ok(rows.every((r) => r.Language === "Danish")); // "da" expanded by enrichRow
});

test("parseRawSource keeps blank lines so __sourceRowIndex stays aligned with the merges", () => {
  const { rows } = parse();
  assert.deepEqual(rows.map((r) => r.__sourceRowIndex), [0, 1, 2, 3, 4]); // incl. the blank line (2)
});

test("parseRawSource does not turn the file's trailing newline into an extra row", () => {
  // Regression: the last manuscript of each source rendered with an extra empty row.
  const withNl = parseRawSource(TSV, SRC, DEPOSITORIES).rows;
  const withoutNl = parseRawSource(TSV.replace(/\n$/, ""), SRC, DEPOSITORIES).rows;
  assert.equal(withNl.length, 5);
  assert.deepEqual(withNl, withoutNl);
  const lastMs = withNl.filter((r) => r.__msKey === withNl[withNl.length - 1].__msKey);
  assert.equal(lastMs.length, 2); // B 2 and its duplicate — no phantom third row
});

test("parseRawSource carries Depository + Shelf mark down into the hidden __msKey only", () => {
  const { rows } = parse();
  assert.equal(rows[1].__msKey, rows[0].__msKey); // covered row joins its manuscript
  assert.equal(rows[2].__msKey, rows[0].__msKey); // so does the blank line under it
  assert.notEqual(rows[3].__msKey, rows[0].__msKey); // next manuscript starts at row 3
  assert.equal(rows[1]["Shelf mark"], ""); // visible blank cells are NOT filled here
  assert.equal(rows[1].Depository_abbr, "AM"); // …but the hidden abbreviation is
});

test("parseRawSource expands Depository and keeps the abbreviation", () => {
  const { rows } = parse();
  assert.equal(rows[0].Depository, "Arnamagnæan Collection");
  assert.equal(rows[0].Depository_abbr, "AM");
  assert.equal(rows[0].__sourceId, "dan");
});

test("parseRawSource drops rows before the first manuscript (empty key)", () => {
  const tsv = [HEADERS.join("\t"), "", ["AM 1", "Book", "AM"].join("\t")].join("\n");
  const { rows } = parseRawSource(tsv, SRC, DEPOSITORIES);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].__sourceRowIndex, 1); // index still counts the dropped row
});

test("parseRawSource leaves an existing Language column alone", () => {
  const tsv = [["Shelf mark", "Language", "Depository"], ["AM 1", "Latin", "AM"]].map((r) => r.join("\t")).join("\n");
  const { headers, rows } = parseRawSource(tsv, SRC, DEPOSITORIES);
  assert.deepEqual(headers, ["Shelf mark", "Language", "Depository"]);
  assert.equal(rows[0].Language, "Latin");
});

// --- assembleModel ----------------------------------------------------------

test("assembleModel fills merged cells down, but not unmerged blanks", () => {
  const model = assembleModel(rawFrom(parse()));
  const am1 = model.rows.filter((r) => r["Shelf mark"] === "AM 1");
  assert.equal(am1.length, 2); // the covered row now carries the shelf mark
  assert.deepEqual(am1.map((r) => r.Name), ["Book", "Book"]);
  assert.deepEqual(am1.map((r) => r.Depository), ["Arnamagnæan Collection", "Arnamagnæan Collection"]);
  assert.deepEqual(am1.map((r) => r["Main text"]), ["K", "KF"]); // own values kept
});

test("assembleModel drops completely empty rows and exact duplicates", () => {
  const model = assembleModel(rawFrom(parse()));
  assert.equal(model.rows.length, 3); // 5 parsed - blank line - duplicate
  assert.deepEqual(model.manuscripts.map((m) => m.rows.length), [2, 1]);
});

test("assembleModel turns 'Unavailable' into an empty value", () => {
  const model = assembleModel(rawFrom(parse()));
  assert.equal(model.rows.find((r) => r["Shelf mark"] === "B 2").Gatherings, "");
});

test("assembleModel merges Links to Database per manuscript, dropping bare labels of linked entries", () => {
  const model = assembleModel(rawFrom(parse()));
  const links = model.rows.filter((r) => r["Shelf mark"] === "AM 1").map((r) => r["Links to Database"]);
  assert.deepEqual(links, ["[HR](https://h/1); NorS", "[HR](https://h/1); NorS"]);
});

test("assembleModel does not modify the raw rows used by Manuscript View", () => {
  const raw = rawFrom(parse());
  const before = JSON.stringify([...raw.rawByKey]);
  const model = assembleModel(raw);
  assert.equal(JSON.stringify([...raw.rawByKey]), before);
  assert.equal(model.rawByKey, raw.rawByKey); // passed through for rendering
  assert.equal(model.mergesBySource, raw.mergesBySource);
});

test("assembleModel without merge data leaves covered rows as their own (keyless) manuscript", () => {
  // Without merges nothing is filled down, so the covered row's visible Shelf mark
  // and Depository stay blank and it groups apart — the merges JSON is load-bearing.
  const model = assembleModel(rawFrom(parse(), null));
  assert.equal(model.rows.filter((r) => r["Shelf mark"] === "AM 1").length, 1);
  assert.equal(model.manuscripts.length, 3);
});

test("assembleModel dates each production unit from filled-down cells", () => {
  // Dating is merged over rows 0-2, crossing from unit I into unit II; raw rows 1-2 are blank.
  const headers = ["Shelf mark", "Depository", "Production Unit", "Dating"];
  const tsv = [headers, ["AM 9", "AM", "I", "1300"], ["", "", "", ""], ["", "", "II", ""], ["", "", "", "1450"]]
    .map((r) => r.join("\t"))
    .join("\n");
  const merges = {
    columns: headers,
    merges: [
      ...[0, 1].map((c) => ({ minRow: 0, maxRow: 3, minColIndex: c, maxColIndex: c })),
      { minRow: 0, maxRow: 2, minColIndex: 3, maxColIndex: 3 },
    ],
  };
  const model = assembleModel(rawFrom(parseRawSource(tsv, SRC, DEPOSITORIES), merges));
  const units = model.unitsByKey.get("AM||AM 9");
  assert.deepEqual(units.map((u) => [u.start, u.end, u.raw, u.minYear]), [
    [0, 1, "I", 1300],
    [2, 3, "II", 1300], // row 2 inherits 1300 from the merge
  ]);
});
