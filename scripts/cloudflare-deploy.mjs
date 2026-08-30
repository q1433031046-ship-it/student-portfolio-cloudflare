#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_SECRET_BINDING = "INITIAL_ADMIN_CODE";
const VALID_MODES = new Set(["auto", "new", "upgrade"]);
const SCRIPT_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return `用法: bash scripts/deploy-cloudflare.sh [选项]

选项:
  --mode auto|new|upgrade   自动识别、仅首次部署或仅现有站点升级（默认 auto）
  --config PATH            Wrangler 配置（默认 wrangler.jsonc）
  --manifest PATH          部署契约（默认 deployment/agent-manifest.json）
  --output PATH            将升级前资源指纹写入指定文件（仅与 --inspect 同用）
  --fingerprint PATH       升级前资源指纹；现有站点升级时必须提供并严格复核
  --inspect                仅核对现有站点资源指纹，不迁移或部署
  --help                   显示帮助
`;
}

function parseArgs(argv) {
  const options = {
    mode: "auto",
    config: "wrangler.jsonc",
    manifest: "deployment/agent-manifest.json",
    output: null,
    fingerprint: null,
    inspect: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (argument === "--inspect") {
      options.inspect = true;
      continue;
    }
    const key = new Map([
      ["--mode", "mode"],
      ["--config", "config"],
      ["--manifest", "manifest"],
      ["--output", "output"],
      ["--fingerprint", "fingerprint"],
    ]).get(argument);
    if (!key) {
      throw new Error(`未知参数：${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} 缺少值`);
    }
    options[key] = value;
    index += 1;
  }

  if (!VALID_MODES.has(options.mode)) {
    throw new Error(`--mode 只能是 auto、new 或 upgrade，收到：${options.mode}`);
  }
  if (options.inspect && options.mode === "new") {
    throw new Error("--inspect 只能用于现有站点，不能与 --mode new 同时使用");
  }
  if (options.inspect && !options.output) {
    throw new Error("--inspect 必须同时提供 --output <升级前指纹文件>");
  }
  if (options.output && !options.inspect) {
    throw new Error("--output 只能与 --inspect 同时使用");
  }
  if (options.fingerprint && (options.inspect || options.mode === "new")) {
    throw new Error("--fingerprint 只能用于现有站点部署，不能用于指纹捕获或首次部署");
  }
  if (options.mode === "upgrade" && !options.inspect && !options.fingerprint) {
    throw new Error("现有站点升级必须提供 --fingerprint <升级前指纹文件>");
  }
  return options;
}

function stripJsonComments(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "string") {
      result += character;
      if (character === "\\") {
        result += next ?? "";
        index += 1;
      } else if (character === '"') {
        state = "code";
      }
      continue;
    }
    if (state === "line-comment") {
      if (character === "\n") {
        result += character;
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      } else if (character === "\n") {
        result += character;
      }
      continue;
    }
    if (character === '"') {
      result += character;
      state = "string";
    } else if (character === "/" && next === "/") {
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else {
      result += character;
    }
  }
  return result;
}

function removeJsonTrailingCommas(source) {
  let result = "";
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (character === "\\") {
        result += source[index + 1] ?? "";
        index += 1;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") continue;
    }
    result += character;
  }
  return result;
}

async function readJson(path, { jsonc = false } = {}) {
  const source = await readFile(path, "utf8");
  const normalized = jsonc ? removeJsonTrailingCommas(stripJsonComments(source)) : source;
  try {
    return JSON.parse(normalized);
  } catch (error) {
    throw new Error(`无法解析 ${path}：${error.message}`);
  }
}

function exactlyOne(items, description) {
  if (items.length !== 1) {
    throw new Error(`部署配置必须且只能包含一个 ${description}，当前为 ${items.length} 个`);
  }
  return items[0];
}

function validatedWorkerName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) {
    throw new Error(`${label} 必须是 1–63 位小写字母、数字或连字符，且不能以连字符开头或结尾`);
  }
  return value;
}

