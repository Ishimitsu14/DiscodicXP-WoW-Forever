local _, addon = ...

local names = {pending = {}, english = {}, indexes = {}}
addon.names = names

local originalNpcName = addon.GetNpcName
local originalQuestName = addon.GetQuestName
local originalCreatureName = addon.GetCreatureName
local russianClient = GetLocale() == "ruRU"

local function russian(text)
    return type(text) == "string" and text ~= _G.UNKNOWN and text ~= _G.RETRIEVING_DATA
        and text:find("[\208\209][\128-\191]") ~= nil
end

local function normalized(text)
    return type(text) == "string" and text:match("^%s*(.-)%s*$"):lower():gsub("%s+", " ") or nil
end

local function cache()
    DXPData = DXPData or {}
    DXPData.nameCache = DXPData.nameCache or {}
    local key = (addon.game or "FOREVER") .. ":" .. GetLocale()
    local data = DXPData.nameCache[key]
    if type(data) ~= "table" or data.version ~= 1 or type(data.npc) ~= "table" or type(data.quest) ~= "table" then
        data = {version = 1, npc = {}, quest = {}}
        DXPData.nameCache[key] = data
    end
    return data
end

function names:RegisterNpc(id, english)
    if type(english) == "string" and english ~= "" and not russian(english) then
        self.english[id] = english
    end
end

function names:GetKnown(kind, id, english)
    if not russianClient then return end
    local saved = cache()[kind][id]
    if russian(saved) then return saved end
    local localName = kind == "npc" and addon.npcNames and addon.npcNames[english]
    if russian(localName) then return localName end
    local rows = addon.nameKnowledge and addon.nameKnowledge[kind]
    if not rows then return end
    local entry = rows[id]
    local key = normalized(english)
    if entry and (not key or key == normalized(entry[1])) then return entry[2] end
    if not key then return end
    local index = self.indexes[kind]
    if not index then
        index = {}
        for _, row in pairs(rows) do
            local name = normalized(row[1])
            if index[name] == nil then index[name] = row[2]
            elseif index[name] ~= row[2] then index[name] = false end
        end
        self.indexes[kind] = index
    end
    return index[key] or nil
end

addon.GetNpcName = function(id, english)
    names:RegisterNpc(id, english)
    local current = originalNpcName(id)
    if not russianClient then return current end
    if russian(current) then
        cache().npc[id] = current
        return current
    end
    return names:GetKnown("npc", id, english or names.english[id])
end

addon.GetQuestName = function(id)
    local current = originalQuestName(id)
    if not russianClient then return current end
    if russian(current) then
        cache().quest[id] = current
        return current
    end
    return names:GetKnown("quest", id, current) or current
end

addon.GetCreatureName = function(value)
    local current = originalCreatureName(value)
    if not russianClient or russian(current) then return current end
    local id = tonumber(value)
    return names:GetKnown("npc", id, id and names.english[id] or value) or current
end

function names:Schedule()
    if self.scheduled or not next(self.pending) then return end
    self.scheduled = true
    C_Timer.After(1.6, function()
        self.scheduled = false
        if InCombatLockdown() then return end
        local elements = {}
        for element in pairs(self.pending) do elements[#elements + 1] = element end
        for _, element in ipairs(elements) do self:ResolveTargets(element, true) end
        self:Schedule()
    end)
end

function names:ResolveTargets(element, retry)
    if not element.npcIds or not element.step or not element.step.active then
        self.pending[element] = nil
        return
    end
    if InCombatLockdown() then
        self.pending[element] = self.pending[element] or 0
        return
    end
    local changed, pending
    for index, id in pairs(element.npcIds) do
        local fallback = element.npcFallbacks[index]
        local name = addon.GetNpcName(id, fallback)
        if not russianClient and addon.player.lang == "en" then name = fallback or name end
        local display = name or fallback or ("NPC " .. id)
        if element.unitlist[index] ~= display then
            element.unitlist[index] = display
            changed = true
        end
        if not name then pending = true end
    end
    element.update = pending or nil
    local attempts = self.pending[element] or 0
    if retry then attempts = attempts + 1 end
    self.pending[element] = pending and attempts < 12 and attempts or nil
    if changed then
        addon:ScheduleTask(addon.targeting.UpdateUnitList)
    end
    self:Schedule()
end

function names:RefreshActive()
    local steps = addon.DXPFrame and addon.DXPFrame.activeSteps or {}
    for _, step in pairs(steps) do
        if step.active then
            for _, element in pairs(step.elements or {}) do
                if element.npcIds then
                    self.pending[element] = nil
                    self:ResolveTargets(element)
                end
            end
        end
    end
end

local frame = CreateFrame("Frame")
for _, event in ipairs({"PLAYER_TARGET_CHANGED", "UPDATE_MOUSEOVER_UNIT", "NAME_PLATE_UNIT_ADDED", "QUEST_DATA_LOAD_RESULT", "QUEST_LOG_UPDATE", "PLAYER_REGEN_ENABLED"}) do
    if not C_EventUtils or C_EventUtils.IsEventValid(event) then frame:RegisterEvent(event) end
end
frame:SetScript("OnEvent", function() names:RefreshActive() end)
