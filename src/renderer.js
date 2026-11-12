'use strict';

const {
    SmartSpectraSDK,
    ProcessingStatus,
    ValidationCode,
    breathingMetrics,
    cardioMetrics,
    faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const $ = (id) => document.getElementById(id);
const els = {
    preview: $('preview'), frame: $('frame'), mirror: $('mirror'), tint: $('tint'),
    numeral: $('numeral'), bpm: $('bpm'), status: $('status'),
    start: $('start'), stop: $('stop'), calm: $('calm'),
    capture: $('capture'), save: $('save'), saveImage: $('saveimage'), discard: $('discard'), clip: $('clip'), badge: $('badge'),
    name: $('name'), nameField: $('namefield'), lengthField: $('lengthfield'), lenMinus: $('lenminus'), lenPlus: $('lenplus'), lenVal: $('lenval'),
};

// A pulse counts as found at this confidence or higher (and marked stable).
const LOCK_CONFIDENCE = 40;
// The beat fades to "can't find your pulse" after this long without a good reading.
const LOST_AFTER_MS = 3000;
const STILL_LOOKING_MS = 45000;

// Development only: `electron . --review-locked` drives the beat from a synthetic wave
// so the locked screen can be tuned without a pulse reading. Never used in normal runs.
const DEV_SYNTHETIC = location.search.includes('demo=locked');

let sdk = null;
let stream = null;
let state = 'consent';
let startedAt = 0;
let lastGood = 0;
let bpmShown = null;
let hintText = '';
let hintAt = 0;
let retries = 0;
let reconnecting = false;

// Capture state. Drawing data is stored while recording; see the share clip section below.
const CLIP_W = 1280, CLIP_H = 720;
const clipCanvas = document.createElement('canvas');
clipCanvas.width = CLIP_W;
clipCanvas.height = CLIP_H;
let clipMode = '';   // '', 'recording' or 'review'
let swellScale = 1;
let beatMin = 1, beatMax = 0;

// Live signal buffers. The pulse waveform drives the throb; the chest trace drives the swell.
const pulseWave = [];
const chestWave = [];
let beat = 0;       // 0..1, smoothed pulse waveform position
let swell = 0;      // 0..1, smoothed breath position
let points = null;  // latest face landmarks as pixel-free fractions of the frame
let landmarksNormalized = null;

// Windows can offer the phone (Phone Link) or other virtual cameras as the
// default; pick a physical laptop camera ourselves.
async function openLaptopCamera() {
    const constraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    let devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (devices.some((d) => !d.label)) {
        // Labels stay hidden until a camera has been opened once.
        const probe = await navigator.mediaDevices.getUserMedia({ video: true });
        for (const t of probe.getTracks()) t.stop();
        devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    }
    const virtual = /phone|link|mobile|virtual|android|iphone|galaxy|pixel|obs|droidcam|iriun/i;
    const pick = devices.find((d) => !virtual.test(d.label)) || devices[0];
    if (!pick) throw new Error('No camera found.');
    console.log('[pm] camera: ' + pick.label);
    return navigator.mediaDevices.getUserMedia({ video: { ...constraints, deviceId: { exact: pick.deviceId } } });
}

function last(arr) {
    return arr && arr.length ? arr[arr.length - 1] : null;
}

function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle('error', !!isError);
}

function setState(next) {
    if (state === next) return;
    state = next;
    document.body.dataset.state = next;
    console.log('[pm] state ' + next);
}

// Scale a buffer's latest value into 0..1 against its own recent range.
function position(buf, value, size) {
    buf.push(value);
    if (buf.length > size) buf.shift();
    let lo = Infinity, hi = -Infinity;
    for (const v of buf) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi > lo ? (value - lo) / (hi - lo) : 0.5;
}

