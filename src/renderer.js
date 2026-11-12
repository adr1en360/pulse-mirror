'use strict';

const {
    SmartSpectraSDK,
    ProcessingStatus,
    breathingMetrics,
    cardioMetrics,
    faceMetrics,
} = require('@smartspectra/node-sdk/renderer');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const $ = (id) => document.getElementById(id);
const els = {
    preview: $('preview'), badge: $('badge'), hint: $('hint'), error: $('error'),
    pulse: $('pulse'), conf: $('conf'), breath: $('breath'), stable: $('stable'),
    wave: $('wave'), start: $('start'), stop: $('stop'),
};

const WAVE_SAMPLES = 300;
const wave = [];
let sdk = null;
let stream = null;

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

function setBadge(on) {
    els.badge.textContent = on ? 'camera on' : 'camera off';
    els.badge.classList.toggle('on', on);
}

function last(arr) {
    return arr && arr.length ? arr[arr.length - 1] : null;
}

function drawWave() {
    const c = els.wave, g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (wave.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of wave) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    g.strokeStyle = '#ff5a6e';
    g.lineWidth = 2;
    g.beginPath();
    wave.forEach((v, i) => {
        const x = (i / (WAVE_SAMPLES - 1)) * c.width;
        const y = c.height - 8 - ((v - lo) / span) * (c.height - 16);
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.stroke();
}

let lastLog = 0;
function logReadings(pulse, breath, waveCount) {
    const now = Date.now();
    if (now - lastLog < 1000) return;
    lastLog = now;
    console.log('[pm] readings ' + JSON.stringify({
        pulse: pulse ? Math.round(pulse.value) : null,
        conf: pulse ? Math.round(pulse.confidence) : null,
        stable: pulse ? pulse.stable : null,
        breath: breath ? Math.round(breath.value) : null,
        waveSamples: waveCount,
    }));
}

function onMetrics(buf) {
    const m = decodeMetrics(buf);
    const pulse = last(m.cardio?.pulseRate);
    if (pulse) {
        els.pulse.textContent = Math.round(pulse.value);
        els.conf.textContent = Math.round(pulse.confidence);
        els.stable.textContent = pulse.stable ? 'yes' : 'no';
    }
    const breath = last(m.breathing?.rate);
    if (breath) els.breath.textContent = Math.round(breath.value);
    for (const s of m.cardio?.arterialPressureTrace ?? []) {
        wave.push(s.value);
        if (wave.length > WAVE_SAMPLES) wave.shift();
    }
    drawWave();
    logReadings(pulse, breath, wave.length);
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
    sdk.on('validationStatus', (code, ts, hint) => { els.hint.textContent = hint || ''; });
    sdk.on('processingStatus', (status) => {
        console.log('[pm] status ' + status);
        const running = status === ProcessingStatus.kRunning || status === ProcessingStatus.kStarting;
        els.start.disabled = running;
        els.stop.disabled = !running;
        if (status === ProcessingStatus.kError) els.error.textContent = 'The SDK stopped. Press Start camera to try again.';
    });
    sdk.on('error', (code, message) => {
        console.error('[pm] sdk error ' + code + ': ' + message);
        els.error.textContent = message;
    });
}

async function start() {
    els.error.textContent = '';
    els.start.disabled = true;
    try {
        if (!sdk) buildSdk();
        stream = await openLaptopCamera();
        sdk.useMediaStream(stream);
        els.preview.srcObject = stream;
        await sdk.start();
        setBadge(true);
    } catch (err) {
        els.error.textContent = err.message || String(err);
        console.error('[pm] start failed', err);
        await stop();
    }
}

async function stop() {
    els.stop.disabled = true;
    try { if (sdk) await sdk.stop(); } catch (err) { console.error('[pm] stop failed', err); }
    if (sdk) { try { sdk.destroy(); } catch { /* already gone */ } sdk = null; }
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    els.preview.srcObject = null;
    els.hint.textContent = '';
    wave.length = 0;
    drawWave();
    setBadge(false);
    els.start.disabled = false;
}

els.start.addEventListener('click', start);
els.stop.addEventListener('click', stop);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') stop(); });
