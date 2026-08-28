export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: "data:text/javascript,export%20const%20env%20%3D%20Object.create(null)%3B",
      shortCircuit: true,
    };
  }

  if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts") && !/\.[a-z]+$/u.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }

  return nextResolve(specifier, context);
}
