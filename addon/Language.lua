local addonName, addon = ...

local L = LibStub("AceLocale-3.0"):GetLocale(addonName)
L["Browse Guides"] = "Выбрать маршрут"
L["Open Settings"] = "Настройки"
L["Import Guides"] = "Локальные гайды"
L["Import guide"] = "Подготовленный гайд"
L["Guide Import"] = "Загрузка маршрутов"
L["Select Guide"] = "Выбрать маршрут"
L["Select a Guide"] = "Выберите маршрут"
L["Current step"] = "Текущий шаг"
L["Active Targets"] = "Выбор NPC"
L["Skip step"] = "Отметить пункт вручную"
L["Step"] = "Шаг"
L["Next"] = "Далее"
L["Previous"] = "Назад"
L["Skip Step"] = "Пропустить шаг"
L["Reset Guide Progress"] = "Сбросить прогресс маршрута"
L["DXP Blue"] = "Синяя"
L["DXP Blue V2"] = "Синяя"
L["DarkMode"] = "Тёмная"
L["Loading Guides"] = "Загрузка маршрутов"
L["Importing Guides"] = "Подготовка маршрутов"
L["Incompatible guide game %d version vs %d"] = "Несовместимая версия маршрута: %d, требуется %d"

local zones = {
    ["Silverpine"] = "Серебряный бор",
    ["Hillsbrad"] = "Хилсбрад",
    ["Southern Barrens"] = "Южные Степи",
    ["Northern Stranglethorn"] = "Северная Тернистая долина",
    ["Southern Stranglethorn"] = "Южная Тернистая долина",
    ["Stranglethorn Vale"] = "Тернистая долина",
    ["Stranglethorn"] = "Тернистая долина",
    ["Thousand Needles"] = "Тысяча Игл",
    ["Shimmering Flats"] = "Мерцающая равнина",
    ["Dustwallow Marsh"] = "Пылевые топи",
    ["Swamp of Sorrows"] = "Болото Печали",
    ["The Hinterlands"] = "Внутренние земли",
    ["Blasted Lands"] = "Выжженные земли",
    ["Searing Gorge"] = "Тлеющее ущелье",
    ["Burning Steppes"] = "Пылающие степи",
    ["Un'Goro Crater"] = "Кратер Ун'Горо",
    ["Western PL"] = "Западные Чумные земли",
    ["Eastern PL"] = "Восточные Чумные земли",
    ["Stonetalon"] = "Когтистые горы",
    ["Ashenvale"] = "Ясеневый лес",
    ["Desolace"] = "Пустоши",
    ["Alterac"] = "Альтерак",
    ["Arathi"] = "Арати",
    ["Badlands"] = "Бесплодные земли",
    ["Tanaris"] = "Танарис",
    ["Feralas"] = "Фералас",
    ["Azshara"] = "Азшара",
    ["Felwood"] = "Осквернённый лес",
    ["Winterspring"] = "Зимние Ключи",
    ["Silithus"] = "Силитус",
    ["Durotar"] = "Дуротар",
    ["Barrens"] = "Степи",
    ["Mulgore"] = "Мулгор",
    ["Undead"] = "Нежить",
    ["Mage"] = "Маг"
}
local ordered = {}
for source in pairs(zones) do ordered[#ordered + 1] = source end
table.sort(ordered, function(a, b) return #a > #b end)

function addon.LocalizeGuideName(text)
    for _, source in ipairs(ordered) do
        local pattern = source:gsub("([^%w])", "%%%1")
        text = text:gsub(pattern, zones[source])
    end
    return text
end
