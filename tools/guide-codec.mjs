import { basename } from 'node:path';
import { inflateSync } from 'node:zlib';

export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (b * 65536 + a) >>> 0;
}

export function deriveKey(identity) {
  const text = identity.toLowerCase().slice(-16);
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length !== text.length || !text.includes('#')) {
    throw new Error('Неподдерживаемый идентификатор в имени файла гайда.');
  }
  const key = Array.from({ length: 16 }, (_, i) => bytes[(i - (16 - bytes.length)) & 15] ?? 0);
  for (let i = 0; i < 16; i++) {
    key[(-i) & 15] = key[(15 - i) & 15] ^ key[(13 - i) & 15]
      ^ key[(12 - i) & 15] ^ key[(10 - i) & 15];
  }
  return key;
}

export function transform(bytes, key) {
  const state = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i & 15]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(bytes, 'binary').map(byte => {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
    return byte ^ state[(state[i] + state[j]) & 255];
  });
}

export function decodeGuides(content, fileName) {
  const identity = basename(fileName).match(/!([^!]+#\d+)\.txt$/i)?.[1];
  if (!identity) throw new Error('Имя файла должно содержать исходный идентификатор после !.');
  const key = deriveKey(identity);
  const container = content.trim();
  const header = container.match(/^(\d+)\|/);
  const version = container.match(/%\|(\d+)$/);
  if (!header || !version) throw new Error('Неполный контейнер гайда.');
  if (Number(version[1]) !== 40000) throw new Error('Неподдерживаемая версия контейнера гайда.');
  const expected = Number(header[1]);
  const body = container.slice(header[0].length, version.index + 1);
  const pattern = /(-?\d+):([A-Za-z0-9+/=]+)%/gy;
  const guides = [];
  let offset = 0;
  while (offset < body.length) {
    pattern.lastIndex = offset;
    const block = pattern.exec(body);
    if (!block) throw new Error('Неизвестный блок в контейнере гайда.');
    const encrypted = Buffer.from(block[2], 'base64');
    if (encrypted.toString('base64') !== block[2]) throw new Error('Некорректный Base64.');
    const compressed = transform(encrypted, key);
    const checksum = Number(block[1]) >>> 0;
    if (compressed.length < 8 || compressed.readUInt32BE(compressed.length - 4) !== checksum) {
      throw new Error('Не удалось раскрыть контейнер: неверное имя файла или повреждённые данные.');
    }
    let plain;
    try {
      plain = inflateSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    } catch {
      throw new Error('Ошибка распаковки контейнера гайда.');
    }
    if (adler32(plain) !== checksum) throw new Error('Контрольная сумма гайда не совпала.');
    for (const source of plain.toString('utf8').split('\0').filter(Boolean)) {
      if (!/^#name\s+.+/m.test(source) || !/^#group\s+.+/m.test(source)) {
        throw new Error('В контейнере найден раздел без имени или группы.');
      }
      guides.push(source);
    }
    offset = pattern.lastIndex;
  }
  if (guides.length !== expected) throw new Error(`Ожидалось ${expected} разделов, получено ${guides.length}.`);
  return { guides, version: Number(version[1]) };
}

export function luaString(value) {
  let separator = '';
  while (value.includes(`]${separator}]`)) separator += '=';
  return `[${separator}[\n${value}]${separator}]`;
}
