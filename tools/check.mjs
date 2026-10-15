import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import luaparse from 'luaparse';

export async function checkBuild(root = resolve('dist/DiscodicXP')) {
  root = resolve(root);
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(path);
    }
  }
  await walk(root);
  let luaFiles = 0;
  let optionalBattleTagCapture = false;
  for (const file of files) {
    if (extname(file).toLowerCase() !== '.lua') continue;
    const code = await readFile(file, 'utf8');
    const ast = luaparse.parse(code, { luaVersion: '5.1' });
    if (/\bBNGetInfo\b/.test(code)) {
      if (relative(root, file).split(sep).join('/') !== 'Discodic/SyncIdentity.lua') {
        throw new Error(`API аккаунта вне сбора метаданных в ${relative(root, file)}.`);
      }
      optionalBattleTagCapture = true;
    }
    if (/\bBNGetInfo\s*\(|\bCheckBattleNet\s*\(|\baddon\.base\s*=|addon\.DeserializeTable\(addon\.base\)/.test(code)) {
      throw new Error(`Вызов аккаунта в ${relative(root, file)}.`);
    }
    function checkIdentifiers(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Identifier' && /^(RXPGuides|RXPC?Data|RXPSettings|RXPDB|RXPFrame)$/.test(node.name)) {
        throw new Error(`Неизолированное имя в ${relative(root, file)}.`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(checkIdentifiers);
        else if (value && typeof value === 'object') checkIdentifiers(value);
      }
    }
    checkIdentifiers(ast);
    luaFiles++;
  }
  const loaded = new Set();
  function resolveMember(member, parent) {
    member = member.replaceAll('\\', '/');
    const path = resolve(root, member);
    const target = existsSync(path) ? path : resolve(dirname(parent), member);
    if (relative(root, target).startsWith(`..${sep}`)) throw new Error('Зависимость выходит за пределы сборки.');
    return target;
  }
  async function load(file) {
    if (loaded.has(file)) return;
    loaded.add(file);
    const source = await readFile(file, 'utf8');
    if (extname(file) === '.xml') {
      const xml = source.replace(/<!--[\s\S]*?-->/g, '');
      for (const match of xml.matchAll(/<(?:Script|Include)\s+file=["']([^"']+)["']/g)) {
        await load(resolveMember(match[1], file));
      }
    }
  }
  const toc = await readFile(resolve(root, 'DiscodicXP.toc'), 'utf8');
  for (const entry of toc.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'))) {
    await load(resolveMember(entry.trim(), resolve(root, 'DiscodicXP.toc')));
  }
  const manifest = JSON.parse(await readFile(resolve(root, 'build.json'), 'utf8'));
  const guides = await readFile(resolve(root, 'UserGuides/ForeverHorde.lua'), 'utf8');
  if ([...guides.matchAll(/addon\.DiscodicXP\.RegisterGuide\(/g)].length !== manifest.guides) {
    throw new Error('Число встроенных разделов отличается от манифеста.');
  }
  if (!toc.includes('## Interface: 16001')) throw new Error('Неверная версия клиента.');
  return { luaFiles, manifestFiles: loaded.size, paidGuides: manifest.guides,
    accountBinding: manifest.runtimeAccountBinding, optionalBattleTagCapture };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await checkBuild(process.argv[2]), null, 2));
}