let targetBeat = 0, targetSwell = 0;
let lastLog = 0;
function logReadings(pulse, breath) {
    const now = Date.now();
    if (now - lastLog < 1000) return;
    lastLog = now;
    console.log('[pm] readings ' + JSON.stringify({
        state,
        pulse: pulse ? Math.round(pulse.value) : null,
        conf: pulse ? Math.round(pulse.confidence) : null,
        stable: pulse ? pulse.stable : null,
        breath: breath ? Math.round(breath.value) : null,
        landmarks: points ? points.length : 0,
        beatRange: [Math.round(beatMin * 100) / 100, Math.round(beatMax * 100) / 100],
        waveSamples: pulseWave.length,
    }));
    beatMin = 1;
    beatMax = 0;
}

function onMetrics(buf) {
    const m = decodeMetrics(buf);
    const now = performance.now();

    const pulse = last(m.cardio?.pulseRate);
    if (pulse && pulse.confidence >= LOCK_CONFIDENCE && pulse.stable) {
        lastGood = now;
        bpmShown = bpmShown === null ? pulse.value : bpmShown * 0.7 + pulse.value * 0.3;
    }
    const breath = last(m.breathing?.rate);

    for (const s of m.cardio?.arterialPressureTrace ?? []) targetBeat = position(pulseWave, s.value, 90);
    for (const s of m.breathing?.upperTrace ?? []) targetSwell = position(chestWave, s.value, 240);

    const lm = last(m.face?.landmarks);
    if (lm && lm.value && lm.value.length > 400) {
        if (landmarksNormalized === null) {
            let maxX = 0;
            for (const p of lm.value) if (p.x > maxX) maxX = p.x;
            landmarksNormalized = maxX <= 1.5;
            console.log('[pm] landmarks ' + lm.value.length + ' points, ' + (landmarksNormalized ? 'normalized' : 'pixel') + ' coordinates');
        }
        points = lm.value;
    }
    logReadings(pulse, breath);
}

// State changes are decided on a steady clock, not on packet arrival.
function tick() {
    if (state === 'consent') return;
    const now = performance.now();
    if (DEV_SYNTHETIC && now - startedAt > 6000) { lastGood = now; bpmShown = 77; }
    if ((state === 'finding' || state === 'lost') && lastGood && now - lastGood < 1500) {
        setState('locked');
        retries = 0;
    } else if (state === 'locked' && !reconnecting && now - lastGood > LOST_AFTER_MS) {
        setState('lost');
    }

    const elapsed = Math.floor((now - startedAt) / 1000);
    els.numeral.textContent = String(Math.min(elapsed, 99)).padStart(2, '0');
    if (bpmShown !== null) els.bpm.textContent = String(Math.round(bpmShown));

    els.capture.disabled = !(state === 'locked' && !clipMode);
    if (clipMode) {
        // The clip flow owns the status line.
    } else if (reconnecting) {
        setStatus('Connection dropped. Reconnecting...');
    } else if (state === 'locked') {
        setStatus('Your pulse is in the mirror. Sit still to keep it.');
    } else if (state === 'lost') {
        setStatus("Can't find your pulse. Check the light and hold still.");
    } else if (hintText && now - hintAt < 2500) {
        setStatus(hintText);
    } else if (elapsed * 1000 > STILL_LOOKING_MS) {
        setStatus('Still looking. Try more light on your face, and check your internet connection: the pulse model downloads when you start.');
    } else {
        setStatus('Finding your heartbeat. Sit still and face the light.');
    }
}

const CHEEK_LEFT = [50, 205, 187, 123];
const CHEEK_RIGHT = [280, 425, 411, 352];

