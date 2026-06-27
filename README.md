# Ajedrez Sonoro — Proof of Concept

A **live, playable chess board that generates music**. Two people play a normal game of chess; every
interaction with the board produces sound, following the logic of the *Ajedrez Sonoro* concept
(Augusto Chikiar · Leonardo Gutierrez · Pablo Martinelli · Paloma Romañach).

This PoC implements **the board, the full chess rules, and the sound‑trigger logic**. The realistic
instrument *timbres* are intentionally **out of scope** — they will be recorded and produced later in
**Ableton Live + Max/MSP**. Here the sound is a placeholder synthesizer, and the whole point of the
architecture is that those real instruments can be plugged in later **without touching the rules,
the board, or the sound logic** — you just change one output mode (see *Integration* below).

---

## Run it

No build step. You need [Node](https://nodejs.org) only to start a local static server (ES modules +
Web Audio require `http://localhost`, not `file://`):

```bash
npm start          # → http://localhost:8000
```

(Any static server works: `python3 -m http.server` or `npx serve .` are fine too.)

Open the page, press **▶ Empezar** (one click is required to unlock browser audio), and play. Use
**Chrome/Edge** if you want the MIDI output mode (Safari/Firefox lack Web MIDI).

Verify the pitch math at any time:

```bash
npm test           # asserts e1→E1, d8→D8, f3→F3, leading tones, dominant chords, MIDI folding
```

---

## How to play / what you'll hear

