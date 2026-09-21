import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCalendarNights, runAirbnbSync } from '../netlify/functions/_lib/airbnbSync.mjs';
const calendar = (events = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}END:VCALENDAR\r\n`;
const event = 'BEGIN:VEVENT\r\nUID:test\r\nDTSTART;VALUE=DATE:20270731\r\nDTEND;VALUE=DATE:20270807\r\nEND:VEVENT\r\n';
test('Booking week blocks seven nights, excluding checkout', () => {
 const result = parseCalendarNights(calendar(event));
 assert.equal(result.nights.length, 7);
 assert.equal(result.nights[0], '2027-07-31');
 assert.equal(result.nights.at(-1), '2027-08-06');
});
test('invalid response cannot silently clear occupied dates', () => {
 assert.throws(() => parseCalendarNights('<html>Sign in</html>'));
 assert.throws(() => parseCalendarNights(calendar(event.replace('20270807','20270730'))));
});
test('valid empty calendar clears cancellations', () => {
 assert.deepEqual(parseCalendarNights(calendar()).nights, []);
});
test('provider failures preserve snapshot and do not stop other providers', async () => {
 const snapshots = { airbnb: ['2027-01-01'], booking: ['2027-01-02'], vrbo: ['2027-01-03'] };
 const failed = [];
 const result = await runAirbnbSync({
 env: { AIRBNB_ICAL_URL: 'https://airbnb.example/feed', BOOKING_ICAL_URL: 'https://booking.example/feed', VRBO_ICAL_URL: 'https://vrbo.example/feed' },
 fetcher: async url => { if (url.hostname === 'airbnb.example') throw new Error('secret URL'); return { ok:true, text:async()=>calendar(url.hostname==='booking.example'?event:'') }; },
 save: async(source,nights)=>{snapshots[source]=nights;}, fail:async(source,error)=>{failed.push(source);assert.ok(!error.includes('secret'));}
 });
 assert.equal(result.ok, false);
 assert.deepEqual(snapshots.airbnb,['2027-01-01']);
 assert.equal(snapshots.booking.length,7);
 assert.deepEqual(snapshots.vrbo,[]);
 assert.deepEqual(failed,['airbnb']);
});
