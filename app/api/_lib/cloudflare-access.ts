import { createRemoteJWKSet, jwtVerify } from "jose";

export type CloudflareAccessIdentity = {
  email: string;
  subject: string;
};

export async function verifyCloudflareAccessJwt(
  token: string,
  configuredTeamDomain: string,
  audience: string,
): Promise<CloudflareAccessIdentity> {
  const teamDomain = normalizeTeamDomain(configuredTeamDomain);
  if (!audience.trim()) throw new Error("Cloudflare Access audience is missing");

  const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  const { payload } = await jwtVerify(token, jwks, {
    issuer: teamDomain,
    audience,
    algorithms: ["RS256"],
  });

  if (typeof payload.email !== "string" || !payload.email.includes("@")) {
    throw new Error("Cloudflare Access token does not contain an email");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Cloudflare Access token does not contain a subject");
  }
  return { email: payload.email.trim().toLowerCase(), subject: payload.sub };
}

function normalizeTeamDomain(value: string) {
  const url = new URL(value.startsWith("https://") ? value : `https://${value}`);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com")) {
    throw new Error("Cloudflare Access team domain is invalid");
  }
  return url.origin;
}
