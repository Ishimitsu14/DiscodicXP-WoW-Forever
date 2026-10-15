import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import luaparse from 'luaparse';
import { joinNames, knowledgeLua, readNames } from '../tools/name-data.mjs';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');
const environment = `
function GetLocale() return locale or "ruRU" end
function GetTime() return now or 100 end
function InCombatLockdown() return combat or false end
clientNpc, clientQuest, timers = {}, {}, {}
C_Timer = {After = function(delay, callback) timers[#timers + 1] = callback end}
function CreateFrame()
    return {RegisterEvent = function() end, SetScript = function(self, name, callback) self[name] = callback; eventFrame = self end}
end
function tick()
    local scheduled = timers
    timers = {}
    for _, callback in ipairs(scheduled) do callback() end
end
DXPData = {}
addon = {
    game = "FOREVER", player = {lang = "ru"}, functions = {}, lastStepUpdate = 100,
    GetNpcName = function(id) return clientNpc[id] end,
    GetQuestName = function(id) return clientQuest[id] end,
    GetCreatureName = function(name) return name end,
    GetGuideProgress = function() return 21 end,
    ScheduleTask = function(self, callback) mapUpdates = (mapUpdates or 0) + 1 end,
    targeting = {UpdateUnitList = function() end}, DXPFrame = {activeSteps = {}}
}
addon.nameKnowledge = {
    npc = {[1] = {"Known NPC", "Из справочника"}, [3] = {"Ambiguous", "Первое имя"}, [4] = {"Ambiguous", "Другое имя"}},
    quest = {[2] = {"Known quest", "Название задания"}}
}
`;

async function resolver(vm) { await vm.file(resolve(root, 'Discodic/NameResolver.lua')); }

test('database importer reads only literal names without executing downloaded Lua', () => {
  const source = Buffer.from('os.execute("must never run")\nlocal rows = loadstring([[return {[1]={"Имя",nil},[2]={evil()}}]])');
  assert.deepEqual([...readNames(source)], [[1, 'Имя']]);
  assert.deepEqual(joinNames(new Map([[1, 'Name']]), new Map([[1, 'Имя'], [2, 'Другой']])), {1: ['Name', 'Имя']});
  assert.throws(() => readNames(Buffer.from('return os.execute("bad")')), /таблица/);
  assert.throws(() => knowledgeLua({version: 2}), /формат/);
});

test('client names override knowledge and persist; mismatched and ambiguous names are rejected', async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await resolver(vm);
    vm.run(`
      assert(addon.GetNpcName(1, "Known NPC") == "Из справочника")
      assert(addon.GetNpcName(1, "Wrong NPC") == nil)
      assert(addon.names:GetKnown("npc", 99, "Ambiguous") == nil)
      assert(addon.GetNpcName(99, "Known NPC") == "Из справочника")
      assert(addon.GetCreatureName("Known NPC") == "Из справочника")
      assert(addon.GetCreatureName("Ambiguous") == "Ambiguous")
      addon.npcNames = {["Local NPC"] = "Имя из аддона"}
      assert(addon.GetNpcName(100, "Local NPC") == "Имя из аддона")
      assert(addon.GetQuestName(2) == "Название задания")
      clientQuest[2] = "Wrong quest"
      assert(addon.GetQuestName(2) == "Wrong quest")
      clientNpc[1] = "Название клиента"
      clientQuest[2] = "Задание клиента"
      assert(addon.GetNpcName(1) == "Название клиента")
      assert(addon.GetQuestName(2) == "Задание клиента")
      clientNpc, clientQuest = {}, {}
      assert(addon.GetNpcName(1) == "Название клиента")
      assert(addon.GetQuestName(2) == "Задание клиента")
      local saved = DXPData.nameCache["FOREVER:ruRU"]
      assert(saved.npc[1] == "Название клиента" and saved.quest[2] == "Задание клиента")
    `);
  } finally { vm.close(); }
});

test('pending NPC names retry without a game event and stop when the step changes', async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await resolver(vm);
    vm.run(`
      local element = {npcIds = {251404}, npcFallbacks = {"Cirrusfly Queen"}, unitlist = {"251404"}, step = {active = true}}
      addon.names:ResolveTargets(element)
      assert(element.unitlist[1] == "Cirrusfly Queen" and #timers == 1)
      clientNpc[251404] = "Щетинистая оса-королева"
      tick()
      assert(element.unitlist[1] == "Щетинистая оса-королева" and #timers == 0)
      element = {npcIds = {999}, npcFallbacks = {"Unseen"}, unitlist = {"999"}, step = {active = true}}
      addon.names:ResolveTargets(element)
      element.step.active = false
      tick()
      assert(not addon.names.pending[element] and #timers == 0)
    `);
  } finally { vm.close(); }
});