// MediaPipe face-mesh outline: the tint covers the whole face, not three spots.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function paintOverlay() {
    const frame = els.frame.getBoundingClientRect();
    const w = Math.round(frame.width), h = Math.round(frame.height);
    if (els.tint.width !== w || els.tint.height !== h) { els.tint.width = w; els.tint.height = h; }
    const g = els.tint.getContext('2d');
    g.clearRect(0, 0, w, h);

    const calm = document.body.classList.contains('calm');
    if (DEV_SYNTHETIC) targetBeat = (Math.sin(performance.now() / 1000 * Math.PI * 2 * 1.3) + 1) / 2;
    const shaped = Math.min(1, Math.max(0, (targetBeat - 0.3) / 0.55));
    beat += (shaped - beat) * 0.55;
    if (beat < beatMin) beatMin = beat;
    if (beat > beatMax) beatMax = beat;
    swell += (targetSwell - swell) * 0.08;
    const swellAmount = state === 'locked' ? (calm ? 0.004 : 0.012) : 0;
    swellScale = 1 + swellAmount * swell;
    els.mirror.style.setProperty('--swell', String(swellScale));
    els.tint.style.setProperty('--swell', String(1 + swellAmount * swell));

    if (!points || state === 'consent') return;
    const vw = els.preview.videoWidth || 1280, vh = els.preview.videoHeight || 720;
    const px = (p) => ({ x: (landmarksNormalized ? p.x : p.x / vw) * w, y: (landmarksNormalized ? p.y : p.y / vh) * h });

    if (state === 'finding' || state === 'lost') {
        // A light mesh: the app shows it can see you while it searches.
        g.fillStyle = 'rgba(242, 243, 244, 0.7)';
        for (let i = 0; i < points.length; i += 5) {
            const p = px(points[i]);
            g.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
        return;
    }

    // Locked: flush the whole face with the live pulse waveform, feathered at the edge.
    const strength = (calm ? 0.35 : 1) * (0.05 + 0.95 * beat);
    g.save();
    g.filter = 'blur(' + Math.round(w * 0.012) + 'px)';
    g.beginPath();
    FACE_OVAL.forEach((idx, i) => {
        const p = px(points[idx]);
        if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
    });
    g.closePath();
    g.fillStyle = 'rgba(255, 91, 61, ' + Math.min(1, 0.42 * strength) + ')';
    g.globalCompositeOperation = 'soft-light';
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(255, 91, 61, ' + 0.10 * strength + ')';
    g.fill();
    g.restore();
}

// ---- The share clip ---------------------------------------------------------------------
// The portrait, heart and caption are drawn from recorded frames of data (face points, beat,
// breath, BPM), never from video. A capture stores that data; the review screen
// replays it live, so a name typed afterwards shows at once; saving renders it into an mp4
// or a png with the name in it.

const FRAME_MS = 1000 / 30;
const LENGTHS = [3, 5, 6, 8, 10, 15, 20, 30];
let lengthIndex = 2;                  // 6 seconds
let clipSeconds = LENGTHS[lengthIndex];
let frames = [];
let capturing = false;
let lastPush = 0;
let captureStart = 0;
let replayStart = 0;
let encoding = false;
const clipCtx = clipCanvas.getContext('2d');
const replayCtx = els.clip.getContext('2d');

function heartPoint(a, size) {
    return {
        x: 16 * Math.pow(Math.sin(a), 3) * size / 17,
        y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * size / 17,
    };
}

// Drawn like frame-by-frame film animation: the lines are redrawn about nine times a second.
function drawDoodleHeart(g, cx, cy, size, beatNow, now) {
    const s = size * (1 + 0.18 * beatNow);
    const seed = Math.floor(now / 110);
    const rnd = (i) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of [0, 1]) {
        g.beginPath();
        for (let i = 0; i <= 48; i++) {
            const p = heartPoint((i / 48) * Math.PI * 2, s);
            const j = s * 0.07;
            const x = cx + p.x + rnd(i + pass * 60) * j;
            const y = cy + p.y + rnd(i + pass * 60 + 200) * j;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.strokeStyle = pass === 0 ? 'rgba(16, 18, 20, 0.55)' : '#ff5b3d';
        g.lineWidth = pass === 0 ? 9 : 4.5;
        g.stroke();
    }
    // Hatching inside the outline, clipped to the clean heart shape.
    g.beginPath();
    for (let i = 0; i <= 48; i++) {
        const p = heartPoint((i / 48) * Math.PI * 2, s);
        if (i === 0) g.moveTo(cx + p.x, cy + p.y); else g.lineTo(cx + p.x, cy + p.y);
    }
    g.closePath();
    g.clip();
    g.strokeStyle = 'rgba(255, 91, 61, 0.8)';
    g.lineWidth = 3;
    for (let k = -7; k <= 7; k++) {
        const x0 = cx + k * s * 0.13;
        g.beginPath();
        g.moveTo(x0 - s * 0.9 + rnd(400 + k) * 5, cy + s * 0.9);
        g.lineTo(x0 + s * 0.9 + rnd(500 + k) * 5, cy - s * 0.9);
        g.stroke();
    }
    g.restore();
}

