---
name: Pulse Mirror
description: A home-movie projection of your own heartbeat. Academy-leader grey, white hairlines, one vermilion pulse.
colors:
  stage: "#101214"
  leader: "#666b71"
  ink: "#f2f3f4"
  ink-dim: "#aeb3b9"
  signal: "#ff5b3d"
  clip-teal: "#19404c"
typography:
  display:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(120px, 26vh, 300px)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(40px, 6.4vh, 64px)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "0.01em"
  readout:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "72px"
    fontWeight: 800
    lineHeight: 1
  label:
    fontFamily: "Big Shoulders Display, sans-serif"
    fontSize: "18px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.1em"
  body:
    fontFamily: "Geist, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  key: "2px"
spacing:
  strip: "64px"
  key-gap: "10px"
  strip-pad: "24px"
components:
  key:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.key}"
    padding: "8px 18px"
  key-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.stage}"
    rounded: "{rounded.key}"
    padding: "8px 18px"
  key-small:
    padding: "6px 12px"
  consent-card:
    backgroundColor: "{colors.leader}"
    textColor: "{colors.ink}"
    padding: "28px 32px"
    width: "min(560px, 80%)"
  badge:
    backgroundColor: "rgba(16, 18, 20, 0.78)"
    textColor: "{colors.ink}"
    padding: "3px 10px 3px 8px"
  beat-plate:
    backgroundColor: "rgba(16, 18, 20, 0.78)"
    textColor: "{colors.signal}"
    padding: "6px 16px 8px 14px"
  name-field:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.key}"
    padding: "8px 12px"
    width: "190px"
---

# Design System: Pulse Mirror

## Overview

**Creative North Star: "The Film Leader"**

The wait to find your pulse is an Academy-leader countdown: a grey field, white hairline crosshair and two rings, a sweeping arm, a large outlined numeral counting seconds. Once the pulse locks, the leader falls away and the person's own mirrored face, tinted vermilion in time with the real waveform, is the only thing that moves. The interface recedes; the face leads.

Everything is flat. There are no shadows, no glows, no gradients except the sweep arm itself, and no rounded pills. Controls are plain labelled keys with a 2px white outline, like labels on a film can. Sentences are set in a quiet humanist sans; everything big or labelled is a condensed uppercase display face. One accent, vermilion, is reserved for the live pulse.

The saved clip is a second surface in the same world: a flat teal card, a white hand-drawn line portrait, scratchy vermilion hatching, and a dark caption plate. It contains no photograph or video of the person.

**Key Characteristics:**
- Near-black stage (never pure black) around a 16:9 grey-leader mirror frame.
- White hairlines at 2px; condensed 800-weight uppercase for numerals, keys and labels.
- One accent, vermilion, used only for the live pulse (beat readout, face tint, heart, cheek hatching).
- Flat, shadowless, glow-free; depth comes from translucent dark plates over the picture.
- Desktop only (Electron); one screen, no side panel.

## Colors

A cold neutral stack of near-black, film grey and off-white, with a single hot vermilion.

### Primary
- **Pulse Vermilion** (signal): the live heartbeat and nothing else. The beat readout number, the face-flush tint, the clip's doodle heart outline and hatching, the clip's cheek hatching. Rare by design.

### Neutral
- **Stage Near-Black** (stage): window background, text on filled keys, the clip element's fallback fill. Also the base of the translucent dark plates (78% alpha) behind the badge and beat readout.
- **Leader Grey** (leader): the mirror frame's field and the consent card. Drops to 50% alpha while finding or lost, and to 0 once locked.
- **Projector White** (ink): body text, key outlines, numeral stroke, the hairlines (at 85% alpha in the leader), the clip's portrait lines.
- **Dim Ink** (ink-dim): the single status sentence, field labels, input placeholder.

### Clip surface
- **Deep Clip Teal** (clip-teal): the flat backdrop of the saved clip and image only. It is not used in the app window. Vermilion on it is about 4:1.

