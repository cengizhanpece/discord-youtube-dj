// Prepares everything the Windows installer needs in installer/build/:
//
//   build/
//     DiscordYouTubeDJ.exe   ← official node.exe, renamed (so Task Manager shows a nice name)
//     icon.ico
//     app/                   ← bot source + production node_modules
//
// Then installer/setup.iss (Inno Setup) packs build/ into a single setup .exe.
// Runs on Windows (CI uses windows-latest) because node_modules contains native binaries.
//
//   node installer/build.mjs [--node-major 24]

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'installer', 'build');
const app = path.join(out, 'app');
const botDir = path.join(root, 'bot');

const majorArg = process.argv.indexOf('--node-major');
const nodeMajor = majorArg > -1 ? process.argv[majorArg + 1] : '24';

if (process.platform !== 'win32') {
  console.error('Run this on Windows: node_modules must contain Windows native binaries.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// 1) Bot sources + production dependencies
console.log('• Copying bot');
for (const f of ['src', 'public', 'package.json', 'package-lock.json']) {
  cpSync(path.join(botDir, f), path.join(app, f), { recursive: true });
}
console.log('• Installing production dependencies');
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: app, stdio: 'inherit' });

// 2) Node runtime
const index = await (await fetch('https://nodejs.org/dist/index.json')).json();
const release = index.find((r) => r.version.startsWith(`v${nodeMajor}.`));
if (!release) throw new Error(`No Node ${nodeMajor} release found`);
console.log(`• Downloading Node ${release.version}`);
const res = await fetch(`https://nodejs.org/dist/${release.version}/win-x64/node.exe`);
if (!res.ok) throw new Error(`node.exe download failed: HTTP ${res.status}`);
writeFileSync(path.join(out, 'DiscordYouTubeDJ.exe'), Buffer.from(await res.arrayBuffer()));

// 3) icon.ico — multi-size icon generated from assets/icon.png and committed to the repo
cpSync(path.join(root, 'installer', 'icon.ico'), path.join(out, 'icon.ico'));

const { version } = JSON.parse(readFileSync(path.join(botDir, 'package.json'), 'utf-8'));
console.log(`\n✔ Ready in ${out} (app v${version}, node ${release.version})`);
console.log(`  Next: iscc /DAppVersion=${version} installer\\setup.iss`);
if (!existsSync(path.join(app, 'node_modules', 'discord.js'))) throw new Error('discord.js missing from build');
