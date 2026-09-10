import { build } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".pages-template");
await build({ root: join(root, "static-site"), configFile: false, plugins: [react()], build: { outDir: output, emptyOutDir: true, assetsDir: "assets" } });
const files = [];
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(join(directory, entry.name), name + "/");
    else { const bytes = await readFile(join(directory, entry.name)); files.push({ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), base64: bytes.toString("base64") }); }
  }
}
await collect(output);
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const identity = createHash("sha256").update(JSON.stringify(files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })))).digest("hex");
await mkdir(join(root, "app/api/_generated"), { recursive: true });
await writeFile(join(root, "app/api/_generated/pages-template.json"), JSON.stringify({ schemaVersion: 1, identity, files }));
console.log(JSON.stringify({ templateIdentity: identity, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) }));
