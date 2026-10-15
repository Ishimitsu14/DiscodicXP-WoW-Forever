local _, addon = ...
local LibDeflate = LibStub("LibDeflate")
local byte, char = string.byte, string.char
local band, bxor = bit.band, bit.bxor

addon.guideCodec = {}
local codec = addon.guideCodec
codec.maxInputBytes = 8 * 1024 * 1024
codec.maxGuideBytes = 16 * 1024 * 1024

function codec.Rebrand(text)
    return (text:gsub("RXPGuides", "DiscodicXP"):gsub("RXPG", "DXPG"):gsub("RXP", "DXP")
        :gsub("rxpguides", "discodicxp"):gsub("rxpg", "dxpg"):gsub("rxp", "dxp")
        :gsub("RestedXP", "DiscodicXP"))
end

function codec.KeyFromFileName(fileName)
    local identity = fileName:match("!([^!]+#%d+)%.txt[\"']?%s*$")
    if not identity or identity:find("[\128-\255]") then
        return nil, "Укажите полное исходное имя .txt, включая часть после !."
    end
    local text = identity:lower():sub(-16)
    local key = {}
    for i = 0, 15 do key[i + 1] = byte(text, band(i - (16 - #text), 15) + 1) or 0 end
    for i = 0, 15 do
        key[band(-i, 15) + 1] = bxor(key[band(15 - i, 15) + 1], key[band(13 - i, 15) + 1],
                                    key[band(12 - i, 15) + 1], key[band(10 - i, 15) + 1])
    end
    return key
end

local function decrypt(content, key, yieldImport)
    if #content % 4 ~= 0 or not content:match("^[A-Za-z0-9+/]*=?=?$") then
        error("Повреждённый формат строки гайда.", 0)
    end
    local decoded, decodeError
    if C_EncodingUtil and C_EncodingUtil.DecodeBase64 then
        local ok
        ok, decoded = pcall(C_EncodingUtil.DecodeBase64, content)
        if not ok then decoded = nil end
    else
        decoded, decodeError = addon.read(content)
    end
    if not decoded or decodeError then error("Не удалось прочитать строку гайда.", 0) end
    local state, j = {}, 0
    for i = 0, 255 do state[i] = i end
    for i = 0, 255 do
        j = band(j + state[i] + key[band(i, 15) + 1], 255)
        state[i], state[j] = state[j], state[i]
    end
    local i, chunks = 0, {}
    j = 0
    for start = 1, #decoded, 4096 do
        local buffer = {}
        for index = start, math.min(start + 4095, #decoded) do
            i = band(i + 1, 255)
            j = band(j + state[i], 255)
            state[i], state[j] = state[j], state[i]
            buffer[#buffer + 1] = char(bxor(byte(decoded, index), state[band(state[i] + state[j], 255)]))
        end
        chunks[#chunks + 1] = table.concat(buffer)
        if yieldImport then yieldImport("Расшифровка…") end
    end
    return table.concat(chunks)
end

function codec.Decode(text, key, yieldImport)
    if type(text) ~= "string" or #text == 0 then error("Вставьте содержимое файла гайда.", 0) end
    if #text > codec.maxInputBytes then error("Файл превышает допустимый размер 8 МБ.", 0) end
    text = text:gsub("^\239\187\191", ""):match("^%s*(.-)%s*$")
    local guides, totalBytes = {}, 0
    local function append(source)
        totalBytes = totalBytes + #source
        if totalBytes > codec.maxGuideBytes then error("Распакованный гайд превышает 16 МБ.", 0) end
        if not source:match("#group%s+[^\r\n]+") or not source:match("#name%s+[^\r\n]+") then
            error("В файле найден раздел без группы или имени.", 0)
        end
        guides[#guides + 1] = codec.Rebrand(source)
    end
    if text:sub(1, 1) == "#" then
        for source in (text .. "\0"):gmatch("([^%z]+)%z") do append(source) end
        return guides
    end
    text = text:gsub("%s", "")
    local count, body, version = text:match("^(%d+)|(.+)%%|(%d+)$")
    if not count or tonumber(version) ~= addon.version then error("Неполный или несовместимый файл гайда.", 0) end
    if not key or #key ~= 16 then error("Укажите имя исходного файла для расшифровки.", 0) end
    body = body .. "%"
    local offset = 1
    while offset <= #body do
        local first, last, checksum, content = body:find("(%-?%d+):([A-Za-z0-9+/=]+)%%", offset)
        if first ~= offset then error("Повреждённый блок в файле гайда.", 0) end
        local compressed = decrypt(content, key, yieldImport)
        checksum = tonumber(checksum) % 4294967296
        local length = #compressed
        local cmf, flg = byte(compressed, 1, 2)
        local trailer = length >= 8 and byte(compressed, length - 3) * 16777216.0
            + byte(compressed, length - 2) * 65536 + byte(compressed, length - 1) * 256 + byte(compressed, length)
        if not trailer or band(cmf, 15) ~= 8 or cmf > 120 or band(flg, 32) ~= 0
            or (cmf * 256 + flg) % 31 ~= 0 or trailer ~= checksum then
            error("Не удалось раскрыть гайд. Проверьте полноту текста и исходное имя файла.", 0)
        end
        if yieldImport then yieldImport("Распаковка…") end
        local plain
        if C_EncodingUtil and C_EncodingUtil.DecompressString then
            local ok
            ok, plain = pcall(C_EncodingUtil.DecompressString, compressed, 1)
            if not ok then plain = nil end
        else
            plain = LibDeflate:DecompressZlib(compressed)
        end
        if not plain or #plain > codec.maxGuideBytes or addon.A32(plain) % 4294967296 ~= checksum then
            error("Данные гайда повреждены: контрольная сумма не совпала.", 0)
        end
        for source in plain:gmatch("[^%z]+") do append(source) end
        offset = last + 1
    end
    if #guides ~= tonumber(count) then error("Вставлен не весь файл: число разделов не совпало.", 0) end
    return guides
end
