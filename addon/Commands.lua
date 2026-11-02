local addonName, addon = ...
local L = addon.locale.Get

local originalCommand = addon.settings.ChatCommand
addon.settings.ChatCommand = function(input)
    input = (input or ""):match("^%s*(.-)%s*$")
    if input == "help" or input == "помощь" then
        addon.comms.PrettyPrint(L("/dxp — settings; /dxp import — import guide; /dxp guides — guides; /dxp show — show; /dxp hide — hide; /dxp npc on|off — NPC window; /dxp status — status."))
    elseif input == "import" or input == "импорт" then
        addon.guideImporter:Open()
    elseif input == "guides" or input == "маршруты" then
        if InCombatLockdown() then
            addon.comms.PrettyPrint(L("Guide selection is available after combat."))
            return
        end
        addon.v2:ShowGuideSelectionMenu()
    elseif input == "status" or input == "статус" then
        local guide = addon.currentGuide
        addon.comms.PrettyPrint(L("DiscordikXP · Forever · progress sync through the launcher"))
        addon.comms.PrettyPrint(L("Guide: %s; step: %s"), guide and addon.LocalizeGuideName(guide.name) or L("not selected"), tostring(addon.GetGuideProgress() or 1))
    elseif input == "npc" or input:match("^npc%s") or input == "нпс" or input:match("^нпс%s") then
        local action = input:match("^%S+%s+(.+)$") or "toggle"
        local enabled
        if action == "on" or action == "show" or action == "вкл" then
            enabled = true
        elseif action == "off" or action == "hide" or action == "выкл" then
            enabled = false
        elseif action == "toggle" then
            enabled = not addon.settings.profile.enableTargetFrame
        else
            addon.comms.PrettyPrint(L("Usage: /dxp npc on|off"))
            return
        end
        local applied = addon.SetNpcWindowEnabled(enabled)
        addon.comms.PrettyPrint(enabled and L("NPC selection window enabled.") or L("NPC selection window disabled."))
        if not applied then addon.comms.PrettyPrint(L("The window will update after combat.")) end
    elseif input == "show" or input == "показать" then
        if not addon.settings.profile.showEnabled then addon.settings.ToggleActive() end
    elseif input == "hide" or input == "скрыть" then
        if addon.settings.profile.showEnabled then addon.settings.ToggleActive() end
    else
        originalCommand(input)
    end
end
