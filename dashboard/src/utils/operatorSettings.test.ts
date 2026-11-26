import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAGS, parseSettings, prefixWithUsername, readableTextColor } from './operatorSettings.ts';

test('a reply leads with the username in bold', () => {
  assert.equal(prefixWithUsername('Hello', 'Viraj'), '*Viraj:* Hello');
});

test('no username or no text leaves the text as it is', () => {
  assert.equal(prefixWithUsername('Hello', ''), 'Hello');
  assert.equal(prefixWithUsername('Hello', '   '), 'Hello');
  assert.equal(prefixWithUsername('', 'Viraj'), '');
});

test('asterisks in the name cannot break the bold markup', () => {
  assert.equal(prefixWithUsername('Hi', 'Vi*raj'), '*Viraj:* Hi');
});

test('stored settings keep only well-formed parts', () => {
  const s = parseSettings(
    JSON.stringify({
      username: 'Viraj',
      tags: [
        { id: 'a', name: 'A', color: '#112233' },
        { id: 'b', name: 'B', color: 'red' },
      ],
      assignments: { c1: 'a', c2: 'b', c3: 'gone' },
    }),
  );
  assert.deepEqual(
    s.tags.map(t => t.id),
    ['a'],
  );
  assert.deepEqual(s.assignments, { c1: 'a' });
});

test('missing or broken storage falls back to the default tags', () => {
  assert.deepEqual(parseSettings(null).tags, DEFAULT_TAGS);
  assert.deepEqual(parseSettings('{not json').tags, DEFAULT_TAGS);
});

test('text colour contrasts with the tag colour', () => {
  assert.equal(readableTextColor('#ffffff'), '#111827');
  assert.equal(readableTextColor('#000000'), '#ffffff');
});
