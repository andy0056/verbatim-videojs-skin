# Verbatim

**A Video.js v10 skin where the subtitle becomes the player.**

The sentence you are hearing *is* the control bar. Words fill in as they are spoken. Drag along the words to scrub; click a word to jump straight to it. Press `/` and type a word to find every place it is said. Copy a link to any sentence, and whoever opens it lands on the same words. Hover the thin seek bar and the sentence spoken at that moment appears in its place, set as a quotation, with the time and chapter above it.

Built for the [Video.js Skins Design Challenge](https://contra.com/community/topic/videojsskinschallenge) by [Anirudh Thakur](https://anirudhthakur.work). Video skin for HTML, styled with CSS, started from the Scaffold skin with `npx @videojs/cli skin create`.

## The idea

Every player renders captions as a layer on top of the picture and then puts the controls on top of *that*. Verbatim folds the two together: the current caption sentence sits where the controls go, so the reading surface and the seeking surface are the same thing.

- **Read it.** Spoken words are bright, upcoming words are dim, and a highlighter sweeps across the word being said.
- **Scrub it.** Press on any word and drag. Cross the end of the sentence to turn to the next one. Click a word to jump. On touch screens each word gives a light tick where the device supports it.
- **Find it.** Press `/` (or the search button) and type. Every place the word is spoken gets a tick on the seek bar and a box in the sentence; Enter goes to the next, Shift+Enter to the one before, Escape closes and returns focus. The count and the matched sentence are announced to screen readers.
- **Quote it.** The link button under play copies the page's address with the sentence's start time in the fragment (`#t=24.92`, the Media Fragments form). Open such a link and the player starts at that sentence; change the fragment while the page is open and it moves there. Other `name=value` pairs in the fragment are kept. Set `href` on `<verbatim-quote>` when an embed should link to its canonical page.
- **Preview it.** Point at the seek bar and the sentence at that moment replaces the live one, in italics, with its time and chapter in the eyebrow. No popup over the video.
- **Key it.** Tab to the sentence: ← → step by word, ↑ ↓ by sentence, Home/End. It is a `role="slider"` with a live value text, so screen readers hear the word and the time. The thin track underneath is a standard, keyboard-operable time slider with chapter segments.
- **Fit it.** Sentences are cut to the width of the player, so the plate is two lines at every size and never changes height while you read. On narrow players the eyebrow and time step aside. With no captions track the sentence row shows the title and the player behaves like a quiet, conventional skin.
- **Rest it.** When the controls go idle the plate folds down to a single subtitle that keeps filling word by word.

Timing comes from ordinary WebVTT cues (hand-written, or Mux's auto-generated captions). Word times are interpolated across each cue by character count, which reads naturally and needs no word-level timestamps.

## Craft notes

- Surfaces carry translucency in the colour, never in `opacity`, so text and icons stay opaque over bright and dark footage.
- Concentric radii: the plate radius is the control radius plus the plate padding.
- Tabular numerals everywhere digits tick.
- Unspoken words keep at least 4.5:1 against the plate, measured over a white frame.
- Every label goes through Video.js's translations (`<media-text>` in the markup, the i18n controller in script). The sentence takes its reading direction from the transcript, and dragging follows it.
- Menus and tooltips grow from their triggers (inherited from the Scaffold base); closing is quicker than opening.
- `prefers-reduced-motion` stops word transitions; `prefers-contrast: more` and `prefers-reduced-transparency` make the plate solid; `forced-colors` maps the highlighter to `Highlight`.
- Own font stacks: a book serif for the sentence, a UI sans for everything else. The host page's font is never inherited. Public knobs match the packaged skins: `--media-accent-color`, `--media-accent-text-color`, `--media-border-radius`, `--media-font-family`, `--media-scale-unit`, plus `--vb-sentence-font` and `--vb-plate`.

## Develop

```sh
npm install
npm run dev
```

The workbench opens the skin in a slimmed-down version of the Video.js sandbox: set the player's width and aspect ratio, colour scheme, text direction, language, and playback options. The settings live in the URL, so `/?width=384&ratio=9:16` opens the workbench in that state and `/preview.html#width=384&ratio=9:16` opens the preview alone.

The preview streams from Mux. `apps/preview/src/frame/player.ts` holds a short list of clips, each with a Mux playback ID, a chapters file and a transcript: either a hand-checked WebVTT file in `apps/preview/public/`, or the ID of Mux's generated text track, which is then read whole from Mux's WebVTT endpoint. Generated captions sometimes split or mishear a word, so a corrected copy is worth the few minutes. `?clip=nasa` plays the second clip; `?media=demo` plays a small bundled file for offline work.

## Use the skin

Import `src/video/skin.ts` once, then paste the markup from `src/video/skin.html` around your media component inside a `<video-player>`, replacing the placeholder comment. Give the media a `kind="captions"` (or `subtitles`) `<track>`; a `kind="chapters"` track adds chapter segments and the eyebrow label.

## Put it on a site

`npm run build:embed` writes `dist-embed/`: one script, one stylesheet and the translation files. Copy the folder to your site and use the element.

```html
<link rel="stylesheet" href="/verbatim/verbatim-player.css" />
<script type="module" src="/verbatim/verbatim-player.js"></script>

<verbatim-player
  playback-id="YOUR_MUX_PLAYBACK_ID"
  transcript="/captions.vtt"
  chapters="/chapters.vtt"
  poster-time="19"
  video-title="A title"
  style="--media-accent-color: #ceb680; --media-font-family: Poppins, sans-serif; --vb-sentence-font: Lora, serif"
></verbatim-player>
```

Use `src` instead of `playback-id` for a plain video file. The fonts, the accent and the corner radius are public custom properties, set on the element or anything around it. The embed stylesheet also shields the player from page-wide resets written outside cascade layers (`* { margin: 0; padding: 0 }` and the like), which would otherwise beat the skin's layered styles.

It runs this way on [anirudhthakur.work/verbatim](https://anirudhthakur.work/verbatim), in that site's own type and colour.

## Where things live

- `src/video/skin.html`: the layout. Device buttons top-right; the reading plate at the bottom with the sentence row and the bar row.
- `src/video/skin.css`: Verbatim's styles.
- `src/video/scaffold-base.css`: the Scaffold component behaviours Verbatim inherits (popups, menus, sliders, indicators, dialogs).
- `src/video/verbatim-transcript.ts`: the `<verbatim-transcript>` component (sentences, word timing, scrubbing, search).
- `src/video/verbatim-find.ts`: the `<verbatim-find>` field and its seek-bar ticks.
- `src/video/verbatim-quote.ts`: the `<verbatim-quote>` link button and the `#t=` reader.
- `design/spec.md`: anatomy, tokens, states, keyboard and accessibility notes.
- `src/video/icons.ts`: the Verbatim icon family.
- `src/styles/`: shared tokens and preference overrides from the Scaffold skin.
- `apps/preview/`: the workbench. `src/frame/player.ts` chooses the media.

## License

Apache-2.0. See `LICENSE`.
