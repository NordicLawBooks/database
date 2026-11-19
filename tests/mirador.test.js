import { test } from "node:test";
import assert from "node:assert/strict";
import { norsPyramid } from "../js/render/mirador.js";

const FULL = "https://sprogsamlinger.ku.dk/projects/sprogsamlinger/ds-img.php?path=billeder%2FAM%2037%204to%2Fa_418323_.jpg";

test("norsPyramid: the 1/8 copy (sizes rounded up) below the full image", () => {
  assert.deepEqual(norsPyramid(FULL, 7216, 5211), {
    type: "legacy-image-pyramid",
    levels: [
      { url: FULL.replace("ds-img.php?", "ds-img.php?thumb=200x200&"), width: 902, height: 652 },
      { url: FULL, width: 7216, height: 5211 },
    ],
  });
});

test("norsPyramid: other images, NorS thumbnails and missing sizes are left alone", () => {
  assert.equal(norsPyramid("https://myndir.handrit.is/file/Handrit.is/AM%20342%20fol./0/SECONDARY_DISPLAY", 4869, 6133), null);
  assert.equal(norsPyramid(FULL.replace("ds-img.php?", "ds-img.php?thumb=200x200&"), 892, 631), null);
  assert.equal(norsPyramid(FULL, 0, 5048), null);
  assert.equal(norsPyramid(FULL, undefined, undefined), null);
  assert.equal(norsPyramid(undefined, 7136, 5048), null);
});