### Named Rules
**The One Signal Rule.** Vermilion marks the live pulse and nothing else: not buttons, not links, not errors, not decoration. If the pulse is not involved, it is not vermilion.

**The No Skin Rule.** The clip draws line only, with no skin tone and no photo. Anything representing a face is white line over flat colour.

## Typography

**Display Font:** Big Shoulders Display, weight 800 only (with Arial Narrow fallback), served from assets/fonts
**Body Font:** Geist, variable 100 to 900 (with Segoe UI, system-ui), served from assets/fonts

**Character:** A condensed industrial slab for anything that is read as a mark (numerals, keys, labels, readout) against a calm geometric sans for sentences. Both load locally with font-display block; no network fonts.

### Hierarchy
- **Display** (800, clamp(120px, 26vh, 300px), 1): the leader countdown numeral, transparent fill with a 3px white outline, tabular numerals, 0.02em tracking.
- **Headline** (800, clamp(40px, 6.4vh, 64px), 0.98): the consent title, uppercase.
- **Readout** (800, 72px, 1): the beat number inside the beat plate, in vermilion, tabular.
- **Label** (800, 18px, 0.1em, uppercase): keys; field labels and the length label at 16px in dim ink; badge and beat-plate words at 14px and 16px at weight 700 (only the 800 file ships, so 700 renders as 800).
- **Body** (400, 16px, 1.5): consent text up to 62ch; the fine print at 14px; the status sentence in dim ink; the name input at weight 500.
- **Clip caption** (canvas): 800 46px display line, 500 20px Geist second line in #d4d8dc.

### Named Rules
**The Numerals Are The Voice Rule.** Large type is condensed numerals or display-face uppercase only. Sentences never go in the display face.

## Layout

A full-window near-black stage with the mirror frame centred at exactly 16:9, sized to the shorter of window width and (viewport height minus the 64px strip minus 20px) times 16/9, with 20px top and 24px side padding. The frame is the whole point of the screen; there is no side panel. Beneath it a 64px strip holds, left to right, the optional name field, one flexible status sentence, and the row of keys (10px gap, 24px side padding). Overlays sit inside the frame: camera-on badge top left (14px, 16px inset), beat plate bottom left (20px, 16px inset), the consent card centred (max 560px). Desktop only; no breakpoints exist.

The clip is a 1280 by 720 canvas: portrait centred near (600, 300), heart at (940, 470), caption plate 700 by 96 at 40px from left and bottom.

## Elevation & Depth

Flat. There are no box shadows, glows or blurs in the interface. Depth is expressed by stacking: leader field over live video, translucent near-black plates (78% alpha) over the picture for the badge, beat readout and clip caption. The only blur is inside the canvas face tint, feathered at the face edge.

### Named Rules
**The Still Grain Rule.** No flicker, no film-grain animation, no glow. Film feeling comes from the leader geometry and hand-redrawn lines, not from simulated damage.

## Shapes

Hairline geometry: 2px white lines, concentric circles (radii 300 and 360 on a 1600 by 900 field) and a centred crosshair, all with non-scaling strokes. Keys, the name field and the consent card are rectangular with a 2px radius (keys, input) or square corners (card) and a 2px outline. The only round things are the sweep arm, the badge dot (8px) and the circles. The clip uses round line caps and joins.

## Components

### Keys
Plain labelled keys, like film-can labels.
- **Shape:** 2px radius, 2px ink outline (2px).
- **Default:** transparent, ink text, 8px 18px, 18px uppercase display label.
- **Primary:** filled ink, stage-coloured text. Hover goes to white.
- **Hover:** secondary keys fill with ink at 14% alpha, 120ms.
- **Press:** translateY(1px) scale(0.98), 120ms, tactile.
- **Disabled:** 35% opacity.
- **Toggle on** (aria-pressed, Calm motion): filled ink, like primary.
- **Focus:** 2px ink outline, 3px offset.
- **Small** (length minus and plus): 6px 12px.

