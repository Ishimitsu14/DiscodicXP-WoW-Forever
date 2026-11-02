local _, addon = ...

local function launcherOnly()
    addon.comms.PrettyPrint(addon.locale.Get("Update guides with the launcher's Update guides button, then /reload."))
    return false
end

addon.guideImporter.Open = launcherOnly
addon.guideImporter.ImportString = launcherOnly
addon.ImportGuide = launcherOnly
addon.DiscodicXP.ImportGuide = launcherOnly

function addon.LoadCachedGuides()
    if next(addon.db.profile.guides or {}) and not addon.db.profile.legacyGuides then
        addon.db.profile.legacyGuides = addon.db.profile.guides
    end
    addon.db.profile.guides = {}
    addon.db.profile.guideContent = nil
    addon.db.profile.guideLength = nil
    addon.db.profile.guideId = nil
    addon.string = nil
    DXPString = nil
    DXPData.guideImportKey = nil
    if DXPCData.launcherGuideDigest ~= addon.launcherGuideDigest then
        addon:CreateMetaDataTable(true)
        DXPCData.launcherGuideDigest = addon.launcherGuideDigest
    end
end