// MediaPipe face-mesh index sets for the line portrait.
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const EYE_LEFT = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const EYE_RIGHT = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const BROW_LEFT = [[276, 283, 282, 295, 285], [300, 293, 334, 296, 336]];
const BROW_RIGHT = [[46, 53, 52, 65, 55], [70, 63, 105, 66, 107]];
const NOSE_BRIDGE = [168, 6, 197, 195, 5, 4];
const NOSE_BASE = [98, 97, 2, 326, 327];
const IRIS_LEFT = 468, IRIS_RIGHT = 473;
const LINE = '#f2f3f4';
const MOUTH_GAIN = 1.35, BROW_GAIN = 1.4;   // a mild boost so expressions read clearly
let portraitScale = 0;

// A smooth hand-drawn curve through the points.
function curve(g, pts, closed) {
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    g.beginPath();
    if (closed) {
        const s = mid(pts[pts.length - 1], pts[0]);
        g.moveTo(s.x, s.y);
        for (let i = 0; i < pts.length; i++) {
            const m = mid(pts[i], pts[(i + 1) % pts.length]);
            g.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
        }
        g.closePath();
    } else {
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
            const m = mid(pts[i], pts[i + 1]);
            g.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
        }
        g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
}

// The leader field behind the portrait, quieter than on screen.
function drawClipBackdrop(g, W, H) {
    g.fillStyle = '#666b71';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(242, 243, 244, 0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, H / 2); g.lineTo(W, H / 2);
    g.moveTo(W / 2, 0); g.lineTo(W / 2, H);
    g.stroke();
    for (const r of [300, 340]) { g.beginPath(); g.arc(W / 2, H / 2, r, 0, Math.PI * 2); g.stroke(); }
}

// One frame of clip data: the face points in video pixels plus the live signals at that moment.
function snapshotFrame(now) {
    if (!points) return null;
    const vw = els.preview.videoWidth || 1280, vh = els.preview.videoHeight || 720;
    const pts = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        pts[2 * i] = landmarksNormalized ? points[i].x * vw : points[i].x;
        pts[2 * i + 1] = landmarksNormalized ? points[i].y * vh : points[i].y;
    }
    return { pts, vw, vh, beat, swell, bpm: bpmShown, calm: document.body.classList.contains('calm') };
}