function effectiveWorkerName(config) {
  const configuredName = validatedWorkerName(config.name, "wrangler Worker name");
  const ciOverrideName = process.env.WRANGLER_CI_OVERRIDE_NAME;
  if (ciOverrideName === undefined) return configuredName;
  return validatedWorkerName(ciOverrideName, "WRANGLER_CI_OVERRIDE_NAME");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("运行变量含无法稳定序列化的 JSON 值");
}

function runtimeVariableFingerprint(binding, type, value) {
  const canonicalValue = type === "plain_text" ? String(value) : canonicalJson(value);
  return {
    binding,
    type,
    sha256: createHash("sha256").update(type).update("\0").update(canonicalValue).digest("hex"),
  };
}

function localResourceFingerprint(config, manifest, workerName) {
  const d1 = exactlyOne(
    (Array.isArray(config.d1_databases) ? config.d1_databases : []).filter((entry) => entry?.binding === "DB"),
    "DB D1 绑定",
  );
  const configuredKvBindings = (Array.isArray(config.kv_namespaces) ? config.kv_namespaces : [])
    .filter((entry) => entry?.binding === "MEDIA_KV");
  if (configuredKvBindings.length > 1) exactlyOne(configuredKvBindings, "MEDIA_KV KV 绑定");
  const kv = configuredKvBindings[0] ?? null;
  const r2Buckets = (Array.isArray(config.r2_buckets) ? config.r2_buckets : []).map((entry) => {
    if (typeof entry?.binding !== "string" || entry.binding.trim() === "") {
      throw new Error("R2 绑定缺少 binding 名称");
    }
    if (typeof entry?.bucket_name !== "string" || entry.bucket_name.trim() === "") {
      throw new Error(`R2 绑定 ${entry.binding} 缺少 bucket_name`);
    }
    return { binding: entry.binding, bucketName: entry.bucket_name };
  }).sort((left, right) => left.binding.localeCompare(right.binding));
  if (new Set(r2Buckets.map((entry) => entry.binding)).size !== r2Buckets.length) {
    throw new Error("wrangler 配置含重复的 R2 binding 名称");
  }
  const runtimeVariables = Object.entries(config.vars ?? {}).map(([binding, value]) => {
    if (typeof value === "string") return runtimeVariableFingerprint(binding, "plain_text", value);
    return runtimeVariableFingerprint(binding, "json", value);
  }).sort((left, right) => left.binding.localeCompare(right.binding));

  const declaredSecrets = Array.isArray(manifest.requiredSecrets)
    ? manifest.requiredSecrets.filter((name) => typeof name === "string" && name.trim() !== "")
    : [DEFAULT_SECRET_BINDING];
  if (!declaredSecrets.includes(DEFAULT_SECRET_BINDING)) {
    throw new Error(`部署契约 requiredSecrets 缺少 ${DEFAULT_SECRET_BINDING}`);
  }

  return {
    schemaVersion: 1,
    workerName,
    configuredWorkersDevEnabled: config.workers_dev !== false,
    d1: {
      binding: "DB",
      id: typeof d1.database_id === "string" && d1.database_id.trim() !== "" ? d1.database_id : null,
    },
    kv: {
      binding: "MEDIA_KV",
      id: typeof kv?.id === "string" && kv.id.trim() !== "" ? kv.id : null,
    },
    r2Buckets,
    runtimeVariables,
    requiredSecretBindings: [...new Set(declaredSecrets)].sort(),
    migrationsDirectory: typeof d1.migrations_dir === "string" ? d1.migrations_dir : "./migrations",
    resourceIdFieldsPresent: {
      d1: Object.hasOwn(d1, "database_id"),
      kv: kv ? Object.hasOwn(kv, "id") : false,
    },
    resourceBindingsPresent: {
      d1: true,
      kv: kv !== null,
    },
  };
}

function assertExistingUpgradeResourceIds(local) {
  if (typeof local.d1.id !== "string") {
    throw new Error("现有站点配置缺少固定的 DB database_id；v1.2.1 自动升级只支持已具备固定 DB ID 和 MEDIA_KV 的站点，纯 v1.0 R2-only 站点本版未支持且已在任何远程改动前停止");
  }
  if (!local.resourceBindingsPresent.kv) {
    throw new Error("现有站点配置缺少 MEDIA_KV；v1.2.1 不会在升级中自动创建或猜测 KV，纯 v1.0 R2-only 站点本版未支持且已在任何远程改动前停止");
  }
  if (typeof local.kv.id !== "string") {
    throw new Error("现有站点的 MEDIA_KV 绑定缺少固定 id；v1.2.1 不会在升级中自动创建或猜测 KV，纯 v1.0 R2-only 站点本版未支持且已在任何远程改动前停止");
  }
}

