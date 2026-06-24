import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeState, decodeState, startHistorySync } from "../js/url.js";
import { createStore, makeInitialState } from "../js/store.js";

// The shareable slice that the URL round-trips (everything except columns/ui).
function shareable(state) {
  const { query, view, sort, page, pageSize, facets, ranges } = state;
  return { query, view, sort, page, pageSize, facets, ranges };
}

const tick = () => new Promise((r) => queueMicrotask(r));
const macro = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("default state encodes to an empty string", () => {
  assert.equal(encodeState(makeInitialState()), "");
});

test("decoding an empty query yields the default shareable state", () => {
  assert.deepEqual(decodeState(""), shareable(makeInitialState()));
  assert.deepEqual(decodeState("?"), shareable(makeInitialState()));
});

test("round-trips a rich state (query, view, sort, page, ps, facets, ranges)", () => {
  const s = makeInitialState();
  s.query = "lagabók"; // non-ASCII survives
  s.view = "table";
  s.sort = "dating";
  s.page = 3;
  s.pageSize = 50;
  s.facets.Language = ["is", "sv"]; // multi-valued, order preserved
  s.facets.Depository = ["AM"];
  s.facets["Main text group-variant"] = ["Eidsivathing|Y"]; // aliased key + "|" value
  s.facets.Lines = ["variable"]; // text value of a range+terms facet
  s.ranges.Dating = { min: 1300, max: 1450 };
  s.ranges.Lines = { min: 20, max: null }; // open-ended range

  const decoded = decodeState(encodeState(s));
  assert.deepEqual(decoded, shareable(s));
});

test("round-trips open-ended ranges in both directions", () => {
  assert.deepEqual(decodeState("?dating=-1450").ranges.Dating, { min: null, max: 1450 });
  assert.deepEqual(decodeState("?dating=1300-").ranges.Dating, { min: 1300, max: null });
  assert.deepEqual(decodeState("?dating=1300-1450").ranges.Dating, { min: 1300, max: 1450 });
});

test("only non-default values appear in the URL", () => {
  const s = makeInitialState();
  s.query = "x";
  s.facets.Script = ["Gothic"];
  const qs = encodeState(s);
  assert.match(qs, /(^|[?&])q=x(&|$)/);
  assert.match(qs, /f\.Script=Gothic/);
  assert.doesNotMatch(qs, /(^|[?&])v=/); // default view omitted
  assert.doesNotMatch(qs, /(^|[?&])sort=/); // default sort omitted
  assert.doesNotMatch(qs, /(^|[?&])page=/); // default page omitted
  assert.doesNotMatch(qs, /(^|[?&])ps=/); // default pageSize omitted
});

test("pageSize 'all' round-trips", () => {
  const s = makeInitialState();
  s.pageSize = "all";
  assert.match(encodeState(s), /ps=all/);
  assert.equal(decodeState(encodeState(s)).pageSize, "all");
});

test("decoding is tolerant of unknown keys and junk", () => {
  const d = decodeState("?bogus=1&q=hi&page=-4&ps=banana&v=zzz");
  assert.equal(d.query, "hi");
  assert.equal(d.page, 1); // invalid -> default
  assert.equal(d.pageSize, 20); // invalid -> default
  assert.equal(d.view, "merged"); // unknown code -> default
});

test("accepts a location-like object with .search", () => {
  assert.equal(decodeState({ search: "?q=loc" }).query, "loc");
});

// --- startHistorySync (with a fake window) ----------------------------------

function fakeWindow() {
  const calls = [];
  let popHandler = null;
  return {
    calls,
    location: { pathname: "/db/", search: "" },
    history: {
      pushState: (_s, _t, url) => calls.push(["push", url]),
      replaceState: (_s, _t, url) => calls.push(["replace", url]),
    },
    addEventListener: (type, fn) => {
      if (type === "popstate") popHandler = fn;
    },
    removeEventListener: () => {
      popHandler = null;
    },
    firePopState() {
      if (popHandler) popHandler();
    },
  };
}

test("history sync: replaceState by default, pushState on history:'push', silent suppresses", async () => {
  const win = fakeWindow();
  const store = createStore();
  const stop = startHistorySync(store, { window: win, writeDelay: 0 });

  store.set({ query: "a" }); // default -> replace
  await tick();
  await macro();
  store.set({ facets: { ...store.get().facets, Script: ["Gothic"] } }, { history: "push" });
  await tick();
  await macro();
  store.set({ query: "silent-change" }, { history: "silent" });
  await tick();
  await macro();

  const modes = win.calls.map((c) => c[0]);
  assert.deepEqual(modes, ["replace", "push"]); // silent produced no write
  assert.match(win.calls[0][1], /q=a/);
  assert.match(win.calls[1][1], /f\.Script=Gothic/);
  stop();
});

test("history sync: popstate pushes decoded location into the store silently", async () => {
  const win = fakeWindow();
  const store = createStore();
  const stop = startHistorySync(store, { window: win, writeDelay: 0 });

  win.location.search = "?q=frompop&v=t";
  win.firePopState();
  await tick();

  assert.equal(store.get().query, "frompop");
  assert.equal(store.get().view, "table");
  await macro();
  // The silent set must not have written back to history.
  assert.equal(win.calls.length, 0);
  stop();
});