// Traces the face points as a hand-drawn portrait. The person's own smile, blinks, mouth,
// brows and gaze move it; there is no video of them in the picture.
function drawLinePortrait(g, f, now) {
    const P = (i) => ({ x: f.pts[2 * i], y: f.pts[2 * i + 1] });
    const a = P(234), b = P(454);
    const faceW = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    let cx = 0, cy = 0;
    for (const i of FACE_OVAL) { const p = P(i); cx += p.x; cy += p.y; }
    cx /= FACE_OVAL.length;
    cy /= FACE_OVAL.length;
    portraitScale = portraitScale ? portraitScale * 0.9 + (370 / faceW) * 0.1 : 370 / faceW;
    const k = portraitScale * (1 + (f.calm ? 0.01 : 0.03) * f.swell);   // the drawing breathes
    const ox = 600, oy = 300;
    // Mirrored, like the live mirror; centred and scaled so head movement shows as tilt and turn.
    const T = (i) => { const p = P(i); return { x: ox - (p.x - cx) * k, y: oy + (p.y - cy) * k }; };

    const seed = Math.floor(now / 110);   // lines re-drawn about nine times a second
    const rnd = (i) => { const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };
    const pts = (idx, salt, amp = 3) => idx.map((i, n) => { const t = T(i); return { x: t.x + rnd(salt + n) * amp, y: t.y + rnd(salt + n + 97) * amp }; });
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // Line only: the grey field shows through, and no skin tone is drawn. Each line has a dark
    // under-stroke so it reads on any background.
    const ink = (path, closed, width, alpha = 1) => {
        curve(g, path, closed);
        g.strokeStyle = 'rgba(16, 18, 20, 0.5)';
        g.lineWidth = width + 5;
        g.stroke();
        g.strokeStyle = alpha === 1 ? LINE : 'rgba(242, 243, 244, ' + alpha + ')';
        g.lineWidth = width;
        g.stroke();
    };
    // A mild boost so a smile and raised brows read clearly: vertical distances from the
    // middle of the mouth, and from the eyes, are stretched a little.
    const around = (list, anchor, gain) => list.map((p) => ({ x: p.x, y: anchor.y + (p.y - anchor.y) * gain }));
    const centre = (list) => ({ x: list.reduce((a, p) => a + p.x, 0) / list.length, y: list.reduce((a, p) => a + p.y, 0) / list.length });
    const eyeL = pts(EYE_LEFT, 80, 2), eyeR = pts(EYE_RIGHT, 120, 2);
    const lipsOuter = pts(LIPS_OUTER, 160, 2), lipsInner = pts(LIPS_INNER, 200, 1.5);
    const mouthAnchor = centre(lipsOuter);
    ink(pts(FACE_OVAL, 0), true, 6);
    ink(eyeL, true, 4);
    ink(eyeR, true, 4);
    ink(around(pts(BROW_LEFT[0], 40, 2), centre(eyeL), BROW_GAIN), false, 8);
    ink(around(pts(BROW_RIGHT[0], 60, 2), centre(eyeR), BROW_GAIN), false, 8);
    ink(pts(NOSE_BRIDGE, 240, 2), false, 4, 0.8);
    ink(pts(NOSE_BASE, 260, 2), false, 4, 0.8);
    ink(around(lipsOuter, mouthAnchor, MOUTH_GAIN), true, 4.5);

    // Pupils follow the gaze.
    const eyeW = Math.hypot(T(33).x - T(133).x, T(33).y - T(133).y);
    g.fillStyle = LINE;
    for (const i of [IRIS_LEFT, IRIS_RIGHT]) {
        const t = T(i);
        g.beginPath();
        g.arc(t.x + rnd(300 + i) * 1.5, t.y + rnd(400 + i) * 1.5, Math.max(5, eyeW * 0.17), 0, Math.PI * 2);
        g.fill();
    }

    // The open mouth as a dark shape, so a smile or a spoken word shows.
    curve(g, around(lipsInner, mouthAnchor, MOUTH_GAIN), true);
    g.fillStyle = 'rgba(16, 18, 20, 0.6)';
    g.fill();
    g.strokeStyle = LINE;
    g.lineWidth = 3;
    g.stroke();

    // Cheeks hatch with each pulse: the flush, drawn by hand.
    const r = faceW * k * 0.13;
    g.strokeStyle = '#ff5b3d';
    g.lineWidth = 4;
    for (const idx of [CHEEK_LEFT, CHEEK_RIGHT]) {
        let mx = 0, my = 0;
        for (const i of idx) { const t = T(i); mx += t.x; my += t.y; }
        mx /= idx.length;
        my /= idx.length;
        const n = Math.round(3 + 6 * f.beat);
        g.globalAlpha = 0.25 + 0.75 * f.beat;
        for (let j = 0; j < n; j++) {
            const x0 = mx - r + (j * 2 * r) / Math.max(1, n - 1);
            g.beginPath();
            g.moveTo(x0 + rnd(500 + j) * 4, my + r * 0.75);
            g.lineTo(x0 + r * 0.8 + rnd(520 + j) * 4, my - r * 0.75);
            g.stroke();
        }
    }
    g.globalAlpha = 1;
    g.restore();
}

