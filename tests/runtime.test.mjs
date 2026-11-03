import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkBuild } from '../tools/check.mjs';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');
const ready = existsSync(resolve(root, 'DiscodicXP.toc'));
const environment = `
unpack = table.unpack
tremove = table.remove
strlower = string.lower
strupper = string.upper
function GetLocale() return "ruRU" end
function UnitLevel() return 30 end
function UnitSex() return 2 end
function GetTime() return 0 end
function strsplit(delimiter, text)
    return text:match("([^" .. delimiter .. "]*)" .. delimiter .. "?(.*)")
end
bit = {
    band = function(a, b)
        a, b = a % 4294967296, b % 4294967296
        if a >= 2147483648 then a = a - 4294967296 end
        if b >= 2147483648 then b = b - 4294967296 end
        return math.floor(a) & math.floor(b)
    end,
    bxor = function(a, b) return a ~ b end
}
table.wipe = function(t) for k in pairs(t) do t[k] = nil end end
local deflate = {
    CompressDeflate = function(self, text) return text end,
    DecompressDeflate = function(self, text) return text end
}
LibStub = function() return deflate end
addon = {
    player = {class = "WARRIOR", race = "Orc", faction = "Horde", hardcore = true},
    game = "FOREVER", gameVersion = 16001, version = 40000,
    settings = {profile = {preLoadData = false, debug = false}, ReplaceColors = function(t) return t end},
    locale = {Get = function(text) return text end},
    DiscodicXP = {}, guideImporter = {}, functions = {}, separators = {},
    comms = {PrettyPrint = function() end, PrettyDebug = function() end},
    LocalizeGuideName = function(text) return text end,
    error = error,
    NewModule = function(self, name, module) return module end,
    ScheduleTask = function() end,
    DXPFrame = {GenerateMenuTable = function() end}
}
DiscodicXP = addon.DiscodicXP
DXPData = {}
DXPCData = {guideDisabled = {}, guideMetaData = {}}
`;

test('Lua 5.1 syntax, load graph and namespaces are valid', { skip: !ready }, async () => {
  const checked = await checkBuild(root);
  assert.equal(checked.paidGuides, 0);
  assert.ok(checked.luaFiles > 50);
});

test('fresh addon keeps the server guide file empty without an account-bound import key', { skip: !ready }, async () => {
  const vm = createVM();
  try {
    vm.run(environment);
    await vm.file(resolve(root, 'GuideLoader.lua'));
    await vm.file(resolve(root, 'UserGuides/ForeverHorde.lua'));
    vm.run(`
      assert(BNGetInfo == nil)
      assert(DXPData.cache == nil)
      assert(#addon.embeddedGuides == 0)
      assert(addon.launcherGuideDigest == "" and addon.defaultGuideImportKey == nil)
      assert(addon.ReadCacheData("string") == "1")
      assert(addon.ReadCacheData("number") == 1)
    `);
  } finally { vm.close(); }
});

