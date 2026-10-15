local _, addon = ...
local AceGUI = LibStub("AceGUI-3.0")
local importer = addon.localGuideImport

local function setBusy(window, busy)
    window.busy = busy
    window.importButton:SetEnabled(not busy and addon.guideImporter.importCache.bufferString ~= "")
    if busy then window.fileName:Disable() else window.fileName:Enable() end
    if busy then window.editBox:Disable() else window.editBox:Enable() end
    window.cancelButton:SetText(busy and "Отменить импорт" or "Закрыть")
end

local function updateTheme(window)
    local theme = addon.v2:GetTheme()
    addon.ui.v2:ApplyFrameBackdrop(window, theme.edge, theme.backgroundColors.common, theme.borderColors.commonEdge)
    for _, label in ipairs(window.labels) do
        label:SetFont(theme.font, 11, "")
        label:SetTextColor(unpack(theme.textColor.common))
    end
    window.title:SetFont(theme.font, 16, "")
    window.title:SetTextColor(unpack(theme.textColor.title))
    window.editBox:SetFont(theme.font, 11, "")
    window.editBox:SetTextColor(unpack(theme.textColor.common))
    addon.ui.v2:ApplyFrameBackdrop(window.input.background, theme.edge,
        theme.backgroundColors.scrollbar, theme.borderColors.commonEdge)
end

function importer:CreateWindow()
    addon.ui.v2:InitializeGuideImporter()
    local window = CreateFrame("Frame", "DiscodicXPImportWindow", UIParent, "BackdropTemplate")
    window:SetSize(560, 430)
    window:SetPoint("CENTER")
    window:SetFrameStrata("DIALOG")
    window:SetClampedToScreen(true)
    window:EnableMouse(true)
    window:SetMovable(true)
    window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", function(frame) frame:StartMoving() end)
    window:SetScript("OnDragStop", function(frame) frame:StopMovingOrSizing() end)
    window.labels = {}

    local function label(text, y, height)
        local font = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
        font:SetPoint("TOPLEFT", 20, y)
        font:SetWidth(520)
        font:SetHeight(height or 20)
        font:SetJustifyH("LEFT")
        font:SetJustifyV("TOP")
        font:SetText(text)
        window.labels[#window.labels + 1] = font
        return font
    end
    window.title = label("DiscodicXP · Импорт маршрутов", -18, 25)
    label("Откройте .txt, скопируйте весь текст и вставьте его в поле ниже.\nСовпадающие разделы будут обновлены с сохранением прогресса.", -53, 34)
    label("Имя исходного файла (необязательно)", -98, 20)
    local fileName = CreateFrame("EditBox", nil, window, "InputBoxTemplate")
    fileName:SetPoint("TOPLEFT", 25, -122)
    fileName:SetSize(510, 26)
    fileName:SetAutoFocus(false)
    fileName:SetMaxBytes(512)
    fileName:SetScript("OnEscapePressed", function(this) this:ClearFocus() end)
    window.fileName = fileName

    label("Содержимое файла .txt — нажмите на поле и вставьте текст через Ctrl+V", -163, 22)
    local input = AceGUI:Create("DXPV2GuideImporterEditBox")
    input.frame:SetParent(window)
    input:SetLabel(nil)
    input:SetNumLines(5)
    input:SetWidth(520)
    input.frame:ClearAllPoints()
    input.frame:SetPoint("TOPLEFT", 20, -190)
    input.frame:SetHeight(116)
    input.frame:Show()
    input.label:Hide()
    window.input = input
    window.editBox = input:GetEditBox()
    window.status = label("Для обновлений текущего гайда имя файла не нужно.\nНовые разделы появятся в меню /dxp guides.", -322, 49)

    local importButton = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
    importButton:SetPoint("BOTTOMLEFT", 20, 20)
    importButton:SetSize(250, 28)
    importButton:SetText("Импортировать / обновить")
    window.importButton = importButton
    local cancel = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
    cancel:SetPoint("BOTTOMRIGHT", -20, 20)
    cancel:SetSize(250, 28)
    cancel:SetText("Закрыть")
    window.cancelButton = cancel
    cancel:SetScript("OnClick", function()
        if window.busy then
            self:Cancel()
            setBusy(window, false)
            window.status:SetText("Импорт отменён. Существующие маршруты сохранены.")
        else
            window:Hide()
        end
    end)
    local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -3, -3)
    close:SetScript("OnClick", function() window:Hide() end)
    input:SetCallback("OnEditFocusGained", function()
        importButton:Disable()
        window.status:SetText("Вставьте весь текст файла через Ctrl+V.")
    end)
    input:SetCallback("OnEditFocusLost", function()
        local buffer = addon.guideImporter.importCache
        if #buffer.bufferData > 0 and buffer.lastBuffer ~= 0 then addon.guideImporter:ProcessBuffer(window.editBox) end
        importButton:SetEnabled(not window.busy and buffer.bufferString ~= "")
        if buffer.bufferString ~= "" then
            window.status:SetText("Получено символов: " .. #buffer.bufferString .. ". Можно импортировать.")
        end
    end)
    importButton:SetScript("OnClick", function()
        local buffer = addon.guideImporter.importCache
        if #buffer.bufferData > 0 then addon.guideImporter:ProcessBuffer(window.editBox) end
        window.editBox:ClearFocus()
        fileName:ClearFocus()
        setBusy(window, true)
        local started, message = self:Start(buffer.bufferString, fileName:GetText(), function(success, status)
            window.status:SetText(status or "Обработка…")
            if success ~= nil then
                if success then
                    buffer.bufferString, buffer.bufferData = "", {}
                    window.editBox:SetText("")
                    fileName:SetText("")
                end
                setBusy(window, false)
            end
        end)
        if not started then
            setBusy(window, false)
            window.status:SetText(message)
        end
    end)
    window:SetScript("OnHide", function()
        if window.busy then self:Cancel(); setBusy(window, false) end
        window.editBox:ClearFocus()
        fileName:ClearFocus()
    end)
    table.insert(UISpecialFrames, "DiscodicXPImportWindow")
    updateTheme(window)
    setBusy(window, false)
    self.window = window
    return window
end

function addon.guideImporter:Open()
    if InCombatLockdown() then
        addon.comms.PrettyPrint("Импорт доступен после боя.")
        return
    end
    local window = importer.window or importer:CreateWindow()
    updateTheme(window)
    window:Show()
    window:Raise()
    if not window.busy and addon.guideImporter.importCache.bufferString == "" then window.input:SetFocus() end
end
