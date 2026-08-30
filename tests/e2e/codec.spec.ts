import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const sample = (await readFile(new URL("../fixtures/codec-sample.mp4.base64", import.meta.url), "utf8")).trim();

test("the release browser decodes baseline H.264 and AAC MP4", async ({ page, browserName }) => {
  await page.goto("about:blank");
  const result = await page.evaluate(async (base64) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    document.body.appendChild(video);
    const metadata = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("metadata timeout")), 10_000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error(`media error ${video.error?.code ?? "unknown"}`)); };
    });
    video.src = `data:video/mp4;base64,${base64}`;
    await metadata;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const snapshot = {
      support: video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      currentTime: video.currentTime,
    };
    video.pause();
    return snapshot;
  }, sample);
  expect(result.support, `${browserName} should advertise H.264/AAC MP4`).not.toBe("");
  expect(result.duration).toBeGreaterThan(0);
  expect(result.width).toBe(16);
  expect(result.height).toBe(16);
  expect(result.currentTime).toBeGreaterThan(0);
});
