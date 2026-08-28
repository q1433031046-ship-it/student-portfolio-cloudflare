import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const works = sqliteTable(
  "works",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    student: text("student").notNull(),
    category: text("category").notNull(),
    year: text("year").notNull(),
    duration: text("duration").notNull().default("00:00"),
    description: text("description").notNull().default(""),
    palette: text("palette").notNull().default("#3b5bff"),
    accent: text("accent").notNull().default("#d9ff55"),
    videoKey: text("video_key"),
    coverKey: text("cover_key"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    publishedAt: text("published_at"),
  },
  (table) => [
    index("works_status_created_idx").on(table.status, table.createdAt),
    index("works_uploaded_by_idx").on(table.uploadedBy),
  ],
);

export const portfolioDocuments = sqliteTable("portfolio_documents", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  revision: integer("revision").notNull().default(1),
  draftJson: text("draft_json").notNull(),
  publishedJson: text("published_json"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedAt: text("published_at"),
});

export const siteOwnership = sqliteTable(
  "site_ownership",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    authSubject: text("auth_subject"),
    authProvider: text("auth_provider", { enum: ["sites", "cloudflare-access", "password"] }).notNull(),
    boundAt: text("bound_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    onboardingEmailSentAt: text("onboarding_email_sent_at"),
    onboardingEmailId: text("onboarding_email_id"),
  },
  (table) => [uniqueIndex("site_ownership_owner_email_idx").on(table.ownerEmail)],
);

export const adminCredentials = sqliteTable("admin_credentials", {
  id: text("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  recoveryHash: text("recovery_hash").notNull(),
  recoverySalt: text("recovery_salt").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  initializedAt: text("initialized_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  passwordChangedAt: text("password_changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  recoveryCodeCreatedAt: text("recovery_code_created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
    userAgentHash: text("user_agent_hash"),
  },
  (table) => [index("admin_sessions_expiry_idx").on(table.expiresAt)],
);

export const portfolioMedia = sqliteTable(
  "portfolio_media",
  {
    id: text("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    replacedObjectKey: text("replaced_object_key"),
    projectId: text("project_id").notNull(),
    slot: text("slot", { enum: ["cover", "final", "draft", "detail"] }).notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageBackend: text("storage_backend", { enum: ["r2", "kv"] }).notNull().default("r2"),
    chunkSize: integer("chunk_size"),
    chunkCount: integer("chunk_count").notNull().default(1),
    uploadedBy: text("uploaded_by").notNull(),
    status: text("status", { enum: ["uploaded", "deleted"] }).notNull().default("uploaded"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("portfolio_media_object_key_idx").on(table.objectKey),
    index("portfolio_media_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const mediaUploadSessions = sqliteTable(
  "media_upload_sessions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    objectKey: text("object_key").notNull(),
    replacedObjectKey: text("replaced_object_key"),
    projectId: text("project_id").notNull(),
    slot: text("slot").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    chunkSize: integer("chunk_size").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    uploadedChunksJson: text("uploaded_chunks_json").notNull().default("[]"),
    uploadedBy: text("uploaded_by").notNull(),
    status: text("status", { enum: ["uploading", "completed", "expired"] }).notNull().default("uploading"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("media_upload_sessions_expiry_idx").on(table.status, table.expiresAt),
    uniqueIndex("media_upload_sessions_object_key_idx").on(table.objectKey),
  ],
);

export const portfolioEvents = sqliteTable(
  "portfolio_events",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    eventType: text("event_type").notNull(),
    path: text("path").notNull(),
    projectId: text("project_id"),
    mediaVersion: text("media_version"),
    referrer: text("referrer"),
    deviceType: text("device_type"),
    browser: text("browser"),
    operatingSystem: text("operating_system"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    asn: integer("asn"),
    asOrganization: text("as_organization"),
    networkHash: text("network_hash"),
    riskLevel: text("risk_level").notNull().default("low"),
    riskReason: text("risk_reason"),
    action: text("action").notNull().default("allow"),
    dedupeKey: text("dedupe_key"),
    eventCount: integer("event_count").notNull().default(1),
    lastSeenAt: text("last_seen_at"),
  },
  (table) => [
    index("portfolio_events_time_idx").on(table.occurredAt),
    index("portfolio_events_project_time_idx").on(table.projectId, table.occurredAt),
    index("portfolio_events_network_time_idx").on(table.networkHash, table.occurredAt),
    index("portfolio_events_risk_time_idx").on(table.riskLevel, table.occurredAt),
    uniqueIndex("portfolio_events_dedupe_idx").on(table.dedupeKey),
  ],
);

export const portfolioAuditLogs = sqliteTable(
  "portfolio_audit_logs",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    summaryJson: text("summary_json").notNull().default("{}"),
  },
  (table) => [
    index("portfolio_audit_time_idx").on(table.occurredAt),
    index("portfolio_audit_actor_time_idx").on(table.actorEmail, table.occurredAt),
  ],
);

export const portfolioAccessSettings = sqliteTable("portfolio_access_settings", {
  id: text("id").primaryKey(),
  restrictionEnabled: integer("restriction_enabled", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: text("updated_by").notNull(),
});

export const portfolioAccessPasses = sqliteTable(
  "portfolio_access_passes",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastUsedAt: text("last_used_at"),
    createdBy: text("created_by").notNull(),
  },
  (table) => [
    index("portfolio_access_passes_status_idx").on(table.enabled, table.expiresAt),
    index("portfolio_access_passes_created_idx").on(table.createdAt),
  ],
);
