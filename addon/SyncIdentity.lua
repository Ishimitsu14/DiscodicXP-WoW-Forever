local _, addon = ...

local function updateIdentity()
    if type(DXPCData) ~= "table" then return end
    local guid = UnitGUID("player")
    if not guid then return end
    local identity = DXPCData.syncIdentity or {}
    identity.guid = guid
    identity.name = UnitName("player")
    identity.realm = GetRealmName()
    identity.schemaVersion = 1
    local getInfo = _G.BNGetInfo
    if type(getInfo) == "function" then
        local ok, _, battleTag = pcall(getInfo)
        if ok and type(battleTag) == "string" then identity.battleTag = battleTag end
    end
    DXPCData.syncIdentity = identity
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:SetScript("OnEvent", updateIdentity)
