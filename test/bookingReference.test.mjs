import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withReferences,nextReference} from '../netlify/functions/_lib/bookingReference.mjs';
test('date and nights produce stable A/B/C codes, including cancelled bookings',()=>{
 const first={id:'first',checkin:'2027-05-01',nights:6,createdAt:'2026-01-01',status:'cancelled'};
 const second={...first,id:'second',createdAt:'2026-02-01'};
 const bs=withReferences([second,first]);
 assert.equal(bs.find(b=>b.id==='first').reference,'AE0105276A');
 assert.equal(bs.find(b=>b.id==='second').reference,'AE0105276B');
 assert.equal(nextReference(first,bs),'AE0105276C');
 assert.equal(nextReference({...first,nights:7},bs),'AE0105277A');
 assert.deepEqual(withReferences(bs),bs);
});
test('saved reference is preserved regardless of booking status',()=>{
 const b={id:'old',reference:'AE0105276C',checkin:'2027-05-01',nights:6,status:'cancelled'};
 assert.equal(withReferences([b])[0].reference,b.reference);
});
