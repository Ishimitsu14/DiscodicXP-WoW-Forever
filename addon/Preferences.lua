local _, addon = ...

-- Use the engine's existing profile option so both settings controls stay in sync.
-- Secure target buttons may only change visibility after combat ends.
function addon.SetNpcWindowEnabled(enabled)
    addon.settings.profile.enableTargetFrame = not not enabled
    if InCombatLockdown() then return false end
    if addon.targeting and addon.targeting.activeTargetFrame then
        addon.targeting:UpdateTargetFrame()
    end
    return true
end
