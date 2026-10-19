import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');

test('built-in themes use bundled Cyrillic font without changing global fonts', async () => {
  const font = await readFile(resolve(root, 'Fonts/FiraSans-Regular.ttf'));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  assert.match(await readFile(resolve(root, 'Fonts/OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1.1/);
  for (const locale of ['enUS', 'ruRU']) {
    const vm = createVM();
    try {
      vm.run(`
        function GetLocale() return "${locale}" end
        function CopyTable(source)
            local result = {}
            for key, value in pairs(source) do
                result[key] = type(value) == "table" and CopyTable(value) or value
            end
            return result
        end
        GameFontNormal = {GetFont = function() return "Fonts/FRIZQT__.TTF", 12, "" end}
        ChatFontNormal = GameFontNormal
        STANDARD_TEXT_FONT = "Fonts/FRIZQT__.TTF"
        UNIT_NAME_FONT = "Fonts/FRIZQT__.TTF"
        RAID_CLASS_COLORS = {WARRIOR = {r = 1, g = 1, b = 1, colorStr = "ffffffff"}}
        function UnitClass() return "Warrior", "WARRIOR" end
        CUSTOM = "Custom"
        addon = {locale = {Get = function(text) return text end}, GetUnitName = function() return "Test" end}
      `);
      await vm.file(resolve(root, 'Themes.lua'));
      await vm.file(resolve(root, 'Discodic/ForeverTheme.lua'));
      vm.run(`
        local expected = "Interface/AddOns/DiscodicXP/Fonts/FiraSans-Regular.ttf"
        for _, themes in ipairs({addon.themes, addon.v2.themes}) do
            for name, theme in pairs(themes) do
                assert(theme.font == expected, name)
            end
        end
        assert(addon.customThemeBase.font == expected)
        addon.v2:ConvertThemes()
        for name, theme in pairs(addon.v2.themes) do assert(theme.font == expected, name) end
        assert(GameFontNormal:GetFont() == "Fonts/FRIZQT__.TTF")
        assert(ChatFontNormal:GetFont() == "Fonts/FRIZQT__.TTF")
        assert(STANDARD_TEXT_FONT == "Fonts/FRIZQT__.TTF")
        assert(UNIT_NAME_FONT == "Fonts/FRIZQT__.TTF")
      `);
    } finally { vm.close(); }
  }
});