// A whole clip frame: backdrop, portrait, corner marks, beating heart, caption with the name.
function drawFrame(g, f, name, now) {
    const W = CLIP_W, H = CLIP_H;
    drawClipBackdrop(g, W, H);
    drawLinePortrait(g, f, now);

    // Registration ticks in the corners, from the film leader.
    g.strokeStyle = 'rgba(242, 243, 244, 0.85)';
    g.lineWidth = 3;
    const inset = 22, tick = 34;
    for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) {
        g.beginPath();
        g.moveTo(x + dx * tick, y); g.lineTo(x, y); g.lineTo(x, y + dy * tick);
        g.stroke();
    }

    drawDoodleHeart(g, W - 150, H - 190, 92, f.beat, now);

    // Caption plate: the beat count, then the name, date and product.
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
    const line2 = (name ? name.toUpperCase() + '  ·  ' : '') + date + '  ·  PULSE MIRROR';
    g.fillStyle = 'rgba(16, 18, 20, 0.78)';
    g.fillRect(40, H - 40 - 96, 700, 96);
    g.fillStyle = '#f2f3f4';
    g.textBaseline = 'alphabetic';
    g.font = '800 46px "Big Shoulders Display", sans-serif';
    g.fillText('ABOUT ' + (f.bpm === null ? '--' : Math.round(f.bpm)) + ' BEATS A MINUTE', 62, H - 40 - 48);
    g.fillStyle = '#d4d8dc';
    g.font = '500 20px "Geist", sans-serif';
    g.fillText(line2, 62, H - 40 - 18);
}

function nameValue() {
    return els.name.value.trim().slice(0, 24);
}

// Frames carry real timestamps, so a clip lasts exactly as long as it was recorded,
// whatever rate the screen happened to draw at.
function clipDuration() {
    return Math.max(1, frames[frames.length - 1].t + FRAME_MS);
}

function frameAt(ms) {
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (frames[mid].t <= ms) lo = mid; else hi = mid - 1;
    }
    return frames[lo];
}

function draw() {
    requestAnimationFrame(draw);
    paintOverlay();
    const now = performance.now();
    if (capturing && now - lastPush >= FRAME_MS - 1) {
        const f = snapshotFrame(now);
        if (f) { f.t = now - captureStart; frames.push(f); lastPush = now; }
    }
    if (clipMode === 'review' && frames.length && !encoding) {
        drawFrame(replayCtx, frameAt((now - replayStart) % clipDuration()), nameValue(), now);
    }
}

