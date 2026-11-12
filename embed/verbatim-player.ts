/**
 * <verbatim-player> — the whole skin as one element, for dropping into a site that has no build step
 * for it. Build with `npm run build:embed`; copy `dist-embed/verbatim-player.js` and `.css` to the site
 * and load both.
 *
 *   <link rel="stylesheet" href="/verbatim/verbatim-player.css">
 *   <script type="module" src="/verbatim/verbatim-player.js"></script>
 *
 *   <verbatim-player
 *     playback-id="…"            a Mux playback ID (or `src` for a plain video file)
 *     transcript="/intro.vtt"    WebVTT with the words; cues are merged into sentences
 *     chapters="/chapters.vtt"   optional chapter names for the seek bar and the eyebrow
 *     poster-time="19"           second shown before the video starts (Mux), or `poster` for an image
 *     video-title="…">
 *   </verbatim-player>
 *
 * The host page styles it with the skin's public properties, set on the element: `--media-accent-color`,
 * `--media-font-family`, `--vb-sentence-font`, `--media-border-radius`.
 */
import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@videojs/html/i18n';
import '../src/video/skin';
import { readFragmentTime } from '../src/video/verbatim-quote';
import skinTemplate from '../src/video/skin.html?raw';
import './verbatim-player.css';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

class VerbatimPlayerElement extends HTMLElement {
  #built = false;

  connectedCallback() {
    if (this.#built) return;
    this.#built = true;

    const playbackId = this.getAttribute('playback-id') ?? '';
    const src = this.getAttribute('src') ?? '';
    const transcript = this.getAttribute('transcript') ?? '';
    const chapters = this.getAttribute('chapters') ?? '';
    const title = this.getAttribute('video-title') ?? '';

    const chapterTrack = chapters
      ? `<track kind="chapters" label="Chapters" srclang="en" src="${attr(chapters)}" default>`
      : '';
    const media = playbackId
      ? `<mux-video src="https://stream.mux.com/${attr(playbackId)}.m3u8" playsinline crossorigin>${chapterTrack}</mux-video>`
      : `<video src="${attr(src)}" playsinline crossorigin preload="metadata">${chapterTrack}</video>`;

    const player = document.createElement('video-player');
    // A link to a sentence opens on the frame it was said over, not the opening frame.
    const linked = readFragmentTime(location.hash);
    const still = linked === null ? (this.getAttribute('poster-time') ?? '1') : String(Math.round(linked * 10) / 10);
    const poster =
      this.getAttribute('poster') ??
      (playbackId ? `https://image.mux.com/${playbackId}/thumbnail.webp?time=${encodeURIComponent(still)}` : '');
    if (poster) player.setAttribute('poster', poster);
    if (title) player.setAttribute('title', title);

    player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);
    if (transcript) player.querySelector('verbatim-transcript')?.setAttribute('src', transcript);

    // The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
    const i18n = document.createElement('media-i18n');
    i18n.append(player);
    this.append(i18n);
  }
}

if (!customElements.get('verbatim-player')) {
  customElements.define('verbatim-player', VerbatimPlayerElement);
}
