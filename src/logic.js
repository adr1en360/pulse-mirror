'use strict';

// Pure logic for Pulse Mirror, kept free of the DOM and the SDK so it can be tested on its own.

// How long a good pulse reading keeps the app "locked" after it arrives.
const LOCK_HOLD_MS = 1500;

// Scales the newest value into 0..1 against the recent range held in `buf`
// (a rolling window of `size` samples). A flat signal sits in the middle.
function position(buf, value, size) {
    buf.push(value);
    if (buf.length > size) buf.shift();
    let lo = Infinity, hi = -Infinity;
    for (const v of buf) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi > lo ? (value - lo) / (hi - lo) : 0.5;
}

// A pulse counts as found at this confidence or higher, and only when the SDK marks it stable.
function isGoodPulse(pulse, minConfidence) {
    return !!pulse && pulse.confidence >= minConfidence && pulse.stable === true;
}

// The shown beat count moves gently toward each new reading.
function smoothBpm(previous, value) {
    return previous === null ? value : previous * 0.7 + value * 0.3;
}

// The searching, locked and lost states. `lastGood` is the time of the last good reading (0 if none).
// A pulse that has gone stale is lost, whether or not the SDK is reconnecting: the beat is never faked.
function nextState(state, now, lastGood, lostAfterMs) {
    if ((state === 'finding' || state === 'lost') && lastGood && now - lastGood < LOCK_HOLD_MS) return 'locked';
    if (state === 'locked' && now - lastGood > lostAfterMs) return 'lost';
    return state;
}

// The beat count put into the spoken status: it changes only on a clear shift, so a screen reader
// is not told a new number every second.
function announceBpm(announced, bpmShown) {
    if (bpmShown === null) return announced;
    const now = Math.round(bpmShown);
    return announced === null || Math.abs(now - announced) >= 4 ? now : announced;
}

// Face landmarks as flat x,y pairs in video pixels. The SDK may give fractions of the frame or pixels.
function toPixels(points, normalized, vw, vh) {
    const out = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        out[2 * i] = normalized ? points[i].x * vw : points[i].x;
        out[2 * i + 1] = normalized ? points[i].y * vh : points[i].y;
    }
    return out;
}

// Captured frames carry real timestamps (`t`, in ms from the start), so a clip lasts exactly
// as long as it was recorded, whatever rate the screen happened to draw at.
function clipDuration(frames, frameMs) {
    return Math.max(1, frames[frames.length - 1].t + frameMs);
}

// The last frame at or before `ms`, clamped to the first and last frame.
function frameAt(frames, ms) {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].t <= ms) lo = mid; else hi = mid - 1;
    }
    return frames[lo];
}

// The breath swell shows only while the SDK has recently been confident about breathing.
// It eases toward on or off a little each frame, so it fades in and out instead of popping.
function breathGate(gate, now, lastBreathGood, holdMs) {
    const target = lastBreathGood && now - lastBreathGood < holdMs ? 1 : 0;
    return gate + (target - gate) * 0.03;
}

module.exports = { LOCK_HOLD_MS, position, isGoodPulse, smoothBpm, nextState, announceBpm, toPixels, clipDuration, frameAt, breathGate };
