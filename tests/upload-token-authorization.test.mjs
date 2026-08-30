import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

register(new URL("./cloudflare-workers-loader.mjs", import.meta.url));

const { env } = await import("cloudflare:workers");
const { createDefaultEndCoverSlide } = await import("../app/portfolio/model.ts");
const { createDefaultPortfolioDocument } = await import("../app/portfolio/default-document.ts");
const { isExactDraftMediaReplacement } = await import("../app/api/_lib/media-replacement.ts");

test("matches replacement keys only to the exact editable draft media slot", () => {
  const draft = createDefaultPortfolioDocument();
  draft.settings.customFont.key = "portfolio/site/font-current.woff2";
  draft.settings.contact.image.key = "portfolio/site/contact-current.jpg";
  draft.hero.slides[0].media.key = "portfolio/site/hero-current.jpg";
  draft.categories[0].transition.media.key = "portfolio/categories/narrative/transition-current.jpg";
  draft.projects[0].cover.key = "portfolio/echo-after/cover-current.jpg";
  draft.projects[0].finalVideo.key = "portfolio/echo-after/final-current.mp4";
  const detailMedia = draft.projects[0].detailBlocks.find((block) => block.type === "media-text").media;
  detailMedia.key = "portfolio/echo-after/detail-current.jpg";
  const galleryMedia = draft.projects[0].detailBlocks.find((block) => block.type === "gallery").items[0];
  galleryMedia.key = "portfolio/echo-after/gallery-current.jpg";
  const endCover = createDefaultEndCoverSlide("end-cover-one");
  endCover.media.key = "portfolio/end-covers/end-cover-one/end-cover-current.jpg";
  draft.endCovers = { enabled: true, slides: [endCover] };

  const valid = [
    ["site", "font", draft.settings.customFont],
    ["site", "contact", draft.settings.contact.image],
    ["site", "hero", draft.hero.slides[0].media],
    [draft.categories[0].id, "transition", draft.categories[0].transition.media],
    [draft.projects[0].id, "cover", draft.projects[0].cover],
    [draft.projects[0].id, "final", draft.projects[0].finalVideo],
    [draft.projects[0].id, "detail", detailMedia],
    [draft.projects[0].id, "detail", galleryMedia],
    [endCover.id, "end-cover", endCover.media],
  ];
  for (const [projectId, slot, asset] of valid) {
    assert.equal(isExactDraftMediaReplacement(draft, projectId, slot, asset.id, asset.key), true);
    assert.equal(isExactDraftMediaReplacement(draft, projectId, slot, `${asset.id}-other`, asset.key), false);
    assert.equal(isExactDraftMediaReplacement(draft, projectId, slot, asset.id, `${asset.key}.other`), false);
  }
  assert.equal(isExactDraftMediaReplacement(draft, "echo-after", "cover", draft.hero.slides[0].media.id, draft.hero.slides[0].media.key), false);
  assert.equal(isExactDraftMediaReplacement(draft, "narrative", "transition", draft.categories[1].transition.media.id, draft.categories[0].transition.media.key), false);
});

test("keeps the upload token out of administrator routes while allowing media upload", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadBoundarySetup2026";
  env.UPLOAD_API_TOKEN = "media-uploader-token-2026";

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const portfolioRoute = await import("../app/api/admin/portfolio/route.ts");
  const accessRoute = await import("../app/api/admin/access/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadBoundaryOwner2026",
  }));
  assert.equal(setup.status, 201);

  const tokenHeaders = { Authorization: `Bearer ${env.UPLOAD_API_TOKEN}` };
  const portfolio = await portfolioRoute.GET(new Request("https://portfolio.example/api/admin/portfolio", {
    headers: tokenHeaders,
  }));
  assert.equal(portfolio.status, 401);
  const access = await accessRoute.GET(new Request("https://portfolio.example/api/admin/access", {
    headers: tokenHeaders,
  }));
  assert.equal(access.status, 401);

  const upload = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers: { ...tokenHeaders, "Content-Type": "application/json" },
    body: "{}",
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(upload.status, 400);
  assert.equal((await upload.json()).error, "上传文件信息不完整");
  resetEnv();
});

