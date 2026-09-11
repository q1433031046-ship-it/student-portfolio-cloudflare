import { readFile, realpath, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildManualFiles, storeZip, sha256, safePath, TEMPLATE_ID } from '../app/lib/manual-static-package.mjs';

export async function packageStatic({ description: descriptionPath, template: templatePath, mediaDir, outDir }) {
  const description = JSON.parse(await readFile(descriptionPath, 'utf8'));
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  if (!Number.isSafeInteger(description.revision) || description.revision < 1 || description.templateIdentity !== TEMPLATE_ID || description.templatePath !== '/manual-pages-template.json') throw new Error('导出描述身份不符');
  const root = await realpath(mediaDir);
  const files = await buildManualFiles({ ...description, template }, async item => {
    safePath(item.path);
    const target = await realpath(path.resolve(root, item.path));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('媒体路径超出输入目录');
    const info = await stat(target);
    if (!info.isFile() || info.size !== item.bytes) throw new Error('媒体文件大小不符');
    return new Uint8Array(await readFile(target));
  });
  const zip = storeZip(files), zipBytes = new Uint8Array(await zip.arrayBuffer());
  // mkdir without recursive is the no-overwrite boundary, including existing symlinks.
  await mkdir(outDir);
  const site = path.join(outDir, 'site'); await mkdir(site);
  const entries = [];
  for (const file of files) {
    const target = path.join(site, safePath(file.path));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data, { flag: 'wx' });
    entries.push({ path: file.path, bytes: file.data.length, sha256: await sha256(file.data) });
  }
  const zipName = `student-portfolio-r${description.revision}.zip`;
  await writeFile(path.join(outDir, zipName), zipBytes, { flag: 'wx' });
  const receipt = { status: 'PACKAGE_COMPLETE_REVISION_RECHECK_REQUIRED', adminOrigin: description.adminOrigin, revision: description.revision,
    templateIdentity: TEMPLATE_ID, files: entries, fileCount: entries.length, bytes: entries.reduce((n, f) => n + f.bytes, 0),
    zip: { path: zipName, bytes: zipBytes.length, sha256: await sha256(zipBytes) }, webFileLimitsCompatible: entries.length <= 1000,
    projectTypeVerified: false, deploymentPerformed: false,
    next: '在原已授权会话对同revision执行check=1；核定原项目为Direct Upload和上传方式后，才可将完整包交付为本次READY。Git集成项目不能网页拖拽；Wrangler接受site目录，不接受ZIP。' };
  await writeFile(path.join(outDir, 'package-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  const keys = { '--description': 'description', '--template': 'template', '--media-dir': 'mediaDir', '--out-dir': 'outDir' };
  for (let i = 0; i < args.length; i += 2) {
    const key = keys[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) throw new Error('需要且仅接受 --description --template --media-dir --out-dir 显式输入');
    options[key] = args[i + 1];
  }
  if (Object.keys(options).length !== 4) throw new Error('缺少显式输入参数');
  await packageStatic(options);
  console.log('完整包已生成；请读取package-receipt.json并完成同revision核验。未执行网络请求或发布。');
}
