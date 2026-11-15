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

// ---- Doodle effects: a sparkle on a wink, smile lines on a smile ----
// They are read from how the face points move, never from the SDK's emotion labels,
// and they never touch the heart or the cheek hatching, which stay pulse-only.

const WINK_RATIO = 0.5;      // the closed eye is less than half as open as the other
const WINK_OPEN_MIN = 0.18;  // and the other eye is clearly open (a blink closes both)
const WINK_HOLD_MS = 120;
const SPARKLE_MS = 900;
const SMILE_GAIN = 1.1;      // the mouth is at least 10% wider than at rest
const SMILE_GAP_MAX = 0.12;  // and not wide open, so an "o" or a yawn does not count
const SMILE_HOLD_MS = 200;

// Openness of each eye, mouth width and lip gap from MediaPipe face-mesh points (flat x,y pairs).
// Eye A is drawn from points 33 to 133, eye B from 362 to 263.
function faceMeasures(pts) {
    const d = (a, b) => Math.hypot(pts[2 * a] - pts[2 * b], pts[2 * a + 1] - pts[2 * b + 1]);
    const faceW = d(234, 454) || 1;
    return {
        eyeA: d(159, 145) / (d(33, 133) || 1),
        eyeB: d(386, 374) / (d(362, 263) || 1),
        mouth: d(61, 291) / faceW,
        gap: d(13, 14) / faceW,
    };
}

// The resting mouth width: a low percentile, so smiles in the history do not raise it.
function restingValue(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.3)];
}

// Marks each captured frame with `sparkle` ({ side: 'a' | 'b', age } or null) and `smile` (0..1).
// One sparkle per wink, shown for SPARKLE_MS; the smile lines ease in and out.
function markEffects(frames, restMouth) {
    const rest = restMouth || restingValue(frames.map((f) => faceMeasures(f.pts).mouth));
    let winkSince = -1, winkSide = '', fired = false;
    let sparkleAt = -Infinity, sparkleSide = '';
    let smileSince = -1, smile = 0, lastT = frames.length ? frames[0].t : 0;
    for (const f of frames) {
        const m = faceMeasures(f.pts);
        const hi = Math.max(m.eyeA, m.eyeB), lo = Math.min(m.eyeA, m.eyeB);
        const side = m.eyeA < m.eyeB ? 'a' : 'b';
        const winking = hi > WINK_OPEN_MIN && lo < hi * WINK_RATIO;
        if (!winking) { winkSince = -1; fired = false; }
        else if (winkSince < 0 || side !== winkSide) { winkSince = f.t; winkSide = side; fired = false; }
        if (winkSince >= 0 && !fired && f.t - winkSince >= WINK_HOLD_MS) { sparkleAt = f.t; sparkleSide = side; fired = true; }
        f.sparkle = f.t - sparkleAt < SPARKLE_MS ? { side: sparkleSide, age: f.t - sparkleAt } : null;

        const smiling = rest > 0 && m.mouth > rest * SMILE_GAIN && m.gap < SMILE_GAP_MAX;
        if (!smiling) smileSince = -1;
        else if (smileSince < 0) smileSince = f.t;
        const target = smileSince >= 0 && f.t - smileSince >= SMILE_HOLD_MS ? 1 : 0;
        smile += (target - smile) * Math.min(1, (f.t - lastT) / 250);
        lastT = f.t;
        f.smile = smile;
    }
    return frames;
}

module.exports = { LOCK_HOLD_MS, position, isGoodPulse, smoothBpm, nextState, announceBpm, toPixels, clipDuration, frameAt, breathGate, faceMeasures, restingValue, markEffects, SPARKLE_MS };
