import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferenceSummary} from '../places.js';
import {places,categories} from '../places-data.js';
test('unique catalog and one person per activity even with multiple venues',()=>{
 assert.equal(new Set(places.map(p=>p.id)).size,places.length);
 assert.ok(places.every(p=>categories.some(c=>c.id===p.category)));
 const result=preferenceSummary([{name:'A',choices:['bryant-rink','stuytown-rink','white-elephant']},{name:'B',choices:['bryant-rink']},{name:'C',choices:[]}]);
 assert.equal(result.active.length,2);assert.equal(result.activities.find(c=>c.id==='skating').count,2);assert.equal(result.ranked[0].id,'bryant-rink');assert.deepEqual(result.ranked[0].people,['A','B']);
});