function assertNewDeploymentHasProvisionedResourceIds(local) {
  if (!local.resourceBindingsPresent.kv) {
    throw new Error("首次部署工作副本缺少 MEDIA_KV binding；请使用 Cloudflare Deploy Button 平台预配置，本脚本不会接管或猜测资源");
  }
  if (typeof local.d1.id !== "string" || typeof local.kv.id !== "string") {
    throw new Error("首次部署只能在 Cloudflare Deploy Button 已为本站独立预配置并向运行时工作副本注入 DB database_id 与 MEDIA_KV id 后继续；公开源模板仍必须省略真实 ID，本地无 ID 通用新建本版未支持，已在迁移和部署前停止");
  }
}

function redactSensitiveOutput(value) {
  return String(value ?? "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/giu, "$1[REDACTED]")
    .replace(/((?:api[_ -]?token|access[_ -]?token|password|cookie|secret(?:[_ -]?value)?)\s*[:=]\s*)[^\s,;]+/giu, "$1[REDACTED]");
}

function runWrangler(args) {
  const result = spawnSync("npx", ["--no-install", "wrangler", ...args], {
    cwd: SCRIPT_PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    env: process.env,
  });
  if (result.error) {
    throw new Error(`无法运行 Wrangler：${result.error.message}`);
  }
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function commandFailure(label, result) {
  const detail = redactSensitiveOutput(`${result.stderr}\n${result.stdout}`).trim();
  return new Error(`${label}失败${detail ? `：\n${detail}` : ""}`);
}

function parseCommandJson(label, output) {
  try {
    return JSON.parse(output.trim());
  } catch (error) {
    throw new Error(`${label}没有返回可解析的 JSON：${error.message}`);
  }
}

function collectVersionIds(value, ids = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectVersionIds(item, ids);
    return ids;
  }
  if (!value || typeof value !== "object") return ids;
  if (typeof value.version_id === "string" && value.version_id.trim() !== "") {
    ids.add(value.version_id);
  }
  if (typeof value.versionId === "string" && value.versionId.trim() !== "") {
    ids.add(value.versionId);
  }
  for (const nested of Object.values(value)) collectVersionIds(nested, ids);
  return ids;
}

function classifyDeploymentState(result) {
  if (result.status === 0) {
    const payload = parseCommandJson("读取 Worker 当前部署", result.stdout);
    const versionIds = [...collectVersionIds(payload)];
    if (versionIds.length === 0) {
      throw new Error("Worker 状态返回成功但没有当前 version_id；为避免覆盖未知状态，已停止部署");
    }
    return { kind: "existing", versionIds };
  }

  const detail = `${result.stderr}\n${result.stdout}`;
  if (/\b(?:unauthori[sz]ed|forbidden|authentication|authorization|permission|api token|log in)\b/iu.test(detail)) {
    throw commandFailure("确认 Worker 是否已存在", result);
  }
  if (/(?:worker\s+has\s+no\s+deployments|no\s+deployments?\s+(?:exist|found)|worker[^\n]{0,100}(?:does\s+not\s+exist|not\s+found))/iu.test(detail)) {
    return { kind: "new", versionIds: [] };
  }
  throw commandFailure("确认 Worker 是否已存在", result);
}

function bindingArrays(value, arrays = []) {
  if (Array.isArray(value)) {
    for (const item of value) bindingArrays(item, arrays);
    return arrays;
  }
  if (!value || typeof value !== "object") return arrays;
  if (Array.isArray(value.bindings)) arrays.push(value.bindings);
  for (const [key, nested] of Object.entries(value)) {
    if (key !== "bindings") bindingArrays(nested, arrays);
  }
  return arrays;
}

function remoteResourceFingerprint(payload, local) {
  const bindings = bindingArrays(payload).flat();
  const d1 = exactlyOne(
    bindings.filter((binding) => binding?.name === "DB" && /^(?:d1|d1_database)$/iu.test(binding?.type ?? "")),
    "远端 DB D1 绑定",
  );
  const kv = exactlyOne(
    bindings.filter((binding) => binding?.name === "MEDIA_KV" && /^(?:kv|kv_namespace)$/iu.test(binding?.type ?? "")),
    "远端 MEDIA_KV KV 绑定",
  );
  const secretNames = new Set(
    bindings
      .filter((binding) => /^(?:secret|secret_text)$/iu.test(binding?.type ?? ""))
      .map((binding) => binding?.name)
      .filter((name) => typeof name === "string"),
  );
  const missingSecrets = local.requiredSecretBindings.filter((name) => !secretNames.has(name));
  if (missingSecrets.length > 0) {
    throw new Error(`远端 Worker 缺少必需的秘密绑定名称：${missingSecrets.join(", ")}`);
  }

  const d1Id = d1.id ?? d1.database_id;
  const kvId = kv.namespace_id ?? kv.id;
  if (typeof d1Id !== "string" || typeof kvId !== "string") {
    throw new Error("远端 Worker 资源信息缺少 D1 或 KV 标识；已停止部署");
  }
  const r2Buckets = bindings
    .filter((binding) => binding?.type === "r2_bucket")
    .map((binding) => {
      if (typeof binding?.name !== "string" || typeof binding?.bucket_name !== "string") {
        throw new Error("远端 Worker 的 R2 绑定缺少 binding 或 bucket_name；已停止部署");
      }
      return { binding: binding.name, bucketName: binding.bucket_name };
    })
    .sort((left, right) => left.binding.localeCompare(right.binding));
  const runtimeVariables = bindings
    .filter((binding) => binding?.type === "plain_text" || binding?.type === "json")
    .map((binding) => {
      if (typeof binding?.name !== "string" || binding.name.trim() === "") {
        throw new Error("远端 Worker 运行变量缺少 binding 名称；已停止部署");
      }
      if (binding.type === "plain_text" && typeof binding.text !== "string") {
        throw new Error(`远端 Worker 运行变量 ${binding.name} 缺少文本值；已停止部署`);
      }
      return runtimeVariableFingerprint(binding.name, binding.type, binding.type === "plain_text" ? binding.text : binding.json);
    })
    .sort((left, right) => left.binding.localeCompare(right.binding));
  if (new Set(runtimeVariables.map((entry) => entry.binding)).size !== runtimeVariables.length) {
    throw new Error("远端 Worker 含重复的运行变量 binding；已停止部署");
  }
  return {
    schemaVersion: 1,
    workerName: local.workerName,
    configuredWorkersDevEnabled: local.configuredWorkersDevEnabled,
    d1: { binding: "DB", id: d1Id },
    kv: { binding: "MEDIA_KV", id: kvId },
    r2Buckets,
    runtimeVariables,
    secretBindings: [...secretNames].sort(),
    requiredSecretBindings: [...local.requiredSecretBindings],
  };
}

function verifyLiveResourceFingerprint(expected, actual, versionId) {
  const mismatches = [];
  if (actual.d1.id !== expected.d1.id) {
    mismatches.push(`DB: 远端 ${actual.d1.id}，配置 ${expected.d1.id}`);
  }
  if (actual.kv.id !== expected.kv.id) {
    mismatches.push(`MEDIA_KV: 远端 ${actual.kv.id}，配置 ${expected.kv.id}`);
  }
  if (actual.configuredWorkersDevEnabled !== expected.configuredWorkersDevEnabled) {
    mismatches.push("本地 workers_dev 配置值不一致");
  }
  if (JSON.stringify(actual.r2Buckets) !== JSON.stringify(expected.r2Buckets)) {
    mismatches.push("R2 BUCKET binding/name 与配置不一致");
  }
  const liveVariables = new Map(actual.runtimeVariables.map((entry) => [entry.binding, entry]));
  for (const configuredVariable of expected.runtimeVariables) {
    const liveVariable = liveVariables.get(configuredVariable.binding);
    if (!liveVariable || liveVariable.type !== configuredVariable.type || liveVariable.sha256 !== configuredVariable.sha256) {
      mismatches.push(`运行变量 ${configuredVariable.binding} 与配置不一致`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Worker version ${versionId} 的 resource fingerprint 与本次配置不一致：${mismatches.join("；")}`);
  }
}

async function writeFingerprint(path, fingerprint) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, `${JSON.stringify(fingerprint, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`指纹文件已存在：${target}；为避免覆盖升级前基线，请使用新的 --output 路径，或在确认不再需要旧基线后手工移走文件`);
    }
    throw error;
  }
  await chmod(target, 0o600);
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(`${label} 字段不符合 schemaVersion 1 契约`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

function normalizeFingerprint(value, label = "资源指纹") {
  assertExactKeys(value, [
    "schemaVersion",
    "workerName",
    "configuredWorkersDevEnabled",
    "d1",
    "kv",
    "r2Buckets",
    "runtimeVariables",
    "secretBindings",
    "requiredSecretBindings",
  ], label);
  if (value.schemaVersion !== 1) throw new Error(`${label} schemaVersion 必须为 1`);
  if (typeof value.configuredWorkersDevEnabled !== "boolean") {
    throw new Error(`${label}.configuredWorkersDevEnabled 必须是布尔值`);
  }
  assertExactKeys(value.d1, ["binding", "id"], `${label}.d1`);
  assertExactKeys(value.kv, ["binding", "id"], `${label}.kv`);
  if (value.d1.binding !== "DB" || value.kv.binding !== "MEDIA_KV") {
    throw new Error(`${label} 必须使用 DB 与 MEDIA_KV binding`);
  }
  if (!Array.isArray(value.r2Buckets) || !Array.isArray(value.runtimeVariables) || !Array.isArray(value.secretBindings) || !Array.isArray(value.requiredSecretBindings)) {
    throw new Error(`${label} 的 R2、运行变量与秘密 binding 字段必须是数组`);
  }
  const r2Buckets = value.r2Buckets.map((entry, index) => {
    assertExactKeys(entry, ["binding", "bucketName"], `${label}.r2Buckets[${index}]`);
    return {
      binding: nonEmptyString(entry.binding, `${label}.r2Buckets[${index}].binding`),
      bucketName: nonEmptyString(entry.bucketName, `${label}.r2Buckets[${index}].bucketName`),
    };
  }).sort((left, right) => left.binding.localeCompare(right.binding));
  const runtimeVariables = value.runtimeVariables.map((entry, index) => {
    assertExactKeys(entry, ["binding", "type", "sha256"], `${label}.runtimeVariables[${index}]`);
    if (entry.type !== "plain_text" && entry.type !== "json") {
      throw new Error(`${label}.runtimeVariables[${index}].type 非法`);
    }
    if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error(`${label}.runtimeVariables[${index}].sha256 非法`);
    }
    return {
      binding: nonEmptyString(entry.binding, `${label}.runtimeVariables[${index}].binding`),
      type: entry.type,
      sha256: entry.sha256,
    };
  }).sort((left, right) => left.binding.localeCompare(right.binding));
  const secretBindings = value.secretBindings
    .map((name, index) => nonEmptyString(name, `${label}.secretBindings[${index}]`))
    .sort();
  const requiredSecretBindings = value.requiredSecretBindings
    .map((name, index) => nonEmptyString(name, `${label}.requiredSecretBindings[${index}]`))
    .sort();
  if (new Set(r2Buckets.map((entry) => entry.binding)).size !== r2Buckets.length) {
    throw new Error(`${label} 含重复 R2 binding`);
  }
  if (new Set(runtimeVariables.map((entry) => entry.binding)).size !== runtimeVariables.length) {
    throw new Error(`${label} 含重复运行变量 binding`);
  }
  if (new Set(secretBindings).size !== secretBindings.length) {
    throw new Error(`${label} 含重复秘密 binding 名称`);
  }
  if (new Set(requiredSecretBindings).size !== requiredSecretBindings.length) {
    throw new Error(`${label} 含重复秘密 binding 名称`);
  }
  const secretSet = new Set(secretBindings);
  if (requiredSecretBindings.some((name) => !secretSet.has(name))) {
    throw new Error(`${label} 缺少 requiredSecretBindings 中声明的秘密 binding 名称`);
  }
  return {
    schemaVersion: 1,
    workerName: nonEmptyString(value.workerName, `${label}.workerName`),
    configuredWorkersDevEnabled: value.configuredWorkersDevEnabled,
    d1: { binding: "DB", id: nonEmptyString(value.d1.id, `${label}.d1.id`) },
    kv: { binding: "MEDIA_KV", id: nonEmptyString(value.kv.id, `${label}.kv.id`) },
    r2Buckets,
    runtimeVariables,
    secretBindings,
    requiredSecretBindings,
  };
}

async function readBaselineFingerprint(path) {
  const target = resolve(path);
  const [payload, metadata] = await Promise.all([readJson(target), stat(target)]);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`升级前指纹文件权限过宽：${target}；请设置为仅当前用户可读写（0600）`);
  }
  return normalizeFingerprint(payload, "升级前 baseline fingerprint");
}

function verifyBaselineFingerprint(baseline, current) {
  const normalizedCurrent = normalizeFingerprint(current, "当前远端资源指纹");
  if (JSON.stringify(baseline) !== JSON.stringify(normalizedCurrent)) {
    const changed = [];
    if (baseline.workerName !== normalizedCurrent.workerName) changed.push("Worker");
    if (baseline.configuredWorkersDevEnabled !== normalizedCurrent.configuredWorkersDevEnabled) changed.push("本地 workers_dev 配置值");
    if (JSON.stringify(baseline.d1) !== JSON.stringify(normalizedCurrent.d1)) changed.push("DB");
    if (JSON.stringify(baseline.kv) !== JSON.stringify(normalizedCurrent.kv)) changed.push("MEDIA_KV");
    if (JSON.stringify(baseline.r2Buckets) !== JSON.stringify(normalizedCurrent.r2Buckets)) changed.push("R2 BUCKET");
    if (JSON.stringify(baseline.runtimeVariables) !== JSON.stringify(normalizedCurrent.runtimeVariables)) changed.push("运行变量");
    if (JSON.stringify(baseline.secretBindings) !== JSON.stringify(normalizedCurrent.secretBindings)) changed.push("秘密 binding 名称");
    if (JSON.stringify(baseline.requiredSecretBindings) !== JSON.stringify(normalizedCurrent.requiredSecretBindings)) changed.push("秘密 binding 名称");
    throw new Error(`升级前 baseline fingerprint 与当前远端不一致（${changed.join("、") || "未知字段"}）；已在迁移和部署前停止`);
  }
}

function extractMigrationNames(output) {
  const names = [...String(output).matchAll(/\b\d{4}_[a-z0-9_]+\.sql\b/giu)].map((match) => match[0]);
  if (names.length > 0) return [...new Set(names)];
  if (/\bno\s+migrations?\b|nothing\s+to\s+(?:apply|migrate)|database\s+is\s+up\s+to\s+date/iu.test(output)) {
    return [];
  }
  throw new Error("无法从 Wrangler 输出中确定待执行迁移；为避免跳过未知迁移，已停止部署");
}

function isD1PermissionError(output) {
  const detail = String(output);
  return /(?:\bD1\b[\s\S]{0,200}\b(?:forbidden|unauthori[sz]ed|permission|access\s+denied)\b|\b(?:forbidden|unauthori[sz]ed|permission|access\s+denied)\b[\s\S]{0,200}\bD1\b)/iu.test(detail);
}

function splitSqlStatements(source) {
  const statements = [];
  let statement = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "single-quote" || state === "double-quote" || state === "backtick") {
      statement += character;
      const closing = state === "single-quote" ? "'" : state === "double-quote" ? '"' : "`";
      if (character === closing) {
        if (next === closing) {
          statement += next;
          index += 1;
        } else {
          state = "code";
        }
      }
      continue;
    }
    if (state === "line-comment") {
      if (character === "\n") {
        statement += character;
        state = "code";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        state = "code";
        index += 1;
      } else if (character === "\n") {
        statement += character;
      }
      continue;
    }
    if (character === "-" && next === "-") {
      state = "line-comment";
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      index += 1;
    } else if (character === "'") {
      state = "single-quote";
      statement += character;
    } else if (character === '"') {
      state = "double-quote";
      statement += character;
    } else if (character === "`") {
      state = "backtick";
      statement += character;
    } else if (character === ";") {
      if (statement.trim() !== "") statements.push(statement.trim());
      statement = "";
    } else {
      statement += character;
    }
  }
  if (state !== "code" && state !== "line-comment") {
    throw new Error("SQL 含有未闭合的字符串或注释");
  }
  if (statement.trim() !== "") statements.push(statement.trim());
  return statements;
}

