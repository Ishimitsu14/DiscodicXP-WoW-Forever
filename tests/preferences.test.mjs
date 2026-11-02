import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import luaparse from 'luaparse';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');
const nameOf = node => node.type === 'Identifier' ? node.name : node.type === 'MemberExpression'
  ? nameOf(node.base) + node.indexer + node.identifier.name : '';

async function preferencesVM() {
  const vm = createVM();
  vm.run(`
    function InCombatLockdown() return combat or false end
    table.wipe = function(t) for key in pairs(t) do t[key] = nil end end
    local button = {
        icon = {isDefault = false}, targetData = {name = "Known NPC"},
        GetUnitTexture = function() end, Show = function() end
    }
    targetFrame = {
        shown = true, friendlyTargetButtons = {button}, enemyTargetButtons = {},
        Hide = function(self) assert(not combat); self.shown = false end,
        Show = function(self) assert(not combat); self.shown = true end,
        SetAlpha = function() end
    }
    addon = {
        settings = {profile = {enableTargetFrame = true, showEnabled = true}},
        locale = {Get = function(text) return text end},
        targeting = {activeTargetFrame = targetFrame, activeIcons = {}, ConfigureTargetButton = function() end},
        comms = {PrettyPrint = function(text) message = text end}
    }
    addon.settings.ChatCommand = function() error("Unexpected fallback") end
    unitscanEnabled, optionsWidth = true, 1
  `);
  const source = await readFile(resolve(root, 'Targeting.lua'), 'utf8');
  const ast = luaparse.parse(source, {ranges: true, luaVersion: '5.1'});
  const nodes = ast.body.filter(node => node.type === 'FunctionDeclaration' && node.identifier &&
    ['addon.targeting:UpdateTargetFrame', 'addon.targeting:PLAYER_REGEN_ENABLED'].includes(nameOf(node.identifier)));
  assert.equal(nodes.length, 2);
  vm.run(`
    local addon = addon
    local InCombatLockdown = InCombatLockdown
    local targetList = {"Known NPC"}
    local unitscanList, mobList = {}, {}
    local function ResizeTargetsFrame() resized = true end
    ${nodes.map(node => source.slice(...node.range)).join('\n')}
  `);
  await vm.file(resolve(root, 'Discodic/Preferences.lua'));
  await vm.file(resolve(root, 'Discodic/Commands.lua'));
  return vm;
}

test('NPC window toggles persist without hiding the guide and wait for combat to end', async () => {
  const vm = await preferencesVM();
  try {
    vm.run(`
      addon.settings.ChatCommand("npc off")
      assert(not addon.settings.profile.enableTargetFrame and not targetFrame.shown)
      assert(addon.settings.profile.showEnabled)
      addon.targeting:UpdateTargetFrame()
      assert(not targetFrame.shown, "A disabled window came back on refresh")
      addon.settings.ChatCommand("npc on")
      assert(addon.settings.profile.enableTargetFrame and targetFrame.shown and resized)
      combat = true
      addon.settings.ChatCommand("нпс выкл")
      assert(not addon.settings.profile.enableTargetFrame and targetFrame.shown)
      assert(message == "The window will update after combat.")
      addon.targeting:UpdateTargetFrame()
      assert(targetFrame.shown)
      combat = false
      addon.targeting:PLAYER_REGEN_ENABLED()
      assert(not targetFrame.shown)
      combat = true
      addon.settings.ChatCommand("npc on")
      assert(addon.settings.profile.enableTargetFrame and not targetFrame.shown)
      combat = false
      addon.targeting:PLAYER_REGEN_ENABLED()
      assert(targetFrame.shown)
      addon.settings.ChatCommand("npc invalid")
      assert(addon.settings.profile.enableTargetFrame and message == "Usage: /dxp npc on|off")
      addon.settings.ChatCommand("npc")
      assert(not addon.settings.profile.enableTargetFrame and not targetFrame.shown)
      addon.settings.ChatCommand("нпс вкл")
      assert(addon.settings.profile.enableTargetFrame and targetFrame.shown)
    `);
  } finally { vm.close(); }
});

test('Hide NPC setting follows Hide Active Item and inverts the saved enable preference', async () => {
  const source = await readFile(resolve(root, 'SettingsPanel.lua'), 'utf8');
  const ast = luaparse.parse(source, {ranges: true, luaVersion: '5.1'});
  const options = {};
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TableKeyString' && ['hideNpcWindow', 'disableItemWindow', 'enableTargetFrame'].includes(node.key.name) && node.value.type === 'TableConstructorExpression') {
      options[node.key.name] = source.slice(...node.value.range);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(ast);
  assert.ok(options.hideNpcWindow && options.disableItemWindow && options.enableTargetFrame);
  const vm = await preferencesVM();
  try {
    vm.run(`
      local self, L = addon.settings, addon.locale.Get
      local quick = ${options.hideNpcWindow}
      local item = ${options.disableItemWindow}
      local advanced = ${options.enableTargetFrame}
      assert(quick.order > item.order and quick.order < item.order + 0.1)
      assert(quick.width == item.width and quick.name == "Hide NPC Selection window")
      assert(not quick.get())
      quick.set(nil, true)
      assert(quick.get() and not targetFrame.shown)
      advanced.set(nil, true)
      assert(not quick.get() and targetFrame.shown)
      combat = true
      quick.set(nil, true)
      assert(quick.get() and targetFrame.shown)
      combat = false
      addon.targeting:PLAYER_REGEN_ENABLED()
      assert(not targetFrame.shown)
      quick.set(nil, false)
      assert(not quick.get() and targetFrame.shown)
    `);
  } finally { vm.close(); }
});
