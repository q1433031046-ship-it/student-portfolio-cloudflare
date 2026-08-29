import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminClient, portfolioCss, adminCss, publicCover] = await Promise.all([
  readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/demo/portfolio-demo.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/portfolio/project-cover.tsx", import.meta.url), "utf8"),
]);

test("administrator and public covers use the same public layout classes", () => {
  assert.match(adminClient, /portfolioStyles\.projectCover/u);
  assert.match(adminClient, /portfolioStyles\.projectCoverInfo/u);
  assert.match(adminClient, /portfolioStyles\.projectTitleGroup/u);
  assert.match(adminClient, /portfolioStyles\.projectSynopsis/u);
  assert.match(adminClient, /portfolioStyles\.projectFacts/u);
  assert.match(publicCover, /styles\.projectTitleGroup/u);
  assert.match(publicCover, /styles\.projectSynopsis/u);
  assert.match(publicCover, /styles\.projectFacts/u);
});

test("cover typography follows its own canvas instead of browser viewport width", () => {
  assert.match(portfolioCss, /container-type:\s*inline-size/u);
  assert.match(portfolioCss, /font-size:\s*7cqw/u);
  assert.match(portfolioCss, /font-size:\s*13cqw/u);
  assert.doesNotMatch(portfolioCss, /projectTitleGroup h2[^}]*7vw/us);
  assert.doesNotMatch(portfolioCss, /projectTitleGroup h2[^}]*13vw/us);
});

test("administrator can review both desktop and mobile cover results", () => {
  assert.match(adminClient, /桌面 16:9/u);
  assert.match(adminClient, /手机 4:5/u);
  assert.match(adminClient, /data-cover-preview/u);
  assert.match(portfolioCss, /admin cover viewport parity/u);
  assert.match(adminCss, /shared project-cover editing canvas/u);
});

test("blank cover text remains editable in the admin canvas without becoming public placeholder text", () => {
  assert.match(adminClient, /placeholder="双击填写作品名称"/u);
  assert.match(adminClient, /data-placeholder/u);
  assert.doesNotMatch(publicCover, /双击填写/u);
});
