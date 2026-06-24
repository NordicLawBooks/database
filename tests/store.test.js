import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, makeInitialState } from "../js/store.js";

const tick = () => new Promise((r) => queueMicrotask(r));

test("makeInitialState returns fresh, non-shared nested objects", () => {
  const a = makeInitialState();
  const b = makeInitialState();
  a.facets.Script.push("Gothic");
  assert.deepEqual(b.facets.Script, []); // not shared
  assert.equal(a.view, "merged");
  assert.equal(a.pageSize, 20);
});

test("get() reflects set() synchronously; shallow top-level merge", () => {
  const store = createStore();
  store.set({ query: "lög" });
  assert.equal(store.get().query, "lög");
  store.set({ page: 4 });
  assert.equal(store.get().page, 4);
  assert.equal(store.get().query, "lög"); // untouched keys preserved
});

test("set accepts a functional patch", () => {
  const store = createStore();
  store.set((s) => ({ page: s.page + 1 }));
  assert.equal(store.get().page, 2);
});

test("subscribers are notified once per microtask (batched)", async () => {
  const store = createStore();
  let calls = 0;
  let lastState = null;
  store.subscribe((s) => {
    calls += 1;
    lastState = s;
  });
  store.set({ query: "a" });
  store.set({ query: "ab" });
  store.set({ page: 2 });
  assert.equal(calls, 0); // nothing synchronous
  await tick();
  assert.equal(calls, 1); // coalesced
  assert.equal(lastState.query, "ab");
  assert.equal(lastState.page, 2);
});

test("subscriber receives (state, prevState, meta); last meta in a batch wins", async () => {
  const store = createStore();
  const seen = [];
  store.subscribe((s, prev, meta) => seen.push({ q: s.query, prevQ: prev.query, meta }));
  store.set({ query: "x" }, { history: "replace" });
  store.set({ query: "y" }, { history: "push" });
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].q, "y");
  assert.equal(seen[0].prevQ, ""); // prev is the pre-batch state
  assert.equal(seen[0].meta.history, "push");
});

test("unsubscribe stops further notifications", async () => {
  const store = createStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });
  store.set({ query: "a" });
  await tick();
  assert.equal(calls, 1);
  off();
  store.set({ query: "b" });
  await tick();
  assert.equal(calls, 1);
});
