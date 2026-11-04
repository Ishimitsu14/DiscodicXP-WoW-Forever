import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import luaparse from 'luaparse';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');
const nameOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'MemberExpression'
  ? nameOf(node.base) + node.indexer + node.identifier.name : '';

async function engineFunction(file, name) {
  const source = await readFile(resolve(root, file), 'utf8');
  const ast = luaparse.parse(source, {ranges: true, luaVersion: '5.1'});
  const node = ast.body.find(node => node.type === 'FunctionDeclaration' && nameOf(node.identifier) === name);
  assert.ok(node, `Missing engine function: ${name}`);
  return source.slice(...node.range);
}

test('collection counts own loot and ignores another character with the same first name', async () => {
  const source = await readFile(resolve(root, 'DiscodicXP.lua'), 'utf8');
  const ast = luaparse.parse(source, {ranges: true, luaVersion: '5.1'});
  const player = ast.body.find(node => node.type === 'AssignmentStatement' &&
    nameOf(node.variables[0]) === 'addon.player').init[0];
  const name = player.fields.find(field => field.key.name === 'name').value;
  const vm = createVM();
  try {
    vm.run(`
      addon = {game = "FOREVER", functions = {}, settings = {profile = {}}, icons = {collect = ""}}
      function UnitName() return "Self", "Family" end
      addon.player = {name = ${source.slice(...name.range)}}
      assert(addon.player.name == "Self Family")
      function UnitName() return "Self" end
      assert(${source.slice(...name.range)} == "Self")
      function addon.GetItemName() return "Quest item" end
      function GetItemCount() return inventoryCount or 0 end
      function GetInventoryItemID() return nil end
      INVSLOT_LAST_EQUIPPED = 0
      C_Item = {GetItemInfo = function() return "", nil, nil, nil, nil, "Quest" end}
      function addon.UpdateStepText() end
      function addon.SetElementComplete(frame) frame.element.completed = true end
      function addon.SetElementIncomplete(frame) frame.element.completed = false end
      function addon.IsOnTurnInGuide() end
      function frame() return {element = {id = 42, qty = 1, totalMinimum = 0, ids = "42", step = {active = false}}} end
    `);
    vm.run('local addon = addon; local gameVersion = 16001; local fmt = string.format;\n' +
      await engineFunction('functions.lua', 'addon.functions.collect'));
    vm.run(`
      local other = frame()
      addon.functions.collect(other, "CHAT_MSG_LOOT", "item:42:", nil, nil, nil, "Self Otherfamily")
      assert(not other.element.completed and not other.element.collected)
      local own = frame()
      addon.functions.collect(own, "CHAT_MSG_LOOT", "item:42:", nil, nil, nil, "Self Family")
      assert(own.element.completed and own.element.collected)
      local unrelated = frame()
      addon.functions.collect(unrelated, "CHAT_MSG_LOOT", "item:99:", nil, nil, nil, "Self Family")
      assert(not unrelated.element.completed)
      local bag = frame()
      inventoryCount = 1
      addon.functions.collect(bag, "BAG_UPDATE_DELAYED")
      assert(bag.element.completed)
    `);
  } finally { vm.close(); }
});

