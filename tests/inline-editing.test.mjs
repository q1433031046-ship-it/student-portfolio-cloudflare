import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldFinishInlineEditing } from "../app/admin/inline-editing.ts";
import { validationViewForReason } from "../app/admin/validation-location.ts";

test("does not finish inline editing while a Chinese IME is choosing text", () => {
  assert.equal(shouldFinishInlineEditing({ key: "Enter", isComposing: true, keyCode: 229 }), false);
  assert.equal(shouldFinishInlineEditing({ key: "Enter", isComposing: false, keyCode: 229 }), false);
  assert.equal(shouldFinishInlineEditing({ key: "Enter", isComposing: false, keyCode: 13 }), true);
  assert.equal(shouldFinishInlineEditing({ key: "ArrowDown", isComposing: false, keyCode: 40 }), false);
});

test("uses the composition-aware Enter rule in both canvas text editors", async () => {
  const [adminClient, heroEditor] = await Promise.all([
    readFile("app/admin/admin-client.tsx", "utf8"),
    readFile("app/admin/hero-layout-editor.tsx", "utf8"),
  ]);

  for (const source of [adminClient, heroEditor]) {
    assert.match(source, /shouldFinishInlineEditing\(event\.nativeEvent\)/u);
    assert.doesNotMatch(source, /editing && event\.key === "Enter"/u);
  }
});

test("accepts blank Chinese contact titles and still locates over-limit errors", async () => {
  const [adminClient, enhancements] = await Promise.all([
    readFile("app/admin/admin-client.tsx", "utf8"),
    readFile("app/admin/admin-interaction-enhancements.tsx", "utf8"),
  ]);

  assert.match(adminClient, /<Field label="主标题"><input maxLength=\{100\} value=\{contact\.title\}/u);
  assert.doesNotMatch(adminClient, /联系方式主标题不能为空/u);
  assert.match(enhancements, /settings\\\.contact\\\.title\|联系方式主标题/u);
  assert.equal(validationViewForReason("settings.contact.title 长度不能超过 100"), "联系");
});
