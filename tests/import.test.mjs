import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateRawSync, deflateSync, inflateRawSync, inflateSync } from 'node:zlib';
import { adler32, decodeGuides, deriveKey, transform } from '../tools/guide-codec.mjs';
import { rebrand } from '../tools/build.mjs';
import { createVM } from './lua-vm.mjs';

const root = resolve(process.env.DISCODICXP_BUILD || 'dist/DiscodicXP');
const ready = existsSync(resolve(root, 'Discodic/GuideImport.lua'));
const source = version => `#forever\n#group RestedXP Forever Guide (H)\n#name 22-24 Hillsbrad\n#version ${version}\n<< Horde\nstep\n.accept 123 >>Test ${version}\n`;
function encoded(sources, count = sources.length) {
  const plain = Buffer.from(sources.join('\0'));
  return `${count}|${adler32(plain)}:${transform(deflateSync(plain), deriveKey('example#12345')).toString('base64')}%|40000`;
}

const environment = `
unpack, tremove = table.unpack, table.remove
strlower, strupper = string.lower, string.upper
function GetLocale() return "ruRU" end
function UnitLevel() return 30 end
function UnitSex() return 2 end
function GetTime() return 0 end
function InCombatLockdown() return combat or false end
function strsplit(delimiter, text) return text:match("([^" .. delimiter .. "]*)" .. delimiter .. "?(.*)") end
local function integer(value)
    value = value % 4294967296
    return math.floor(value >= 2147483648 and value - 4294967296 or value)
end
bit = {
    band = function(a, b) return integer(a) & integer(b) end,
    bxor = function(...)
        local result = 0
        for i = 1, select("#", ...) do result = result ~ integer(select(i, ...)) end
        return result
    end,
    bor = function(a, b) return integer(a) | integer(b) end,
    lshift = function(a, b) return integer(a) << b end,
    rshift = function(a, b) return integer(a) >> b end
}
table.wipe = function(t) for key in pairs(t) do t[key] = nil end end
function CopyTable(source)
    local copy = {}
    for key, value in pairs(source) do copy[key] = type(value) == "table" and CopyTable(value) or value end
    return copy
end
local deflate = {
    CompressDeflate = function(self, text) return compressRaw(text) end,
    DecompressDeflate = function(self, text) return decompressRaw(text) end,
    DecompressZlib = function(self, text) return decompressZlib(text) end
}
LibStub = function() return deflate end
addon = {
    player = {class = "WARRIOR", race = "Orc", faction = "Horde", hardcore = false},
    game = "FOREVER", gameVersion = 16001, version = 40000, release = "0.2.0",
    settings = {profile = {preLoadData = false, debug = false}, ReplaceColors = function(t) return t end},
    locale = {Get = function(text) return text end},
    DiscodicXP = {}, guideImporter = {}, functions = {}, separators = {},
    comms = {PrettyPrint = function() end, PrettyDebug = function() end},
    LocalizeGuideName = function(text) return text end,
    error = error,
    NewModule = function(self, name, module) return module end,
    ScheduleTask = function() end,
    safeCall = pcall,
    DXPFrame = {GenerateMenuTable = function() end},
    LoadGuide = function(self, guide, keepStep) self.currentGuide = guide; assert(keepStep) end
}
DiscodicXP = addon.DiscodicXP
DXPData = {release = "0.2.0"}
DXPCData = {guideDisabled = {}, guideMetaData = {}, guideProgress = {}}
function CreateFrame()
    return {scripts = {}, SetScript = function(self, name, callback) self.scripts[name] = callback end}
end
`;

async function createImportVM() {
  const vm = createVM();
  vm.bindBytes('compressRaw', bytes => deflateRawSync(bytes));
  vm.bindBytes('decompressRaw', bytes => inflateRawSync(bytes));
  vm.bindBytes('decompressZlib', bytes => inflateSync(bytes));
  vm.run(environment);
  await vm.file(resolve(root, 'libs/plc/base64.lua'));
  await vm.file(resolve(root, 'GuideLoader.lua'));
  await vm.file(resolve(root, 'Discodic/GuideCodec.lua'));
  await vm.file(resolve(root, 'Discodic/GuideImport.lua'));
  vm.run(`
    addon.db = {profile = {guides = {}}}
    addon.functions.accept = function(line, text) return {text = text} end
  `);
  return vm;
}

