import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

await mkdir(dist, { recursive: true });

// The project intentionally uses standalone vanilla JS/CSS files from the
// multi-page HTML app. Vite builds the HTML, while this step guarantees the
// runtime files are present at the paths used by the pages in production.
for (const file of ['script.js', 'admin.js', 'admin-dashboard.js', 'styles.css', '404.html']) {
  try {
    await cp(path.join(root, file), path.join(dist, file), { force: true });
  } catch (_) {}
}

for (const pubFile of ['robots.txt', 'site.webmanifest', '404.html', 'logo.png']) {
  try {
    await cp(path.join(root, 'public', pubFile), path.join(dist, pubFile), { force: true });
  } catch (_) {}
}

