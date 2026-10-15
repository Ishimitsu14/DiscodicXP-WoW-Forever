import luaparse from 'luaparse';
import { luaString } from './guide-codec.mjs';

function parse(source) {
  return luaparse.parse(source, { luaVersion: '5.1', encodingMode: 'pseudo-latin1' });
}

export function readNames(bytes) {
  const outer = parse(Buffer.from(bytes).toString('latin1'));
  let payload;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'StringLiteral' && /^return\s*\{/.test(node.value)) {
      if (payload) throw new Error('Несколько таблиц названий в источнике.');
      payload = node.value;
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(outer);
  if (!payload) throw new Error('Не найдена таблица названий.');
  const body = parse(payload).body;
  const table = body[0]?.arguments?.[0];
  if (body.length !== 1 || body[0].type !== 'ReturnStatement' || table?.type !== 'TableConstructorExpression') {
    throw new Error('Неподдерживаемая таблица названий.');
  }
  const rows = new Map();
  for (const field of table.fields) {
    const id = field.key?.value;
    const name = field.value?.fields?.[0]?.value;
    if (field.type !== 'TableKey' || !Number.isSafeInteger(id) || id <= 0 || name?.type !== 'StringLiteral') continue;
    const text = Buffer.from(name.value, 'latin1').toString('utf8').trim();
    if (text && text.length <= 300 && !/[\x00-\x1f\ufffd]/.test(text)) rows.set(id, text);
  }
  return rows;
}

export function joinNames(english, russian) {
  return Object.fromEntries([...russian].filter(([id, ru]) => english.has(id) && /[А-Яа-яЁё]/.test(ru))
    .sort(([a], [b]) => a - b).map(([id, ru]) => [id, [english.get(id), ru]]));
}

export function validateKnowledge(data) {
  if (data?.version !== 1 || data.variant !== 'FOREVER' || data.locale !== 'ruRU' || !/^[a-f0-9]{40}$/.test(data.revision || '')) {
    throw new Error('Неверный формат русского справочника.');
  }
  for (const kind of ['npc', 'quest']) {
    if (!data[kind] || typeof data[kind] !== 'object' || Array.isArray(data[kind])) throw new Error('Нет раздела ' + kind);
    for (const [id, pair] of Object.entries(data[kind])) {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || !Array.isArray(pair) || pair.length !== 2 ||
          pair.some(name => typeof name !== 'string' || !name.trim() || name.length > 300 || /[\x00-\x1f]/.test(name)) ||
          !/[А-Яа-яЁё]/.test(pair[1])) throw new Error('Неверная запись ' + kind + ':' + id);
    }
  }
  return data;
}

export function knowledgeLua(data) {
  validateKnowledge(data);
  const lines = ['local _, addon = ...', 'addon.nameKnowledge = {', `    revision = "${data.revision}",`];
  for (const kind of ['npc', 'quest']) {
    lines.push(`    ${kind} = {`);
    for (const [id, [en, ru]] of Object.entries(data[kind])) lines.push(`        [${id}] = {${luaString(en)}, ${luaString(ru)}},`);
    lines.push('    },');
  }
  lines.push('}', '');
  return lines.join('\n');
}
