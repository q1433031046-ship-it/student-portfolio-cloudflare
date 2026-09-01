import { getStaticPublishingSecret } from "../../../_lib/app-secret";
import { createOpaqueToken, leaseExpiresAt, signExportLease, tokenDigest, privateExportHeaders } from "../../../_lib/static-site-export";
import { exchangeBootstrapGrant } from "../../../_lib/static-site-store";
import { readJsonBody } from "../../../_lib/request-body";

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const headers = privateExportHeaders();
  try {
    const { jobId } = await context.params;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const body = await readJsonBody(request, 8_192);
    if (!/^job_[a-f0-9]{32}$/u.test(jobId) || !isRecord(body) || !Number.isSafeInteger(body.generation) || token.length < 20) throw new Error("invalid");
    const leaseId = createOpaqueToken();
    const expiresAt = leaseExpiresAt();
    const generation = Number(body.generation);
    await exchangeBootstrapGrant({ jobId, generation, bootstrapDigest: await tokenDigest(token), leaseIdDigest: await tokenDigest(leaseId), leaseExpiresAt: expiresAt });
    const exp = Math.floor(Date.parse(expiresAt) / 1000);
    const lease = await signExportLease({ jobId, generation, leaseId, methods: ["GET", "HEAD"], exp }, getStaticPublishingSecret("STATIC_EXPORT_SIGNING_KEY"));
    return Response.json({ lease, expiresAt }, { headers });
  } catch {
    return Response.json({ code: "EXPORT_BOOTSTRAP_INVALID", error: "导出授权无效、已使用或已过期" }, { status: 409, headers });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
