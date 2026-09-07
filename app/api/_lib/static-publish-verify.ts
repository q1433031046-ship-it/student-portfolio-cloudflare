import { canonicalJson, PROVIDER_REQUEST_KEY_PATTERN, SHA256_PATTERN, sha256Hex } from "./static-site-contract";
import type { NetlifyDeploy, NetlifyFile } from "./netlify-client";

export type ArtifactFile = { path: string; byteSize: number; contentType: string; sha256: string; providerSha1: string };
export type ArtifactManifest = {
  schemaVersion: 1;
  providerRequestKey: string;
  deployId: string;
  publicRevision: number;
  candidateSha256: string;
  sourceCommitSha: string;
  artifactSha256: string;
  fileCount: number;
  totalBytes: number;
  files: ArtifactFile[];
};

export class StaticArtifactError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function verifyArtifact(input: {
  manifest: ArtifactManifest;
  marker: Record<string, unknown>;
  deploy: NetlifyDeploy;
  providerFiles: NetlifyFile[];
  manifestFileEvidence: { byteSize: number; providerSha1: string };
  markerFileEvidence: { byteSize: number; providerSha1: string };
  expectedCandidateSha256: string;
  expectedSourceCommitSha: string;
  expectedProviderRequestKey: string;
  expectedPublicRevision: number;
}) {
  const { manifest } = input;
  const files = [...manifest.files].sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (canonicalJson(files) !== canonicalJson(manifest.files)) fail("STATIC_ARTIFACT_ORDER_INVALID", "制品清单路径未稳定排序");
  if (manifest.schemaVersion !== 1 || manifest.deployId !== input.deploy.id
    || manifest.providerRequestKey !== input.expectedProviderRequestKey
    || manifest.candidateSha256 !== input.expectedCandidateSha256
    || manifest.sourceCommitSha !== input.expectedSourceCommitSha
    || manifest.publicRevision !== input.expectedPublicRevision) fail("STATIC_ARTIFACT_IDENTITY_MISMATCH", "制品身份与冻结候选不一致");
  if (!PROVIDER_REQUEST_KEY_PATTERN.test(manifest.providerRequestKey) || !SHA256_PATTERN.test(manifest.candidateSha256)) fail("STATIC_ARTIFACT_IDENTITY_INVALID", "制品身份格式无效");
  if (manifest.fileCount !== files.length || manifest.totalBytes !== files.reduce((sum, file) => sum + file.byteSize, 0)) fail("STATIC_ARTIFACT_SUMMARY_MISMATCH", "制品汇总不一致");
  const artifactSha256 = await sha256Hex(canonicalJson(files));
  if (artifactSha256 !== manifest.artifactSha256) fail("STATIC_ARTIFACT_DIGEST_MISMATCH", "制品总摘要不一致");

  const expectedPaths = new Set([...files.map((file) => normalizePath(file.path)), "artifact-manifest.json", "__static-release.json"]);
  const providerByPath = new Map(input.providerFiles.map((file) => [normalizePath(file.path), file]));
  if (providerByPath.size !== expectedPaths.size || [...expectedPaths].some((path) => !providerByPath.has(path))) {
    fail("STATIC_ARTIFACT_FILE_SET_MISMATCH", "Netlify 文件集合与制品清单不一致");
  }
  for (const file of files) {
    const provider = providerByPath.get(normalizePath(file.path));
    if (!provider || provider.size !== file.byteSize || provider.sha.toLowerCase() !== file.providerSha1.toLowerCase()) {
      fail("STATIC_ARTIFACT_FILE_MISMATCH", "Netlify 文件摘要与制品清单不一致");
    }
  }
  for (const [path, evidence] of [
    ["artifact-manifest.json", input.manifestFileEvidence],
    ["__static-release.json", input.markerFileEvidence],
  ] as const) {
    const provider = providerByPath.get(path);
    if (!provider || provider.size !== evidence.byteSize || provider.sha.toLowerCase() !== evidence.providerSha1.toLowerCase()) {
      fail("STATIC_ARTIFACT_CONTROL_FILE_MISMATCH", "Netlify 控制文件摘要与读回内容不一致");
    }
  }
  for (const [key, value] of Object.entries({
    deployId: manifest.deployId,
    providerRequestKey: manifest.providerRequestKey,
    candidateSha256: manifest.candidateSha256,
    artifactSha256: manifest.artifactSha256,
    publicRevision: manifest.publicRevision,
    sourceCommitSha: manifest.sourceCommitSha,
  })) if (input.marker[key] !== value) fail("STATIC_MARKER_MISMATCH", "静态发布标记与制品清单不一致");
  return { artifactSha256, files };
}

export function assertProductionReadback(marker: Record<string, unknown>, deployId: string, artifactSha256: string) {
  if (marker.deployId !== deployId || marker.artifactSha256 !== artifactSha256) {
    fail("STATIC_PRODUCTION_READBACK_MISMATCH", "固定网址尚未读回准确 Deploy");
  }
}

function normalizePath(path: string) { return path.replaceAll("\\", "/").replace(/^\/+/u, ""); }
function fail(code: string, message: string): never { throw new StaticArtifactError(code, message); }
