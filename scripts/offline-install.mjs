// Development fallback for a sandbox with tarballs cached but no registry metadata.
// Standard environments should use npm ci instead.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const require = createRequire('/opt/homebrew/lib/node_modules/npm/package.json');
const cacache = require('cacache'), semver = require('semver');
const cache = '/Users/qtpctechhxd/.npm/_cacache';
const entries = await cacache.ls(cache);
const candidates = new Map();
for (const [key, entry] of Object.entries(entries)) {
  const match = key.match(/^make-fetch-happen:request-cache:(https:\/\/registry.npmjs.org\/(.+)\/-\/[^/]+\.tgz)$/);
  if (!match) continue;
  const name = match[2];
  const version = match[1].match(/-([0-9]+\.[0-9]+\.[0-9]+[^/]*)\.tgz$/)?.[1];
  if (!version) continue;
  candidates.set(name, [...(candidates.get(name) || []), { key, version, url: match[1], integrity: entry.integrity }]);
}
const root = JSON.parse(await readFile('package.json', 'utf8'));
const lock = { name: root.name, version: root.version, lockfileVersion: 3, requires: true, packages: { '': { name: root.name, version: root.version, dependencies: root.dependencies, devDependencies: root.devDependencies, engines: root.engines } } };
const installed = new Map();
const temp = await mkdtemp(path.join(os.tmpdir(), 'rsa-offline-'));
async function install(name, range, parent = '') {
  const options = (candidates.get(name) || []).filter(x => semver.satisfies(x.version, range));
  options.sort((a,b) => semver.rcompare(a.version,b.version));
  if (!options.length) throw Error(`Missing cached dependency: ${name}@${range}`);
  const item = options[0];
  let dest = `node_modules/${name}`;
  if (installed.has(dest)) {
    if (semver.satisfies(installed.get(dest), range)) return;
    dest = `${parent}/node_modules/${name}`;
  }
  if (installed.has(dest)) return;
  installed.set(dest, item.version);
  const archive = path.join(temp, 'package.tgz');
  await writeFile(archive, (await cacache.get(cache, item.key)).data);
  const manifestPath = execFileSync('tar', ['-tzf', archive], {encoding:'utf8'}).split('\n').find(p => /^[^/]+\/package.json$/.test(p));
  if (!manifestPath) throw Error(`No manifest in ${name}`);
  const manifest = JSON.parse(execFileSync('tar', ['-xzOf', archive, manifestPath], {encoding:'utf8'}));
  await mkdir(dest, {recursive:true});
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', dest]);
  lock.packages[dest] = { version: manifest.version, resolved: item.url, integrity: item.integrity,
    ...(manifest.dependencies ? {dependencies:manifest.dependencies}:{}),
    ...(manifest.optionalDependencies ? {optionalDependencies:manifest.optionalDependencies}:{}),
    ...(manifest.bin ? {bin:manifest.bin}:{}), ...(manifest.engines ? {engines:manifest.engines}:{}),
    ...(manifest.os ? {os:manifest.os}:{}), ...(manifest.cpu ? {cpu:manifest.cpu}:{}),
    ...(manifest.peerDependencies ? {peerDependencies:manifest.peerDependencies}:{}),
    ...(manifest.peerDependenciesMeta ? {peerDependenciesMeta:manifest.peerDependenciesMeta}:{}) };
  for (const [dep, spec] of Object.entries(manifest.dependencies || {})) await install(dep, spec, dest);
  for (const [dep, spec] of Object.entries(manifest.optionalDependencies || {})) {
    // Only install the cached platform build; other architectures are irrelevant locally.
    if (!candidates.has(dep)) {
      const version = semver.minVersion(spec)?.version;
      if (!version) continue;
      const platform = dep.match(/(?:-|\/)(android|darwin|freebsd|linux|win32|openharmony|wasm32)(?:-|$)/)?.[1];
      const cpu = dep.match(/(?:-)(arm64|x64|arm|ppc64|s390x|riscv64|wasm32)(?:-|$)/)?.[1];
      lock.packages[`node_modules/${dep}`] = {version, resolved:`https://registry.npmjs.org/${dep}/-/${dep.split('/').pop()}-${version}.tgz`, optional:true,
        ...(platform?{os:[platform==='wasm32'?'none':platform]}:{}), ...(cpu?{cpu:[cpu]}:{})};
      continue;
    }
    await install(dep, spec, dest);
  }
}
try {
  for (const [name, range] of Object.entries({...root.dependencies,...root.devDependencies})) await install(name, range);
  await writeFile('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
  await mkdir('node_modules/.bin', {recursive:true});
  const { symlink } = await import('node:fs/promises');
  for (const [dest, entry] of Object.entries(lock.packages)) {
    if (!dest || !entry.bin) continue;
    const bins = typeof entry.bin === 'string' ? {[path.basename(dest)]: entry.bin}: entry.bin;
    for (const [name, bin] of Object.entries(bins)) {
      try { await symlink(path.relative('node_modules/.bin', `${dest}/${bin}`), `node_modules/.bin/${name}`); } catch(e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  console.log(`Installed ${installed.size} cached packages.`);
} finally { await rm(temp, {recursive:true, force:true}); }