test('in-game codec opens original encrypted data without account APIs', { skip: !ready }, async () => {
  const vm = await createImportVM();
  try {
    vm.setBytes('input', encoded([source(1), source(2).replace('22-24 Hillsbrad', '24-26 Barrens')]));
    vm.setBytes('expected', rebrand(source(1)));
    vm.run(`
      local key = assert(addon.guideCodec.KeyFromFileName("Demo!example#12345.txt"))
      local sources = addon.guideCodec.Decode(input, key)
      assert(#sources == 2 and sources[1] == expected)
      assert(BNGetInfo == nil and DXPData.cache == nil)
      local wrong = addon.guideCodec.KeyFromFileName("Demo!different#98765.txt")
      assert(not pcall(addon.guideCodec.Decode, input, wrong))
      assert(not pcall(addon.guideCodec.Decode, input:sub(1, -5), key))
      assert(not pcall(addon.guideCodec.Decode, input:gsub("^2|", "3|"), key))
    `);
  } finally { vm.close(); }
});

test('real purchased file decodes to the same 33 sections in Lua and Node', {
  skip: !ready || !process.env.DISCODICXP_GUIDE
}, async () => {
  const fileName = process.env.DISCODICXP_GUIDE;
  const text = await readFile(fileName, 'utf8');
  const decoded = decodeGuides(text, fileName);
  const commands = [...new Set([...decoded.guides.join('\n').matchAll(/^\s*\.(\S+)/gm)].map(match => match[1]))];
  const vm = await createImportVM();
  try {
    await vm.file(resolve(root, 'Discodic/ImportKey.lua'));
    vm.setBytes('input', text);
    vm.setBytes('expected', rebrand(decoded.guides[0]));
    vm.run(`for _, command in ipairs({${commands.map(s => JSON.stringify(s)).join(',')}}) do
      addon.functions[command] = function(line, text) return {text = text} end
    end`);
    vm.run(`
      local sources = addon.guideCodec.Decode(input, addon.defaultGuideImportKey)
      assert(#sources == 33)
      assert(sources[1] == expected)
      local entries = addon.localGuideImport:Prepare(sources)
      assert(#entries == 33)
      assert(addon.localGuideImport:Commit(entries) == 33)
      local stored = 0
      for _ in pairs(addon.db.profile.guides) do stored = stored + 1 end
      assert(stored == 33)
      assert(BNGetInfo == nil)
    `);
  } finally { vm.close(); }
});

test('updates replace cached sections, retain progress and survive embedded guide loading', { skip: !ready }, async () => {
  const vm = await createImportVM();
  try {
    vm.setBytes('old', rebrand(source(1)));
    vm.setBytes('updated', rebrand(source(2)));
    vm.run(`
      local import = addon.localGuideImport
      local first = import:Prepare({old})
      assert(import:Commit(first) == 1)
      local key = first[1].guide.key
      DXPCData.guideProgress[key] = {step = 7, stepId = 900}
      addon.currentGuide = first[1].guide
      local second = import:Prepare({updated})
      assert(import:Commit(second) == 1)
      local count = 0
      for _ in pairs(addon.db.profile.guides) do count = count + 1 end
      assert(count == 1)
      assert(DXPCData.guideProgress[key].step == 7)
      assert(DXPCData.guideProgress[key].stepId == 900)
      addon.guides, addon.guideList, addon.guideIds, addon.guideCache = {}, {}, {}, {}
      addon.LoadCachedGuides()
      local index = second[1].guide.group .. "||" .. second[1].guide.name
      assert(addon.guides[index].version == 2 and addon.guides[index].imported)
      addon.RegisterGuide(old)
      addon.LoadEmbeddedGuides()
      assert(addon.guides[index].version == 2 and addon.guides[index].imported)
      local changed, skipped = import:Commit(import:Prepare({old}))
      assert(changed == 0 and skipped == 1)
      assert(addon.guides[index].version == 2)
    `);
  } finally { vm.close(); }
});