### Leader
Crosshair lines, two rings, a conic sweep arm (62% wide, white at 50% alpha fading to nothing over 38 degrees, a 4s linear turn), and the outline numeral showing elapsed seconds, two digits, capped at 99.

### Camera-on badge
Dark plate (78%), 14px uppercase display text, 8px ink dot. Visible in every state except consent. During recording its text becomes a Recording countdown; there is no distinct colour for it.

### Beat plate
Bottom-left dark plate, shown only when locked: "about", the BPM in 72px vermilion, "beats a minute". Hidden in clip review.

### Status strip
One sentence in dim ink. Errors turn it to a pale coral (#ffb4a6), not vermilion.

### Name field and length control
Name field appears in review: label in dim ink, 190px input, 2px ink outline, transparent, max 24 characters. The length control (label, minus, 22px value, plus) is visible before capture and hidden in consent.

### Consent card
Opaque leader grey card with a 2px hairline border, uppercase headline, two paragraphs, one primary key. Shown only in the consent state; the numeral and arm are hidden then.

### States
- **Consent:** leader opaque; the card is the only content.
- **Finding:** leader at 50% alpha so the live face shows; light mesh dots (every fifth landmark, 2px, white at 70%) drawn over the face; arm sweeps; numeral counts up.
- **Locked:** leader, arm and numeral fade out (700ms and 500ms); the face tints vermilion with the pulse; the beat plate appears.
- **Lost:** same as finding, with the arm slowed to an 8s turn; status says plainly it cannot find the pulse.
- **Recording / review:** the badge counts down while capturing; review replays the clip canvas in place of the frame, with the name field, Save clip, Save image and Discard shown.

### Motion
Easing is one curve, cubic-bezier(0.16, 1, 0.3, 1), for fades (500 to 700ms) and key feedback (120ms). The arm sweeps only while searching. Once locked, the pulse tint and a tiny breath swell (1.2% scale) are the only motion. Calm motion cuts the sweep entirely, reduces the tint strength to 35%, the swell to 0.4%, and the clip's portrait breath to 1%; the same happens for prefers-reduced-motion for the sweep.

### Clip surface (canvas)
- Flat clip-teal backdrop, nothing else: no crosshair, rings, corner marks or viewfinder.
- White line portrait (face oval, eyes, brows, nose, lips), each line with a dark under-stroke at 50% alpha 5px wider so it reads on any ground; pupils filled; open mouth a dark shape. Lines are redrawn about nine times a second with small jitter, hand-animated.
- Vermilion cheek hatching that gets denser and brighter with each beat.
- A doodle heart: vermilion 4.5px outline over a dark 9px under-stroke, diagonal hatching inside, wobble shared between passes, pulsing 18% with the beat.
- Dark caption plate (78%): "ABOUT N BEATS A MINUTE" in display face, then name, date and PULSE MIRROR in Geist.

## Do's and Don'ts

### Do:
- **Do** reserve vermilion (#ff5b3d) for the live pulse.
- **Do** keep every surface flat: 2px outlines, no shadows, no glows.
- **Do** set numerals and labels in Big Shoulders Display 800, sentences in Geist.
- **Do** give press feedback (1px down, 98% scale) and a focus outline (2px, 3px offset) on every key.
- **Do** give any new line over the picture a dark under-stroke, and any new text over the picture a 78% near-black plate.
- **Do** keep the leader's hairlines at 2px with non-scaling strokes.
- **Do** make anything that moves respect the calm option.

### Don't:
- **Don't** use pure black; stage is #101214 and ink is #f2f3f4.
- **Don't** add a second accent, graphs, number tiles or a side panel.
- **Don't** draw skin colour, photos or video of the person into the clip.
- **Don't** add flicker, animated grain, glow or blur effects.
- **Don't** put sentences in the display face or marketing serifs anywhere.
- **Don't** add viewfinder marks, crosshair or rings to the clip.
