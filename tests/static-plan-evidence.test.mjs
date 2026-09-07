import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PLAN_PATH = "governance/records/v1.3.1-b/plan-v2.md";
const AUDIT_PATH = "governance/records/v1.3.1-b/AUD-20260901-STATIC-PLAN-001-R1.md";
const APPROVED_PLAN_SHA256 = "b4e7f8918cbcf197a7c567390ad150358e56f1afb406b4892ba8f1865c2d0a23";

test("keeps the approved v1.3.1-b plan v2 and R1 approval independently readable", async () => {
  const [plan, audit] = await Promise.all([
    readFile(PLAN_PATH, "utf8"),
    readFile(AUDIT_PATH, "utf8"),
  ]);
  const planSha256 = createHash("sha256").update(plan, "utf8").digest("hex");

  assert.equal(planSha256, APPROVED_PLAN_SHA256, "the approved plan v2 must remain byte-identical");
  assert.match(plan, /^# 学生作品展示 v1\.3\.1-b 固定静态网站发布正式规划$/mu);
  assert.match(plan, /^> 文件版本：`2`\s*$/mu);
  assert.match(plan, /^> 修订依据：`AUD-20260901-STATIC-PLAN-001`\s*$/mu);

  assert.match(audit, /审计编号：`AUD-20260901-STATIC-PLAN-001-R1`/u);
  assert.match(audit, /最终结论：`通过`/u);
  assert.match(audit, new RegExp(APPROVED_PLAN_SHA256, "u"));
  assert.match(audit, /规划审计 AUD-20260901-STATIC-PLAN-001-R1 已通过。/u);
  assert.match(audit, /不重新规划、不重新审计/u);
});