function pickClipType() {
    const types = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function setClipMode(mode) {
    clipMode = mode;
    document.body.dataset.clip = mode;
    const review = mode === 'review';
    els.save.hidden = !review;
    els.saveImage.hidden = !review;
    els.discard.hidden = !review;
    els.clip.hidden = !review;
    els.nameField.hidden = !review;
    els.capture.hidden = review;
    els.lengthField.hidden = review;
    els.lenMinus.disabled = els.lenPlus.disabled = mode === 'recording';
}

function setLength(index) {
    lengthIndex = Math.min(LENGTHS.length - 1, Math.max(0, index));
    clipSeconds = LENGTHS[lengthIndex];
    els.lenVal.textContent = clipSeconds + ' s';
    els.capture.textContent = 'Capture ' + clipSeconds + ' seconds';
}

async function capture() {
    if (state !== 'locked' || clipMode) return;
    frames = [];
    lastPush = 0;
    captureStart = performance.now();
    capturing = true;
    setClipMode('recording');
    const began = performance.now();
    let cancelled = false;
    let lostMs = 0;
    await new Promise((resolve) => {
        const counter = setInterval(() => {
            const elapsed = (performance.now() - began) / 1000;
            els.badge.textContent = 'Recording ' + Math.max(0, Math.ceil(clipSeconds - elapsed));
            setStatus('Recording ' + clipSeconds + ' seconds. Hold still.');
            lostMs = state === 'locked' ? 0 : lostMs + 200;
            if (lostMs > 1500) cancelled = true;
            if (cancelled || elapsed >= clipSeconds) { clearInterval(counter); resolve(); }
        }, 200);
    });
    capturing = false;
    els.badge.textContent = 'Camera on';
    if (cancelled || frames.length < 10) {
        frames = [];
        setClipMode('');
        setStatus('Lost your pulse during the capture, so nothing was kept. Hold still and try again.', true);
        return;
    }
    portraitScale = 0;
    replayStart = performance.now();
    setClipMode('review');
    setStatus('Clip ready. Add your name, then save.');
}

function dropClip() {
    frames = [];
    encoding = false;
    els.name.value = '';
    setClipMode('');
}

function setBusy(on) {
    for (const b of [els.save, els.saveImage, els.discard]) b.disabled = on;
}

async function saveClip() {
    if (!frames.length || encoding) return;
    const type = pickClipType();
    if (!type) { setStatus('This computer cannot save video here.', true); return; }
    encoding = true;
    setBusy(true);
    setStatus('Preparing your clip, about ' + clipSeconds + ' seconds.');
    try {
        const recorder = new MediaRecorder(clipCanvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6000000 });
        const chunks = [];
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
        const name = nameValue();
        const total = clipDuration();
        const began = performance.now();
        portraitScale = 0;
        recorder.start(250);
        await new Promise((resolve) => {
            const step = () => {
                const e = performance.now() - began;
                if (e >= total) return resolve();
                drawFrame(clipCtx, frameAt(e), name, performance.now());
                requestAnimationFrame(step);
            };
            step();
        });
        recorder.stop();
        await stopped;
        const blob = new Blob(chunks, { type });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const result = await window.pulseMirror.saveClip(bytes, type.startsWith('video/mp4') ? 'mp4' : 'webm');
        if (result && result.saved) {
            const file = String(result.path).split(/[\\/]/).pop();
            dropClip();
            setStatus('Saved ' + file + '.');
            return;
        }
        setStatus('Not saved. You can try again.');
    } catch (err) {
        console.error('[pm] save failed', err);
        setStatus('Could not save the clip. Try again.', true);
    }
    encoding = false;
    portraitScale = 0;
    setBusy(false);
}