test("rejects arbitrary quota credits and allows an exact KV draft replacement", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadReplacementSetup2026";
  env.UPLOAD_API_TOKEN = "media-replacement-token-2026";
  env.MEDIA_KV = memoryKv();

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadReplacementOwner2026",
  }));
  assert.equal(setup.status, 201);

  const unrelatedKey = "portfolio/unrelated/huge-old.jpg";
  insertUploadedMedia(database, unrelatedKey, 795 * 1024 * 1024);
  const headers = { Authorization: `Bearer ${env.UPLOAD_API_TOKEN}`, "Content-Type": "application/json" };
  const body = {
    assetId: "hero-media",
    filename: "new-hero.jpg",
    contentType: "image/jpeg",
    byteSize: 8 * 1024 * 1024,
    replacingKey: unrelatedKey,
  };

  const rejected = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).error, "替换媒体信息无效，请刷新草稿后重试");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_upload_sessions").get().count, 0);

  setDraftAssetKey(database, (draft) => draft.hero.slides[0].media, unrelatedKey);
  const noCredit = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(noCredit.status, 413);
  assert.equal((await noCredit.json()).error, "网站空间不足，当前大约还剩 5 MB");
  database.prepare("UPDATE portfolio_media SET byte_size = ? WHERE object_key = ?")
    .run(100 * 1024 * 1024, unrelatedKey);
  const allowed = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(allowed.status, 201);
  assert.equal((await allowed.json()).mode, "chunked");
  const session = database.prepare("SELECT asset_id, replaced_object_key FROM media_upload_sessions LIMIT 1").get();
  assert.equal(session.asset_id, "hero-media");
  assert.equal(session.replaced_object_key, unrelatedKey);
  resetEnv();
});

test("atomically reserves KV capacity for concurrent upload initialization", async () => {
  const database = await createDatabase();
  const insertBarrier = runBarrier(2, (sql) => sql.includes("INSERT INTO media_upload_sessions"));
  env.DB = d1Adapter(database, { beforeRun: insertBarrier.wait });
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadCapacityRaceSetup2026";
  env.UPLOAD_API_TOKEN = "media-capacity-race-token-2026";
  env.MEDIA_KV = memoryKv();

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadCapacityRaceOwner2026",
  }));
  assert.equal(setup.status, 201);
  insertUploadedMedia(database, "portfolio/unrelated/almost-full.jpg", 790 * 1024 * 1024);

  const request = (assetId) => new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPLOAD_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assetId,
      filename: `${assetId}.jpg`,
      contentType: "image/jpeg",
      byteSize: 8 * 1024 * 1024,
      replacingKey: null,
    }),
  });
  const responses = await Promise.all([
    mediaRoute.POST(request("hero-media"), { params: Promise.resolve({ projectId: "site", slot: "hero" }) }),
    mediaRoute.POST(request("hero-media-2"), { params: Promise.resolve({ projectId: "site", slot: "hero" }) }),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort((a, b) => a - b), [201, 413]);
  const rejected = responses.find((response) => response.status === 413);
  assert.equal((await rejected.json()).error, "网站空间不足，当前大约还剩 2 MB");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_upload_sessions WHERE status = 'uploading'").get().count, 1);
  resetEnv();
});

