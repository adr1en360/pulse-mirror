# Pulse Mirror: product spec

Status: FROZEN on 11 Nov 2026. Changes need the owner's explicit OK.

Change log:
- 12 Nov 2026, owner's request: the clip background is a flat deep teal (#19404c), chosen so white lines and vermilion stand out without clashing, and the clip carries no viewfinder-style marks: no corner brackets, crosshair or rings.
- 12 Nov 2026, owner's request: the portrait no longer fills the face with a sampled skin colour (it read badly in poor light). It is pure line art on the grey field. The mouth and brows get a mild boost (about 1.35x and 1.4x vertical) so a smile and raised eyebrows read clearly.
- 12 Nov 2026, owner's request: the person can type their name after recording, shown in the caption of the clip and image, and can set the clip length (3 to 30 seconds, default 6) before capturing. A capture now stores drawing data rather than encoded video, so the name can be added afterwards; saving renders the final mp4 or png. Neither the name nor the length is stored.
- 12 Nov 2026, owner's request: the review screen also offers Save image, a PNG still of the portrait at the strongest heartbeat of the capture, alongside Save clip.
- 12 Nov 2026, owner's request: the share clip no longer contains the person's video. It shows a hand-drawn, animated line portrait traced live from the face landmarks (so the person's own smile, blinks, mouth and eyebrows move it), with the beating heart doodle and the BPM caption. The SDK's emotion labels are not used (they failed testing).

## One line

A mirror that shows your heartbeat in your own face.

## What it does

You sit in front of your laptop camera and see yourself live. Once the SmartSpectra SDK has found your pulse, your face visibly throbs in time with it and gently swells with each breath. Press a key to capture a six-second looping portrait that keeps beating at your rhythm. A printed photo held to the camera stays still, because it has no pulse.

Everything on screen is drawn from the SDK's live readings. Nothing is simulated.

## Platform

Electron desktop app on Windows x64 (SmartSpectra Node/Electron SDK). Laptop built-in webcam. Setup: Node 22, `npm install`, an API key in a local `.env`.

## Screens and states

1. **Consent.** Plain-language card: what the camera sees, that processing happens on this device, that nothing is saved unless you press Capture, what the SDK sends (API key check and usage count; telemetry disabled). One button: Start camera. A visible "camera on" badge stays on screen while the camera runs. Escape or Stop turns it off.
2. **Finding.** Live mirror with a light face mesh. Friendly hints from the SDK's validation codes (too dark, move closer, hold still). A calm "finding your heartbeat" ring fills the wait, which is about 20 to 30 seconds in testing.
3. **Locked.** Triggered when pulse confidence is at least 40 and the SDK marks it stable. The face throbs with the live pulse waveform; the chest/face swell follows the breathing trace. Shows "about N beats a minute" as plain information.
4. **Lost.** If confidence stays below 40 for more than 3 seconds, the throb fades out and the app says "can't find your pulse, check the light". It never fakes a beat.
5. **Capture and share.** A key press records six seconds. A preview shows a looping share clip: a hand-drawn line portrait of the person, traced from the live face landmarks in scratchy film-animation lines on a flat deep teal field, so their own expression moves it; their cheeks hatch with each pulse and the drawing breathes. Beside it a hand-drawn heart beats at the live pulse, and a caption reads "about N beats a minute", the date and "Pulse Mirror". The clip contains no photo or video of the person. Save writes an mp4 (webm if mp4 is unavailable) to a local file the user chooses; Discard throws it away. If the pulse is lost mid-recording the capture is cancelled. The app never uploads anything; the user shares the file themselves.

## Signal map (what each reading does)

| SDK reading | Job in the app |
|---|---|
| Pulse waveform + pulse rate + confidence + stable flag | Drives the throb; gates Locked and Lost |
| Breathing upper trace | Drives the slow swell |
| Face landmarks (478 points) | Place the tint on cheeks and forehead; confirm one face |
| Pulse waveform (again) | Beats the doodle heart and hatches the cheeks of the line portrait in the share clip |
| Face landmarks (again) | Drawn as the line portrait in the share clip: face outline, brows, eyes, pupils, lips, nose |
| Validation codes | Hints in Finding |

## Throb method

- **Version A (committed):** a skin tint over cheeks and forehead, masked with the face landmarks, pulsing with the real waveform. It is a drawing driven by the real heartbeat, and the post and README say so.
- **Version B (only if ahead on 18 Nov):** real colour magnification of the video's skin region, band-limited around the SDK's pulse rate.

## Honesty rules

- No medical or diagnostic wording, no "healthy" verdicts, no blood pressure, no apnea.
- Never claim liveness or anti-spoofing: tests showed a recorded video of a real face is read as a pulse; only a still photo fails.
- Credit prior art in the README and post: MIT's Medical Mirror (Poh, McDuff, Picard) and open-source webcam-pulse-detector projects.
- Mark every mock or sample asset as such.

## Out of scope

Accounts, servers, upload or hosted sharing links (the file is shared by the user), multi-person, health scores, audio, mobile.

## Cut order (cut from the top when the clock slips)

1. Polish extras (sound, themes)
2. Breath swell
3. Version B magnification
4. Doodle heart: fall back to a plain caption card
5. mp4 output: fall back to webm
6. Never cut: consent screen, Lost state, honest labelling, capture and save

## Build slices

1. Electron shell, laptop-camera picker, SDK metrics flowing, API key from `.env`
2. Finding and Locked/Lost states from confidence
3. Throb overlay using landmarks and the live waveform
4. Breath swell
5. Capture, doodle heart and share-clip export
6. Consent screen, camera badge, settings (telemetry off), README
7. Demo recording on a steady connection

## Known risks

- Pulse appears about 20 to 27 s after start, not 15 s. The first seconds must still look alive.
- The SDK session can die if its usage check cannot reach Presage; restart the session automatically.
- Lamp light on a laptop webcam gives low frame rates and confidence; test and tune lighting early.
