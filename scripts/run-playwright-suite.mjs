import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suites = {
  mobile: "mobile-chromium",
  "codec-chrome": "codec-chrome",
  "codec-webkit": "codec-webkit",
};

const suite = process.argv[2];
const project = suites[suite];
if (!project) {
  console.error(`Unknown browser suite: ${suite ?? "(missing)"}`);
  process.exit(2);
}

const cli = fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "test", `--project=${project}`], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, PLAYWRIGHT_SUITE: suite },
  stdio: "inherit",
  timeout: 12 * 60 * 1000,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
