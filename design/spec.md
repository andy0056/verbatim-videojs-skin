# Verbatim: design spec

A Video.js v10 skin (HTML, Scaffold base, video preset). One idea: **the caption sentence is the control bar.**

## Why

Subtitles and controls usually compete for the same strip at the bottom of a video. Verbatim makes them one thing. The sentence being spoken sits where the control bar would be, and every word in it is a place you can go. Reading and seeking become the same gesture.

## Anatomy

A single plate at the bottom of the player, two rows on a shared grid.

| Row | Left rail | Middle | Right |
|---|---|---|---|
| Text | Play | Eyebrow (chapter · sentence n / total) over the sentence | Time, Find |
| Bar | Link to this sentence | Seek bar with chapter segments | Mute, Captions, Settings, Fullscreen |

The rail is as wide as the play button, so the seek bar starts where the sentence starts. Picture-in-picture sits alone at the top right. A find field opens as a third row above the text row. When controls go idle the plate folds to the sentence alone, centred, as an ordinary subtitle.

## Tokens

All colour and size decisions are custom properties on `.verbatim` in `src/video/skin.css`.

| Token | Value | Use |
|---|---|---|
| `--vb-sentence-font` | Source Serif 4, then system serifs | The sentence. Everything else is Inter. |
| `--media-default-accent-color` | `oklch(91% 0.11 92)` | Highlighter yellow: current word, fill, focus, matches |
| `--vb-plate` | `oklch(9% 0.012 260 / 0.66)` with `blur(14px) saturate(120%)` | The plate |
| `--vb-plate-idle` | `oklch(9% 0.012 260 / 0.8)` | The idle subtitle, which has no scrim behind it |
| `--vb-fg` / `--vb-fg-muted` / `--vb-fg-dim` | foreground at 100% / 64% / 56% | Spoken words / labels / unspoken words |
| `--vb-accent-wash` / `--vb-accent-rest` | accent at 36% / 14% | Highlighter sweep / the rest of the current word |
| `--vb-plate-pad`, `--vb-plate-gap` | 12px, 8px (10px, 6px under 42rem; 8px, 4px under 24rem) | Plate padding and row gap |
| `--vb-control-radius` | 10px; the plate's radius is this plus its padding | Concentric corners |
| `--vb-rail` | 40px (36px under 42rem, 32px under 24rem, 44px minimum on touch) | Left rail |
| `--vb-thumb` | 13px | Seek thumb; search ticks use the same position formula |

A site sets `--media-accent-color`, `--media-font-family`, `--vb-sentence-font` and `--media-border-radius` on the player or anything around it; the skin reads fonts through internal aliases so those settings are never shut out.

Motion uses the scaffold's `--media-duration*` tokens, which collapse under `prefers-reduced-motion`.

## The sentence

- Captions are merged into sentences and cut to the measured width of the player, so the sentence is never more than two lines and the plate keeps one height per size. A cut prefers a sentence end, then a clause mark, then a hard limit.
- Word timing is interpolated inside each cue by character count. No word-level timestamps are needed.
- States of a word: unspoken (dim), current (bright, a highlighter sweep that follows the word's progress, a 2px underline), spoken (bright), match (boxed), selected match (filled), preview (italic, muted).
- A new sentence enters from the side you are travelling toward.
- The sentence takes its reading direction from the transcript (`dir="auto"`), not from the page. The highlighter and the drag follow it.

## Interactions

| Do | Get |
|---|---|
| Click a word | Jump to it |
| Press and drag along the words | Scrub by word; cross either end to turn the sentence |
| Point at the seek bar | The sentence at that moment replaces the live one, with its time and chapter. No popup. |
| `/` or the Find button, then type | Every place the word is spoken is ticked on the seek bar and boxed in the sentence. Enter next, Shift+Enter previous, Escape closes and returns focus. |
| Link button | Copies the page address with `#t=<seconds>` for the sentence on show. That link opens the player at the sentence; a fragment change on an open page moves it. |
| Stop moving while playing | The plate folds to a one-line subtitle that keeps filling |

Touch: targets are at least 44px, the seek thumb stays visible, the find field is 16px so iOS does not zoom, and a drag ticks once per word where the device supports vibration.

## Keyboard

Source order is visual order, top to bottom and along each row: Picture-in-picture, then Play, sentence, Find, Link, Seek, Mute and volume, Captions, Settings, Fullscreen.

- The sentence is one tab stop with the slider role: ← → by word, ↑ ↓ by sentence, Home and End.
- All Video.js hotkeys remain (J, K, L, M, F, C, digits). Typing in the find field never triggers them.
- Idle never removes a focused control from layout. With keyboard focus inside the plate, the full plate stays.
- The faded centre play button leaves the tab order.

## Accessibility

- Unspoken words measure 4.7:1 on the full plate and 5.2:1 on the idle subtitle over a white frame. The eyebrow measures 5.7:1.
- Every label goes through Video.js i18n (`<media-text>` in markup, the i18n controller in script).
- Search count, the matched sentence, and "Link copied" are announced through polite live regions.
- `prefers-reduced-motion`: no sweep, no sentence turn, no field animation; states still change.
- `prefers-reduced-transparency` and `prefers-contrast: more`: solid plate, no blur, stronger secondary text.
- `forced-colors`: system colours throughout; hovered, focused, pressed and confirmed buttons use the Highlight pair.

## Sizes

| Player width | Changes |
|---|---|
| 42rem and up | Everything shown; sentence 19px |
| Under 42rem | Eyebrow, time, captions button, picture-in-picture and the centre play button step aside; sentence 16px |
| Under 24rem | Settings steps aside; sentence 14.4px; tighter padding |

## States covered

Poster, playing, paused, buffering, ended, idle, error (scaffold dialog kept), no captions (the sentence row shows the title and the link and find controls hide), find open, find with no matches, quote copied, clipboard refused.

## Deliberate limits

- No transcript panel, translation, or summaries. The skin does one thing.
- Generated captions are used as they come. A word split across two cues cannot be detected from the file, so the demo reads corrected copies; see the notes at the top of the `.vtt` files in `apps/preview/public/`.
- On a phone the paused plate covers about two-thirds of a 16:9 player. It folds to one line while playing.

## Files

`src/video/skin.html` (layout), `skin.css` (styles), `verbatim-transcript.ts` (sentences, timing, scrub, search), `verbatim-find.ts` (find field, ticks), `verbatim-quote.ts` (link button, `#t=` reader), `icons.ts`.
