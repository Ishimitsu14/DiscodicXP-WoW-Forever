local addonName, addon = ...

local L = LibStub("AceLocale-3.0"):GetLocale(addonName)
local russianClient = GetLocale() == "ruRU"
addon.displayName = "DiscordicXP"

if not L["Active Targets"] then L["Active Targets"] = "NPC Selection" end
L["Enable Standby Mode"] = "Enable Standby Mode"
L["Pause guide processing when addon is hidden."] = "Pause guide processing when addon is hidden."
if russianClient then
    L["Enable Standby Mode"] = "Приостанавливать скрытый аддон"
    L["Pause guide processing when addon is hidden."] = "Приостанавливать обработку маршрута, когда аддон скрыт. После показа обработка продолжится."
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
    L["Hide NPC Selection window"] = "Скрыть окно выбора НПС"
    L["Hide NPC target buttons without hiding the guide."] = "Скрыть кнопки выбора НПС, сохранив окно маршрута."
    L["Enable Active Target Frame"] = "Показывать окно выбора НПС"
    L["Active Target Frame"] = "Окно выбора НПС"
    L["Forever — Azeroth"] = "Forever — Азерот"
    L["Cancel import"] = "Отменить импорт"
    L["Close"] = "Закрыть"
    L["DiscordicXP · Import guides"] = "DiscordicXP · Импорт маршрутов"
    L["Open the .txt file, copy all text and paste it below.\nMatching sections will be updated, keeping your progress."] = "Откройте .txt, скопируйте весь текст и вставьте его в поле ниже.\nСовпадающие разделы будут обновлены с сохранением прогресса."
    L["Original file name (optional)"] = "Имя исходного файла (необязательно)"
    L[".txt contents — click the field and paste with Ctrl+V"] = "Содержимое файла .txt — нажмите на поле и вставьте текст через Ctrl+V"
    L["The file name is not needed to update the current guide.\nNew sections will appear in /dxp guides."] = "Для обновлений текущего гайда имя файла не нужно.\nНовые разделы появятся в меню /dxp guides."
    L["Import / update"] = "Импортировать / обновить"
    L["Import cancelled. Existing guides were kept."] = "Импорт отменён. Существующие маршруты сохранены."
    L["Paste the entire file with Ctrl+V."] = "Вставьте весь текст файла через Ctrl+V."
    L["Characters received: "] = "Получено символов: "
    L[". Ready to import."] = ". Можно импортировать."
    L["Processing…"] = "Обработка…"
    L["Import is available after combat."] = "Импорт доступен после боя."
    L["Error parsing section "] = "Ошибка разбора раздела "
    L["Section "] = "Раздел "
    L[" is incompatible with WoW Forever or contains an error."] = " не подходит для WoW Forever или содержит ошибку."
    L["Duplicate section in file: "] = "В файле повторяется раздел: "
    L["Could not save section: "] = "Не удалось сохранить раздел: "
    L["Checking sections: "] = "Проверка разделов: "
    L["The file contains no guides."] = "В файле нет маршрутов."
    L["Finish combat and try importing again."] = "Завершите бой и повторите импорт."
    L["Could not add guide."] = "Не удалось добавить маршрут."
    L["An import is already in progress."] = "Импорт уже выполняется."
    L["Done. Sections added or updated: "] = "Готово. Разделов добавлено или обновлено: "
    L[". Older sections skipped: "] = ". Более старых пропущено: "
    L["Enter the full original .txt file name, including the part after !."] = "Укажите полное исходное имя .txt, включая часть после !."
    L["Invalid guide string format."] = "Повреждённый формат строки гайда."
    L["Could not read the guide string."] = "Не удалось прочитать строку гайда."
    L["Decrypting…"] = "Расшифровка…"
    L["Paste the contents of the guide file."] = "Вставьте содержимое файла гайда."
    L["The file exceeds the 8 MB limit."] = "Файл превышает допустимый размер 8 МБ."
    L["The unpacked guide exceeds 16 MB."] = "Распакованный гайд превышает 16 МБ."
    L["The file contains a section without a group or name."] = "В файле найден раздел без группы или имени."
    L["Incomplete or incompatible guide file."] = "Неполный или несовместимый файл гайда."
    L["Enter the original file name to decrypt the guide."] = "Укажите имя исходного файла для расшифровки."
    L["Damaged block in the guide file."] = "Повреждённый блок в файле гайда."
    L["Could not decode the guide. Check the full text and original file name."] = "Не удалось раскрыть гайд. Проверьте полноту текста и исходное имя файла."
    L["Unpacking…"] = "Распаковка…"
    L["Guide data is damaged: checksum mismatch."] = "Данные гайда повреждены: контрольная сумма не совпала."
    L["The pasted file is incomplete: section count mismatch."] = "Вставлен не весь файл: число разделов не совпало."
    L["/dxp — settings; /dxp guides — guides; /dxp show — show; /dxp hide — hide; /dxp npc on|off — NPC window; /dxp status — status. Update guides in the launcher, then /reload."] = "/dxp — настройки; /dxp guides — маршруты; /dxp show — показать; /dxp hide — скрыть; /dxp npc on|off — окно НПС; /dxp status — состояние. Обновление гайдов — в лаунчере, затем /reload."
    L["Update guides with the launcher's Update guides button, then /reload."] = "Гайды обновляются кнопкой «Обновить гайды» в лаунчере. После обновления выполните /reload."
    L["Guide selection is available after combat."] = "Выбор маршрута доступен после боя."
    L["DiscordicXP · Forever · progress sync through the launcher"] = "DiscordicXP · Forever · синхронизация прогресса через лаунчер"
    L["Guide: %s; step: %s"] = "Маршрут: %s; шаг: %s"
    L["not selected"] = "не выбран"
    L["Usage: /dxp npc on|off"] = "Используйте: /dxp npc on|off"
    L["NPC selection window enabled."] = "Окно выбора НПС включено."
    L["NPC selection window disabled."] = "Окно выбора НПС отключено."
    L["The window will update after combat."] = "Окно обновится после боя."
end

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
    text = text:gsub("DiscodicXP", addon.displayName):gsub("RestedXP", addon.displayName)
    if not russianClient then return text end
    for _, source in ipairs(ordered) do
        local pattern = source:gsub("([^%w])", "%%%1")
        text = text:gsub(pattern, zones[source])
    end
    return text
end
