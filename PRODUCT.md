# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Electron desktop app (Windows x64 first), plain HTML/CSS/JavaScript in the renderer, bundled with esbuild. No UI framework. Desktop only; no mobile layout.

## Users
One person at their laptop for about a minute who wants to see their own heartbeat for the first time, then share a short clip of it with someone. They are curious, not clinical. They sit still facing the screen, usually in lamp or window light.

## Product Purpose
Pulse Mirror shows a person their own measured heartbeat in their own face. The camera reads the pulse on the device; the face on screen throbs in time with it and swells gently with each breath. The person can capture a six-second looping clip to share. Success is a moment of wonder ("that is my heart") that someone wants to send on.

## Positioning
It shows the viewer's actual measured pulse waveform in their own reflection, and says so plainly when it cannot find a pulse instead of faking one. Neighbouring products show a number or a graph; this one shows the person.

## Operating Context
A laptop webcam, a lamp, a still seated person. The pulse takes roughly 20 to 30 seconds to appear and breathing about 30 to 40, so the first half minute is a visible "finding your heartbeat" moment, not dead time. The SDK needs a network connection only to check the API key and usage.

## Capabilities and Constraints
- Live mirror with face mesh, throb tied to the real pulse waveform, breath swell, hints from the SDK's validation codes.
- Locked state needs pulse confidence of at least 40 and the stable flag; below 40 for over 3 seconds it fades to a "can't find your pulse" state.
- Capture records six seconds into a looping clip with a code-drawn heart doodle that beats at the live pulse and a caption; saved locally as mp4 (webm fallback). Nothing is uploaded.
- Wording stays at wellness curiosity: "about N beats a minute". No health verdicts, no blood pressure, no apnea, no claims that it detects people or proves anyone is live. A recorded video of a real face is read as a pulse, so liveness is never claimed.
- Camera-on badge always visible while the camera runs. Telemetry disabled. Camera only; never the microphone.
- Throb version A is a tint driven by the real waveform and is described as such. Real video magnification is a possible later version.

## Brand Commitments
Name: Pulse Mirror. Credit prior art openly: MIT's Medical Mirror (Poh, McDuff, Picard) and open-source webcam pulse projects.

## Evidence on Hand
Tested on the owner's own face: the SDK read pulse 86 to 88 beats a minute against a wrist count of 84. A frozen photo gave pulse readings at confidence 0; recordings of a face gave confident readings. No user testing with other people yet; no testimonials or customers.

## Product Principles
1. Show the real signal, never a simulation; when the signal is missing, say so.
2. The person's face is the interface; chrome stays out of the way.
3. Fill the wait honestly: the first half minute is part of the experience.
4. Consent is visible at all times: camera-on, nothing saved unless asked.
5. One screen, one loop, one clear moment of wonder.

## Accessibility & Inclusion
The mirror throbs and swells, so motion can be reduced: provide a calm option that shows the pulse as a gentle brightness change without flashing. Text meets WCAG AA contrast on the dark background. Keyboard works for every action (Start, Capture, Save, Discard, Stop, Escape). The pulse reading should work across skin tones; the lighting hints help any face, and results are never presented as more accurate than they are.