test('target refresh waits for combat to end and unresolved retries are bounded', async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await resolver(vm);
    vm.run(`
      local element = {npcIds = {1}, npcFallbacks = {"Known NPC"}, unitlist = {"1"}, step = {active = true}}
      addon.DXPFrame.activeSteps = {{active = true, elements = {element}}}
      combat = true
      addon.names:ResolveTargets(element)
      assert(element.unitlist[1] == "1" and not mapUpdates)
      combat = false
      eventFrame.OnEvent()
      assert(element.unitlist[1] == "Из справочника" and mapUpdates == 1)
      element = {npcIds = {999}, npcFallbacks = {"Unseen"}, unitlist = {"Unseen"}, step = {active = true}}
      addon.names:ResolveTargets(element)
      for i = 1, 20 do tick() end
      assert(#timers == 0 and not addon.names.pending[element])
    `);
  } finally { vm.close(); }
});

test('English clients keep English target names', async () => {
  const vm = createVM();
  try {
    vm.run(environment + 'locale = "enUS"; addon.player.lang = "en"');
    await resolver(vm);
    vm.run(`
      local element = {npcIds = {1}, npcFallbacks = {"Known NPC"}, unitlist = {"1"}, step = {active = true}}
      addon.names:ResolveTargets(element)
      assert(element.unitlist[1] == "Known NPC" and #timers == 0)
      assert(addon.GetNpcName(1) == nil and addon.GetQuestName(2) == nil)
    `);
  } finally { vm.close(); }
});

test('native NPC lookup uses a private tooltip and leaves the visible tooltip alone', async () => {
  const source = await readFile(resolve(root, 'functions.lua'), 'utf8');
  const start = source.indexOf('local NPCNames = {}');
  const end = source.indexOf('function addon.ReplaceNpcIds(', start);
  assert.ok(start >= 0 && end > start);
  const vm = createVM();
  try {
    vm.run(environment + `
      UIParent = {}
      GameTooltip = {Hide = function() error("Visible tooltip was hidden") end}
      local create = CreateFrame
      function CreateFrame(kind, name, parent, template)
          if kind ~= "GameTooltip" then return create() end
          assert(name == "DXPNPCNameTooltip" and template == "GameTooltipTemplate")
          local tooltip = {
              SetOwner = function(self, owner, anchor) assert(owner == UIParent and anchor == "ANCHOR_NONE") end,
              ClearLines = function(self) self.text = nil end,
              SetHyperlink = function(self, link) self.text = clientNpc[tonumber(link:match("%-(%d+)$"))] end,
              IsShown = function() error("Lookup must not depend on tooltip visibility") end,
              Hide = function(self) queryHidden = true end
          }
          _G[name .. "TextLeft1"] = {GetText = function() return tooltip.text end}
          return tooltip
      end
    `);
    vm.run(source.slice(start, end));
    await resolver(vm);
    vm.run(`
      clientNpc[251404] = "Щетинистая оса-королева"
      assert(addon.GetNpcName(251404, "Cirrusfly Queen") == "Щетинистая оса-королева")
      assert(queryHidden)
    `);
  } finally { vm.close(); }
});

test('actual mob parser preserves ID and source name while the resolver updates its target list', async () => {
  const source = await readFile(resolve(root, 'functions.lua'), 'utf8');
  const nameOf = node => node.type === 'Identifier' ? node.name : node.type === 'MemberExpression' ? nameOf(node.base) + node.indexer + node.identifier.name : '';
  const wanted = new Set(['UpdateTargets', 'CheckNpcIds', 'UpdateNpcNames', 'addon.functions.mob']);
  const nodes = luaparse.parse(source, {ranges: true, luaVersion: '5.1'}).body
    .filter(node => node.type === 'FunctionDeclaration' && node.identifier && wanted.has(nameOf(node.identifier)));
  assert.equal(nodes.length, wanted.size);
  const vm = createVM();
  try {
    vm.run(environment);
    await resolver(vm);
    vm.run(nodes.map(node => source.slice(...node.range)).join('\n'));
    vm.run(`
      local element = addon.functions.mob("mob", nil, "Cirrusfly Queen::251404")
      assert(element.npcIds[1] == 251404 and element.npcFallbacks[1] == "Cirrusfly Queen")
      assert(element.unitlist[1] == "Cirrusfly Queen")
      element.step = {active = true, index = 21}
      clientNpc[251404] = "Щетинистая оса-королева"
      addon.functions.mob({element = element})
      assert(element.unitlist[1] == "Щетинистая оса-королева")
    `);
  } finally { vm.close(); }
});
