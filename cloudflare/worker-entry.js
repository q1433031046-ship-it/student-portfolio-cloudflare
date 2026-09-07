import application from "../dist/server/index.js";

const securityHeaders = {
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const worker = {
  async fetch(request, env, ctx) {
    const requestUrl = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && requestUrl.pathname === "/" && !requestUrl.search) {
      try {
        const binding = await env.DB.prepare("SELECT production_url, current_deploy_id, current_public_revision FROM static_site_bindings WHERE id = 'default' LIMIT 1").first();
        if (binding?.current_deploy_id && Number(binding.current_public_revision) > 0 && typeof binding.production_url === "string") {
          const target = new URL(binding.production_url);
          if (target.protocol === "https:" && target.hostname.endsWith(".netlify.app") && target.pathname === "/" && !target.search && !target.hash) {
            return Response.redirect(target.toString(), 302);
          }
        }
      } catch {
        // Before migration 0008, or on a transient D1 read failure, keep serving the existing Worker page.
      }
    }
    const response = await application.fetch(request, env, ctx);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