test('failed parsing and failed commit leave saved guides and progress intact', { skip: !ready }, async () => {
  const vm = await createImportVM();
  try {
    vm.setBytes('good', rebrand(source(1)));
    vm.setBytes('bad', rebrand(source(2).replace('.accept 123', '.unknownCommand 123')));
    vm.run(`
      local import = addon.localGuideImport
      import:Commit(import:Prepare({good}))
      local cache, guides, progress = addon.db.profile.guides, addon.guides, DXPCData.guideProgress
      assert(not pcall(import.Prepare, import, {good, bad}))
      assert(addon.db.profile.guides == cache and addon.guides == guides)
      assert(DXPCData.guideProgress == progress)
      local entries = import:Prepare({good})
      local original = addon.AddGuide
      addon.AddGuide = function() error("Commit failure") end
      assert(not pcall(import.Commit, import, entries))
      addon.AddGuide = original
      assert(addon.db.profile.guides == cache and addon.guides == guides)
      assert(DXPCData.guideProgress == progress)
    `);
  } finally { vm.close(); }
});

test('async import can be cancelled and blocks committing after combat starts', { skip: !ready }, async () => {
  const vm = await createImportVM();
  try {
    vm.setBytes('input', encoded([source(2)]));
    vm.run(`
      local import = addon.localGuideImport
      addon.defaultGuideImportKey = assert(addon.guideCodec.KeyFromFileName("Demo!example#12345.txt"))
      assert(import:Start(input, "", function() end))
      assert(not import:Start(input, "", function() end))
      import:Cancel()
      assert(next(addon.db.profile.guides) == nil)
      local done, message
      assert(import:Start(input, "", function(ok, status) if ok ~= nil then done, message = ok, status end end))
      combat = true
      while import.job do import.worker.scripts.OnUpdate() end
      assert(done == false and message:find("бой"))
      assert(next(addon.db.profile.guides) == nil)
      combat = false
      assert(import:Start(input, "", function(ok) if ok ~= nil then done = ok end end))
      while import.job do import.worker.scripts.OnUpdate() end
      assert(done == true and next(addon.db.profile.guides))
      assert(DXPData.guideImportKey and BNGetInfo == nil)
    `);
  } finally { vm.close(); }
});

