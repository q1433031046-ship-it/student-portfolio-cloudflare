import assert from "node:assert/strict";
import test from "node:test";
import { croppedImageStyle, fitCropToAspect, mediaCropAspect, normalizeMediaCrop } from "../app/portfolio/media-crop.ts";

test("fits a fixed output ratio inside portrait and landscape sources", () => {
  const landscape = fitCropToAspect(2, 16 / 9);
  assert.equal(landscape.height, 100);
  assert.equal(Math.round((2 * landscape.width / landscape.height) * 1000) / 1000, Math.round((16 / 9) * 1000) / 1000);

  const portrait = fitCropToAspect(3 / 4, 1);
  assert.equal(portrait.width, 100);
  assert.equal(Math.round(((3 / 4) * portrait.width / portrait.height) * 1000) / 1000, 1);
});

test("uses the confirmed crop ratio and maps the selected source rectangle", () => {
  const asset = {
    id: "crop-media",
    label: "",
    alt: "",
    kind: "image",
    visualKey: "frame",
    sourceAspectRatio: 2,
    crop: { x: 25, y: 10, width: 50, height: 80 },
  };
  assert.equal(mediaCropAspect(asset), 1.25);
  const style = croppedImageStyle(asset);
  assert.equal(style.left, "-50%");
  assert.equal(style.width, "200%");
  assert.equal(style.height, "125%");
});

test("keeps resized crop rectangles inside the source", () => {
  assert.deepEqual(normalizeMediaCrop({ x: 90, y: -10, width: 30, height: 120 }), { x: 70, y: 0, width: 30, height: 100 });
});
