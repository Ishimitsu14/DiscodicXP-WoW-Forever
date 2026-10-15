local addonName, addon = ...

local originalCommand = addon.settings.ChatCommand
addon.settings.ChatCommand = function(input)
    input = (input or ""):match("^%s*(.-)%s*$")
    if input == "help" or input == "помощь" then
        addon.comms.PrettyPrint("/dxp — настройки; /dxp import — импорт гайда; /dxp guides — маршруты; /dxp show — показать; /dxp hide — скрыть; /dxp status — состояние.")
    elseif input == "import" or input == "импорт" then
        addon.guideImporter:Open()
    elseif input == "guides" or input == "маршруты" then
        if InCombatLockdown() then
            addon.comms.PrettyPrint("Выбор маршрута доступен после боя.")
            return
        end
        addon.v2:ShowGuideSelectionMenu()
    elseif input == "status" or input == "статус" then
        local guide = addon.currentGuide
        addon.comms.PrettyPrint("DiscodicXP · Forever · локальная загрузка без Battle.net")
        addon.comms.PrettyPrint("Маршрут: %s; шаг: %s", guide and guide.name or "не выбран", tostring(addon.GetGuideProgress() or 1))
    elseif input == "show" or input == "показать" then
        if not addon.settings.profile.showEnabled then addon.settings.ToggleActive() end
    elseif input == "hide" or input == "скрыть" then
        if addon.settings.profile.showEnabled then addon.settings.ToggleActive() end
    else
        originalCommand(input)
    end
end
