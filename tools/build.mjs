import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knowledgeLua, validateKnowledge } from './name-data.mjs';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const rebrand = text => text
  .replaceAll('RXPGuides', 'DiscodicXP')
  .replaceAll('RXPG', 'DXPG')
  .replaceAll('RXP', 'DXP')
  .replaceAll('rxpguides', 'discodicxp')
  .replaceAll('rxpg', 'dxpg')
  .replaceAll('rxp', 'dxp')
  .replaceAll('RestedXP', 'DiscodicXP');

function replaceOnce(text, before, after, label) {
  if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) {
    throw new Error(`Исходный код изменился: не удалось применить ${label}.`);
  }
  return text.replace(before, after);
}

export function patchSource(path, source) {
  let text = source.replaceAll('\r\n', '\n');
  if (path === 'RXPGuides.lua') {
    text = replaceOnce(text, '    name = UnitName("player"),',
      '    name = addon.game == "FOREVER" and table.concat({UnitName("player")}, " ") or UnitName("player"),',
      'полное имя персонажа Forever');
    text = replaceOnce(text, 'or _G.SkillLineInfo', 'or _G.GetSkillLineInfo', 'API профессий');
    text = replaceOnce(text, 'local trainerUpdate = 0', 'local trainerUpdate = 0\nlocal trainerProcessTime', 'таймер автообучения');
    const start = text.indexOf('local function ProcessSpells(names, rank)\n');
    const end = text.indexOf('local function OnTrainer()\n', start);
    if (start < 0 || end < start) throw new Error('Не найдена функция автообучения.');
    text = text.slice(0, start) + `local function ProcessSpells(names, rank)
    local now = GetTime()
    if gameVersion > 90000 or not addon.defaultSpellList or trainerProcessTime == now then return end
    trainerProcessTime = now

    local forever = addon.game == "FOREVER"
    if forever and ClassTrainerFrame and ClassTrainerFrame.TitleContainer and ClassTrainerFrame.TitleContainer.TitleText:GetText() == UnitName("pet") then
        return
    end

    local playerLevelMax = GetEffectivePlayerMaxLevel and GetEffectivePlayerMaxLevel() or 90
    local _, race = UnitRace("player")
    local level = UnitLevel("player")
    local entries = {race, addon.player.class}
    local hcserver = C_GameRules and C_GameRules.IsHardcoreActive and C_GameRules.IsHardcoreActive()
    local spellsToBuy = {}
    for _, entry in pairs(entries) do
        if addon.defaultSpellList[entry] then
            for spellLvl = 1, playerLevelMax do
                local spells = addon.defaultSpellList[entry][spellLvl]
                if spells and spellLvl <= level then
                    for _, spellId in ipairs(spells) do
                        if not (spellRequest[spellId] or C_Spell.IsSpellDataCached(spellId)) then
                            C_Spell.RequestLoadSpellData(spellId)
                            spellRequest[spellId] = true
                        end
                        if names and rank and
                            not (hcserver and addon.HCSpellList and addon.HCSpellList[spellId]) then
                            spellRequest[spellId] = nil
                            local sName = GetSpellInfo(spellId)
                            local sRank = GetSpellSubtext(spellId)
                            for id, name in pairs(names) do
                                if sName == name and sRank == rank[id] then
                                    table.insert(spellsToBuy, id)
                                end
                            end
                        end
                    end
                    if next(spellsToBuy) then break end
                end
            end
        end
    end

    table.sort(spellsToBuy)
    local lastId
    local start, finish, step = 1, #spellsToBuy, 1
    if forever then
        -- Buying from the end preserves trainer indices when the list shrinks.
        start, finish, step = #spellsToBuy, 1, -1
    end
    for i = start, finish, step do
        local id = spellsToBuy[i]
        if id ~= lastId then BuyTrainerService(id) end
        lastId = id
    end
end

` + text.slice(end);
    text = replaceOnce(text, `function addon.LegacyUpdateLoop()
    -- NewTicker calls function every updateFrequency, making diff/updateTick/tickRate logic obsolete
`, `function addon.LegacyUpdateLoop()
    -- NewTicker calls function every updateFrequency, making diff/updateTick/tickRate logic obsolete
    local profile = addon.settings.profile
    if profile.standbyMode and not profile.showEnabled then return end

`, 'паузу скрытого маршрута');
  }
  if (path === 'LevelingTracker.lua') {
    text = replaceOnce(text, 'local playerName = UnitName("player")', 'local playerName = addon.player.name', 'имя в трекере прокачки');
  }
  if (path === 'QuestLog.lua') {
    text = replaceOnce(text, '            local group = list.defaultGroup_', `            if not list and guide.group then list = addon.guideList["*" .. guide.group] end
            list = list or {}
            local group = list.defaultGroup_`, 'журнал отсутствующей группы маршрутов');
  }
  if (path === 'GuideLoader.lua') {
    const start = text.indexOf('local importChunkSize = 4096\n');
    const end = text.indexOf('local function CompressDeflate(str)\n', start);
    if (start < 0 || end < start) throw new Error('Не найдена граница импортера.');
    text = text.slice(0, start) + `local function CheckDataIntegrity(str, checksum)
    if not checksum then return addon.A32(str) end
    return false, addon.locale.Get("Update guides with the launcher's Update guides button, then /reload.")
end

` + text.slice(end);
    const cacheStart = text.indexOf('local cachedData = {}\n');
    const cacheEnd = text.indexOf('local function LoadGuide(guideData,n)\n', cacheStart);
    if (cacheStart < 0 || cacheEnd < cacheStart) throw new Error('Не найдена граница кэша.');
    text = text.slice(0, cacheStart) + `function addon.ReadCacheData(mode)
    if mode == "number" then return 1 end
    if mode == "string" then return "1" end
end

` + text.slice(cacheEnd);
    text = replaceOnce(text, 'guide.displayname = addon.settings.ReplaceColors(guide.displayname or guide.name)',
      'guide.displayname = addon.LocalizeGuideName(addon.settings.ReplaceColors(guide.displayname or guide.name))', 'названия маршрутов');
    text = replaceOnce(text, 'addon.guideImporter.lastBNetQuery = 0\n', '', 'таймер Battle.net');
    text = replaceOnce(text, 'if name and group and addon.guides[group .. "||" .. name] then',
      'if name and group and addon.guides[group .. "||" .. name] and not addon.guides[group .. "||" .. name].imported then',
      'приоритет импортированного маршрута');
  }
  if (path === 'UI/V2/GuideImporter.lua') {
    text = replaceOnce(text,
      '    local relog = not RXPData.cache and "\\n" .. addon.locale.Get("Please restart your game client and try again") or ""',
      '    local relog = ""', 'сообщение импортера');
    const start = text.indexOf('function addon.guideImporter:CheckBattleNet()\n');
    const end = text.indexOf('local function addHistoryEntry(', start);
    if (start < 0 || end < start) throw new Error('Не найден запрос Battle.net.');
    text = text.slice(0, start) + text.slice(end);
    text = replaceOnce(text, '    self:CheckBattleNet()\n', '', 'опрос Battle.net');
    text = replaceOnce(text, 'not self.importReady or not RXPData.cache', 'not self.importReady', 'кнопку импорта');
    text = replaceOnce(text, `    if not RXPData.cache then
        guideImporter:UpdateImportStatusHistory(
            L("Battle.net unreachable, please exit your client, restart Battle.net, and try again"), true)
    end
`, '', 'предупреждение Battle.net');
  }
  if (path === 'DB/shared.lua') {
    text = replaceOnce(text, 'addon.base = {66,78,71,101,116,73,110,102,111}', '', 'обфусцированное имя API');
  }
  if (path === 'Communications.lua') {
    text = replaceOnce(text, 'f:SetTitle("RestedXP: " .. title)', 'f:SetTitle("DiscordicXP: " .. title)', 'название окна сообщений');
    text = replaceOnce(text, `    -- Update Feedback Report into GuideWindow context menu, load order workaround
    for i, m in ipairs(addon.RXPFrame.bottomMenu) do
        if m.text == L("Give Feedback for step") then
            addon.RXPFrame.bottomMenu[i].func = addon.comms.OpenBugReport
            break
        end
    end

`, '', 'обработчик обратной связи');
    const start = text.indexOf('function addon.comms.OpenBugReport(stepNumber)\n');
    const end = text.indexOf('function addon.comms.OpenBrandedExport(', start);
    if (start < 0 || end < start) throw new Error('Не найдена форма обратной связи.');
    text = text.slice(0, start) + text.slice(end);
  }
  if (path === 'SettingsPanel.lua') {
    text = replaceOnce(text, '        showEnabled = true,', '        showEnabled = true,\n        standbyMode = false,', 'настройку паузы');
    text = replaceOnce(text, '                    featuresHeader = {\n', `                    standbyMode = {
                        name = L("Enable Standby Mode"),
                        desc = L("Pause guide processing when addon is hidden."),
                        type = "toggle",
                        width = optionsWidth,
                        order = 1.4,
                    },
                    featuresHeader = {
`, 'переключатель паузы в общих настройках');
    text = replaceOnce(text, '        label = addonName,', '        label = "DiscordicXP",', 'название на миникарте');
    text = replaceOnce(text, `                        order = 3.10,
                        set = function(info, value)
                            SetProfileOption(info, value)
                            if addon.targeting.activeTargetFrame and
                                not InCombatLockdown() then
                                addon.targeting.activeTargetFrame:Hide()
                            end`, `                        order = 3.10,
                        set = function(info, value)
                            addon.SetNpcWindowEnabled(value)`, 'переключатель окна NPC');
    text = replaceOnce(text, "activeTheme = 'RXP Blue',", "activeTheme = 'Forever',", 'тему');
    text = replaceOnce(text, 'enableV2Interface = false,', 'enableV2Interface = true,', 'интерфейс');
    text = replaceOnce(text, 'guideFontSize = 9,', 'guideFontSize = 11,', 'размер текста');
    text = replaceOnce(text, 'anchorOrientation = "top",', 'anchorOrientation = "bottom",', 'положение текущих шагов');
    text = replaceOnce(text, 'self:RegisterChatCommand("rxp", self.ChatCommand)', 'self:RegisterChatCommand("dxp", self.ChatCommand)', 'команду');
    text = replaceOnce(text, 'self:RegisterChatCommand("rxpg", self.ChatCommand)', 'self:RegisterChatCommand("dguide", self.ChatCommand)', 'короткую команду');
    text = replaceOnce(text, `    elseif input == "bug" or input == "feedback" then
        addon.comms.OpenBugReport()
`, '', 'команды обратной связи');
    const discordStart = text.indexOf('            discordButton = {\n');
    const importStart = text.indexOf('            importGuidesButton = {\n', discordStart);
    if (discordStart < 0 || importStart < discordStart) throw new Error('Не найдена кнопка Discord.');
    text = text.slice(0, discordStart) + text.slice(importStart);
    const feedbackStart = text.indexOf('            feedbackButton = {\n');
    const resetStart = text.indexOf('            resetGuideProgressTop = {\n', feedbackStart);
    if (feedbackStart < 0 || resetStart < feedbackStart) throw new Error('Не найдены кнопки обратной связи и конфигуратора.');
    text = text.slice(0, feedbackStart) + text.slice(resetStart);
    const importButtonStart = text.indexOf('            importGuidesButton = {\n');
    const progressStart = text.indexOf('            resetGuideProgressTop = {\n', importButtonStart);
    if (importButtonStart < 0 || progressStart < importButtonStart) throw new Error('Не найдена кнопка импорта гайдов.');
    text = text.slice(0, importButtonStart) + text.slice(progressStart);
    text = replaceOnce(text, '                    enableVendorTreasure = {\n', `                    hideNpcWindow = {
                        order = 2.41,
                        name = L("Hide NPC Selection window"),
                        desc = L("Hide NPC target buttons without hiding the guide."),
                        type = "toggle",
                        width = optionsWidth,
                        get = function() return not self.profile.enableTargetFrame end,
                        set = function(_, value) addon.SetNpcWindowEnabled(not value) end
                    },
                    enableVendorTreasure = {
`, 'отключение окна NPC рядом с окном предметов');
    text = replaceOnce(text, `    -- Theme load order, leave default settings branding unthemed
    f.icon:SetTexture("Interface/AddOns/" .. addonName ..
                          "/Textures/rxp_logo-64")`,
    '    f.icon:SetTexture("Interface/Icons/INV_Misc_Map_01")', 'значок личных настроек');
    text = replaceOnce(text, `    tinsert(menu, {
        text = L("Open Feedback Form"),
        notCheckable = 1,
        func = function() addon.comms.OpenBugReport() end
    })

`, '', 'форму обратной связи на карте');
  }
  if (path === 'GuideWindow.lua') {
    text = replaceOnce(text, `    if not useV2GuideWindow then
        ClearFrameData()
        addon.v2:ClearActiveStepEventWatchers()
    end`, `    if useV2GuideWindow then
        local playerState = addon.v2.state.player[addon.player.name]
        if playerState and playerState.childContainer then
            playerState.childContainer:ReleaseChildren()
            playerState.activeStepItemsByKey = nil
            playerState.activeStepItems = nil
        end
        addon.v2:ClearActiveStepEventWatchers()
    else
        ClearFrameData()
    end`, 'очистку закреплённых целей при смене шага');
    text = replaceOnce(text, `    tinsert(menuList, {
        text = L("Import guide"),
        notCheckable = 1,
        func = function()
            addon.guideImporter:Open()
        end
    })

`, '', 'импорт в меню маршрута');
    text = replaceOnce(text, `    if not addon.settings.profile.enableBetaFeatures then
        return
    end

    if player == addon.player.name and not addon.v2:IsGuideWindowEnabled() then`,
    `    if not addon.settings.profile.enableBetaFeatures and player ~= addon.player.name then
        return
    end

    if player == addon.player.name and not addon.v2:IsGuideWindowEnabled() then`, 'локальные текущие шаги');
    text = replaceOnce(text, `function addon.v2:UpdateActiveStepsFrame(steps, questId)
    if not addon.settings.profile.enableBetaFeatures then`,
    `function addon.v2:UpdateActiveStepsFrame(steps, questId)
    if self.state.updatingActiveStepEventWatchers then
        addon.updateStepText = true
        return
    end

    if not addon.settings.profile.enableBetaFeatures and not self:IsGuideWindowEnabled() then`, 'обработчики целей');
    text = replaceOnce(text, '    watcher:SetElements(watcherStep, true)',
      `    self.state.updatingActiveStepEventWatchers = true
    local success, err = pcall(watcher.SetElements, watcher, watcherStep, true)
    self.state.updatingActiveStepEventWatchers = nil
    if not success then error(err, 0) end`, 'защиту от повторного обновления целей');
    text = replaceOnce(text, 'if payloadReady and addon.comms.grouping:CanBroadcastCurrentStep() then',
      'if addon.settings.profile.enableBetaFeatures and payloadReady and addon.comms.grouping:CanBroadcastCurrentStep() then',
      'условие групповой отправки');
    text = replaceOnce(text, `    }, { -- Give Feedback for step, updated by addon.comms:Setup()
        notCheckable = 1,
        text = L("Give Feedback for step")
    },
`, '    },\n', 'обратную связь в меню шага');
    text = replaceOnce(text, `    -- Lookup feedbackMenuIndex, avoid dynamic/future menu change conflicts
    local feedbackMenuIndex
    for i, m in ipairs(addon.RXPFrame.bottomMenu) do
        if m.text == L("Give Feedback for step") then
            feedbackMenuIndex = i
            break
        end
    end

`, '', 'поиск удалённого пункта обратной связи');
    text = replaceOnce(text, '                    bottomMenu[feedbackMenuIndex].arg1 = n\n', '',
      'обработчик меню шага без обратной связи');
    text = replaceOnce(text, `    tinsert(menuList, {
        text = L("Open Feedback Form"),
        notCheckable = 1,
        func = function() addon.comms.OpenBugReport() end
    })

`, '', 'форму обратной связи в меню маршрута');
  }
  if (path === 'Help.lua') {
    text = replaceOnce(text, '|cff909090/rxp bug||feedback|r - Open Feedback Form\n', '', 'справку без внешней обратной связи');
  }
  if (path === 'UI/V2/Core.lua') {
    text = replaceOnce(text, `        for _, item in ipairs(menu) do
            if item.text == addon.locale.Get("Give Feedback for step") then
                item.arg1 = this.index
                break
            end
        end

`, '', 'обратную связь в новом меню шага');
    text = replaceOnce(text, 'return profile and profile.enableBetaFeatures and profile.enableV2Interface',
      'return profile and profile.enableV2Interface', 'стабильный интерфейс Forever');
    text = replaceOnce(text, `local frame = CreateFrame("Frame", nil, addon.RXPFrame or UIParent)
        frame:Hide()`, `local frame = CreateFrame("Frame", nil, addon.RXPFrame or UIParent)
        frame:Hide()
        frame:SetClampedToScreen(true)`, 'видимость блока текущих целей на экране');
  }
  if (path === 'functions.lua') {
    text = replaceOnce(text, '    local event,msg = ...', '    local event,msg,arg2,arg3,arg4,arg5 = ...', 'получателя предмета');
    text = replaceOnce(text, 'if event == "CHAT_MSG_LOOT" and C_Item and C_Item.GetItemInfo then',
      'if event == "CHAT_MSG_LOOT" and C_Item and C_Item.GetItemInfo and arg5 == addon.player.name then',
      'учёт только собственного лута');
    text = text.replaceAll(`            local questId = tonumber(v)
            if questId then
                ids[i] = GetQuestId(questId)
                addon.InsertQuestGuide(ids[i],addon.pickUpList)
            else
                err = true
                break
            end`, `            local questId = tonumber(v)
            questId = questId and GetQuestId(questId)
            if not questId then
                err = true
                break
            end
            ids[i] = questId
            addon.InsertQuestGuide(questId,addon.pickUpList)`);
    text = replaceOnce(text, '        if RXPCData.skipDailies and element.tag == "daily" then',
      '        if not (element and element.ids) then return end\n        if RXPCData.skipDailies and element.tag == "daily" then',
      'проверку данных ежедневного задания');
    text = replaceOnce(text, '    if RXPCData.skipDailies and element.tag == "dailyturnin" then',
      '    if not (element and element.ids) then return end\n    if RXPCData.skipDailies and element.tag == "dailyturnin" then',
      'проверку данных сдачи ежедневного задания');
    text = replaceOnce(text, '        local id = GetQuestId(element.questId,nil,true)\n',
      '        local id = GetQuestId(element.questId,nil,true)\n        if not id then return end\n', 'проверку ID сдаваемого задания');
    text = replaceOnce(text, 'if not addon.IsSecretValue(arStart) and not addon.IsSecretValue(arDuration) then',
      'if arStart and arDuration and not addon.IsSecretValue(arStart) and not addon.IsSecretValue(arDuration) then',
      'пустой откат Astral Recall');
    text = replaceOnce(text, '                stat = GetInventoryItemQuality("player", element.slot)', `                stat = GetInventoryItemQuality and GetInventoryItemQuality("player", element.slot)
                if not stat then
                    local itemID = GetInventoryItemID("player", element.slot)
                    if itemID then
                        _, _, stat = GetItemInfo(itemID)
                    end
                end`, 'совместимость API качества предмета');
    text = replaceOnce(text, 'not element.found andL"Step skipped: Quest is not being offered"',
      'not element.found and L("Step skipped: Quest is not being offered")', 'сообщение пропущенного задания');
    text = replaceOnce(text, 'local NPCNames = {}', `local NPCNames = {}
local NPCNameTooltip = CreateFrame("GameTooltip", "RXPNPCNameTooltip", UIParent, "GameTooltipTemplate")`, 'скрытую подсказку поиска NPC');
    const start = text.indexOf('function addon.GetNpcName(id)\n');
    const end = text.indexOf('function addon.ReplaceNpcIds(', start);
    if (start < 0 || end < start) throw new Error('Не найден поиск имени NPC.');
    let lookup = text.slice(start, end)
      .replaceAll('GameTooltipTextLeft1:GetText()', '_G.RXPNPCNameTooltipTextLeft1:GetText()')
      .replaceAll(/\bGameTooltip\b/g, 'NPCNameTooltip')
      .replace('SetOwner(WorldFrame, "ANCHOR_BOTTOMRIGHT")', 'SetOwner(UIParent, "ANCHOR_NONE")');
    lookup = replaceOnce(lookup, `        local name
        if NPCNameTooltip:IsShown() then
            name = _G.RXPNPCNameTooltipTextLeft1:GetText()`, `        local name = _G.RXPNPCNameTooltipTextLeft1:GetText()
        if name and name ~= "" then`, 'чтение имени из скрытой подсказки');
    text = text.slice(0, start) + lookup + text.slice(end);
    text = replaceOnce(text, 'return addon.GetNpcName(tonumber(id)) or name',
      'return addon.GetNpcName(tonumber(id), name) or name', 'имя NPC из текста маршрута');
    text = replaceOnce(text, 'local newName = addon.GetNpcName(tonumber(npcId))',
      'local newName = addon.GetNpcName(tonumber(npcId), name)', 'названия NPC в подсказках');
    text = replaceOnce(text, 'local function CheckNpcIds(element,t)\n', `local function CheckNpcIds(element,t)
    element.npcIds = {}
    element.npcFallbacks = {}
`, 'отдельные ID NPC');
    text = replaceOnce(text, '        if name and addon.player.lang == "en" then', `        if id then
            element.npcIds[i] = id
            element.npcFallbacks[i] = name
            if addon.names then addon.names:RegisterNpc(id, name) end
        end
        if name and addon.player.lang == "en" then`, 'исходные имена NPC');
    text = replaceOnce(text, '            local name --= addon.GetNpcName(id)',
      '            local name = addon.names and addon.names:GetKnown("npc", id, name)', 'русский справочник NPC');
    text = replaceOnce(text, '                t[i] = tostring(id)\n                element.update = true',
      '                t[i] = name or element.npcFallbacks[i] or tostring(id)\n                element.update = true', 'имя из гайда вместо ID');
    text = replaceOnce(text, 'local function UpdateNpcNames(element)\n', `local function UpdateNpcNames(element)
    if addon.names then return addon.names:ResolveTargets(element) end
`, 'повторный поиск имён без ожидания события');
  }
  if (path === 'Locale.lua') {
    const start = text.indexOf('-- TODO check if L returned language, remove explicit list\n');
    const end = text.indexOf('\nfunction addon.locale.AddGenericTranslation(', start);
    if (start < 0 || end < start) throw new Error('Не найден выбор языка интерфейса.');
    text = text.slice(0, start) + `-- AceLocale selects the client language, falling back to English.
-- Only display text is branded; guide keys and SavedVariables keep their identity.
addon.locale.Get = function(text)
    local translated = getForeign(text)
    if type(translated) == "string" then return (translated:gsub("DiscodicXP", "DiscordicXP")) end
    return translated
end
` + text.slice(end);
  }
  if (path === 'Targeting.lua') {
    text = replaceOnce(text, `function addon.targeting:UpdateTargetFrame(selector)
    if not addon.settings.profile.enableTargetFrame then return end`, `function addon.targeting:UpdateTargetFrame(selector)
    if not addon.settings.profile.enableTargetFrame then
        if self.activeTargetFrame and not InCombatLockdown() then self.activeTargetFrame:Hide() end
        return
    end`, 'скрытие отключённого окна NPC после боя');
  }
  if (path === 'Themes.lua') {
    text = text.replaceAll('font = _G.GameFontNormal:GetFont(),',
      'font = "Interface/AddOns/" .. addonName .. "/Fonts/FiraSans-Regular.ttf",');
  }
  return rebrand(text);
}

