// The Lua value reader over whole files: what it steps over, what it counts, and what it still reads.
//
// The server's own town scripts are a table of data followed by the functions that stand it, and the
// reader used to go through a file a line at a time: the first statement inside a function that was
// code rather than data threw, and the whole file went with it -- 32 of the 35 town scripts, and with
// them every person who stands in a town. These fixtures are written here in the shapes those files
// use; nothing is copied from them.
//
// Run: node tools/swg/tests/lua.test.ts

import assert from 'node:assert/strict';
import { findCalls, parseLuaValue, readLua, LuaCall } from '../lua.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ a function's body is stepped over whole
{
  const src = [
    'TownScreenPlay = CityScreenPlay:new {',
    '  planet = "somewhere",',
    '  mobiles = {',
    '    {"trader", 60, 1.5, 0.2, -3.5, 90, 1000, "calm"},',
    '  },',
    '}',
    '',
    'function TownScreenPlay:standThem()',
    '  local mobiles = self.mobiles',
    '  for n = 1, #mobiles do',
    '    local row = mobiles[n]',
    '    local body = spawnMobile(self.planet, row[1], row[2], row[3], row[4], row[5], row[6], row[7])',
    '    if (body ~= nil) then',
    '      if row[8] ~= "" then Person(body):feel(row[8]) end',
    '      notAValue = row[1] ~= nil and 1 or 2',
    '    end',
    '  end',
    'end',
    '',
    'afterTheFunction = { 1, 2, 3 }',
  ].join('\n');
  const { values, skipped } = readLua(src);
  const town = values.get('TownScreenPlay') as Record<string, unknown>;
  ok(!!town && town.planet === 'somewhere' && Array.isArray(town.mobiles), 'a town\'s table above its functions is read, which a file of function bodies used to throw away');
  ok(!values.has('mobiles') && !values.has('body') && !values.has('notAValue'), 'and nothing inside the function is read as the file\'s own: `local mobiles = self.mobiles` is code');
  ok((values.get('afterTheFunction') as number[])?.length === 3, 'the reader picks up again after the function\'s own `end`, however many blocks it holds');
  ok(skipped === 0, 'a function stepped over whole is logic, not a failure, and is not counted');
}

// ------------------------------------------------------------------ blocks count keyword by keyword
{
  const src = [
    'function f()',
    '  while x do',
    '    repeat y = y + 1 until y > 3',
    '    do local z = "end" end',
    '  end',
    '  -- end end end',
    'end',
    'kept = "yes"',
  ].join('\n');
  ok(readLua(src).values.get('kept') === 'yes', '`while` is closed by the `end` its `do` opens, `repeat` by `until`, and an `end` in a string or a comment is not counted');
  ok(readLua('local function g() return 1 end\nkept = 2').values.get('kept') === 2, 'a local function is stepped over the same way');
  ok(readLua('if isZoneEnabled("w") then\n  inside = 1\nend\nkept = 3').values.get('inside') === undefined, 'and a control structure written at the top level: what is inside it is logic');
}

// ------------------------------------------------------------------ a statement that will not read is counted, never thrown
{
  const src = [
    'before = 1',
    'broken = { a = 1, b = somewhere:else(), c = 3 }',
    'multiline = {',
    '  { x = 1 } ! oops',
    '  y = 2,',
    '}',
    'after = { name = "kept" }',
  ].join('\n');
  let res: ReturnType<typeof readLua> | null = null;
  try {
    res = readLua(src.replace('!', '@@'));
  } catch {
    res = null;
  }
  // The tokeniser still throws on a character Lua has not got: that is a file this does not read at
  // all, which is said, rather than one statement of it.
  ok(res === null, 'a character outside the language still stops the whole file, since nothing in it can be trusted');
  const good = readLua(src.replace(' ! oops', ' oops'));
  ok(good.values.get('before') === 1 && (good.values.get('after') as Record<string, unknown>)?.name === 'kept', 'the statements round one that will not read are kept');
  ok(good.skipped === 2 && good.skippedLines.join() === '2,3', `each statement stepped over is counted, with the line it began on (${good.skipped} at ${good.skippedLines.join(', ')})`);
  ok(!good.values.has('x') && !good.values.has('y'), 'and the inside of a statement stepped over is never read as the file\'s own, not even a line of it shaped like an assignment: a table of twenty lines is one statement');
}

// ------------------------------------------------------------------ arithmetic, as the manual orders it
{
  ok(parseLuaValue('7 * 24 * 60 * 60') === 604800, 'a week written as a product is the number it is, which is what kept one event\'s whole table from reading');
  ok(parseLuaValue('1 + 2 * 3') === 7 && parseLuaValue('(1 + 2) * 3') === 9, '`*` binds tighter than `+`, and a bracket tighter than both');
  ok(parseLuaValue('10 - 4 - 3') === 3, '`-` groups to the left');
  ok(parseLuaValue('0.') === 0 && parseLuaValue('{ 0., 1 }').length === 2, '`0.` is a number, as the server\'s own creature files write it');
  ok(parseLuaValue('"a" .. "b" .. "c"') === 'abc', '`..` joins strings');
  const scatter = parseLuaValue('-65.7 + getRandomNumber(40)') as LuaCall;
  ok(scatter instanceof LuaCall && scatter.call === '+' && scatter.args[0] === -65.7 && (scatter.args[1] as LuaCall).call === 'getRandomNumber', 'a minus binds to its own number, so a scatter written base first is a base plus a draw, not the negative of both');
  const flags = parseLuaValue('PACK + KILLER + STALKER') as LuaCall;
  ok(flags instanceof LuaCall && JSON.stringify(flags).includes('KILLER'), 'a sum of words nobody declared is still kept as a marker naming them');
  const read = parseLuaValue('mob[3]') as LuaCall;
  ok(read instanceof LuaCall && read.call === '[]' && read.args[0] === 'mob' && read.args[1] === 3, 'a read out of a table is kept as a marker naming the table and the key');
}

// ------------------------------------------------------------------ the call scanner sees the table reads
{
  const found = findCalls('function S:go()\n  spawnMobile(self.planet, mob[1], 60, mob[2], mob[3], mob[4], 0, 0)\nend', ['spawnMobile']);
  ok(found.length === 1 && (found[0].args[1] as LuaCall).call === '[]' && ((found[0].args[3] as LuaCall).args[1] as number) === 2, 'a call that stands a table\'s rows reads as which element of the row goes where');
}

console.log(`\nlua: ${passed} checks passed`);
