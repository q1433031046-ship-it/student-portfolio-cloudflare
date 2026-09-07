import { env } from "cloudflare:workers";

type SecretBindings = {
  INITIAL_ADMIN_CODE?: string;
  MEDIA_SIGNING_KEY?: string;
  ACCESS_SIGNING_KEY?: string;
  ANALYTICS_HASH_KEY?: string;
  NETLIFY_AUTH_TOKEN?: string;
  NETLIFY_DRAFT_BUILD_HOOK?: string;
  STATIC_EXPORT_SIGNING_KEY?: string;
};

export function getInitialAdminCode() {
  const value = (env as unknown as SecretBindings).INITIAL_ADMIN_CODE?.trim();
  if (!value || value.length < 16 || !/[A-Za-z]/u.test(value) || !/\d/u.test(value)) {
    throw new Error("部署口令尚未配置，或不符合至少16位且同时包含英文字母和数字的要求");
  }
  return value;
}

export function getStaticPublishingSecret(name: "NETLIFY_AUTH_TOKEN" | "NETLIFY_DRAFT_BUILD_HOOK" | "STATIC_EXPORT_SIGNING_KEY") {
  const value = (env as unknown as SecretBindings)[name]?.trim();
  if (!value || value.length < 20) throw new Error(`${name} 尚未安全配置`);
  return value;
}

export function getPurposeSecret(purpose: "media" | "access" | "analytics" | "auth") {
  const bindings = env as unknown as SecretBindings;
  const override = purpose === "media"
    ? bindings.MEDIA_SIGNING_KEY
    : purpose === "access"
      ? bindings.ACCESS_SIGNING_KEY
      : purpose === "analytics"
        ? bindings.ANALYTICS_HASH_KEY
        : undefined;
  return override?.trim() || getInitialAdminCode();
}