async function assertCreateOnlyMigration(path, migrationName) {
  const source = await readFile(path, "utf8").catch((error) => {
    throw new Error(`无法读取运行时安全迁移 ${migrationName}：${error.message}`);
  });
  const statements = splitSqlStatements(source);
  if (statements.length === 0) {
    throw new Error(`运行时安全迁移 ${migrationName} 为空`);
  }
  for (const statement of statements) {
    const isCreateTable = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/iu.test(statement);
    const isCreateIndex = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/iu.test(statement);
    if (!isCreateTable && !isCreateIndex) {
      throw new Error(`运行时安全迁移 ${migrationName} 含非幂等 CREATE TABLE/INDEX 语句；已停止部署`);
    }
  }
  return source;
}

async function assertRuntimeSafeFallback({ pendingMigrations, manifest, configPath, migrationsDirectory }) {
  const runtimeSafe = manifest.databaseMigrationPolicy?.runtimeSafeBootstrapMigrations;
  if (!Array.isArray(runtimeSafe) || runtimeSafe.some((name) => typeof name !== "string")) {
    throw new Error("部署契约未声明 databaseMigrationPolicy.runtimeSafeBootstrapMigrations；不能跳过迁移权限错误");
  }
  const undeclared = pendingMigrations.filter((name) => !runtimeSafe.includes(name));
  if (undeclared.length > 0) {
    throw new Error(`待执行迁移未声明为 runtime-safe：${undeclared.join(", ")}`);
  }

  const migrationRoot = isAbsolute(migrationsDirectory)
    ? migrationsDirectory
    : resolve(dirname(configPath), migrationsDirectory);
  for (const migrationName of pendingMigrations) {
    if (basename(migrationName) !== migrationName) {
      throw new Error(`迁移文件名非法：${migrationName}`);
    }
    const source = await assertCreateOnlyMigration(join(migrationRoot, migrationName), migrationName);
    const expectedSha256 = manifest.databaseMigrationPolicy?.migrationSha256?.[migrationName];
    if (expectedSha256 !== undefined) {
      if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
        throw new Error(`运行时安全迁移 ${migrationName} 的部署契约 SHA-256 非法；已停止部署`);
      }
      const actualSha256 = createHash("sha256").update(source, "utf8").digest("hex");
      if (actualSha256 !== expectedSha256) {
        throw new Error(`运行时安全迁移 ${migrationName} 与部署契约 SHA-256 不一致；已停止部署`);
      }
    }
  }
}

