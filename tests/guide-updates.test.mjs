import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuild } from '../tools/check.mjs';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');

test('launcher guide loading retires imported caches and invalidates metadata once per character and package', async () => {
  const vm = createVM();
  try {
    vm.run(`
      local function unexpected() error("old import path called") end
      addon = {guideImporter = {Open = unexpected, ImportString = unexpected}, DiscodicXP = {}, comms = {PrettyPrint = function() end},
        locale = {Get = function(text) return text end},
        db = {profile = {guides = {stale = true}, guideContent = "old", guideLength = 1, guideId = 123}}, string = "old",
        launcherGuideDigest = "new", CreateMetaDataTable = function(self, wipe)
          assert(wipe); invalidations = (invalidations or 0) + 1
          DXPCData.guideMetaData = {}; DXPCData.guideDisabled = {}
        end}
      DXPData = {guideImportKey = {1,2,3}}
      DXPString = "old"
      DXPCData = {launcherGuideDigest = "old", guideDisabled = {[1] = 20}, guideMetaData = {old = true},
        currentGuideName = "Route", currentStep = 7, currentStepId = 900,
        guideProgress = {route = {step = 7, stepId = 900}}, stepSkip = {[2] = true}}
    `);
    await vm.file(fileURLToPath(new URL('../addon/GuideUpdates.lua', import.meta.url)));
    vm.run(`
      addon.LoadCachedGuides()
      assert(next(addon.db.profile.guides) == nil and addon.db.profile.guideId == nil)
      assert(addon.db.profile.legacyGuides.stale)
      assert(DXPString == nil and addon.string == nil and DXPData.guideImportKey == nil)
      assert(next(DXPCData.guideMetaData) == nil and next(DXPCData.guideDisabled) == nil)
      assert(DXPCData.launcherGuideDigest == "new" and invalidations == 1)
      assert(DXPCData.currentGuideName == "Route" and DXPCData.currentStep == 7 and DXPCData.currentStepId == 900)
      assert(DXPCData.guideProgress.route.step == 7 and DXPCData.stepSkip[2])
      addon.LoadCachedGuides()
      assert(invalidations == 1 and addon.db.profile.legacyGuides.stale)
      addon.launcherGuideDigest = "newer"
      addon.LoadCachedGuides()
      assert(invalidations == 2 and DXPCData.launcherGuideDigest == "newer")
      assert(DXPCData.currentStep == 7 and DXPCData.guideProgress.route.step == 7)
      assert(addon.guideImporter:Open() == false and addon.guideImporter:ImportString("bad") == false)
      assert(addon.ImportGuide("bad") == false and addon.DiscodicXP.ImportGuide("bad") == false)
    `);
  } finally { vm.close(); }
});

test('public build leaves purchased guide delivery to the launcher', { skip: !existsSync(resolve(root, 'DiscodicXP.toc')) }, async () => {
  const settings = await readFile(`${root}/SettingsPanel.lua`, 'utf8');
  const window = await readFile(`${root}/GuideWindow.lua`, 'utf8');
  const toc = await readFile(`${root}/DiscodicXP.toc`, 'utf8');
  assert.doesNotMatch(settings, /importGuidesButton\s*=/);
  assert.doesNotMatch(window, /text = L\("Import guide"\)/);
  assert.doesNotMatch(toc, /Discodic\/(?:GuideCodec|GuideImport|ImportWindow|ImportKey)\.lua/);
  assert.match(toc, /UserGuides\/ForeverHorde\.lua/);
  assert.equal(existsSync(resolve(root, 'Discodic/ImportKey.lua')), false);
  assert.equal(existsSync(resolve(root, 'Guides/forever')), false);
  const manifest = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8'));
  assert.equal(manifest.guides, 0);
  assert.equal(manifest.guideUpdates, 1);
  assert.ok(manifest.starterGuides > 0);
  assert.equal(manifest.sourceDigest, undefined);
});

test('public build verification rejects guide payloads and embedded import keys', async t => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'dxp-public-build-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(resolve(fixture, 'UserGuides'));
  await mkdir(resolve(fixture, 'Guides/Starters'), { recursive: true });
  const toc = '## Interface: 16001\nGuides/Starters/Fixture.lua\nUserGuides/ForeverHorde.lua\n';
  await writeFile(resolve(fixture, 'DiscodicXP.toc'), toc);
  await writeFile(resolve(fixture, 'Guides/Starters/Fixture.lua'), 'DiscodicXP.RegisterGuide([[#forever\n#group Fixture\n#name 1-6 Starter\nstep\n]])');
  await writeFile(resolve(fixture, 'build.json'), JSON.stringify({ guides: 0, guideUpdates: 1, starterGuides: 1 }));
  const guide = resolve(fixture, 'UserGuides/ForeverHorde.lua');
  await writeFile(guide, 'local _, addon = ...\n');
  assert.equal((await checkBuild(fixture)).paidGuides, 0);
  await writeFile(resolve(fixture, 'DiscodicXP.toc'), '## Interface: 16001\nUserGuides/ForeverHorde.lua\n');
  await assert.rejects(checkBuild(fixture), /не включён в TOC/);
  await writeFile(resolve(fixture, 'DiscodicXP.toc'), toc);
  await writeFile(guide, 'addon.DiscodicXP.RegisterGuide([[#group Fixture\n#name Private\nstep\n]])');
  await assert.rejects(checkBuild(fixture), /Публичная сборка/);
  await writeFile(guide, 'local _, addon = ...\n');
  await mkdir(resolve(fixture, 'Discodic'));
  await writeFile(resolve(fixture, 'Discodic/ImportKey.lua'), 'local key = {1, 2, 3}');
  await assert.rejects(checkBuild(fixture), /ключ импорта/);
});
