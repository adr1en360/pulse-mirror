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
    }));
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

    if (reconnecting) {
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

// MediaPipe face-mesh outline: the tint covers the whole face, not three spots.
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

function draw() {
    requestAnimationFrame(draw);
    const frame = els.frame.getBoundingClientRect();
    const w = Math.round(frame.width), h = Math.round(frame.height);
    if (els.tint.width !== w || els.tint.height !== h) { els.tint.width = w; els.tint.height = h; }
    const g = els.tint.getContext('2d');
    g.clearRect(0, 0, w, h);

    const calm = document.body.classList.contains('calm');
    if (DEV_SYNTHETIC) targetBeat = (Math.sin(performance.now() / 1000 * Math.PI * 2 * 1.3) + 1) / 2;
    beat += (targetBeat - beat) * 0.55;
    swell += (targetSwell - swell) * 0.08;
    const swellAmount = state === 'locked' ? (calm ? 0.004 : 0.012) : 0;
    els.mirror.style.setProperty('--swell', String(1 + swellAmount * swell));
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
    g.fillStyle = 'rgba(255, 91, 61, ' + Math.min(1, 0.55 * strength) + ')';
    g.globalCompositeOperation = 'soft-light';
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(255, 91, 61, ' + 0.16 * strength + ')';
    g.fill();
    g.restore();
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

els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
els.calm.addEventListener('click', () => {
    const on = !document.body.classList.contains('calm');
    document.body.classList.toggle('calm', on);
    els.calm.setAttribute('aria-pressed', String(on));
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state !== 'consent') stop(); });
setInterval(tick, 250);
requestAnimationFrame(draw);