test('trainer automation preserves shrinking list indices and deduplicates racial and class spells', async () => {
  const vm = createVM();
  try {
    vm.run(`
      addon = {game = "FOREVER", defaultSpellList = {
          SHAMAN = {[1] = {101, 102}, [20] = {103}}, Orc = {[1] = {101}}
      }, player = {class = "SHAMAN"}}
      now = 1
      function GetTime() return now end
      function UnitRace() return "Orc", "Orc" end
      function UnitLevel() return 10 end
      function GetEffectivePlayerMaxLevel() return 60 end
      C_Spell = {IsSpellDataCached = function() return true end}
      function GetSpellInfo(id) return id == 101 and "A" or id == 102 and "B" or "Unwanted" end
      function GetSpellSubtext() return "" end
      services, bought = {"A", "B", "Unwanted"}, {}
      function BuyTrainerService(index) bought[#bought + 1] = table.remove(services, index) end
    `);
    vm.run('local addon = addon; local gameVersion = 16001; local spellRequest = {}; local trainerProcessTime;\n' +
      await engineFunction('DiscodicXP.lua', 'ProcessSpells') + '\nprocessSpells = ProcessSpells');
    vm.run(`
      processSpells({"A", "B", "Unwanted"}, {"", "", ""})
      assert(table.concat(bought, ",") == "B,A", "Bought a shifted or duplicate trainer entry")
      assert(#services == 1 and services[1] == "Unwanted")
      processSpells({"A", "B", "Unwanted"}, {"", "", ""})
      assert(#bought == 2, "Processed stale trainer indices twice in the same frame")
      now = 2
      processSpells({"Unwanted"}, {""})
      assert(#bought == 2, "Bought a spell above the player's level")
    `);
  } finally { vm.close(); }
});

test('changing a V2 step releases old objective widgets and watchers before rebinding', async () => {
  const source = await readFile(resolve(root, 'GuideWindow.lua'), 'utf8');
  const ast = luaparse.parse(source, {ranges: true, luaVersion: '5.1'});
  const setStep = ast.body.find(node => nameOf(node.identifier) === 'addon.SetStep');
  const start = setStep.body.find(node => node.type === 'LocalStatement' && node.variables[0].name === 'useV2GuideWindow');
  const cleanup = setStep.body.find(node => node.type === 'IfStatement' && nameOf(node.clauses[0].condition) === 'useV2GuideWindow');
  assert.ok(start && cleanup);
  const vm = createVM();
  try {
    vm.run(`
      enabled, released, cleared, legacyCleared = true, 0, 0, 0
      state = {activeStepItemsByKey = {}, activeStepItems = {}, childContainer = {
          ReleaseChildren = function() released = released + 1 end
      }}
      addon = {player = {name = "Self Family"}, v2 = {state = {player = {["Self Family"] = state}}}}
      function addon.v2:IsGuideWindowEnabled() return enabled end
      function addon.v2:ClearActiveStepEventWatchers() cleared = cleared + 1 end
      function ClearFrameData() legacyCleared = legacyCleared + 1 end
      function cleanup()
          ${source.slice(start.range[0], cleanup.range[1])}
      end
      cleanup()
      assert(released == 1 and cleared == 1 and legacyCleared == 0)
      assert(state.activeStepItemsByKey == nil and state.activeStepItems == nil)
      addon.v2.state.player = {}
      cleanup()
      assert(cleared == 2 and released == 1)
      enabled = false
      cleanup()
      assert(legacyCleared == 1 and cleared == 2)
    `);
  } finally { vm.close(); }
});

test('standby pauses a hidden guide and resumes when shown or disabled', async () => {
  const vm = createVM();
  try {
    vm.run(`
      checks = 0
      addon = {settings = {profile = {standbyMode = true, showEnabled = false}}, tickers = {}}
      function addon.tickers:ShouldContinue() checks = checks + 1; return false end
      function GetFramerate() return 60 end
    `);
    vm.run('local addon = addon; local updateError; local errorCount = 0;\n' +
      await engineFunction('DiscodicXP.lua', 'addon.LegacyUpdateLoop'));
    vm.run(`
      addon.LegacyUpdateLoop()
      assert(checks == 0)
      addon.settings.profile.showEnabled = true
      addon.LegacyUpdateLoop()
      assert(checks == 1)
      addon.settings.profile.showEnabled = false
      addon.settings.profile.standbyMode = false
      addon.LegacyUpdateLoop()
      assert(checks == 2)
    `);
  } finally { vm.close(); }
});

