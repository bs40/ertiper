// Copies third-party browser assets (Leaflet, fonts) from node_modules into public/vendor,
// so pages load nothing from outside CDNs (privacy + a tight Content-Security-Policy).
// Run by `npm run vendor`, the Dockerfile and the Windows installer build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const out = path.join(root, 'public', 'vendor');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'leaflet', 'images'), { recursive: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

for (const f of ['leaflet.js', 'leaflet.css', 'LICENSE']) {
  const src = f === 'LICENSE' ? nm('leaflet', 'LICENSE') : nm('leaflet', 'dist', f);
  fs.copyFileSync(src, path.join(out, 'leaflet', f));
}
for (const f of fs.readdirSync(nm('leaflet', 'dist', 'images'))) {
  fs.copyFileSync(nm('leaflet', 'dist', 'images', f), path.join(out, 'leaflet', 'images', f));
}

const faces = [
  ['barlow-condensed', 'Barlow Condensed', [400, 500, 600, 700]],
  ['barlow', 'Barlow', [400, 500, 600]],
];
let css = '/* Self-hosted fonts (SIL Open Font License), copied from @fontsource by scripts/vendor.mjs */\n';
for (const [pkg, family, weights] of faces) {
  for (const w of weights) {
    const file = `${pkg}-latin-${w}-normal.woff2`;
    fs.copyFileSync(nm('@fontsource', pkg, 'files', file), path.join(out, 'fonts', file));
    css += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(fonts/${file}) format('woff2');}\n`;
  }
  fs.copyFileSync(nm('@fontsource', pkg, 'LICENSE'), path.join(out, 'fonts', `${pkg}-LICENSE`));
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);
console.log(`Vendored assets written to ${path.relative(root, out)}`);
