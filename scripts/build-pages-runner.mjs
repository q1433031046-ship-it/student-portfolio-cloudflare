import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.pages-workerd', { recursive: true });
await build({ entryPoints: ['scripts/pages-runner-lib.ts'], bundle: true, format: 'esm', platform: 'node', outfile: '.pages-workerd/runner-lib.mjs' });