test("a late chunk PUT cannot alter bytes after finalization freezes the upload", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadLateChunkSetup2026";
  env.UPLOAD_API_TOKEN = "media-late-chunk-token-2026";
  const kv = memoryKv();
  env.MEDIA_KV = kv;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadLateChunkOwner2026",
  }))).status, 201);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const initialized = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media", filename: "hero.jpg", byteSize: 4 });
  const original = new Uint8Array([1, 2, 3, 4]);
  assert.equal((await putKvChunk(mediaRoute, token, initialized.uploadId, original)).status, 200);

  const lateGate = oneShotGate();
  let temporaryWrites = 0;
  kv.beforePut = async (key) => {
    if (key.startsWith("portfolio-upload/") && ++temporaryWrites === 1) await lateGate.wait();
  };
  const late = putKvChunk(mediaRoute, token, initialized.uploadId, new Uint8Array([9, 9, 9, 9]));
  await lateGate.entered;
  const completed = await completeKvUpload(mediaRoute, token, initialized.uploadId);
  assert.equal(completed.status, 201);
  const asset = (await completed.json()).asset;
  assert.deepEqual([...kv.read(`${asset.key}::chunk:0000`)], [...original]);

  lateGate.release();
  const lateResponse = await late;
  assert.equal(lateResponse.status, 409);
  assert.deepEqual([...kv.read(`${asset.key}::chunk:0000`)], [...original]);
  assert.equal(database.prepare("SELECT status FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId).status, "completed");
  database.prepare("UPDATE media_upload_sessions SET expires_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", initialized.uploadId);
  await initializeKvUpload(mediaRoute, token, { assetId: "hero-media-2", filename: "after-complete.jpg", byteSize: 1 });
  assert.deepEqual([...kv.read(`${asset.key}::chunk:0000`)], [...original]);
  assert.equal(kv.deleted.includes(`${asset.key}::chunk:0000`), false);
  resetEnv();
});

test("expiry cleanup that loses its claim cannot delete completed chunks", async () => {
  const database = await createDatabase();
  let simulateCompletedWinner = false;
  let targetUploadId = "";
  const hooks = {
    async beforeRun(sql) {
      if (!simulateCompletedWinner || !sql.includes("SET status = 'expiring'")) return;
      simulateCompletedWinner = false;
      const session = database.prepare("SELECT * FROM media_upload_sessions WHERE id = ?").get(targetUploadId);
      insertCompletedKvMedia(database, session);
      database.prepare("UPDATE media_upload_sessions SET status = 'completed' WHERE id = ? AND status = 'uploading'").run(targetUploadId);
    },
  };
  env.DB = d1Adapter(database, hooks);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadExpiryRaceSetup2026";
  env.UPLOAD_API_TOKEN = "media-expiry-race-token-2026";
  const kv = memoryKv();
  env.MEDIA_KV = kv;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadExpiryRaceOwner2026",
  }))).status, 201);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const initialized = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media", filename: "expiring.jpg", byteSize: 4 });
  targetUploadId = initialized.uploadId;
  const original = new Uint8Array([4, 3, 2, 1]);
  assert.equal((await putKvChunk(mediaRoute, token, initialized.uploadId, original)).status, 200);
  const session = database.prepare("SELECT * FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId);
  await kv.put(`${session.object_key}::chunk:0000`, original.buffer);
  database.prepare("UPDATE media_upload_sessions SET expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", initialized.uploadId);
  simulateCompletedWinner = true;

  const next = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media-2", filename: "next.jpg", byteSize: 1 });
  assert.ok(next.uploadId);
  assert.equal(database.prepare("SELECT status FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId).status, "completed");
  assert.deepEqual([...kv.read(`${session.object_key}::chunk:0000`)], [...original]);
  assert.equal(kv.deleted.length, 0);
  resetEnv();
});

test("an expired interrupted finalization is reclaimed exactly and releases its capacity", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadFinalizeRecoverySetup2026";
  env.UPLOAD_API_TOKEN = "media-finalize-recovery-token-2026";
  const kv = memoryKv();
  env.MEDIA_KV = kv;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadFinalizeRecoveryOwner2026",
  }))).status, 201);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const interrupted = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media", filename: "interrupted.jpg", byteSize: 4 });
  const original = new Uint8Array([8, 6, 4, 2]);
  assert.equal((await putKvChunk(mediaRoute, token, interrupted.uploadId, original)).status, 200);
  const session = database.prepare("SELECT * FROM media_upload_sessions WHERE id = ?").get(interrupted.uploadId);
  const temporaryKey = JSON.parse(session.uploaded_chunks_json)["0"].key;
  const formalKey = `${session.object_key}::chunk:0000`;
  await kv.put(formalKey, new Uint8Array([9, 9]).buffer);
  database.prepare("UPDATE media_upload_sessions SET status = 'finalizing', expires_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", interrupted.uploadId);
  insertUploadedMedia(database, "portfolio/unrelated/nearly-full.jpg", 792 * 1024 * 1024);

  const next = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media-2", filename: "after-recovery.jpg", byteSize: 8 * 1024 * 1024 });
  assert.ok(next.uploadId);
  assert.equal(database.prepare("SELECT status FROM media_upload_sessions WHERE id = ?").get(interrupted.uploadId).status, "expired");
  assert.equal(kv.read(temporaryKey), null);
  assert.equal(kv.read(formalKey), null);
  assert.equal(kv.deleted.includes(temporaryKey), true);
  assert.equal(kv.deleted.includes(formalKey), true);
  assert.equal(database.prepare(`SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM media_upload_sessions
    WHERE status IN ('uploading', 'finalizing', 'expiring')`).get().bytes, 8 * 1024 * 1024);
  resetEnv();
});