function safeMember(root, member) {
  const path = resolve(root, member.replaceAll('\\', '/'));
  const part = relative(root, path);
  if (isAbsolute(part) || part === '..' || part.startsWith(`..${sep}`)) {
    throw new Error('Файл выходит за пределы каталога аддона.');
  }
  return path;
}

function createHeaderTexture() {
  const width = 256;
  const height = 64;
  const bytes = Buffer.alloc(18 + width * height * 4);
  bytes[2] = 2;
  bytes.writeUInt16LE(width, 12);
  bytes.writeUInt16LE(height, 14);
  bytes[16] = 32;
  bytes[17] = 0x28;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const glow = (1 - x / width) * (1 - y / height);
      const offset = 18 + (y * width + x) * 4;
      const color = y === height - 1 ? [120, 89, 43] : [28 + glow * 18, 20 + glow * 10, 13 + glow * 4];
      bytes[offset] = color[2];
      bytes[offset + 1] = color[1];
      bytes[offset + 2] = color[0];
      bytes[offset + 3] = 255;
    }
  }
  return bytes;
}

export async function build({ source, starterSource = source, output = resolve(projectRoot, 'dist/DiscodicXP') }) {
  source = resolve(source);
  starterSource = resolve(starterSource);
  output = resolve(output);
  const upstreamToc = await readFile(resolve(source, 'RXPGuides.toc'), 'utf8');
  if (!/^## Version: v4\.11\.23\s*$/m.test(upstreamToc)) {
    throw new Error('Эта сборка проверена для RestedXP v4.11.23. Другую версию нужно сначала проверить.');
  }
  if (existsSync(output)) throw new Error('Каталог сборки уже существует. Укажите новый --output.');
  const knowledge = validateKnowledge(JSON.parse(await readFile(resolve(projectRoot, 'data/names.ruRU.json'), 'utf8')));
  const entries = upstreamToc.split(/\r?\n/).filter(line => {
    if (!line.trim() || line.startsWith('#') || line.startsWith('lang/') || line.startsWith('Guides/GuideList-')) return false;
    const games = line.match(/\[AllowLoadGameType ([^\]]+)\]/)?.[1];
    return !games || games.split(',').includes('camelot');
  }).map(line => line.replace(/\s*\[AllowLoadGameType[^\]]+\]/, '').trim().replaceAll('\\', '/'));
  const files = new Map();
  async function collect(member, parent = '') {
    let path = safeMember(source, member);
    if (!existsSync(path)) path = safeMember(source, resolve(dirname(safeMember(source, parent)), member));
    const name = relative(source, path).split(sep).join('/');
    if (files.has(name)) return;
    const bytes = await readFile(path);
    files.set(name, bytes);
    if (extname(name).toLowerCase() === '.xml') {
      const xml = bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
      for (const match of xml.matchAll(/<(?:Script|Include)\s+file=["']([^"']+)["']/g)) {
        await collect(match[1].replaceAll('\\', '/'), name);
      }
    }
  }
  for (const entry of entries) await collect(entry);
  await collect('Bindings.xml');
  const starterToc = await readFile(resolve(starterSource, 'RXPGuides.toc'), 'utf8');
  const starterVersion = starterToc.match(/^## Version: (v[\d.]+)\s*$/m)?.[1];
  if (!starterVersion) throw new Error('Не найдена версия источника стартовых гайдов.');
  const starterEntries = [];
  let starterGuides = 0;
  for (const name of ['RestedXP-Skyborne.lua', 'Horde-01-12_Durotar.lua', 'Horde-01-14_Undead.lua',
    'Horde-1-12_Mulgore.lua', 'Horde-12-22_Barrens.lua', 'Horde-Mage-12-21.lua']) {
    const code = await readFile(safeMember(starterSource, `Guides/forever/${name}`));
    const count = [...code.toString('utf8').matchAll(/RXPGuides\.RegisterGuide\(/g)].length;
    if (!count) throw new Error(`Не найдены стартовые маршруты в ${name}.`);
    const path = `Guides/Starters/${name}`;
    files.set(path, code);
    starterEntries.push(path);
    starterGuides += count;
  }
  async function collectDirectory(dir) {
    for (const entry of await readdir(resolve(source, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await collectDirectory(path);
      else files.set(path, await readFile(resolve(source, path)));
    }
  }
  await collectDirectory('Textures');
  for (const directory of ['libs', 'locale']) {
    for (const entry of await readdir(resolve(source, directory), { recursive: true })) {
      if (/licen[cs]e|copying/i.test(entry)) {
        const name = `${directory}/${entry.replaceAll('\\', '/')}`;
        files.set(name, await readFile(resolve(source, name)));
      }
    }
  }
  for (const name of ['FiraSans-Regular.ttf', 'OFL.txt', 'README.md']) {
    files.set(`Fonts/${name}`, await readFile(resolve(projectRoot, 'addon/Fonts', name)));
  }
  await mkdir(output, { recursive: true });
  for (const [name, bytes] of files) {
    const destination = resolve(output, rebrand(name));
    await mkdir(dirname(destination), { recursive: true });
    const isCode = ['.lua', '.xml'].includes(extname(name).toLowerCase());
    await writeFile(destination, isCode ? patchSource(name, bytes.toString('utf8')) : bytes);
  }
  for (const name of ['Language.lua', 'ForeverTheme.lua', 'GuideUpdates.lua', 'NameResolver.lua', 'SyncIdentity.lua', 'Preferences.lua', 'Commands.lua']) {
    await mkdir(resolve(output, 'Discodic'), { recursive: true });
    await writeFile(resolve(output, 'Discodic', name), await readFile(resolve(projectRoot, 'addon', name)));
  }
  await writeFile(resolve(output, 'Discodic/NameKnowledge.lua'), knowledgeLua(knowledge));
  await mkdir(resolve(output, 'Textures/Forever'), { recursive: true });
  await writeFile(resolve(output, 'Textures/Forever/header.tga'), createHeaderTexture());
  const guideSource = 'local _, addon = ...\naddon.launcherGuideDigest = ""\n';
  await mkdir(resolve(output, 'UserGuides'), { recursive: true });
  await writeFile(resolve(output, 'UserGuides/ForeverHorde.lua'), guideSource);
  const tocEntries = entries.map(rebrand);
  tocEntries.splice(tocEntries.indexOf('Locale.lua') + 1, 0, 'Discodic/Language.lua');
  tocEntries.splice(tocEntries.indexOf('Themes.lua') + 1, 0, 'Discodic/ForeverTheme.lua');
  tocEntries.splice(tocEntries.indexOf('functions.lua') + 1, 0, 'Discodic/NameKnowledge.lua', 'Discodic/NameResolver.lua');
  tocEntries.push(...starterEntries.map(rebrand), 'Discodic/GuideUpdates.lua', 'UserGuides/ForeverHorde.lua', 'Discodic/SyncIdentity.lua', 'Discodic/Preferences.lua', 'Discodic/Commands.lua');
  const toc = `## Interface: 16001
## Title: DiscordicXP |cffe0bd7aForever|r
## Notes: WoW Forever leveling guides. Interface follows the client language.
## Notes-ruRU: Маршруты прокачки WoW Forever. Интерфейс под язык клиента.
## Author: DiscordicXP
## Version: 0.5.4
## Category: Quests
## Category-ruRU: Задания
## OptionalDeps: Questie
## SavedVariables: DXPData, DXPDB, DXPSettings, DXPString
## SavedVariablesPerCharacter: DXPCData, DXPCTrackingData, DXPCComms, DXPCSettings

${tocEntries.join('\n')}
`;
  await writeFile(resolve(output, 'DiscodicXP.toc'), toc);
  await writeFile(resolve(output, 'LICENSE'), await readFile(resolve(source, 'LICENSE')));
  await writeFile(resolve(output, 'NOTICE.txt'), await readFile(resolve(projectRoot, 'NOTICE.txt')));
  const manifest = {
    addon: 'DiscodicXP', displayName: 'DiscordicXP', version: '0.5.4', interface: 16001, guideUpdates: 1,
    engine: 'RestedXP v4.11.23', engineFixes: 'RestedXP v4.11.32', guides: 0,
    starterGuides, starterSource: `RestedXP ${starterVersion}`,
    guideDigest: createHash('sha256').update(guideSource).digest('hex'),
    runtimeAccountBinding: false,
    nameKnowledge: { revision: knowledge.revision, npc: Object.keys(knowledge.npc).length, quest: Object.keys(knowledge.quest).length },
  };
  await writeFile(resolve(output, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, ...manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--starter-source', '--output'].includes(args[i]) || !args[i + 1]) {
      throw new Error('Аргументы: --source <RXPGuides> [--starter-source <RXPGuides>] [--output <новый каталог>]');
    }
    options[args[i] === '--starter-source' ? 'starterSource' : args[i].slice(2)] = args[i + 1];
  }
  if (!options.source) throw new Error('Нужен --source.');
  try {
    console.log(JSON.stringify(await build(options), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
