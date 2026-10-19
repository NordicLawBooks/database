import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX } from "../js/render/sidebar.js";

test("clampSidebarWidth keeps the sidebar within 180–600px", () => {
  assert.equal(clampSidebarWidth(340), 340);
  assert.equal(clampSidebarWidth(50), SIDEBAR_MIN);
  assert.equal(clampSidebarWidth(5000), SIDEBAR_MAX);
  assert.equal(clampSidebarWidth(undefined), SIDEBAR_MIN);
});