test('import window opens, imports pasted content and clears input after success', { skip: !ready }, async () => {
  const vm = await createImportVM();
  try {
    vm.setBytes('input', encoded([source(2)]));
    vm.run(`
      local methods = {}
      for _, name in ipairs({"SetSize", "SetPoint", "SetWidth", "SetHeight", "SetFont", "SetTextColor", "SetJustifyH", "SetJustifyV",
          "SetFrameStrata", "SetClampedToScreen", "EnableMouse", "SetMovable", "RegisterForDrag", "SetParent", "ClearAllPoints",
          "SetAutoFocus", "SetMaxBytes", "Raise", "StartMoving", "StopMovingOrSizing", "SetMultiLine", "SetTextInsets",
          "SetCountInvisibleLetters", "SetMaxLetters", "HighlightText", "SetCursorPosition"}) do methods[name] = function() end end
      methods.SetScript = function(self, name, callback) self.scripts[name] = callback end
      methods.SetFont = function(self, font) self.font = font end
      methods.SetFontObject = methods.SetFont
      methods.SetParent = function(self, parent) self.parent = parent end
      methods.SetText = function(self, text)
          if self.kind == "FontString" then assert(self.font, "FontString:SetText(): Font not set") end
          self.text = text
          if self.scripts.OnTextSet then self.scripts.OnTextSet(self) end
      end
      methods.GetText = function(self) return self.text or "" end
      methods.GetNumLetters = function(self) return #self.text end
      methods.SetEnabled = function(self, enabled) self.enabled = enabled end
      methods.Enable = function(self) self.enabled = true end
      methods.Disable = function(self) self.enabled = false end
      methods.SetFocus = function(self)
          if not self.focused then self.focused = true; if self.scripts.OnEditFocusGained then self.scripts.OnEditFocusGained(self) end end
      end
      methods.ClearFocus = function(self)
          if self.focused then self.focused = false; if self.scripts.OnEditFocusLost then self.scripts.OnEditFocusLost(self) end end
      end
      methods.Show = function(self) self.shown = true end
      methods.Hide = function(self) self.shown = false; if self.scripts.OnHide then self.scripts.OnHide() end end
      methods.IsShown = function(self) return self.shown and (not self.parent or self.parent:IsShown()) end
      local function frame(kind, parent)
          local object = setmetatable({scripts = {}, text = "", kind = kind, parent = parent, shown = true}, {__index = function(self, key)
              if self.kind == "EditBox" and key == "SetEnabled" then return nil end
              return methods[key]
          end})
          object.CreateFontString = function(self, name, layer, template)
              local font = frame("FontString", self)
              font.font = template
              return font
          end
          return object
      end
      CreateFrame = function(kind, name, parent) return frame(kind, parent) end
      local constructors, versions = {}, {}
      local base = {
          SetWidth = function(self, value) self.frame:SetWidth(value) end,
          SetHeight = function(self, value) self.frame:SetHeight(value) end,
          SetCallback = function(self, name, callback) self.callbacks[name] = callback end,
          Fire = function(self, name, ...) if self.callbacks[name] then self.callbacks[name](self, name, ...) end end
      }
      local ace = {
          GetWidgetVersion = function(self, name) return versions[name] end,
          GetNextWidgetNum = function() return 1 end,
          RegisterWidgetType = function(self, name, constructor, version) constructors[name], versions[name] = constructor, version end,
          RegisterAsWidget = function(self, widget) widget.callbacks = {}; return setmetatable(widget, {__index = base}) end,
          Create = function(self, name) local widget = constructors[name](); widget:OnAcquire(); return widget end,
          SetFocus = function() end
      }
      LibStub = function(name) if name == "AceGUI-3.0" then return ace end end
      local theme = {font = "GameFont", edge = {}, backgroundColors = {common = {}, scrollbar = {}},
          borderColors = {commonEdge = {}}, textColor = {common = {}, title = {}}}
      addon.v2 = {GetTheme = function() return theme end}
      addon.ui = {v2 = {InitializeGuideImporter = function() end, ApplyFrameBackdrop = function() end}}
      UISpecialFrames = {}
      StaticPopupDialogs = {}
      ChatFontNormal = "ChatFontNormal"
      local time = 1
      function GetTime() return time end
      function advanceTime() time = time + 1 end
    `);
    await vm.file(resolve(root, 'UI/V2/GuideImporter.lua'));
    vm.run('addon.ui.v2.InitializeGuideImporter = function(self) self:RegisterDXPV2GuideImporterEditBox() end');
    await vm.file(resolve(root, 'Discodic/ImportWindow.lua'));
    vm.run(`
      addon.guideImporter:Open()
      local window = addon.localGuideImport.window
      assert(window and window.shown)
      assert(window.input.frame:IsShown(), "Paste widget is hidden")
      assert(window.editBox:IsShown(), "Paste edit box is hidden")
      assert(window.editBox.focused, "Paste field did not receive focus")
      for index = 1, #input do window.editBox.scripts.OnChar(window.editBox, input:sub(index, index)) end
      advanceTime()
      window.editBox.scripts.OnUpdate(window.editBox)
      assert(addon.guideImporter.importCache.bufferString == input)
      assert(#window.editBox:GetText() == math.min(#input, 150))
      assert(window.importButton.enabled)
      window.fileName:SetText("Demo!example#12345.txt")
      window.importButton.scripts.OnClick()
      while addon.localGuideImport.job do addon.localGuideImport.worker.scripts.OnUpdate() end
      assert(window.status.text:find("Готово"))
      assert(not window.busy and not window.importButton.enabled)
      assert(window.fileName:GetText() == "" and addon.guideImporter.importCache.bufferString == "")
      assert(next(addon.db.profile.guides))
      assert(UISpecialFrames[1] == "DiscodicXPImportWindow")
    `);
  } finally { vm.close(); }
});