- **Lift a piece** — click (or press) it, and it goes "in the air": its instrument sounds and
  **swells the longer you hold it** (the doc's "play with time"). **Drop** it on a legal square to
  move, or release on its origin to set it back down (the sound rests).
- **Click‑click** also works: tap a piece to lift it, tap a destination to move it, tap it again to
  put it down.
- The right‑hand panels show exactly what is sounding and why — see below.

### The sound rules (from the source document)

| # | Rule | In the PoC |
|---|------|-----------|
| 1 | **Board → notes.** Files `a..h` → `A B C D E F G A` (American notation; `a` and `h` are both A). The **rank number is the octave**. | `e1`→**E1**, `d8`→**D8**, `f3`→**F3**. Toggle "Notas" to see every square's note on the board. |
| 2 | **Piece → instrument.** Pawn→violins, Bishop→violas, Knight→cellos, Rook→double basses, King & Queen→flutes. | Shown in the Voices panel. |
| 3 | **Inverse density.** More pieces = *less* sound. As pieces are captured, the music **grows**: each captured piece's square‑note **sustains to the end**. | The "Densidad inversa" meter fills as the board empties. |
| 4 | **The King is inverse** — it sounds *while in play*. At the start only the two kings sound (sustained). Lifting the king **silences** it; placing it resumes. | Press Empezar: only `Mi 1` + `Mi 8` (flutes) sound. |
| 5 | **Touch = lift.** Holding any piece raises tension (its instrument swells); setting it down restores stability. | The held voice + tempo‑of‑thought readout. |
| 6 | **Piece under attack ("jaque").** A threatened piece plays its **leading tone** (a semitone below its note) in a **crescendo**; if captured it **resolves to the fundamental** and sustains. | Pawn attacked on `f3` → `E3` crescendo → if taken, `F3` sustains. Threatened squares pulse red. |
| 7 | **King in check / endgame.** On check, all present instruments play the **dominant chord** of the king's square, *forte*. Checkmate → the **resolution (cadence)** ends the piece. | CHECK banner + dominant chord; checkmate plays V→I then releases everything. |
| 8 | **Tonality.** A key can be chosen, transposing the column notes. | The "Tonalidad" dropdown (global semitone transposition). |

### The panels (the PoC "earns its keep" by making the invisible audible)

- **Voces sonando** — every live voice: instrument, note, dynamic, and *why* it's sounding
  (king‑sustain / in‑the‑air / leading‑tone crescendo / captured‑sustain / dominant chord).
- **Densidad inversa** — density rising as captures accumulate (rule 3).
- **Registro de eventos** — a human‑readable log of every semantic event.
- **Monitor MIDI / OSC** — the exact byte / OSC stream the Ableton/Max bridge **would** send,
  shown even in Web‑Audio mode. This is the integration contract, visible without any DAW attached.

---

## Decisions on the document's ambiguities

1. **King start note (e8 vs d8).** Each king sustains the note of the square it actually occupies →
   White **E1**, Black **E8**. The document's "Re 8 (d8)" is a typo (d8 is the black queen). The
   **"Inicio → literal del documento"** preset reproduces the literal `e1`/`d8` reading if you want it.
2. **"Threatened" piece.** A non‑king piece is threatened iff it is attacked by any enemy piece
   (defenders ignored, matching the `f3` example).
3. **Dominant chord on check.** Built as the **V7 over the king's square note as tonic**; checkmate
   resolves to that tonic (I) — an authentic V→I cadence in the "key" of the king's square.
4. **Tonality.** A single global semitone transposition (interval‑preserving, so leading tones and
   chords transpose for free). Diatonic scale‑snapping is a documented extension point, not shipped.
5. **MIDI register.** Scientific pitch, `C4 = 60`, so the doc's octave index *is* the octave number.
   All MIDI is folded into `[0,127]` before any bridge consumes it (a dominant chord stacked on a
   rank‑8 king would otherwise exceed 127).

---

## Architecture — the swap‑in seam

```
pointer ─▶ lift.js ─▶ controller.js ─▶ (event bus) ─▶ sonicLogic.js ─▶ SoundEngine ─▶ sound
                          │ (only module that knows chess)      │ (owns the voice set)
chess.js (vendored) ──────┘                                     └─▶ UI panels (read‑only) + IO monitor
```

- `controller.js` turns chess facts into a stream of **semantic events** (`KING_SUSTAIN_ON`,
  `PIECE_THREATENED`, `PIECE_CAPTURED`, `CHECK`, `CHECKMATE`, …). It is the only place chess logic lives.
- `sonicLogic.js` is the only consumer that produces sound. It owns the voice set and talks to one
  **`SoundEngine` interface** — never to a specific backend.
- The `SoundEngine` interface (`src/audio/soundEngine.js`) is **the seam**. Four interchangeable
  backends implement it:
  - `webAudioEngine.js` — the PoC default (placeholder synth).
  - `midiEngine.js` — **Web MIDI → Ableton Live** (the recorded notes).
  - `oscEngine.js` — **WebSocket → Max/MSP** (continuous control).
  - `nullEngine.js` — silent (the panels still fully describe the state).
- `src/audio/protocol.js` is the single source of truth for the **MIDI/OSC contract** (instrument→
  channel, dynamic→velocity, event→message). The bridges send it; the monitor displays it.

### Files

```
index.html · styles.css · serve.mjs · osc-bridge.js · vendor/chess.js
src/
  music-math.js      pitch math: square→note/MIDI, leading tone, dominant/resolution, transpose
  music-math.test.mjs assertions vs the document's worked examples
  mapping.js         piece→instrument, glyphs, names
  events.js          event bus + the semantic event vocabulary (the seam)
  engineAdapter.js   the only importer of chess.js
  controller.js      game brain: the per‑move pipeline that emits events
  sonicLogic.js      reducer: events → voices → SoundEngine + monitor
  boardView.js       board rendering, highlights, note badges, promotion picker
  lift.js            TOUCH = LIFT pointer state machine (drag + click‑click)
  main.js            bootstrap + Start overlay + wiring
  audio/soundEngine.js  interface + makeEngine() factory
  audio/protocol.js     MIDI/OSC contract
  audio/{webAudio,midi,osc,null}Engine.js  the four backends
  ui/controls.js · ui/panels.js
```

---

## Integrating the real Ableton + Max sounds (later)

Nothing in the rules, mapping, or event layer changes — you select a different output backend.

### MIDI → Ableton Live (the recorded notes)

1. **macOS IAC bus:** Audio MIDI Setup → *Window → Show MIDI Studio* → double‑click **IAC Driver** →
   check *Device is online* → add a port named **"Ajedrez Bus"**.
2. In Ableton Live → *Preferences → Link/Tempo/MIDI*: enable **Track** + **Remote** on the IAC input.
   Create **5 MIDI tracks** receiving channels **1–5**, each loaded with the recorded instrument:

   | Channel | Instrument | Piece |
   |--------:|------------|-------|
   | 1 | violins | pawns |
   | 2 | violas | bishops |
   | 3 | cellos | knights |
   | 4 | double basses | rooks |
   | 5 | flutes | king & queen |

   Velocity carries the dynamic; **CC 11** carries crescendos; **CC 7** (ch 16) is master volume.
3. In the app (Chrome/Edge), set **Salida → MIDI → Ableton**. The same stream you see in the IO
   monitor now plays the real instruments.

### OSC → Max/MSP (continuous control / custom patches)

```bash
npm install        # installs ws + osc (optional deps)
npm run bridge     # ws://localhost:8081 → OSC 127.0.0.1:7400
```

In Max: `[udpreceive 7400] → [route /ajedrez/note/on /ajedrez/crescendo /ajedrez/chord …]`.
In the app, set **Salida → OSC → Max**. OSC addresses are listed in `src/audio/protocol.js`.

> Tip: run both at once for a hybrid setup — MIDI to Live for the notes, OSC to Max for the
> crescendo curves and the inverse‑density scalar.
