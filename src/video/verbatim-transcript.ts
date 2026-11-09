/**
 * <verbatim-transcript> — the sentence you are hearing, as a control.
 *
 * Reads the first captions/subtitles text track on the media element, renders the current cue
 * word by word, fills words as they are spoken, and lets you seek by pointing at words:
 * click a word to jump to it, drag along the sentence to scrub, cross the edge to flip to the
 * neighbouring sentence. Keyboard: arrows step by word, Page Up/Down by sentence, Home/End.
 *
 * Cue-level timing is interpolated across words by character count, which reads naturally for
 * auto-generated captions (Mux) and hand-written WebVTT alike.
 */
import {
  UIElement,
  PlayerController,
  playerContext,
  selectTime,
  selectPlayback,
  type PropertyValues,
} from '@videojs/html';

interface Word {
  text: string;
  start: number;
  end: number;
}

interface Sentence {
  start: number;
  end: number;
  text: string;
  words: Word[];
}

interface MediaLike extends EventTarget {
  textTracks?: TextTrackList;
  currentTime?: number;
  duration?: number;
  querySelector?: (selector: string) => Element | null;
}

const WORD_SPLIT = /\s+/;
const EDGE_COOLDOWN_MS = 280;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

function cueText(cue: TextTrackCue): string {
  const anyCue = cue as unknown as { text?: string };
  const raw = anyCue.text ?? '';
  // Strip WebVTT tags such as <c.yellow>, <v Speaker>, <00:00:01.000>
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function buildSentence(cue: TextTrackCue): Sentence | null {
  const text = cueText(cue);
  if (!text) return null;
  const tokens = text.split(WORD_SPLIT).filter(Boolean);
  const total = tokens.reduce((n, t) => n + t.length, 0) + Math.max(0, tokens.length - 1);
  const duration = Math.max(0.001, cue.endTime - cue.startTime);
  let offset = 0;
  const words: Word[] = tokens.map((t, i) => {
    const start = cue.startTime + (offset / total) * duration;
    offset += t.length + (i < tokens.length - 1 ? 1 : 0);
    const end = cue.startTime + (offset / total) * duration;
    return { text: t, start, end };
  });
  return { start: cue.startTime, end: cue.endTime, text, words };
}

export class VerbatimTranscriptElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);

  #disconnect: AbortController | null = null;
  #media: MediaLike | null = null;
  #track: TextTrack | null = null;
  #chapters: TextTrack | null = null;
  #sentences: Sentence[] = [];
  #index = -1; // current sentence index
  #wordIndex = -1;
  #raf = 0;
  #dragging = false;
  #moved = false;
  #lastEdgeFlip = 0;
  #pendingSeek = 0;
  #seekTimer = 0;
  #previewTime: number | null = null;
  #slider: HTMLElement | null = null;
  #hoverPreview = false;

  // DOM parts
  #eyebrow!: HTMLElement;
  #sentenceEl!: HTMLElement;
  #live!: HTMLElement;
  #tip!: HTMLElement;

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;

    if (!this.#sentenceEl) this.#build();

    this.setAttribute('role', 'slider');
    this.setAttribute('tabindex', '0');
    this.setAttribute('aria-label', this.getAttribute('label') ?? 'Transcript. Seek by word.');
    this.setAttribute('aria-orientation', 'horizontal');
    this.setAttribute('aria-valuemin', '0');
    this.toggleAttribute('data-empty', true);

    this.addEventListener('pointerdown', this.#onPointerDown, { signal });
    this.addEventListener('pointermove', this.#onPointerMove, { signal });
    this.addEventListener('pointerup', this.#onPointerUp, { signal });
    this.addEventListener('pointercancel', this.#onPointerUp, { signal });
    this.addEventListener('pointerleave', this.#onPointerLeave, { signal });
    this.addEventListener('keydown', this.#onKeyDown, { signal });
    this.addEventListener('focus', () => this.#announce(), { signal });

    // The media element is a sibling inside <media-container>; it may upgrade after us.
    queueMicrotask(() => {
      this.#attachMedia();
      this.#attachSlider();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#detachTracks();
    this.#media = null;
  }

  update(changed: PropertyValues) {
    super.update(changed);
    const time = this.#time.value;
    if (time && Number.isFinite(time.duration) && time.duration > 0) {
      this.setAttribute('aria-valuemax', String(Math.round(time.duration)));
    }
    this.#syncToTime(time?.currentTime ?? 0);
    // Keep a smooth per-word fill while playing: the store ticks on timeupdate (~4 Hz), the
    // media element is continuous.
    const playing = this.#playback.value && !this.#playback.value.paused;
    if (playing && !this.#raf) this.#tick();
  }

  // ---------------------------------------------------------------- setup

  #build() {
    this.innerHTML = '';
    this.#eyebrow = document.createElement('span');
    this.#eyebrow.className = 'vb-eyebrow';
    this.#eyebrow.setAttribute('aria-hidden', 'true');

    this.#sentenceEl = document.createElement('span');
    this.#sentenceEl.className = 'vb-sentence';
    this.#sentenceEl.setAttribute('aria-hidden', 'true');

    this.#tip = document.createElement('span');
    this.#tip.className = 'vb-tip';
    this.#tip.setAttribute('aria-hidden', 'true');
    this.#tip.hidden = true;

    this.#live = document.createElement('span');
    this.#live.className = 'vb-sr-only';
    this.#live.setAttribute('aria-live', 'polite');

    this.append(this.#eyebrow, this.#sentenceEl, this.#tip, this.#live);
  }

  #findMedia(): MediaLike | null {
    const container = this.closest('media-container') ?? this.closest('video-player');
    if (!container) return null;
    const direct = container.querySelector(':scope > video, :scope > audio, :scope > [slot="media"]');
    const candidate = (direct ?? container.querySelector('video, audio, mux-video, hls-video, hlsjs-video')) as MediaLike | null;
    if (!candidate) return null;
    if ('textTracks' in candidate && candidate.textTracks) return candidate;
    // A media custom element may wrap a native <video>.
    const inner = candidate.querySelector?.('video') ?? (candidate as unknown as Element).shadowRoot?.querySelector('video');
    return (inner as unknown as MediaLike) ?? candidate;
  }

  #attachMedia() {
    const media = this.#findMedia();
    if (!media) {
      // Try again shortly; the media component may still be upgrading.
      setTimeout(() => this.isConnected && !this.#media && this.#attachMedia(), 250);
      return;
    }
    this.#media = media;
    const signal = this.#disconnect?.signal;
    const list = media.textTracks;
    if (list) {
      list.addEventListener('addtrack', () => this.#pickTracks(), { signal });
      list.addEventListener('removetrack', () => this.#pickTracks(), { signal });
      list.addEventListener('change', () => this.#pickTracks(), { signal });
    }
    media.addEventListener('loadedmetadata', () => this.#pickTracks(), { signal });
    media.addEventListener('emptied', () => this.#resetSentences(), { signal });
    this.#pickTracks();
  }

  #detachTracks() {
    this.#track = null;
    this.#chapters = null;
  }

  #pickTracks() {
    const list = this.#media?.textTracks;
    if (!list) return;
    let captions: TextTrack | null = null;
    let chapters: TextTrack | null = null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!captions && (t.kind === 'captions' || t.kind === 'subtitles')) captions = t;
      if (!chapters && t.kind === 'chapters') chapters = t;
    }
    if (captions && captions.mode === 'disabled') captions.mode = 'hidden'; // load cues without rendering
    if (chapters && chapters.mode === 'disabled') chapters.mode = 'hidden';

    if (captions !== this.#track) {
      this.#track = captions;
      this.#resetSentences();
    }
    this.#chapters = chapters;
    this.#readCues();
  }

  #readCues() {
    const track = this.#track;
    if (!track) return;
    const cues = track.cues;
    if (!cues || cues.length === 0) {
      // Cues parse asynchronously; poll briefly until they appear.
      setTimeout(() => this.isConnected && this.#track === track && this.#readCues(), 300);
      return;
    }
    if (this.#sentences.length === cues.length) return;
    const sentences: Sentence[] = [];
    for (let i = 0; i < cues.length; i++) {
      const s = buildSentence(cues[i]);
      if (s) sentences.push(s);
    }
    sentences.sort((a, b) => a.start - b.start);
    this.#sentences = sentences;
    this.toggleAttribute('data-empty', sentences.length === 0);
    this.#index = -1;
    this.#syncToTime(this.#currentTime());
  }

  #resetSentences() {
    this.#sentences = [];
    this.#index = -1;
    this.#wordIndex = -1;
    this.toggleAttribute('data-empty', true);
    this.#sentenceEl.textContent = '';
    this.#eyebrow.textContent = '';
  }

  // ---------------------------------------------------------------- time → view

  #currentTime(): number {
    const t = this.#media?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : (this.#time.value?.currentTime ?? 0);
  }

  #tick = () => {
    this.#raf = 0;
    if (!this.isConnected) return;
    this.#syncToTime(this.#currentTime());
    const playing = this.#playback.value && !this.#playback.value.paused;
    if (playing) this.#raf = requestAnimationFrame(this.#tick);
  };

  #findIndex(time: number): number {
    const s = this.#sentences;
    if (!s.length) return -1;
    // Binary search for the last sentence whose start <= time.
    let lo = 0, hi = s.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].start <= time) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best === -1) return 0; // before the first sentence: show the first
    return best;
  }

  #syncToTime(time: number) {
    if (!this.#sentences.length) return;
    const shown = this.#previewTime ?? time;
    const idx = this.#findIndex(shown);
    if (idx !== this.#index) this.#renderSentence(idx);
    this.#paintProgress(shown);
    this.setAttribute('aria-valuenow', String(Math.round(time)));
  }

  #renderSentence(idx: number) {
    this.#index = idx;
    const s = this.#sentences[idx];
    const frag = document.createDocumentFragment();
    s.words.forEach((w, i) => {
      const span = document.createElement('span');
      span.className = 'vb-word';
      span.textContent = w.text;
      span.dataset.i = String(i);
      frag.append(span);
      if (i < s.words.length - 1) frag.append(document.createTextNode(' '));
    });
    this.#sentenceEl.replaceChildren(frag);
    this.#sentenceEl.dataset.index = String(idx);
    this.#wordIndex = -1;
    if (!this.#hoverPreview) this.#renderEyebrow(s.start);
    this.toggleAttribute('data-gap', false);
  }

  #renderEyebrow(time: number) {
    const chapters = this.#chapters?.cues;
    let label = '';
    if (chapters && chapters.length) {
      for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i];
        if (time >= c.startTime && time < c.endTime) { label = cueText(c); break; }
      }
    }
    const pos = `${this.#index + 1} / ${this.#sentences.length}`;
    this.#eyebrow.textContent = label ? `${label} · ${pos}` : pos;
  }

  #paintProgress(time: number) {
    const s = this.#sentences[this.#index];
    if (!s) return;
    const inGap = time < s.start || time >= s.end;
    this.toggleAttribute('data-gap', inGap && time >= s.end);
    const spans = this.#sentenceEl.children;
    let current = -1;
    for (let i = 0; i < spans.length; i++) {
      const w = s.words[i];
      const el = spans[i] as HTMLElement;
      let state: 'past' | 'current' | 'future';
      if (time >= w.end) state = 'past';
      else if (time >= w.start) { state = 'current'; current = i; }
      else state = 'future';
      if (el.dataset.state !== state) el.dataset.state = state;
      if (state === 'current') {
        const frac = Math.min(1, Math.max(0, (time - w.start) / Math.max(0.001, w.end - w.start)));
        el.style.setProperty('--vb-word-progress', frac.toFixed(3));
      } else if (el.style.getPropertyValue('--vb-word-progress')) {
        el.style.removeProperty('--vb-word-progress');
      }
    }
    if (current !== this.#wordIndex) {
      this.#wordIndex = current;
      if (document.activeElement === this) this.#announce();
    }
  }

  #announce() {
    const s = this.#sentences[this.#index];
    if (!s) return;
    const word = this.#wordIndex >= 0 ? s.words[this.#wordIndex].text : s.words[0]?.text ?? '';
    const t = formatTime(this.#currentTime());
    const total = formatTime(this.#time.value?.duration ?? 0);
    const text = `${word}, ${t} of ${total}`;
    this.setAttribute('aria-valuetext', text);
    this.#live.textContent = text;
  }

  // ---------------------------------------------------------------- seek bar → preview

  /** Hovering the thin track previews the sentence spoken at that moment, instead of a popup. */
  #attachSlider() {
    const root = this.closest('media-container') ?? this.closest('video-player');
    const slider = root?.querySelector('media-time-slider') as HTMLElement | null;
    if (!slider) {
      setTimeout(() => this.isConnected && !this.#slider && this.#attachSlider(), 250);
      return;
    }
    this.#slider = slider;
    const signal = this.#disconnect?.signal;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && !slider.hasAttribute('data-dragging')) return;
      const t = this.#sliderPointerTime(e.clientX);
      if (t === null) return;
      this.#hoverPreview = true;
      this.#previewTime = t;
      this.toggleAttribute('data-previewing', true);
      this.#syncToTime(this.#currentTime());
      this.#renderPreviewEyebrow(t);
    };
    const onLeave = () => {
      if (slider.hasAttribute('data-dragging')) return;
      this.#endSliderPreview();
    };
    slider.addEventListener('pointermove', onMove, { signal });
    slider.addEventListener('pointerdown', onMove, { signal });
    slider.addEventListener('pointerleave', onLeave, { signal });
    slider.addEventListener('pointerup', () => setTimeout(() => this.#endSliderPreview(), 60), { signal });
    slider.addEventListener('pointercancel', onLeave, { signal });
  }

  #endSliderPreview() {
    if (!this.#hoverPreview) return;
    this.#hoverPreview = false;
    this.#previewTime = null;
    this.toggleAttribute('data-previewing', false);
    this.#index = -1; // force re-render of the live sentence
    this.#syncToTime(this.#currentTime());
  }

  #sliderPointerTime(clientX: number): number | null {
    const slider = this.#slider;
    const duration = this.#time.value?.duration ?? (this.#media?.duration as number | undefined) ?? 0;
    if (!slider || !Number.isFinite(duration) || duration <= 0) return null;
    // Prefer the slider's own pointer percentage (accounts for thumb alignment); fall back to geometry.
    const raw = getComputedStyle(slider).getPropertyValue('--media-slider-pointer').trim();
    let frac = raw.endsWith('%') ? parseFloat(raw) / 100 : NaN;
    if (!Number.isFinite(frac)) {
      const r = slider.getBoundingClientRect();
      frac = r.width > 0 ? (clientX - r.left) / r.width : 0;
    }
    return Math.min(duration, Math.max(0, frac * duration));
  }

  #renderPreviewEyebrow(time: number) {
    const chapters = this.#chapters?.cues;
    let label = '';
    if (chapters && chapters.length) {
      for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i];
        if (time >= c.startTime && time < c.endTime) { label = cueText(c); break; }
      }
    }
    this.#eyebrow.textContent = label ? `${formatTime(time)} · ${label}` : formatTime(time);
  }

  // ---------------------------------------------------------------- pointer → time

  #timeAtPoint(x: number, y: number): { time: number; word: HTMLElement | null; edge: -1 | 0 | 1 } {
    const s = this.#sentences[this.#index];
    const rect = this.#sentenceEl.getBoundingClientRect();
    if (!s) return { time: this.#currentTime(), word: null, edge: 0 };

    const target = document.elementFromPoint(x, y)?.closest('.vb-word') as HTMLElement | null;
    if (target && this.#sentenceEl.contains(target)) {
      const i = Number(target.dataset.i);
      const w = s.words[i];
      const r = target.getBoundingClientRect();
      const frac = r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
      return { time: w.start + frac * (w.end - w.start), word: target, edge: 0 };
    }

    // Not on a word: pick the nearest word on the nearest line; detect edges.
    const spans = Array.from(this.#sentenceEl.children) as HTMLElement[];
    if (!spans.length) return { time: s.start, word: null, edge: 0 };
    const rects = spans.map((el) => el.getBoundingClientRect());
    const lineY = rects.reduce((best, r) => (Math.abs((r.top + r.bottom) / 2 - y) < Math.abs((best.top + best.bottom) / 2 - y) ? r : best), rects[0]);
    const onLine = rects.map((r, i) => ({ r, i })).filter(({ r }) => Math.abs((r.top + r.bottom) / 2 - (lineY.top + lineY.bottom) / 2) < r.height / 2);
    const first = onLine[0], last = onLine[onLine.length - 1];
    if (x < first.r.left) {
      const isFirstLine = first.i === 0;
      return { time: s.words[first.i].start, word: spans[first.i], edge: isFirstLine && x < rect.left - 4 ? -1 : 0 };
    }
    if (x > last.r.right) {
      const isLastLine = last.i === spans.length - 1;
      return { time: s.words[last.i].end, word: spans[last.i], edge: isLastLine && x > rect.right + 4 ? 1 : 0 };
    }
    // Between words on the same line: the gap belongs to the word before it.
    for (let k = 0; k < onLine.length - 1; k++) {
      if (x >= onLine[k].r.right && x <= onLine[k + 1].r.left) {
        return { time: s.words[onLine[k].i].end, word: spans[onLine[k].i], edge: 0 };
      }
    }
    return { time: s.start, word: spans[0], edge: 0 };
  }

  #onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.#sentences.length) return;
    e.preventDefault();
    this.#dragging = true;
    this.#moved = false;
    this.toggleAttribute('data-dragging', true);
    this.setPointerCapture(e.pointerId);
    this.#scrubTo(e.clientX, e.clientY, true);
  };

  #onPointerMove = (e: PointerEvent) => {
    if (this.#dragging) {
      this.#moved = true;
      this.#scrubTo(e.clientX, e.clientY, false);
      return;
    }
    if (!this.#sentences.length || e.pointerType === 'touch') return;
    // Hover preview: show the time of the word under the pointer.
    const { time, word } = this.#timeAtPoint(e.clientX, e.clientY);
    this.#showTip(word, time);
  };

  #onPointerLeave = () => {
    if (!this.#dragging) this.#hideTip();
  };

  #onPointerUp = (e: PointerEvent) => {
    if (!this.#dragging) return;
    this.#dragging = false;
    this.toggleAttribute('data-dragging', false);
    try { this.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // Commit the final position immediately.
    if (this.#pendingSeek) {
      clearTimeout(this.#seekTimer);
      this.#seekTimer = 0;
      this.#commitSeek();
    }
    this.#previewTime = null;
    this.#hideTip();
    this.#syncToTime(this.#currentTime());
  };

  #scrubTo(x: number, y: number, immediate: boolean) {
    const { time, word, edge } = this.#timeAtPoint(x, y);
    let target = time;
    if (edge !== 0) {
      const now = performance.now();
      if (now - this.#lastEdgeFlip > EDGE_COOLDOWN_MS) {
        const next = this.#index + edge;
        if (next >= 0 && next < this.#sentences.length) {
          this.#lastEdgeFlip = now;
          target = edge > 0 ? this.#sentences[next].start : Math.max(this.#sentences[next].start, this.#sentences[next].end - 0.05);
          this.#previewTime = target;
          this.#renderSentence(next);
        }
      } else {
        return;
      }
    } else {
      this.#previewTime = target;
    }
    this.#paintProgress(target);
    this.#showTip(word, target);
    this.#requestSeek(target, immediate);
  }

  #requestSeek(time: number, immediate: boolean) {
    this.#pendingSeek = time;
    if (immediate) {
      clearTimeout(this.#seekTimer);
      this.#seekTimer = 0;
      this.#commitSeek();
      return;
    }
    if (!this.#seekTimer) {
      this.#seekTimer = window.setTimeout(() => {
        this.#seekTimer = 0;
        this.#commitSeek();
      }, 90);
    }
  }

  #commitSeek() {
    const t = this.#pendingSeek;
    this.#pendingSeek = 0;
    const time = this.#time.value;
    if (time) void time.seek(t);
    else if (this.#media && typeof this.#media.currentTime === 'number') (this.#media as unknown as HTMLMediaElement).currentTime = t;
  }

  #showTip(word: HTMLElement | null, time: number) {
    if (!word) return this.#hideTip();
    const host = this.getBoundingClientRect();
    const r = word.getBoundingClientRect();
    this.#tip.textContent = formatTime(time);
    this.#tip.hidden = false;
    this.#tip.style.setProperty('--vb-tip-x', `${r.left + r.width / 2 - host.left}px`);
    this.#tip.style.setProperty('--vb-tip-y', `${r.top - host.top}px`);
    this.#sentenceEl.querySelector('.vb-word[data-hover]')?.removeAttribute('data-hover');
    word.setAttribute('data-hover', '');
  }

  #hideTip() {
    this.#tip.hidden = true;
    this.#sentenceEl.querySelector('.vb-word[data-hover]')?.removeAttribute('data-hover');
  }

  // ---------------------------------------------------------------- keyboard → time

  #onKeyDown = (e: KeyboardEvent) => {
    if (!this.#sentences.length) return;
    const s = this.#sentences[this.#index];
    const t = this.#currentTime();
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowRight': {
        const i = this.#wordIndexAt(t);
        if (i + 1 < s.words.length) target = s.words[i + 1].start;
        else if (this.#index + 1 < this.#sentences.length) target = this.#sentences[this.#index + 1].start;
        break;
      }
      case 'ArrowLeft': {
        const i = this.#wordIndexAt(t);
        // Inside a word: go to its start; at its start: previous word.
        if (i >= 0 && t - s.words[i].start > 0.35) target = s.words[i].start;
        else if (i > 0) target = s.words[i - 1].start;
        else if (this.#index > 0) {
          const prev = this.#sentences[this.#index - 1];
          target = prev.words[prev.words.length - 1].start;
        } else target = 0;
        break;
      }
      case 'PageDown':
      case 'ArrowDown':
        if (this.#index + 1 < this.#sentences.length) target = this.#sentences[this.#index + 1].start;
        break;
      case 'PageUp':
      case 'ArrowUp':
        target = t - s.start > 0.75 ? s.start : (this.#index > 0 ? this.#sentences[this.#index - 1].start : 0);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = Math.max(0, (this.#time.value?.duration ?? s.end) - 0.1);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (target !== null) {
      this.#requestSeek(target, true);
      this.#syncToTime(target);
      this.#wordIndex = this.#wordIndexAt(target);
      this.#announce();
    }
  };

  #wordIndexAt(time: number): number {
    const s = this.#sentences[this.#index];
    if (!s) return -1;
    for (let i = s.words.length - 1; i >= 0; i--) if (time >= s.words[i].start) return i;
    return 0;
  }
}

if (!customElements.get('verbatim-transcript')) {
  customElements.define('verbatim-transcript', VerbatimTranscriptElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'verbatim-transcript': VerbatimTranscriptElement;
  }
}
