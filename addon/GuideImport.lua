local _, addon = ...
local LibDeflate = LibStub("LibDeflate")

addon.localGuideImport = {}
local importer = addon.localGuideImport
local originalAddGuide = addon.AddGuide

function addon.AddGuide(guide)
    if guide then
        addon.GroupOverride(guide)
        local existing = addon.guides[guide.group .. "||" .. guide.name]
        if existing and existing.imported and not guide.imported then return true end
    end
    return originalAddGuide(guide)
end

local parsingFields = {"guide", "step", "lastObjective", "lastElement", "currentGuideName", "currentGuideGroup",
                       "lastGuideName", "lastGuideGroup", "minGuideVersion", "maxGuideVersion", "farmGuides", "error"}

function importer:Prepare(sources, yieldImport)
    local entries, seen = {}, {}
    for index, source in ipairs(sources) do
        source = source:gsub("%s-[\r\n]+%s*", "\n"):gsub("[\t ][\t ]+", " "):gsub("%-%-[^\n]*", "")
        source = "--" .. addon.ReadCacheData("string") .. "\n" .. source
        local saved = {}
        for _, key in ipairs(parsingFields) do saved[key] = addon[key] end
        addon.error = function(message) error(message, 0) end
        local ok, guide, parseError, metadata = pcall(addon.ParseGuide, source)
        for _, key in ipairs(parsingFields) do addon[key] = saved[key] end
        if not ok then error("Ошибка разбора раздела " .. index .. ": " .. tostring(guide), 0) end
        if not guide or not guide.name or not guide.group or parseError == "#0" then
            error("Раздел " .. index .. " не подходит для WoW Forever или содержит ошибку.", 0)
        end
        if parseError and addon.applies(guide.enabledFor) then error(tostring(parseError), 0) end
        guide.name = guide.name:gsub("^(%d)-(%d%d?)", addon.affix)
        guide.key = guide.key or addon.BuildGuideKey(guide)
        if seen[guide.key] then error("В файле повторяется раздел: " .. guide.name, 0) end
        seen[guide.key] = true
        guide.imported = true
        local compressed = LibDeflate:CompressDeflate(source)
        if not compressed then error("Не удалось сохранить раздел: " .. guide.name, 0) end
        entries[#entries + 1] = {
            guide = guide, applicable = not parseError,
            cache = addon.BuildCacheObject(compressed, guide.enabledFor, guide.version, metadata, guide.key)
        }
        if yieldImport then yieldImport("Проверка разделов: " .. index .. "/" .. #sources) end
    end
    if #entries == 0 then error("В файле нет маршрутов.", 0) end
    return entries
end

function importer:Commit(entries)
    if InCombatLockdown() then error("Завершите бой и повторите импорт.", 0) end
    local keys, changed, skipped = {}, {}, 0
    for _, entry in ipairs(entries) do
        local guide = entry.guide
        local current = addon.guides[guide.group .. "||" .. guide.name]
        local latest = current and tonumber(current.version) or 0
        for _, cached in pairs(addon.db.profile.guides) do
            if cached.key == guide.key then latest = math.max(latest, tonumber(cached.version) or 0) end
        end
        if (tonumber(guide.version) or 0) < latest then
            skipped = skipped + 1
        else
            keys[guide.key] = true
            changed[#changed + 1] = entry
        end
    end
    local cachedGuides = {}
    for key, cached in pairs(addon.db.profile.guides) do
        local guideKey = cached.key or key:match("^[^|]+|[^|]-|[^|]+")
        if not keys[guideKey] then cachedGuides[key] = cached end
    end
    for _, entry in ipairs(changed) do cachedGuides[entry.guide.key .. "|local"] = entry.cache end
    local snapshot = {}
    for _, key in ipairs({"guides", "guideList", "guideIds", "guideCache", "condenseGroups", "groupAlias"}) do
        snapshot[key] = addon[key]
        if key == "guideList" then
            addon[key] = CopyTable(addon[key])
        else
            local copy = {}
            for k, v in pairs(addon[key] or {}) do copy[k] = v end
            addon[key] = copy
        end
    end
    local previousCache, previousDefault = addon.db.profile.guides, addon.defaultGuide
    addon.db.profile.guides = cachedGuides
    local ok, failure = pcall(function()
        for _, entry in ipairs(changed) do
            addon.guideCache[entry.guide.key] = nil
            if entry.applicable then assert(addon.AddGuide(entry.guide), "Не удалось добавить маршрут.") end
        end
    end)
    if not ok then
        for key, value in pairs(snapshot) do addon[key] = value end
        addon.db.profile.guides = previousCache
        addon.defaultGuide = previousDefault
        error(failure, 0)
    end
    return #changed, skipped
end

function importer:Cancel()
    self.job = nil
    if self.worker then self.worker:SetScript("OnUpdate", nil) end
end

function importer:Start(text, fileName, callback)
    if self.job then return false, "Импорт уже выполняется." end
    if InCombatLockdown() then return false, "Импорт доступен после боя." end
    local key = DXPData.guideImportKey or addon.defaultGuideImportKey
    if fileName and fileName:match("%S") then
        local message
        key, message = addon.guideCodec.KeyFromFileName(fileName)
        if not key then return false, message end
    end
    local job = coroutine.create(function()
        local sources = addon.guideCodec.Decode(text, key, coroutine.yield)
        return self:Prepare(sources, coroutine.yield)
    end)
    self.job = job
    self.worker = self.worker or CreateFrame("Frame")
    self.worker:SetScript("OnUpdate", function()
        local ok, result = coroutine.resume(job)
        if self.job ~= job then return end
        if not ok then
            self:Cancel()
            callback(false, tostring(result))
        elseif coroutine.status(job) ~= "dead" then
            callback(nil, result)
        else
            self:Cancel()
            local committed, updated, skipped = pcall(self.Commit, self, result)
            if not committed then callback(false, tostring(updated)); return end
            if key then DXPData.guideImportKey = key end
            addon:ScheduleTask(addon.DXPFrame.GenerateMenuTable)
            callback(true, "Готово. Разделов добавлено или обновлено: " .. updated .. ". Более старых пропущено: " .. skipped .. ".")
            local current = addon.currentGuide
            if current then
                local replacement = addon.guides[current.group .. "||" .. current.name]
                if replacement and replacement ~= current then
                    addon.safeCall(function() addon:LoadGuide(replacement, true) end)
                end
            end
        end
    end)
    return true
end