async function saveImage() {
    if (!frames.length || encoding) return;
    try {
        // The still is the frame at the strongest heartbeat.
        let best = 0;
        for (let i = 1; i < frames.length; i++) if (frames[i].beat > frames[best].beat) best = i;
        portraitScale = 0;
        drawFrame(clipCtx, frames[best], nameValue(), performance.now());
        portraitScale = 0;
        const blob = await new Promise((resolve) => clipCanvas.toBlob(resolve, 'image/png'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const result = await window.pulseMirror.saveClip(bytes, 'png');
        if (result && result.saved) setStatus('Saved ' + String(result.path).split(/[\\/]/).pop() + '.');
    } catch (err) {
        console.error('[pm] save image failed', err);
        setStatus('Could not save the image. Try again.', true);
    }
}

function discardClip() {
    if (encoding) return;
    dropClip();
    setStatus('Clip discarded.');
}

// A composed frame of the live face, used only by development test modes.
function composeClip() {
    const f = snapshotFrame(performance.now());
    if (f) drawFrame(clipCtx, f, '', performance.now());
}

function buildSdk() {
    const apiKey = (window.pulseMirror && window.pulseMirror.apiKey) || '';
    if (!apiKey) throw new Error('No API key. Copy .env.example to .env and add PRESAGE_API_KEY.');
    sdk = new SmartSpectraSDK({
        apiKey,
        requestedMetrics: [...breathingMetrics, ...cardioMetrics, ...faceMetrics],
        enableAccumulatedOutput: false,
        enableTelemetry: false,
    });
    sdk.on('metrics', (buf) => {
        try { onMetrics(buf); } catch (e) { console.error('[pm] metrics decode failed', e); }
    });
    sdk.on('validationStatus', (code, ts, hint) => {
        if (code !== ValidationCode.kOk && hint) { hintText = hint; hintAt = performance.now(); }
    });
    sdk.on('processingStatus', (status) => {
        console.log('[pm] status ' + status);
        if (status === ProcessingStatus.kError) reconnect();
    });
    sdk.on('error', (code, message) => console.error('[pm] sdk error ' + code + ': ' + message));
}

// The SDK checks its access key online as it runs; a dropped connection ends the
// session. Keep the camera, rebuild the SDK and carry on, a few times.
async function connect() {
    if (!sdk) buildSdk();
    sdk.useMediaStream(stream);
    await sdk.start();
}

async function reconnect() {
    if (reconnecting || state === 'consent') return;
    reconnecting = true;
    try {
        while (state !== 'consent') {
            if (retries >= 6) return fail('Lost the connection to the SDK. Check your internet, then press Start camera.');
            retries++;
            console.log('[pm] reconnect ' + retries);
            const old = sdk;
            sdk = null;
            if (old) {
                try { await old.stop(); } catch { /* already stopped */ }
                try { old.destroy(); } catch { /* already gone */ }
            }
            await new Promise((r) => setTimeout(r, 1500));
            if (state === 'consent') return;
            lastGood = 0;
            startedAt = performance.now();
            try { await connect(); return; } catch (err) { console.error('[pm] reconnect failed', err); }
        }
    } finally {
        reconnecting = false;
    }
}

async function start() {
    els.start.disabled = true;
    setStatus('');
    try {
        stream = await openLaptopCamera();
        els.preview.srcObject = stream;
        retries = 0;
        // Show the mirror at once; starting the SDK needs the network and can take a while.
        startedAt = performance.now();
        lastGood = 0;
        bpmShown = null;
        pulseWave.length = 0;
        chestWave.length = 0;
        points = null;
        landmarksNormalized = null;
        hintText = '';
        setState('finding');
        els.stop.disabled = false;
        await connect();
    } catch (err) {
        console.error('[pm] start failed', err);
        await fail(err.message || String(err));
    }
}

async function release() {
    capturing = false;
    dropClip();
    if (sdk) {
        try { await sdk.stop(); } catch (err) { console.error('[pm] stop failed', err); }
        try { sdk.destroy(); } catch { /* already gone */ }
        sdk = null;
    }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    els.preview.srcObject = null;
    points = null;
    targetBeat = 0; targetSwell = 0;
    els.stop.disabled = true;
    els.start.disabled = false;
    setState('consent');
}

async function stop() {
    await release();
    setStatus('Camera off. Nothing was saved.');
}

async function fail(message) {
    await release();
    setStatus(message, true);
}

// Lets the main process shut the SDK down cleanly before the window closes.
window.pmShutdown = release;

els.capture.addEventListener('click', capture);
els.save.addEventListener('click', saveClip);
els.saveImage.addEventListener('click', saveImage);
els.discard.addEventListener('click', discardClip);
els.lenMinus.addEventListener('click', () => setLength(lengthIndex - 1));
els.lenPlus.addEventListener('click', () => setLength(lengthIndex + 1));
els.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.name.blur(); });
setLength(lengthIndex);
els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
els.calm.addEventListener('click', () => {
    const on = !document.body.classList.contains('calm');
    document.body.classList.toggle('calm', on);
    els.calm.setAttribute('aria-pressed', String(on));
});
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.activeElement === els.name) { els.name.blur(); return; }
    if (clipMode === 'review') discardClip();
    else if (state !== 'consent' && !capturing) stop();
});
setInterval(tick, 250);
requestAnimationFrame(draw);