test('bundled Horde starters load for new characters and join the server route at level 22', { skip: !ready }, async () => {
  const toc = await readFile(resolve(root, 'DiscodicXP.toc'), 'utf8');
  const entries = toc.split(/\r?\n/).filter(line => line.startsWith('Guides/Starters/'));
  assert.equal(entries.length, 6);
  const sources = await Promise.all(entries.map(entry => readFile(resolve(root, entry), 'utf8')));
  const commands = [...new Set(sources.flatMap(source => [...source.matchAll(/^\s*\.(\S+)/gm)].map(match => match[1])))];
  const handlers = await readFile(resolve(root, 'functions.lua'), 'utf8');
  const missing = commands.filter(command => {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`addon\\.functions(?:\\.${escaped}\\b|\\[['"]${escaped}['"]\\])`).test(handlers);
  });
  assert.deepEqual(missing, []);
  for (const [race, klass, start] of [['Orc', 'SHAMAN', '01-06 Durotar'], ['Troll', 'MAGE', '01-06 Durotar'],
    ['Scourge', 'WARLOCK', '01-06 Tirisfal Glades'], ['Tauren', 'DRUID', '01-06 Mulgore'], ['Skyborne', 'SHAMAN', '01-09 Zephras Isle']]) {
    const vm = createVM();
    try {
      vm.run(environment);
      vm.run(`
        function UnitLevel() return 2 end
        function UnitFactionGroup() return "Horde" end
        addon.player.class = "${klass}"; addon.player.race = "${race}"
        addon.enabledLocale = {}; DXP = addon
        addon.db = {profile = {guides = {}}}; addon.guideCache = {}
      `);
      await vm.file(resolve(root, 'GuideLoader.lua'));
      for (const entry of entries) await vm.file(resolve(root, entry));
      await vm.file(resolve(root, 'UserGuides/ForeverHorde.lua'));
      vm.run(`
        assert(#addon.embeddedGuides == 15)
        for _, command in ipairs({${commands.map(command => JSON.stringify(command)).join(',')}}) do
          addon.functions[command] = function(line, text) return {text = text} end
        end
        addon.DiscodicXP.RegisterGuide([=[#forever
#group DiscodicXP Forever Guide (H)
#name 22-24 Hillsbrad
<< Horde
step
.accept 123 >>Server route fixture
]=])
        addon.LoadEmbeddedGuides()
        local group = "DiscodicXP Forever Guide (H)||"
        local starter = assert(addon.guides[group .. "${start}"], "Missing starter for ${race} ${klass}")
        assert(not starter.lowPrio and addon.applies(starter.defaultfor))
        local last = assert(addon.guides[group .. "17-22 Stonetalon/Barrens/Ashenvale"])
        assert(last.next == "22-24 Hillsbrad")
        assert(addon.guides[group .. last.next], "Missing continuation from server")
      `);
    } finally { vm.close(); }
  }
});

test('actual parser reads server guide fixtures for Horde race/class combinations', { skip: !ready }, async () => {
  const guides = ['Horde', 'Mage'].map((condition, index) =>
    `#forever\n#group Server Fixture\n#name Route ${index}\n<< ${condition}\nstep\n.accept ${index + 1} >>Test quest\n`);
  for (const [race, klass] of [['Orc', 'WARRIOR'], ['Troll', 'MAGE'], ['Scourge', 'WARLOCK'], ['Tauren', 'DRUID']]) {
    const vm = createVM();
    try {
      vm.run(environment);
      vm.run(`addon.player.class = "${klass}"; addon.player.race = "${race}"`);
      await vm.file(resolve(root, 'GuideLoader.lua'));
      vm.run(`
        addon.functions.accept = function(line, text) return {text = text} end
        ${guides.map(guide => `addon.DiscodicXP.RegisterGuide([=[${guide}]=])`).join('\n')}
        local parsed, applicable = 0, 0
        for _, entry in ipairs(addon.embeddedGuides) do
            local guide, err = addon.ParseGuide(entry.groupOrContent, nil, nil, true)
            assert(guide and guide.name, tostring(err))
            if not err then
                assert(#guide.steps > 0, guide.name)
                applicable = applicable + 1
            else
                assert(err == "#0" or not addon.applies(guide.enabledFor), tostring(err))
            end
            parsed = parsed + 1
        end
        assert(parsed == 2)
        assert(applicable == (addon.player.class == "MAGE" and 2 or 1))
      `);
    } finally { vm.close(); }
  }
});