function printCommandOutput(result) {
  const stdout = redactSensitiveOutput(result.stdout);
  const stderr = redactSensitiveOutput(result.stderr);
  if (stdout) process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configPath = resolve(options.config);
  const manifestPath = resolve(options.manifest);
  const [config, manifest] = await Promise.all([
    readJson(configPath, { jsonc: true }),
    readJson(manifestPath),
  ]);
  const local = localResourceFingerprint(config, manifest, effectiveWorkerName(config));
  if (options.mode === "upgrade" || options.inspect || options.fingerprint) {
    assertExistingUpgradeResourceIds(local);
  }
  const baseline = options.fingerprint ? await readBaselineFingerprint(options.fingerprint) : null;
  const commonArgs = ["--config", configPath, "--name", local.workerName];

  const status = runWrangler(["deployments", "status", ...commonArgs, "--json"]);
  const deployment = classifyDeploymentState(status);
  if (options.mode === "new" && deployment.kind !== "new") {
    throw new Error("Worker 已存在；首次部署模式已停止。现有站点请运行 npm run cloudflare:deploy");
  }
  if ((options.mode === "upgrade" || options.inspect) && deployment.kind !== "existing") {
    throw new Error("未找到现有 Worker；升级模式不会创建新站点，请从 README 的 Cloudflare Deploy Button 创建新站点");
  }
  if (options.fingerprint && deployment.kind !== "existing") {
    throw new Error("--fingerprint 只适用于已存在的 Worker；首次部署已停止");
  }
  if (deployment.kind === "new") assertNewDeploymentHasProvisionedResourceIds(local);
  if (deployment.kind === "existing") assertExistingUpgradeResourceIds(local);
  if (deployment.kind === "existing" && !options.inspect && !options.fingerprint) {
    throw new Error("现有 Worker 的任何部署都必须提供 --fingerprint <升级前指纹文件>；已在迁移和部署前停止");
  }

  let upgradeFingerprint = null;
  if (deployment.kind === "existing") {
    for (const versionId of deployment.versionIds) {
      const view = runWrangler(["versions", "view", versionId, ...commonArgs, "--json"]);
      if (view.status !== 0) throw commandFailure(`读取 Worker version ${versionId}`, view);
      const payload = parseCommandJson(`读取 Worker version ${versionId}`, view.stdout);
      const remote = remoteResourceFingerprint(payload, local);
      verifyLiveResourceFingerprint(local, remote, versionId);
      if (baseline) verifyBaselineFingerprint(baseline, remote);
      if (upgradeFingerprint && JSON.stringify(normalizeFingerprint(upgradeFingerprint)) !== JSON.stringify(normalizeFingerprint(remote))) {
        throw new Error(`多个 active Worker versions 的 DB/KV/R2/运行变量或秘密 binding 名称不一致（version ${versionId}）；已在迁移和部署前停止`);
      }
      upgradeFingerprint ??= remote;
    }
    process.stderr.write(`已核对升级前资源指纹：Worker ${local.workerName}，DB ${local.d1.id}，KV ${local.kv.id}，R2 ${local.r2Buckets.length} 个，秘密绑定名称 ${upgradeFingerprint.secretBindings.join(", ")}。\n`);
    if (options.output) await writeFingerprint(options.output, normalizeFingerprint(upgradeFingerprint));
  }

  if (options.inspect) {
    process.stdout.write("资源指纹核对通过；未执行迁移或部署。\n");
    return;
  }

  const list = runWrangler(["d1", "migrations", "list", "DB", "--remote", "--config", configPath]);
  if (list.status !== 0) throw commandFailure("读取 D1 待执行迁移（list 失败时不能证明完整 pending 集合，已关闭部署）", list);
  const pendingMigrations = extractMigrationNames(`${list.stdout}\n${list.stderr}`);

  let runtimeBootstrapRequired = false;
  if (pendingMigrations.length > 0) {
    const apply = runWrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", configPath]);
    if (apply.status === 0) {
      printCommandOutput(apply);
    } else {
      const detail = `${apply.stderr}\n${apply.stdout}`;
      if (deployment.kind !== "existing" || !isD1PermissionError(detail)) {
        throw commandFailure("执行 D1 迁移", apply);
      }
      await assertRuntimeSafeFallback({
        pendingMigrations,
        manifest,
        configPath,
        migrationsDirectory: local.migrationsDirectory,
      });
      runtimeBootstrapRequired = true;
      process.stderr.write(`D1 Edit 权限不足；${pendingMigrations.join(", ")} 均已通过 runtime bootstrap 安全检查，将先部署 Worker。\n`);
    }
  } else {
    process.stdout.write("D1 没有待执行迁移。\n");
  }

  const deploy = runWrangler(["deploy", ...commonArgs, "--keep-vars"]);
  if (deploy.status !== 0) throw commandFailure("部署 Worker", deploy);
  printCommandOutput(deploy);

  if (runtimeBootstrapRequired) {
    const route = manifest.databaseMigrationPolicy?.runtimeBootstrapRoute ?? "/admin";
    process.stderr.write(`部署已完成，但迁移记录尚未写入 D1。请立即打开生产站点 ${route} 触发运行时自举；取得 D1 Edit 权限后再次执行 npm run db:migrate:remote。\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${redactSensitiveOutput(error?.message ?? error)}\n`);
  process.exitCode = 1;
});