test("an expired finalizing session can renew its lease and finish safely", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadFinalizeRetrySetup2026";
  env.UPLOAD_API_TOKEN = "media-finalize-retry-token-2026";
  const kv = memoryKv();
  env.MEDIA_KV = kv;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadFinalizeRetryOwner2026",
  }))).status, 201);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const initialized = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media", filename: "retry.jpg", byteSize: 4 });
  const original = new Uint8Array([3, 1, 4, 1]);
  assert.equal((await putKvChunk(mediaRoute, token, initialized.uploadId, original)).status, 200);
  const session = database.prepare("SELECT object_key FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId);
  const formalKey = `${session.object_key}::chunk:0000`;
  await kv.put(formalKey, new Uint8Array([0, 0, 0, 0]).buffer);
  database.prepare("UPDATE media_upload_sessions SET status = 'finalizing', expires_at = ? WHERE id = ?")
    .run("2020-01-01T00:00:00.000Z", initialized.uploadId);

  const completed = await completeKvUpload(mediaRoute, token, initialized.uploadId);
  assert.equal(completed.status, 201);
  assert.deepEqual([...kv.read(formalKey)], [...original]);
  const recovered = database.prepare("SELECT status, expires_at FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId);
  assert.equal(recovered.status, "completed");
  assert.ok(Date.parse(recovered.expires_at) > Date.now());
  resetEnv();
});

test("double completion has one winner and an idempotent peer", async () => {
  const database = await createDatabase();
  const finalizeBarrier = runBarrier(2, (sql) => sql.includes("SET status = 'finalizing'"));
  env.DB = d1Adapter(database, { beforeRun: finalizeBarrier.wait });
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadDoubleCompleteSetup2026";
  env.UPLOAD_API_TOKEN = "media-double-complete-token-2026";
  const kv = memoryKv();
  env.MEDIA_KV = kv;

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  assert.equal((await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadDoubleCompleteOwner2026",
  }))).status, 201);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const longFilename = `${"a".repeat(140)}.jpg`;
  const initialized = await initializeKvUpload(mediaRoute, token, { assetId: "hero-media", filename: longFilename, byteSize: 4 });
  assert.equal((await putKvChunk(mediaRoute, token, initialized.uploadId, new Uint8Array([5, 6, 7, 8]))).status, 200);
  const responses = await Promise.all([
    completeKvUpload(mediaRoute, token, initialized.uploadId),
    completeKvUpload(mediaRoute, token, initialized.uploadId),
  ]);
  const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
  assert.deepEqual(statuses, [200, 201]);
  for (const response of responses) {
    const body = await response.json();
    assert.equal(body.asset.label, longFilename.slice(0, 120));
  }
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portfolio_media").get().count, 1);
  assert.equal(database.prepare("SELECT status FROM media_upload_sessions WHERE id = ?").get(initialized.uploadId).status, "completed");
  resetEnv();
});