test('show and hide commands are idempotent and Russian aliases work', { skip: !ready }, async () => {
  const vm = createVM();
  try {
    vm.run(environment + `
      addon.settings.profile.showEnabled = false
      local toggles = 0
      addon.settings.ToggleActive = function()
          toggles = toggles + 1
          addon.settings.profile.showEnabled = not addon.settings.profile.showEnabled
      end
      addon.settings.ChatCommand = function(input) fallback = input end
      addon.guideImporter.Open = function() importOpened = true end
      addon.GetGuideProgress = function() return 1 end
      addon.v2 = {ShowGuideSelectionMenu = function() selected = true end}
      function InCombatLockdown() return combat or false end
    `);
    await vm.file(resolve(root, 'Discodic/Commands.lua'));
    vm.run(`
      addon.settings.ChatCommand("show")
      addon.settings.ChatCommand("показать")
      assert(addon.settings.profile.showEnabled)
      addon.settings.ChatCommand("hide")
      addon.settings.ChatCommand("скрыть")
      assert(not addon.settings.profile.showEnabled)
      combat = true
      addon.settings.ChatCommand("guides")
      assert(not selected)
      combat = false
      addon.settings.ChatCommand("маршруты")
      assert(selected)
      addon.settings.ChatCommand("импорт")
      addon.settings.ChatCommand("import")
      assert(not importOpened)
      addon.settings.ChatCommand("debug")
      assert(fallback == "debug")
    `);
  } finally { vm.close(); }
});

test('UI follows the client language and unknown locales fall back to English', { skip: !ready }, async () => {
  for (const locale of ['ruRU', 'enUS', 'enGB', 'deDE', 'frFR', 'itIT']) {
    const vm = createVM();
    try {
      vm.run(`
        function GetLocale() return "${locale}" end
        function geterrorhandler() return error end
        format = string.format
        addon = {}
        unpack = table.unpack
        strjoin = function(delimiter, ...) return table.concat({...}, delimiter) end
        strsplittable = function(delimiter, text)
            local result = {}
            for word in text:gmatch("[^" .. delimiter .. "]+") do result[#result + 1] = word end
            return result
        end
      `);
      await vm.file(resolve(root, 'libs/LibStub/LibStub.lua'), false);
      await vm.file(resolve(root, 'libs/AceLocale-3.0/AceLocale-3.0.lua'), false);
      vm.run('local ace = LibStub:NewLibrary("AceAddon-3.0", 1); ace.NewAddon = function(self, addon) return addon end');
      await vm.file(resolve(root, 'locale/enUS.lua'));
      for (const language of ['esES', 'frFR', 'zhCN', 'zhTW', 'deDE', 'koKR', 'ruRU']) {
        await vm.file(resolve(root, `locale/${language}.lua`));
      }
      await vm.file(resolve(root, 'Locale.lua'));
      await vm.file(resolve(root, 'Discodic/Language.lua'));
      vm.run(`
        local L = LibStub("AceLocale-3.0"):GetLocale("DiscodicXP")
        local russian = GetLocale() == "ruRU"
        assert(addon.displayName == "DiscordikXP")
        assert(addon.locale.Get("DiscodicXP") == "DiscordikXP")
        assert(addon.LocalizeGuideName("22-24 Hillsbrad") == (russian and "22-24 Хилсбрад" or "22-24 Hillsbrad"))
        assert(addon.LocalizeGuideName("DiscodicXP Forever Guide") == "DiscordikXP Forever Guide")
        assert(addon.locale.Get("DiscordikXP · Import guides") == (russian and "DiscordikXP · Импорт маршрутов" or "DiscordikXP · Import guides"))
        assert(addon.locale.Get("Finish combat and try importing again.") == (russian and "Завершите бой и повторите импорт." or "Finish combat and try importing again."))
        assert(addon.locale.Get("Hide NPC Selection window") == (russian and "Скрыть окно выбора НПС" or "Hide NPC Selection window"))
        if russian then
            assert(L["Browse Guides"] == "Выбрать маршрут")
            assert(addon.locale.Get("Active Targets") == "Выбор NPC")
        elseif GetLocale() == "enUS" or GetLocale() == "enGB" or GetLocale() == "itIT" then
            assert(addon.locale.Get("Browse Guides") == "Browse Guides")
            assert(addon.locale.Get("Active Targets") == "NPC Selection")
        else
            assert(addon.locale.Get("Compare Next Level") == L["Compare Next Level"])
            assert(addon.locale.Get("Compare Next Level") ~= "Compare Next Level")
        end
      `);
    } finally { vm.close(); }
  }
});
