import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

test('manual addon updates retain server guides and replace legacy bundled guides', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'dxp-install-test-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    return rm(root, { recursive: true, force: true });
  });
  const addons = resolve(root, 'WoW/Interface/AddOns');
  const build = resolve(root, 'build');
  const target = resolve(addons, 'DiscodicXP');
  const manifest = { addon: 'DiscodicXP', version: '0.5.1', guideUpdates: 1 };
  const empty = 'local _, addon = ...\naddon.launcherGuideDigest = ""\n';
  await mkdir(addons, { recursive: true });
  await mkdir(resolve(build, 'UserGuides'), { recursive: true });
  await writeFile(resolve(build, 'build.json'), JSON.stringify(manifest));
  await writeFile(resolve(build, 'DiscodicXP.toc'), 'UserGuides/ForeverHorde.lua\n');
  await writeFile(resolve(build, 'UserGuides/ForeverHorde.lua'), empty);
  const install = (...args) => {
    const result = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('tools/install.ps1'),
      '-AddOnsPath', addons, '-BuildPath', build, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
  };
  install();
  const guide = resolve(target, 'UserGuides/ForeverHorde.lua');
  assert.equal(await readFile(guide, 'utf8'), empty);
  const serverGuide = 'local _, addon = ...\naddon.launcherGuideDigest = "server-fixture"\n';
  await writeFile(guide, serverGuide);
  install('-Update');
  assert.equal(await readFile(guide, 'utf8'), serverGuide);
  await writeFile(resolve(target, 'build.json'), JSON.stringify({ addon: 'DiscodicXP', version: '0.4.2' }));
  install('-Update');
  assert.equal(await readFile(guide, 'utf8'), empty);
});
