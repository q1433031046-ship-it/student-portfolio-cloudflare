import assert from "node:assert/strict";
import test from "node:test";
import { clampHeroLayer, keyboardMoveDelta, moveHeroLayer, resizeHeroLayer } from "../app/portfolio/hero-layout.ts";
import { resolveWatermarkText } from "../app/portfolio/watermark.ts";

const layer = { id: "facts", kind: "facts", x: 72, y: 72, width: 25, scale: 1, align: "left", zIndex: 3, visible: true };

test("clamps free hero layers inside the desktop canvas", () => {
  assert.deepEqual(moveHeroLayer(layer, 20, 40), { ...layer, x: 75, y: 100 });
  assert.equal(resizeHeroLayer(layer, 30).width, 55);
  const clamped = clampHeroLayer({ ...layer, x: -4, width: 120, scale: 4, zIndex: 30 });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.width, 100);
  assert.equal(clamped.scale, 2.5);
  assert.equal(clamped.zIndex, 20);
});

test("returns accessible keyboard movement increments", () => {
  assert.deepEqual(keyboardMoveDelta("ArrowLeft", false), { x: -1, y: 0 });
  assert.deepEqual(keyboardMoveDelta("ArrowDown", true), { x: 0, y: 5 });
  assert.equal(keyboardMoveDelta("Enter", false), null);
});

test("uses one configured watermark or falls back to the portfolio owner", () => {
  assert.equal(resolveWatermarkText("  样片专用  ", "林予安"), "样片专用");
  assert.equal(resolveWatermarkText("   ", "林予安"), "林予安");
  assert.equal(resolveWatermarkText("a".repeat(100), "林予安").length, 80);
});
