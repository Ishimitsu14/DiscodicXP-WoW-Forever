import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { adler32, decodeGuides, deriveKey, luaString, transform } from '../tools/guide-codec.mjs';

const file = 'Fixture!example#12345.txt';
const guides = ['#group Demo\n#name 1-2 Test\nstep\n.accept 1\n', '#group Demo\n#name 2-3 Test\nstep\n.turnin 1\n'];
function container(text = guides.join('\0'), count = guides.length) {
  const plain = Buffer.from(text);
  const encrypted = transform(deflateSync(plain), deriveKey('example#12345'));
  return `${count}|${adler32(plain)}:${encrypted.toString('base64')}%|40000`;
}

test('all sections survive preparation without changing source text', () => {
  assert.deepEqual(decodeGuides(container(), file), { guides, version: 40000 });
});
test('wrong source identity cannot produce silently corrupted guides', () => {
  assert.throws(() => decodeGuides(container(), 'Fixture!different#98765.txt'), /повреждённые/);
});
test('truncated and foreign container blocks are rejected', () => {
  assert.throws(() => decodeGuides(container().slice(0, -4), file));
  assert.throws(() => decodeGuides(container().replace('%|', '%invalid|'), file));
  assert.throws(() => decodeGuides(container().replace(/:\w/, ':!'), file));
});
test('wrong section count, missing metadata and invalid names fail closed', () => {
  assert.throws(() => decodeGuides(container(undefined, 3), file), /Ожидалось 3/);
  assert.throws(() => decodeGuides(container('step\n.accept 1', 1), file), /без имени/);
  assert.throws(() => decodeGuides(container(), 'Fixture.txt'), /Имя файла/);
});
test('checksum and Lua text delimiters preserve arbitrary guide content', () => {
  assert.equal(adler32(Buffer.from('Wikipedia')), 0x11e60398);
  assert.equal(luaString('a]]b]=]c'), '[==[\na]]b]=]c]==]');
});
