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

// A face with just the points the effect measures use. Eyes are 30 wide; `a` and `b` set how open
// each eye is, `mouth` the mouth width and `gap` the lip gap, all in a face 200 wide.
function face({ a = 9, b = 9, mouth = 80, gap = 4 }) {
    const pts = new Float32Array(478 * 2);
    const set = (i, x, y) => { pts[2 * i] = x; pts[2 * i + 1] = y; };
    set(234, 0, 100); set(454, 200, 100);
    set(33, 40, 80); set(133, 70, 80); set(159, 55, 80 - a / 2); set(145, 55, 80 + a / 2);
    set(362, 130, 80); set(263, 160, 80); set(386, 145, 80 - b / 2); set(374, 145, 80 + b / 2);
    set(61, 100 - mouth / 2, 150); set(291, 100 + mouth / 2, 150); set(13, 100, 150 - gap / 2); set(14, 100, 150 + gap / 2);
    return pts;
}
const clip = (spec) => spec.map(([t, f]) => ({ t, pts: face(f) }));

test('faceMeasures reads eye openness, mouth width and lip gap', () => {
    const m = logic.faceMeasures(face({ a: 3, b: 9, mouth: 90, gap: 10 }));
    assert.ok(Math.abs(m.eyeA - 0.1) < 1e-6 && Math.abs(m.eyeB - 0.3) < 1e-6);
    assert.ok(Math.abs(m.mouth - 0.45) < 1e-6 && Math.abs(m.gap - 0.05) < 1e-6);
});

test('a held wink gives one sparkle on the closed side; a blink and a flicker give none', () => {
    const frames = [];
    for (let t = 0; t < 2000; t += 33) frames.push([t, t >= 300 && t < 1300 ? { a: 2 } : {}]);
    const marked = logic.markEffects(clip(frames), 0.4);
    const lit = marked.filter((f) => f.sparkle);
    assert.ok(lit.length > 0 && lit.every((f) => f.sparkle.side === 'a'));
    assert.ok(lit[lit.length - 1].sparkle.age < logic.SPARKLE_MS);
    assert.equal(new Set(lit.map((f) => f.t - f.sparkle.age)).size, 1, 'one sparkle for one held wink');

    const blink = clip([[0, {}], [33, { a: 1, b: 1 }], [66, { a: 1, b: 1 }], [99, { a: 1, b: 1 }], [132, { a: 1, b: 1 }], [165, {}]]);
    assert.ok(logic.markEffects(blink, 0.4).every((f) => !f.sparkle), 'both eyes closed is a blink');

    const flicker = clip([[0, {}], [33, { b: 2 }], [66, {}], [99, {}]]);
    assert.ok(logic.markEffects(flicker, 0.4).every((f) => !f.sparkle), 'too short to be a wink');
});

test('smile lines ease in on a held wide mouth, not on an open mouth or a resting face', () => {
    const frames = [];
    for (let t = 0; t < 3000; t += 33) frames.push([t, t >= 500 && t < 2000 ? { mouth: 96 } : {}]);
    const marked = logic.markEffects(clip(frames), 0.4);
    assert.ok(marked.find((f) => f.t >= 1500).smile > 0.9);
    assert.ok(marked[0].smile === 0 && marked[marked.length - 1].smile < 0.1);

    const open = [];
    for (let t = 0; t < 1500; t += 33) open.push([t, { mouth: 96, gap: 40 }]);
    assert.ok(logic.markEffects(clip(open), 0.4).every((f) => f.smile < 0.01), 'a wide-open mouth is not a smile');
});

test('restingValue takes a low percentile so smiles do not raise the rest', () => {
    assert.equal(logic.restingValue([]), 0);
    assert.equal(logic.restingValue([0.40, 0.41, 0.40, 0.39, 0.40, 0.48, 0.49, 0.50, 0.40, 0.41]), 0.4);
});