test("admin keeps the server-normalized filename after upload", async () => {
  const source = await readFile(new URL("../app/admin/admin-client.tsx", import.meta.url), "utf8");
  assert.match(source, /onUploaded\(\{ \.\.\.result\.asset, alt: asset\.alt/u);
  assert.doesNotMatch(source, /onUploaded\(\{ \.\.\.result\.asset, label: file\.name/u);
  assert.doesNotMatch(source, /mode: "single"/u);
  assert.doesNotMatch(source, /initialized\.mode === "single"/u);
});

test("requires MEDIA_KV for every new upload even when the legacy BUCKET is bound", async () => {
  const database = await createDatabase();
  env.DB = d1Adapter(database);
  env.AUTH_PLATFORM = "password";
  env.INITIAL_ADMIN_CODE = "UploadSingleSetup2026";
  env.UPLOAD_API_TOKEN = "media-single-token-2026";
  const writes = [];
  env.BUCKET = {
    async put(key) { writes.push(key); },
    async delete() {},
  };

  const setupRoute = await import("../app/api/admin/setup/route.ts");
  const mediaRoute = await import("../app/api/admin/media/[projectId]/[slot]/route.ts");
  const setup = await setupRoute.POST(jsonRequest("https://portfolio.example/api/admin/setup", {
    initialCode: env.INITIAL_ADMIN_CODE,
    password: "UploadSingleOwner2026",
  }));
  assert.equal(setup.status, 201);

  const existingKey = "portfolio/site/existing-hero.jpg";
  insertUploadedMedia(database, existingKey, 1);
  setDraftAssetKey(database, (draft) => draft.hero.slides[0].media, existingKey);
  const token = `Bearer ${env.UPLOAD_API_TOKEN}`;
  const initialized = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      assetId: "hero-media",
      filename: "replacement.jpg",
      contentType: "image/jpeg",
      byteSize: 1,
      replacingKey: existingKey,
    }),
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(initialized.status, 503);
  assert.match((await initialized.json()).error, /MEDIA_KV/u);

  const direct = await mediaRoute.PUT(binaryRequest(
    `https://portfolio.example/api/admin/media/site/hero?assetId=hero-media&replacingKey=${encodeURIComponent(existingKey)}`,
    token,
  ), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(direct.status, 503);
  assert.match((await direct.json()).error, /MEDIA_KV/u);
  assert.equal(writes.length, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM portfolio_media").get().count, 1);
  resetEnv();
});

async function createDatabase() {
  const database = new DatabaseSync(":memory:");
  for (const name of [
    "0000_bumpy_ultimo.sql",
    "0001_perpetual_firestar.sql",
    "0002_nosy_silhouette.sql",
    "0003_careful_justice.sql",
    "0004_owner_email_onboarding.sql",
    "0005_password_auth_kv_media.sql",
    "0006_auth_v2.sql",
  ]) {
    const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
    database.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return database;
}

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function binaryRequest(url, authorization) {
  return new Request(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": "image/jpeg",
      "Content-Length": "1",
      "X-File-Name": "replacement.jpg",
    },
    body: new Uint8Array([1]),
    duplex: "half",
  });
}

async function initializeKvUpload(mediaRoute, authorization, { assetId, filename, byteSize }) {
  const response = await mediaRoute.POST(new Request("https://portfolio.example/api/admin/media/site/hero", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ assetId, filename, contentType: "image/jpeg", byteSize, replacingKey: null }),
  }), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
  assert.equal(response.status, 201);
  return response.json();
}

function putKvChunk(mediaRoute, authorization, uploadId, bytes) {
  return mediaRoute.PUT(new Request(
    `https://portfolio.example/api/admin/media/site/hero?uploadId=${encodeURIComponent(uploadId)}&chunk=0`,
    {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
      },
      body: bytes,
      duplex: "half",
    },
  ), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
}

function completeKvUpload(mediaRoute, authorization, uploadId) {
  return mediaRoute.POST(new Request(
    `https://portfolio.example/api/admin/media/site/hero?uploadId=${encodeURIComponent(uploadId)}&complete=1`,
    { method: "POST", headers: { Authorization: authorization } },
  ), { params: Promise.resolve({ projectId: "site", slot: "hero" }) });
}

function insertUploadedMedia(database, objectKey, byteSize) {
  database.prepare(`INSERT INTO portfolio_media (
    id, object_key, project_id, slot, filename, content_type, byte_size,
    uploaded_by, status, created_at
  ) VALUES (?, ?, 'unrelated', 'cover', 'old.jpg', 'image/jpeg', ?, '网站管理员', 'uploaded', ?)`)
    .run(crypto.randomUUID(), objectKey, byteSize, new Date().toISOString());
}

function setDraftAssetKey(database, selectAsset, objectKey) {
  const row = database.prepare("SELECT draft_json FROM portfolio_documents WHERE id = 'default'").get();
  const draft = JSON.parse(row.draft_json);
  selectAsset(draft).key = objectKey;
  database.prepare("UPDATE portfolio_documents SET draft_json = ? WHERE id = 'default'").run(JSON.stringify(draft));
}

function memoryKv() {
  const values = new Map();
  return {
    beforePut: null,
    deleted: [],
    async put(key, value) {
      await this.beforePut?.(key, value);
      values.set(key, await arrayBufferOf(value));
    },
    async get(key) {
      const value = values.get(key);
      return value ? value.slice(0) : null;
    },
    async delete(key) {
      this.deleted.push(key);
      values.delete(key);
    },
    read(key) {
      const value = values.get(key);
      return value ? new Uint8Array(value.slice(0)) : null;
    },
  };
}

async function arrayBufferOf(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return new Response(value).arrayBuffer();
}

function insertCompletedKvMedia(database, session) {
  database.prepare(`INSERT INTO portfolio_media (
    id, object_key, replaced_object_key, project_id, slot, filename, content_type,
    byte_size, storage_backend, chunk_size, chunk_count, uploaded_by, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'kv', ?, ?, ?, 'uploaded', ?)`)
    .run(
      `upload-${session.id}`,
      session.object_key,
      session.replaced_object_key,
      session.project_id,
      session.slot,
      session.filename,
      session.content_type,
      session.byte_size,
      session.chunk_size,
      session.chunk_count,
      session.uploaded_by,
      new Date().toISOString(),
    );
}

function resetEnv() {
  delete env.DB;
  delete env.AUTH_PLATFORM;
  delete env.INITIAL_ADMIN_CODE;
  delete env.UPLOAD_API_TOKEN;
  delete env.MEDIA_KV;
  delete env.BUCKET;
}

function d1Adapter(database, hooks = {}) {
  let batchTail = Promise.resolve();
  return {
    prepare(sql) { return new SqliteD1Statement(database, sql, [], hooks); },
    async batch(statements) {
      const previous = batchTail;
      let release;
      batchTail = new Promise((resolve) => { release = resolve; });
      await previous;
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  };
}

class SqliteD1Statement {
  constructor(database, sql, values = [], hooks = {}) { this.database = database; this.sql = sql; this.values = values; this.hooks = hooks; }
  bind(...values) { return new SqliteD1Statement(this.database, this.sql, values, this.hooks); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async run() {
    await this.hooks.beforeRun?.(this.sql, this.values);
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  async all() { return { success: true, results: this.database.prepare(this.sql).all(...this.values), meta: { changes: 0 } }; }
}

function runBarrier(expected, predicate) {
  let arrivals = 0;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  return {
    async wait(sql) {
      if (!predicate(sql)) return;
      arrivals += 1;
      if (arrivals === expected) release();
      await ready;
    },
  };
}

function oneShotGate() {
  let enteredResolve;
  let releaseResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const released = new Promise((resolve) => { releaseResolve = resolve; });
  return {
    entered,
    async wait() {
      enteredResolve();
      await released;
    },
    release() { releaseResolve(); },
  };
}
