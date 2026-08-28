import { writeAuditLog } from "../../_lib/audit";
import {
  createAccessPass,
  deleteAccessPass,
  getAccessConfiguration,
  setAccessRestriction,
  updateAccessPass,
  validateAccessPassInput,
} from "../../_lib/portfolio-access";
import { isRequestBodyError, readJsonBody } from "../../_lib/request-body";
import { requirePortfolioManager } from "../../_lib/site-ownership";

export async function GET(request: Request) {
  const access = await requireManager(request);
  if (access instanceof Response) return access;
  try {
    return Response.json(await getAccessConfiguration(new URL(request.url).origin), { headers: noCacheHeaders });
  } catch (error) {
    return failure(error, "二维码访问设置暂时无法读取");
  }
}

export async function POST(request: Request) {
  const access = await requireManager(request);
  if (access instanceof Response) return access;
  try {
    const body = await readJsonBody(request, 8_192);
    const input = validateAccessPassInput(body);
    const id = await createAccessPass(input, access.identity.user);
    await writeAuditLog({
      actorEmail: access.identity.user,
      action: "portfolio.access_pass.created",
      targetType: "access_pass",
      targetId: id,
      summary: { label: input.label, maxUses: input.maxUses, expiresAt: input.expiresAt },
    });
    return Response.json(await getAccessConfiguration(new URL(request.url).origin), { status: 201, headers: noCacheHeaders });
  } catch (error) {
    return failure(error, "二维码创建失败");
  }
}

export async function PATCH(request: Request) {
  const access = await requireManager(request);
  if (access instanceof Response) return access;
  try {
    const body = await readJsonBody(request, 8_192);
    if (!isRecord(body)) return Response.json({ error: "访问设置格式无效" }, { status: 400, headers: noCacheHeaders });

    if (typeof body.restrictionEnabled === "boolean") {
      await setAccessRestriction(body.restrictionEnabled, access.identity.user);
      await writeAuditLog({
        actorEmail: access.identity.user,
        action: "portfolio.access_policy.updated",
        targetType: "access_policy",
        targetId: "default",
        summary: { restrictionEnabled: body.restrictionEnabled },
      });
    } else {
      const id = typeof body.id === "string" ? body.id : "";
      if (!/^qr_[a-f0-9]{32}$/u.test(id)) return Response.json({ error: "二维码编号无效" }, { status: 400, headers: noCacheHeaders });
      const patch: { label?: string; enabled?: boolean; maxUses?: number | null; expiresAt?: string | null } = {};
      if ("label" in body || "maxUses" in body || "expiresAt" in body) {
        const validated = validateAccessPassInput({
          label: body.label,
          maxUses: body.maxUses,
          expiresAt: body.expiresAt,
        }, true);
        patch.label = validated.label;
        patch.maxUses = validated.maxUses;
        patch.expiresAt = validated.expiresAt;
      }
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (Object.keys(patch).length === 0) return Response.json({ error: "没有可更新的二维码设置" }, { status: 400, headers: noCacheHeaders });
      await updateAccessPass(id, patch);
      await writeAuditLog({
        actorEmail: access.identity.user,
        action: "portfolio.access_pass.updated",
        targetType: "access_pass",
        targetId: id,
        summary: { enabled: patch.enabled ?? null, maxUses: patch.maxUses ?? null, expiresAt: patch.expiresAt ?? null },
      });
    }
    return Response.json(await getAccessConfiguration(new URL(request.url).origin), { headers: noCacheHeaders });
  } catch (error) {
    return failure(error, "访问设置更新失败");
  }
}

export async function DELETE(request: Request) {
  const access = await requireManager(request);
  if (access instanceof Response) return access;
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^qr_[a-f0-9]{32}$/u.test(id)) return Response.json({ error: "二维码编号无效" }, { status: 400, headers: noCacheHeaders });
    await deleteAccessPass(id);
    await writeAuditLog({ actorEmail: access.identity.user, action: "portfolio.access_pass.deleted", targetType: "access_pass", targetId: id });
    return Response.json(await getAccessConfiguration(new URL(request.url).origin), { headers: noCacheHeaders });
  } catch (error) {
    return failure(error, "二维码删除失败");
  }
}

async function requireManager(request: Request) {
  return requirePortfolioManager(request);
}

function failure(error: unknown, fallback: string) {
  if (isRequestBodyError(error)) {
    return Response.json({ error: error.message }, { status: error.status, headers: noCacheHeaders });
  }
  const message = error instanceof Error ? error.message : fallback;
  const clientError = /二维码|访问限制|格式|时间|次数/u.test(message);
  console.error(JSON.stringify({ message: fallback, error: message }));
  return Response.json({ error: clientError ? message : fallback }, { status: clientError ? 400 : 500, headers: noCacheHeaders });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const noCacheHeaders = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" };
