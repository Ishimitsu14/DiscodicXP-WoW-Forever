import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinNames, readNames, validateKnowledge } from './name-data.mjs';

const repository = 'Questie/QuestieDB';
export const sourceFiles = {
  npc: ['data/Forever/foreverNpcDB.lua', 'l10n/Forever/lookupNpcs/ruRU.lua'],
  quest: ['data/Forever/foreverQuestDB.lua', 'l10n/Forever/lookupQuests/ruRU.lua']
};

async function github(path) {
  const response = await fetch('https://api.github.com/repos/' + repository + '/' + path, {
    headers: { 'User-Agent': 'DiscodicXP-name-data' }, signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}. Старый справочник сохранён.`);
  return response.json();
}

async function download(entry, revision, onProgress) {
  const parts = [];
  for (let start = 0; start < entry.size; start += 400000) {
    const end = Math.min(start + 399999, entry.size - 1);
    let part;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`https://raw.githubusercontent.com/${repository}/${revision}/${entry.path}`, {
          headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(25000)
        });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${entry.size}`) {
          await response.body?.cancel();
          throw new Error('Источник не поддерживает загрузку по частям: ' + entry.path);
        }
        part = Buffer.from(await response.arrayBuffer());
        if (part.length !== end - start + 1) throw new Error('Неполная загрузка: ' + entry.path);
        break;
      } catch (error) { if (attempt === 1) throw error; }
    }
    parts.push(part);
    onProgress(`${entry.path}: ${end + 1}/${entry.size} байт`);
  }
  const bytes = Buffer.concat(parts);
  if (createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') !== entry.sha) {
    throw new Error('Контрольная сумма источника не совпадает: ' + entry.path);
  }
  return bytes;
}

export async function updateNames({ source, revision, output = resolve('data/names.ruRU.json'), onProgress = () => {} } = {}) {
  if (source && !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Для локальных файлов нужен --revision с SHA исходной базы.');
  if (!source) revision = (await github('commits/' + (revision || 'master'))).sha;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Не удалось определить версию базы.');
  const tree = source ? null : await github('git/trees/' + revision + '?recursive=1');
  const files = {};
  for (const path of Object.values(sourceFiles).flat()) {
    if (source) files[path] = await readFile(resolve(source, path));
    else {
      const entry = tree.tree.find(entry => entry.path === path && entry.type === 'blob');
      if (!entry || entry.size > 10 * 1024 * 1024) throw new Error('Не найден поддерживаемый файл ' + path);
      files[path] = await download(entry, revision, onProgress);
    }
  }
  const data = { version: 1, variant: 'FOREVER', locale: 'ruRU', repository, revision, npc: {}, quest: {} };
  for (const [kind, [en, ru]] of Object.entries(sourceFiles)) data[kind] = joinNames(readNames(files[en]), readNames(files[ru]));
  validateKnowledge(data);
  if (Object.keys(data.npc).length < 1000 || Object.keys(data.quest).length < 1000) throw new Error('Источник неполон. Старый справочник сохранён.');
  output = resolve(output);
  await mkdir(dirname(output), { recursive: true });
  const temporary = output + '.tmp';
  await writeFile(temporary, JSON.stringify(data) + '\n');
  await rename(temporary, output);
  return { output, revision, npc: Object.keys(data.npc).length, quest: Object.keys(data.quest).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i];
    if (!['--source', '--revision', '--output'].includes(flag) || !process.argv[i + 1]) throw new Error('Аргументы: [--source <каталог>] [--revision <SHA>] [--output <JSON>]');
    options[flag.slice(2)] = process.argv[i + 1];
  }
  try { console.log(JSON.stringify(await updateNames({ ...options, onProgress: message => console.error(message) }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