test('daily handlers reject unresolved quest IDs and tolerate missing runtime data', async () => {
  const vm = createVM();
  try {
    vm.run(`
      addon = {functions = {}, currentGuideName = "Fixture", pickUpList = {}}
      DXPCData = {}
      function GetQuestId(id) if id ~= 999 then return id end end
      function addon.InsertQuestGuide(id) assert(id); inserted = id end
      function addon.error(message) return nil, message end
      function addon.functions.accept() end
      function addon.functions.turnin() end
    `);
    for (const name of ['daily', 'dailyturnin']) {
      vm.run('local addon = addon; local L = function(text) return text end;\n' +
        await engineFunction('functions.lua', `addon.functions.${name}`));
      vm.run(`
        local handler = addon.functions.${name}
        local value, err = handler("fixture", "", 999)
        assert(value == nil and err:find("Invalid quest ID", 1, true) and inserted == nil)
        local valid = handler("fixture", "", 42)
        assert(valid.ids[1] == 42 and inserted == 42)
        handler({})
        handler({element = {}})
        inserted = nil
      `);
    }
    vm.run('local addon = addon;\n' + await engineFunction('functions.lua', 'addon.functions.turnin'));
    vm.run(`
      function IsQuestTurnedIn() error("Invalid ID reached the game API") end
      addon.functions.turnin({element = {questId = 999, step = {active = true}}})
    `);
  } finally { vm.close(); }
});

test('profession fallback reads legacy GetSkillLineInfo when C_SkillInfo is absent', async () => {
  const vm = createVM();
  try {
    vm.run(`
      addon = {}
      function IsPlayerSpell() return false end
      addon.IsPlayerSpell = IsPlayerSpell
      function GetNumSkillLines() return 1 end
      function GetSkillLineInfo() return "Mining", false, false, 75, nil, nil, 150 end
    `);
    vm.run('local addon = addon; local professionNames = {riding = "Riding", mining = "Mining"}; ' +
      'local currrentSkillLevel, maxSkillLevel = {}, {};\n' +
      await engineFunction('DiscodicXP.lua', 'addon.GetProfessionLevel'));
    vm.run(`
      local current, maximum = addon.GetProfessionLevel()
      assert(current.mining == 75 and maximum.mining == 150)
      C_SkillInfo = {GetNumSkillLines = function() return 1 end, GetSkillLineInfo = function()
          return {name = "Mining", rank = 80, maxRank = 150}
      end}
      current, maximum = addon.GetProfessionLevel()
      assert(current.mining == 80 and maximum.mining == 150)
    `);
  } finally { vm.close(); }
});

test('item quality falls back to item info and Astral Recall tolerates unavailable cooldown data', async () => {
  const vm = createVM();
  try {
    vm.run(`
      addon = {functions = {}, Round = function(value) return value end, IsSecretValue = function() return false end}
      function GetInventoryItemID() return 42 end
      function GetItemInfo(id) assert(id == 42); queried = true; return "", nil, 3 end
      function GetItemCooldown() return 0, 20 end
      function GetSpellCooldown() return nil, nil end
      function IsPlayerSpell(id) return id == 556 end
      function GetTime() return 0 end
    `);
    vm.run('local addon = addon;\n' + await engineFunction('functions.lua', 'addon.functions.itemStat'));
    vm.run(`
      local frame = {element = {stat = "QUALITY", slot = 1, total = 2, operator = ">", step = {active = true}}}
      addon.functions.itemStat(frame)
      assert(queried and not frame.element.step.completed)
      queried = false
      function GetInventoryItemQuality() return nil end
      addon.functions.itemStat(frame)
      assert(queried)
    `);
    vm.run('local addon = addon; local class = "SHAMAN";\n' +
      await engineFunction('functions.lua', 'addon.functions.cooldown'));
    vm.run(`
      local frame = {element = {id = 6948, cooldownType = "item", remaining = 2, operator = 1, step = {active = true}}}
      addon.functions.cooldown(frame)
      assert(frame.element.step.completed and addon.updateSteps)
    `);
  } finally { vm.close(); }
});
