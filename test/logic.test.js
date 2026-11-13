'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../src/logic');

const FRAME_MS = 1000 / 30;

test('position scales to the recent range and keeps a rolling window', () => {
    const buf = [];
    assert.equal(logic.position(buf, 5, 4), 0.5, 'a single value sits in the middle');
    assert.equal(logic.position(buf, 5, 4), 0.5, 'a flat signal stays in the middle');
    logic.position(buf, 0, 4);
    assert.equal(logic.position(buf, 10, 4), 1, 'the newest high value is 1');
    assert.equal(logic.position(buf, 0, 4), 0, 'the newest low value is 0');
    assert.equal(buf.length, 4, 'the window never grows past its size');
    // the old 5s have left the window: 0, 10, 0 then 10 is the top
    logic.position(buf, 10, 4);
    assert.equal(logic.position(buf, 5, 4), 0.5);
});

test('isGoodPulse needs confidence at the threshold and a stable flag', () => {
    assert.equal(logic.isGoodPulse({ confidence: 40, stable: true }, 40), true);
    assert.equal(logic.isGoodPulse({ confidence: 39.9, stable: true }, 40), false);
    assert.equal(logic.isGoodPulse({ confidence: 95, stable: false }, 40), false);
    assert.equal(logic.isGoodPulse(null, 40), false);
    assert.equal(logic.isGoodPulse(undefined, 40), false);
});

test('smoothBpm passes the first value and then blends 70/30', () => {
    assert.equal(logic.smoothBpm(null, 70), 70);
    assert.ok(Math.abs(logic.smoothBpm(70, 80) - 73) < 1e-9);
});

test('nextState locks on a fresh reading and loses it after the hold time', () => {
    const lostAfter = 3000;
    assert.equal(logic.nextState('finding', 1000, 0, lostAfter), 'finding', 'no reading, no lock');
    assert.equal(logic.nextState('finding', 1000, 900, lostAfter), 'locked', 'a recent reading locks');
    assert.equal(logic.nextState('finding', 5000, 900, lostAfter), 'finding', 'a stale reading does not lock');
    assert.equal(logic.nextState('locked', 3000, 1000, lostAfter), 'locked', 'inside the lost window it stays locked');
    assert.equal(logic.nextState('locked', 4500, 1000, lostAfter), 'lost', 'after the lost window it is lost, even while the SDK reconnects');
    assert.equal(logic.nextState('lost', 2000, 1500, lostAfter), 'locked', 'lost recovers on a fresh reading');
    assert.equal(logic.nextState('consent', 9000, 8999, lostAfter), 'consent', 'the start screen never changes by itself');
});

test('announceBpm changes only on a clear shift', () => {
    assert.equal(logic.announceBpm(null, null), null);
    assert.equal(logic.announceBpm(null, 62.4), 62);
    assert.equal(logic.announceBpm(62, 64.9), 62, 'a shift of 3 is not announced');
    assert.equal(logic.announceBpm(62, 66.4), 66, 'a shift of 4 is announced');
    assert.equal(logic.announceBpm(62, null), 62, 'no reading keeps the last one');
});

test('toPixels handles fractions and pixel coordinates', () => {
    const pts = [{ x: 0.5, y: 0.25 }, { x: 1, y: 1 }];
    assert.deepEqual(Array.from(logic.toPixels(pts, true, 1280, 720)), [640, 180, 1280, 720]);
    assert.deepEqual(Array.from(logic.toPixels([{ x: 320, y: 90 }], false, 1280, 720)), [320, 90]);
});

test('a clip keeps its real duration when frames arrived slower than 30 a second', () => {
    // The bug this guards against: 6 s of capture at about 23 frames a second was played
    // back at 30 a second and came out as 4.6 s.
    const frames = [];
    for (let t = 0; t < 6000; t += 1000 / 23) frames.push({ t });
    const d = logic.clipDuration(frames, FRAME_MS);
    assert.ok(d >= 5990 && d <= 6100, 'duration is about 6 s, got ' + d);
});

test('frameAt returns the last frame at or before a time, clamped at the ends', () => {
    const frames = [{ t: 0, id: 'a' }, { t: 40, id: 'b' }, { t: 90, id: 'c' }, { t: 130, id: 'd' }];
    assert.equal(logic.frameAt(frames, -50).id, 'a');
    assert.equal(logic.frameAt(frames, 0).id, 'a');
    assert.equal(logic.frameAt(frames, 39.9).id, 'a');
    assert.equal(logic.frameAt(frames, 40).id, 'b');
    assert.equal(logic.frameAt(frames, 100).id, 'c');
    assert.equal(logic.frameAt(frames, 99999).id, 'd');
    assert.equal(logic.frameAt([{ t: 0, id: 'only' }], 500).id, 'only');
});

test('breathGate fades in while breathing is confident and out after the hold time', () => {
    let gate = 0;
    for (let i = 0; i < 200; i++) gate = logic.breathGate(gate, 10000, 9000, 5000);
    assert.ok(gate > 0.99);
    const once = logic.breathGate(0, 10000, 9000, 5000);
    assert.ok(once > 0 && once < 0.1, 'one frame does not jump straight to full');
    for (let i = 0; i < 200; i++) gate = logic.breathGate(gate, 20000, 9000, 5000);
    assert.ok(gate < 0.01);
    assert.equal(logic.breathGate(0, 10000, 0, 5000), 0, 'no confident reading yet means no swell');
});
