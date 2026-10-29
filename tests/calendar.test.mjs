import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calendarUrl} from '../calendar.js';
test('evening blocks cross midnight and year boundary correctly',()=>{
 for(const [date,expected] of [['2026-11-01','20261102T000000Z/20261102T050000Z'],['2026-12-31','20270101T000000Z/20270101T050000Z']]){const url=new URL(calendarUrl({date,title:'Friends & fun',location:'NYC'}));assert.equal(url.searchParams.get('dates'),expected);assert.equal(url.searchParams.get('ctz'),'America/New_York');assert.equal(url.searchParams.get('text'),'Friends & fun')}
});
