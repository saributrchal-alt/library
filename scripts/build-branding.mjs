import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { uploadCover } from '../lib/cover-upload.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = `${root}public/`;
const local = process.argv.includes('--local');
const mediaUrl = /^https:\/\/media\.nathoeng\.com\/uploads\/library\/\d{4}\/\d{2}\/[a-f0-9]{32}\.webp$/;
const assets = [
  { name: 'logo', file: 'library-logo.webp', token: '__LIBRARY_LOGO_URL__' },
  { name: 'icon', file: 'library-icon.webp', token: '__LIBRARY_ICON_URL__' }
];

// Reuse the published manifest so unchanged branding is uploaded only once.
// Production credentials stay in the build environment, as with book covers.
let previous = {};
if (!local) {
  try {
    const response = await fetch('https://library.nathoeng.com/library-branding.json', {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    if (response.ok) previous = await response.json();
  } catch { /* A first deployment has no branding manifest yet. */ }
}

const branding = {};
for (const asset of assets) {
  const bytes = await readFile(`${root}assets/${asset.file}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let url;
  const cached = previous?.[asset.name];
  if (local) {
    url = `/assets/${asset.file}`;
  } else if (cached?.sha256 === sha256 && mediaUrl.test(cached.url)) {
    url = cached.url;
  } else {
    const uploaded = await uploadCover(`data:image/webp;base64,${bytes.toString('base64')}`);
    url = uploaded.url;
  }
  branding[asset.name] = { sha256, url };
}

// Publish only the existing browser-facing files. The API and its supporting
// modules remain at their original source paths for Vercel Functions.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(html|css|js|txt)$/.test(entry.name)) continue;
  if (entry.name.endsWith('.html')) {
    let html = await readFile(`${root}${entry.name}`, 'utf8');
    for (const asset of assets) html = html.replaceAll(asset.token, branding[asset.name].url);
    if (/__LIBRARY_(?:LOGO|ICON)_URL__/.test(html)) throw new Error('Unresolved library branding URL');
    await writeFile(`${output}${entry.name}`, html);
  } else {
    await cp(`${root}${entry.name}`, `${output}${entry.name}`);
  }
}
if (local) await cp(`${root}assets`, `${output}assets`, { recursive: true });
await writeFile(`${output}library-branding.json`, `${JSON.stringify(branding, null, 2)}\n`);
console.log(`Built library pages with ${local ? 'local preview' : 'Nathoeng media'} branding.`);
