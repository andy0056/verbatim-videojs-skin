/**
 * <verbatim-transcript> — the sentence you are hearing, as a control.
 *
 * Reads captions (a WebVTT `src`, or the first captions/subtitles text track on the media element),
 * groups the cues into sentences that fit the player, renders the current one word by word, fills
 * words as they are spoken, and lets you seek by pointing at words: click a word to jump to it, drag
 * along the sentence to scrub, cross the edge to flip to the neighbouring sentence.
 * Keyboard: arrows step by word, up/down by sentence, Home/End.
 *
 * It also answers searches for <verbatim-find>: every place a word is spoken, as times.
 *
 * Cue-level timing is interpolated across words by character count, which reads naturally for
 * auto-generated captions (Mux) and hand-written WebVTT alike.
 */
import {
  UIElement,
  PlayerController,
  I18nController,
  playerContext,
  i18nContext,
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

/** One place a searched word or phrase is spoken. */
export interface VerbatimMatch {
  /** When the first matched word starts, in seconds. */
  time: number;
  /** Index of the sentence that holds it, at the current player width. */
  sentence: number;
  /** Index of the first matched word in that sentence. */
  word: number;
  /** How many consecutive words the match covers (it may run into the next sentence). */
  length: number;
}

interface FlatWord {
  sentence: number;
  word: number;
  key: string;
  start: number;
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

function cueText(cue: CueLike | TextTrackCue): string {
  const anyCue = cue as unknown as { text?: string };
  const raw = anyCue.text ?? '';
  // Strip WebVTT tags such as <c.yellow>, <v Speaker>, <00:00:01.000>
  return raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

interface CueLike {
  startTime: number;
  endTime: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  const [h, m, sec] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return h * 3600 + m * 60 + sec;
}

/** Parse the cues of a WebVTT file: timings and text only, which is all a transcript needs. */
export function parseWebVtt(source: string): CueLike[] {
  const cues: CueLike[] = [];
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((l) => l.includes('-->'));
    if (timingIndex === -1) continue;
    const [from, to] = lines[timingIndex].split('-->');
    const startTime = parseTimestamp(from);
    const endTime = parseTimestamp(to.split(/\s+/)[1] ?? to.trim().split(' ')[0]);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) continue;
    const text = lines.slice(timingIndex + 1).join(' ').trim();
    if (text) cues.push({ startTime, endTime, text });
  }
  return cues;
}

/** Words of one cue, timed by character share of the cue's duration. */
function cueWords(cue: CueLike, text: string): Word[] {
  const tokens = text.split(WORD_SPLIT).filter(Boolean);
  if (!tokens.length) return [];
  const total = tokens.reduce((n, t) => n + t.length, 0) + Math.max(0, tokens.length - 1);
  const duration = Math.max(0.001, cue.endTime - cue.startTime);
  let offset = 0;
  return tokens.map((t, i) => {
    const start = cue.startTime + (offset / total) * duration;
    offset += t.length + (i < tokens.length - 1 ? 1 : 0);
    const end = cue.startTime + (offset / total) * duration;
    return { text: t, start, end };
  });
}

const SENTENCE_END = /[.!?…]["'”’)]*$/;
const CLAUSE_END = /[,;:—–]["'”’)]*$/;
const MAX_SECONDS = 14;
const MAX_GAP_SECONDS = 1.5;

/** How much text one sentence may hold: past `soft` it ends at the next clause mark, and never passes `hard`. */
interface Capacity {
  soft: number;
  hard: number;
}
const DEFAULT_CAPACITY: Capacity = { soft: 110, hard: 180 };
const LINES = 2;
/** Seconds added to every seek so the target word is the one the media clock reports. */
const SEEK_NUDGE = 0.004;

/**
 * Group cue words into readable sentences. Auto-generated captions (Mux, YouTube) cut cues at
 * line-wrap points, so a cue is often a fragment: "analogy." or "all part of". Reading surfaces want
 * sentences, so words run on until one ends a sentence, a long run reaches a clause mark, the run
 * would no longer fit the plate, or there is a real pause between cues. Hand-written captions that end
 * each cue with punctuation pass through unchanged when they fit.
 */
function buildSentences(cues: ArrayLike<CueLike>, capacity: Capacity): Sentence[] {
  const out: Sentence[] = [];
  let words: Word[] = [];
  let text = '';
  let start = 0;
  let lastEnd = 0;

  const flush = () => {
    if (words.length) out.push({ start, end: lastEnd, text, words });
    words = [];
    text = '';
  };

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i] as CueLike;
    const t = cueText(cue);
    if (!t) continue;
    if (words.length && (cue.startTime - lastEnd > MAX_GAP_SECONDS || cue.endTime - start > MAX_SECONDS)) flush();
    for (const w of cueWords(cue, t)) {
      if (words.length && text.length + 1 + w.text.length > capacity.hard) flush();
      if (!words.length) start = w.start;
      words.push(w);
      text = text ? `${text} ${w.text}` : w.text;
      lastEnd = w.end;
      if (SENTENCE_END.test(w.text) || (text.length >= capacity.soft && CLAUSE_END.test(w.text))) flush();
    }
    lastEnd = cue.endTime;
  }
  flush();
  return out.sort((a, b) => a.start - b.start);
}

/** Lower-case, accent-free letters and digits only: how words are compared when searching. */
function searchKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export class VerbatimTranscriptElement extends UIElement {
  #time = new PlayerController(this, playerContext, selectTime);
  #playback = new PlayerController(this, playerContext, selectPlayback);
  #i18n = new I18nController(this, i18nContext);

  #disconnect: AbortController | null = null;
  #media: MediaLike | null = null;
  #track: TextTrack | null = null;
  #chapters: TextTrack | null = null;
  #srcLoaded: string | null = null;

  // Text
  #cues: CueLike[] = [];
  #cueCount = -1;
  #capacity: Capacity = DEFAULT_CAPACITY;
  #measured = false;
  #sentences: Sentence[] = [];
  #flat: FlatWord[] | null = null;
  #index = -1; // sentence on show
  #wordIndex = -1;
  #eyebrowKey = '';
  #raf = 0;
  #measureFrame = 0;
  #resizeObserver: ResizeObserver | null = null;
  #canvas: HTMLCanvasElement | null = null;

  // Pointer scrubbing
  #dragging = false;
  #touch = false;
  #scrubTime: number | null = null;
  #scrubWord = -1;
  #lastEdgeFlip = 0;
  #pendingSeek: number | null = null;
  /** A position asked for before the media could seek (a shared link); shown at once, applied when it can be. */
  #startAt: number | null = null;
  #startRequested = false;
  #startFrom = 0;
  #startTimer = 0;
  #quoteTimer = 0;
  #seekTimer = 0;

  // Previews: the sentence at the seek-bar pointer, or at a search match not yet jumped to
  #slider: HTMLElement | null = null;
  #sliderPreview: number | null = null;
  #findPreview: number | null = null;

  // Search
  #query = '';
  #matches: VerbatimMatch[] = [];
  #marks = new Map<number, Array<{ word: number; match: number }>>();
  #activeMatch = -1;

  // DOM parts
  #eyebrow!: HTMLElement;
  #sentenceEl!: HTMLElement;
  #live!: HTMLElement;
  #tip!: HTMLElement;

  static get observedAttributes() {
    return ['src'];
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'src' && this.isConnected) void this.#loadSrc(value);
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;

    if (!this.#sentenceEl) this.#build();

    this.setAttribute('role', 'slider');
    this.setAttribute('tabindex', '0');
    this.setAttribute('aria-orientation', 'horizontal');
    this.setAttribute('aria-valuemin', '0');
    this.toggleAttribute('data-empty', this.#sentences.length === 0);

    this.addEventListener('pointerdown', this.#onPointerDown, { signal });
    this.addEventListener('pointermove', this.#onPointerMove, { signal });
    this.addEventListener('pointerup', this.#onPointerUp, { signal });
    this.addEventListener('pointercancel', this.#onPointerUp, { signal });
    this.addEventListener('pointerleave', this.#onPointerLeave, { signal });
    this.addEventListener('keydown', this.#onKeyDown, { signal });
    this.addEventListener('focus', () => this.#announce(), { signal });

    // Sentences are cut to what fits two lines here, so they follow the player's width.
    this.#resizeObserver = new ResizeObserver(() => this.#scheduleMeasure());
    this.#resizeObserver.observe(this);
    document.fonts?.addEventListener?.('loadingdone', () => this.#scheduleMeasure(), { signal });

    // The media element is a sibling inside <media-container>; it may upgrade after us.
    queueMicrotask(() => {
      this.#attachMedia();
      this.#attachSlider();
      void this.#loadSrc(this.getAttribute('src'));
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#measureFrame);
    clearTimeout(this.#seekTimer);
    this.#raf = this.#measureFrame = this.#seekTimer = 0;
    this.#track = null;
    this.#chapters?.removeEventListener('cuechange', this.#onChapterCue);
    this.#chapters = null;
    this.#media = null;
    this.#slider = null;
  }

  update(changed: PropertyValues) {
    super.update(changed);
    const label = this.getAttribute('label') ?? this.#translate('verbatim.transcript', 'Transcript. Seek by word.');
    if (this.getAttribute('aria-label') !== label) this.setAttribute('aria-label', label);

    const time = this.#time.value;
    if (time && Number.isFinite(time.duration) && time.duration > 0) {
      this.setAttribute('aria-valuemax', String(Math.round(time.duration)));
    }
    if (this.#startAt !== null) this.#applyStart();
    this.#syncToTime(this.#startAt ?? time?.currentTime ?? 0);
    // Keep a smooth per-word fill while playing: the store ticks on timeupdate (~4 Hz), the
    // media element is continuous.
    const playing = this.#playback.value && !this.#playback.value.paused;
    if (playing && !this.#raf) this.#tick();
  }

  // ---------------------------------------------------------------- public: time and search

  /** The media's current time, read from the element so it is continuous while playing. */
  get currentTime(): number {
    const t = this.#media?.currentTime;
    return typeof t === 'number' && Number.isFinite(t) ? t : (this.#time.value?.currentTime ?? 0);
  }

  /** The media's duration, or 0 before it is known. */
  get duration(): number {
    const d = this.#time.value?.duration ?? (this.#media?.duration as number | undefined) ?? 0;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  /** Matches of the last `search`, in spoken order. (`matches` is taken by Element.) */
  /** The sentence on show: where it starts and what it says. Null when there is no transcript. */
  quote(): { time: number; text: string } | null {
    const s = this.#sentences[this.#index];
    if (!s) return null;
    return { time: s.start, text: s.words.map((w) => w.text).join(' ') };
  }

  /** Mark the sentence on show for a moment, the way a highlighter would. */
  flashQuote(): void {
    clearTimeout(this.#quoteTimer);
    this.toggleAttribute('data-quoted', false);
    void this.offsetWidth; // restart the animation when asked twice in a row
    this.toggleAttribute('data-quoted', true);
    this.#quoteTimer = window.setTimeout(() => this.toggleAttribute('data-quoted', false), 1000);
  }

  /**
   * Open at a moment, as a shared link does. The sentence at that time is shown straight away and
   * the media is moved there as soon as it can seek.
   */
  startAt(time: number): void {
    if (!Number.isFinite(time) || time < 0) return;
    clearTimeout(this.#startTimer);
    this.#startAt = time;
    this.#startRequested = false;
    this.#findPreview = null;
    this.#sliderPreview = null;
    this.#applyStart();
    this.#syncToTime(time);
  }

  #applyStart() {
    const target = this.#startAt;
    if (target === null) return;
    if (!this.#startRequested) {
      if (this.duration <= 0) return; // not seekable yet; update() tries again
      this.#startRequested = true;
      this.#startFrom = this.currentTime;
      this.#pendingSeek = Math.min(target, Math.max(0, this.duration - 0.25));
      this.#commitSeek();
      // If the media never reports the move, stop holding the sentence.
      this.#startTimer = window.setTimeout(() => (this.#startAt = null), 5000);
      return;
    }
    // The media has taken the seek (or the viewer has moved on): follow the clock again.
    if (this.currentTime !== this.#startFrom) {
      clearTimeout(this.#startTimer);
      this.#startAt = null;
    }
  }

  get results(): readonly VerbatimMatch[] {
    return this.#matches;
  }

  /**
   * Find every place `query` is spoken. A query is one or more words; the last may be the start of a
   * word ("tele" finds "telescope"), earlier ones must match whole words. Case, accents and
   * punctuation are ignored. Matched words are marked in the sentence on show.
   */
  search(query: string): readonly VerbatimMatch[] {
    this.#query = query;
    this.#computeMatches();
    this.#activeMatch = -1;
    this.#findPreview = null;
    this.#applyMarks();
    this.#syncToTime(this.currentTime);
    return this.#matches;
  }

  /**
   * Select a match. With `seek` the media jumps to it; without, its sentence is shown as a preview
   * (set as a quotation, with its time) and playback is left alone.
   */
  showMatch(index: number, options: { seek?: boolean } = {}): void {
    const match = this.#matches[index];
    if (!match) return;
    this.#activeMatch = index;
    if (options.seek) {
      this.#findPreview = null;
      this.#requestSeek(match.time, true);
      this.#index = -1; // render the match's sentence now, before the media reports the new time
      this.#syncToTime(match.time);
    } else {
      this.#findPreview = match.time;
      this.#syncToTime(this.currentTime);
    }
    this.#applyMarks();
  }

  /** "0:19, other stars in the galaxy, …": a match's time and sentence, for announcements. */
  describeMatch(index: number): string {
    const match = this.#matches[index];
    if (!match) return '';
    return `${formatTime(match.time)}, ${this.#sentences[match.sentence]?.text ?? ''}`;
  }

  /** Mark which match is the selected one without previewing or seeking (it follows playback). */
  markMatch(index: number): void {
    if (index === this.#activeMatch && this.#findPreview === null) return;
    this.#activeMatch = index;
    this.#findPreview = null;
    this.#applyMarks();
    this.#syncToTime(this.currentTime);
  }

  /** Forget the search: marks and any preview go, the live sentence returns. */
  clearSearch(): void {
    this.#query = '';
    this.#matches = [];
    this.#marks.clear();
    this.#activeMatch = -1;
    this.#findPreview = null;
    this.#applyMarks();
    this.#syncToTime(this.currentTime);
  }

  // ---------------------------------------------------------------- setup

  #build() {
    this.innerHTML = '';
    this.#eyebrow = document.createElement('span');
    this.#eyebrow.className = 'vb-eyebrow';
    this.#eyebrow.setAttribute('aria-hidden', 'true');

    this.#sentenceEl = document.createElement('span');
    this.#sentenceEl.className = 'vb-sentence';
    this.#sentenceEl.dir = 'auto'; // the transcript's language sets the reading direction, not the page
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

  #translate(key: string, fallback: string): string {
    // Skin-specific keys are not in Video.js's typed phrase list; the translator falls back to `default`.
    const translate = this.#i18n.value as unknown as (key: string, options: { default: string }) => string;
    try {
      return translate(key, { default: fallback }) || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * A `src` pointing at a WebVTT file gives the transcript the whole text up front, independent of
   * how the media loads its own captions (HLS manifests load cues progressively, segment by segment).
   */
  async #loadSrc(src: string | null) {
    if (!src || src === this.#srcLoaded) return;
    this.#srcLoaded = src;
    try {
      const response = await fetch(src, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const cues = parseWebVtt(await response.text());
      if (this.#srcLoaded !== src || !this.isConnected) return;
      this.#cueCount = cues.length;
      this.#setCues(cues);
    } catch (error) {
      console.warn('[verbatim] could not load transcript from', src, error);
      this.#srcLoaded = null; // fall back to the media's own text tracks
      this.#pickTracks();
    }
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

  #onChapterCue = () => {
    this.#eyebrowKey = '';
    this.#syncToTime(this.#startAt ?? this.currentTime);
  };

  #pickTracks() {
    const list = this.#media?.textTracks;
    if (!list) return;
    let captions: TextTrack | null = null;
    let chapters: TextTrack | null = null;
    // An authored <track> element wins over tracks a streaming engine adds from the manifest.
    const host = this.#media as unknown as Element;
    const authored = host.querySelector?.('track[kind="captions"], track[kind="subtitles"]') as HTMLTrackElement | null;
    if (authored?.track) captions = authored.track;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!captions && (t.kind === 'captions' || t.kind === 'subtitles')) captions = t;
      if (!chapters && t.kind === 'chapters') chapters = t;
    }
    if (captions && captions.mode === 'disabled') captions.mode = 'hidden'; // load cues without rendering
    if (chapters && chapters.mode === 'disabled') chapters.mode = 'hidden';

    if (chapters !== this.#chapters) {
      this.#chapters?.removeEventListener('cuechange', this.#onChapterCue);
      this.#chapters = chapters;
      // A track is listed before its cues have loaded; the first cue change says the names are in.
      chapters?.addEventListener('cuechange', this.#onChapterCue);
      this.#eyebrowKey = '';
    }
    if (this.#srcLoaded) {
      // Sentences come from `src`; the media's captions track is only used for native rendering.
      this.#syncToTime(this.currentTime);
      return;
    }
    if (captions !== this.#track) {
      this.#track = captions;
      this.#resetSentences();
    }
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
    if (this.#cueCount === cues.length) return;
    this.#cueCount = cues.length;
    const copy: CueLike[] = [];
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      // VTTCue has `text`; the DOM type for a generic TextTrackCue does not declare it.
      copy.push({ startTime: cue.startTime, endTime: cue.endTime, text: (cue as unknown as { text?: string }).text ?? '' });
    }
    this.#setCues(copy);
  }

  #setCues(cues: CueLike[]) {
    this.#cues = cues;
    this.#rebuild();
    this.#scheduleMeasure();
  }

  /** Cut the cues into sentences for the current capacity, keeping the place and any search. */
  #rebuild() {
    this.#sentences = buildSentences(this.#cues, this.#capacity);
    this.#flat = null;
    this.toggleAttribute('data-empty', this.#sentences.length === 0);
    this.#index = -1;
    this.#eyebrowKey = '';
    if (this.#query) {
      const activeTime = this.#matches[this.#activeMatch]?.time;
      this.#computeMatches();
      this.#activeMatch = activeTime === undefined ? -1 : this.#matches.findIndex((m) => m.time === activeTime);
    }
    this.#syncToTime(this.currentTime);
    this.dispatchEvent(new CustomEvent('verbatim-sentences', { bubbles: true }));
  }

  #resetSentences() {
    this.#cues = [];
    this.#sentences = [];
    this.#flat = null;
    this.#cueCount = -1;
    this.#index = -1;
    this.#wordIndex = -1;
    this.#eyebrowKey = '';
    this.#matches = [];
    this.#marks.clear();
    this.#activeMatch = -1;
    this.#findPreview = null;
    this.toggleAttribute('data-empty', true);
    this.#sentenceEl.textContent = '';
    this.#eyebrow.textContent = '';
    this.dispatchEvent(new CustomEvent('verbatim-sentences', { bubbles: true }));
  }

  // ---------------------------------------------------------------- fit: sentences follow the width

  #scheduleMeasure() {
    if (this.#measureFrame) return;
    this.#measureFrame = requestAnimationFrame(() => {
      this.#measureFrame = 0;
      this.#measure();
    });
  }

  /**
   * Work out how many characters fit on two lines of the sentence at this size, and re-cut the
   * sentences when that changes. Measured only while the controls show: the idle plate is laid out
   * differently, and reuses the measured width so its line breaks do not move.
   */
  #measure() {
    if (!this.isConnected || !this.#sentences.length) return;
    let width = this.#sentenceEl.clientWidth;
    if (width < 48) return;

    const content = this.closest('media-controls-content');
    const idle = !!content && !content.hasAttribute('data-visible');
    if (idle) {
      if (this.#measured) return;
      // Never seen with controls (autoplay): leave room for the buttons that will stand beside the text.
      const container = this.closest('media-container');
      width -= (container?.clientWidth ?? 0) >= 672 ? 200 : 96;
      if (width < 48) return;
    } else {
      this.#measured = true;
      this.style.setProperty('--vb-sentence-width', `${width}px`);
    }

    const style = getComputedStyle(this.#sentenceEl);
    const context = (this.#canvas ??= document.createElement('canvas')).getContext('2d');
    if (!context) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const sample = 'the elements in our bodies were all part of stars that existed well before';
    const average = context.measureText(sample).width / sample.length;
    if (!(average > 0)) return;

    // Words do not break, so a line rarely fills: keep a margin for the ragged edge.
    const perLine = width / average;
    const hard = Math.max(32, Math.min(DEFAULT_CAPACITY.hard, Math.floor(perLine * LINES * 0.9 - 6)));
    if (Math.abs(hard - this.#capacity.hard) / this.#capacity.hard < 0.06) return;
    this.#capacity = { hard, soft: Math.round(hard * 0.62) };
    this.#rebuild();
  }

  // ---------------------------------------------------------------- time → view

  #tick = () => {
    this.#raf = 0;
    if (!this.isConnected) return;
    this.#syncToTime(this.currentTime);
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

  /** A preview shows a moment other than now: the seek-bar pointer first, then a pending search match. */
  #preview(): number | null {
    return this.#sliderPreview ?? this.#findPreview;
  }

  #syncToTime(time: number) {
    if (!this.#sentences.length) return;
    const preview = this.#scrubTime === null ? this.#preview() : null;
    const shown = this.#scrubTime ?? preview ?? time;
    // While dragging, the sentence under the pointer stays put; only an edge flip changes it.
    const idx = this.#dragging && this.#index >= 0 ? this.#index : this.#findIndex(shown);
    if (idx !== this.#index) this.#renderSentence(idx);
    this.toggleAttribute('data-previewing', preview !== null);
    this.#renderEyebrow(preview);
    this.#paintProgress(shown);
    this.setAttribute('aria-valuenow', String(Math.round(time)));
  }

  #renderSentence(idx: number) {
    const previous = this.#index;
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
    // Restart the turn for the new sentence: it arrives from below going forward, from above going back.
    this.#sentenceEl.removeAttribute('data-enter');
    void this.#sentenceEl.offsetWidth;
    this.#sentenceEl.setAttribute('data-enter', previous >= 0 && idx < previous ? 'back' : 'forward');
    this.#wordIndex = -1;
    this.#eyebrowKey = '';
    this.#applyMarks();
  }

  #chapterAt(time: number): string {
    const chapters = this.#chapters?.cues;
    if (chapters) {
      for (let i = 0; i < chapters.length; i++) {
        const c = chapters[i];
        if (time >= c.startTime && time < c.endTime) return cueText(c);
      }
    }
    return '';
  }

  /** Live: "Chapter · 4 / 14". Previewing: "0:18 · Chapter", the moment being looked at. */
  #renderEyebrow(preview: number | null) {
    const s = this.#sentences[this.#index];
    if (!s) return;
    const key = preview === null ? `live:${this.#index}:${this.#sentences.length}` : `preview:${Math.floor(preview)}:${this.#index}`;
    if (key === this.#eyebrowKey) return;
    this.#eyebrowKey = key;
    const label = this.#chapterAt(preview ?? s.start);
    const text = preview === null
      ? `${this.#index + 1} / ${this.#sentences.length}`
      : formatTime(preview);
    this.#eyebrow.textContent = preview === null
      ? (label ? `${label} · ${text}` : text)
      : (label ? `${text} · ${label}` : text);
  }

  #paintProgress(time: number) {
    const s = this.#sentences[this.#index];
    if (!s) return;
    this.toggleAttribute('data-gap', time >= s.end);
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
    const text = `${word}, ${formatTime(this.currentTime)} / ${formatTime(this.duration)}`;
    this.setAttribute('aria-valuetext', text);
    this.#live.textContent = text;
  }

  // ---------------------------------------------------------------- search

  #flatWords(): FlatWord[] {
    if (this.#flat) return this.#flat;
    const flat: FlatWord[] = [];
    this.#sentences.forEach((s, sentence) => {
      s.words.forEach((w, word) => {
        const key = searchKey(w.text);
        if (key) flat.push({ sentence, word, key, start: w.start });
      });
    });
    return (this.#flat = flat);
  }

  #computeMatches() {
    this.#matches = [];
    this.#marks.clear();
    const tokens = this.#query.split(/\s+/).map(searchKey).filter(Boolean);
    if (!tokens.length || tokens.join('').length < 2) return;
    const flat = this.#flatWords();
    const last = tokens.length - 1;
    for (let i = 0; i + last < flat.length; i++) {
      let hit = flat[i + last].key.startsWith(tokens[last]);
      for (let k = 0; hit && k < last; k++) hit = flat[i + k].key === tokens[k];
      if (!hit) continue;
      const match = this.#matches.length;
      this.#matches.push({ time: flat[i].start, sentence: flat[i].sentence, word: flat[i].word, length: tokens.length });
      for (let k = 0; k <= last; k++) {
        const f = flat[i + k];
        let list = this.#marks.get(f.sentence);
        if (!list) this.#marks.set(f.sentence, (list = []));
        list.push({ word: f.word, match });
      }
    }
  }

  /** Box the matched words in the sentence on show; the selected match is filled. */
  #applyMarks() {
    const spans = this.#sentenceEl?.children;
    if (!spans) return;
    const marks = this.#marks.get(this.#index);
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i] as HTMLElement;
      const mark = marks?.find((m) => m.word === i);
      if (!mark) el.removeAttribute('data-match');
      else el.setAttribute('data-match', mark.match === this.#activeMatch ? 'active' : '');
    }
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
      if (e.pointerType === 'touch' && !slider.hasAttribute('data-dragging') && e.type !== 'pointerdown') return;
      const t = this.#sliderPointerTime(e.clientX);
      if (t === null) return;
      this.#sliderPreview = t;
      this.#syncToTime(this.currentTime);
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
    if (this.#sliderPreview === null) return;
    this.#sliderPreview = null;
    this.#syncToTime(this.currentTime);
  }

  /** The slider seeks by plain geometry (pointer x over its width), so the preview does too. */
  #sliderPointerTime(clientX: number): number | null {
    const slider = this.#slider;
    const duration = this.duration;
    if (!slider || !duration) return null;
    const r = slider.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
  }

  // ---------------------------------------------------------------- pointer → time

  #timeAtPoint(x: number, y: number): { time: number; word: HTMLElement | null; edge: -1 | 0 | 1 } {
    const s = this.#sentences[this.#index];
    if (!s) return { time: this.currentTime, word: null, edge: 0 };

    // Work along the reading direction: "from" is where a word starts, "to" is where it ends. For
    // right-to-left text the axis is mirrored, so the same comparisons hold.
    const rtl = getComputedStyle(this.#sentenceEl).direction === 'rtl';
    const at = rtl ? -x : x;
    const from = (r: DOMRect) => (rtl ? -r.right : r.left);
    const to = (r: DOMRect) => (rtl ? -r.left : r.right);
    const rect = this.#sentenceEl.getBoundingClientRect();

    const target = document.elementFromPoint(x, y)?.closest('.vb-word') as HTMLElement | null;
    if (target && this.#sentenceEl.contains(target)) {
      const i = Number(target.dataset.i);
      const w = s.words[i];
      const r = target.getBoundingClientRect();
      const frac = r.width > 0 ? Math.min(1, Math.max(0, (at - from(r)) / r.width)) : 0;
      return { time: w.start + frac * (w.end - w.start), word: target, edge: 0 };
    }

    // Not on a word: pick the nearest word on the nearest line; detect edges.
    const spans = Array.from(this.#sentenceEl.children) as HTMLElement[];
    if (!spans.length) return { time: s.start, word: null, edge: 0 };
    const rects = spans.map((el) => el.getBoundingClientRect());
    const lineY = rects.reduce((best, r) => (Math.abs((r.top + r.bottom) / 2 - y) < Math.abs((best.top + best.bottom) / 2 - y) ? r : best), rects[0]);
    const onLine = rects.map((r, i) => ({ r, i })).filter(({ r }) => Math.abs((r.top + r.bottom) / 2 - (lineY.top + lineY.bottom) / 2) < r.height / 2);
    const first = onLine[0], last = onLine[onLine.length - 1];
    if (at < from(first.r)) {
      const isFirstLine = first.i === 0;
      return { time: s.words[first.i].start, word: spans[first.i], edge: isFirstLine && at < from(rect) - 4 ? -1 : 0 };
    }
    if (at > to(last.r)) {
      const isLastLine = last.i === spans.length - 1;
      const w = s.words[last.i];
      // Stay just inside this sentence: its end is the next sentence's start.
      return { time: Math.max(w.start, w.end - 0.02), word: spans[last.i], edge: isLastLine && at > to(rect) + 4 ? 1 : 0 };
    }
    // Between words on the same line: the gap belongs to the word before it.
    for (let k = 0; k < onLine.length - 1; k++) {
      if (at >= to(onLine[k].r) && at <= from(onLine[k + 1].r)) {
        const w = s.words[onLine[k].i];
        return { time: Math.max(w.start, w.end - 0.02), word: spans[onLine[k].i], edge: 0 };
      }
    }
    return { time: s.start, word: spans[0], edge: 0 };
  }

  #onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.#sentences.length) return;
    e.preventDefault();
    this.#dragging = true;
    this.#touch = e.pointerType === 'touch';
    this.#scrubWord = -1;
    // Scrubbing takes over from any preview. The sentence on show stays, so pressing a word of a
    // previewed sentence (a search match not yet jumped to) goes to that word.
    this.#findPreview = null;
    this.#sliderPreview = null;
    this.toggleAttribute('data-dragging', true);
    this.setPointerCapture(e.pointerId);
    this.#scrubTo(e.clientX, e.clientY, true);
  };

  #onPointerMove = (e: PointerEvent) => {
    if (this.#dragging) {
      this.#scrubTo(e.clientX, e.clientY, false);
      return;
    }
    if (!this.#sentences.length || e.pointerType === 'touch') return;
    // Hover: show the time of the word under the pointer.
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
    if (this.#pendingSeek !== null) {
      clearTimeout(this.#seekTimer);
      this.#seekTimer = 0;
      this.#commitSeek();
    }
    this.#scrubTime = null;
    this.#hideTip();
    this.#syncToTime(this.currentTime);
  };

  #scrubTo(x: number, y: number, immediate: boolean) {
    const { time, word, edge } = this.#timeAtPoint(x, y);
    let target = time;
    if (edge !== 0) {
      const now = performance.now();
      if (now - this.#lastEdgeFlip <= EDGE_COOLDOWN_MS) return;
      const next = this.#index + edge;
      if (next < 0 || next >= this.#sentences.length) return;
      this.#lastEdgeFlip = now;
      target = edge > 0 ? this.#sentences[next].start : Math.max(this.#sentences[next].start, this.#sentences[next].end - 0.05);
      this.#scrubTime = target;
      this.#renderSentence(next);
      this.#renderEyebrow(null);
      this.#tap();
    } else {
      this.#scrubTime = target;
      // A light tick under the finger each time it crosses onto another word.
      const i = word ? Number(word.dataset.i) : -1;
      if (i !== this.#scrubWord) {
        if (this.#scrubWord !== -1) this.#tap();
        this.#scrubWord = i;
      }
    }
    this.#paintProgress(target);
    this.#showTip(edge === 0 ? word : null, target);
    this.#requestSeek(target, immediate);
  }

  /** Haptic tick for touch scrubbing, where the platform has one. */
  #tap() {
    if (!this.#touch) return;
    try {
      navigator.vibrate?.(4);
    } catch {
      /* not allowed here */
    }
  }

  #requestSeek(time: number, immediate: boolean) {
    this.#startAt = null; // the viewer has chosen a place; a pending link position no longer applies
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
    this.#pendingSeek = null;
    if (t === null) return;
    // Media clocks truncate, so a seek to exactly a word's start can report a time just before it
    // and leave the previous word lit. Land a few milliseconds inside the word instead.
    const target = t > 0 ? t + SEEK_NUDGE : 0;
    const time = this.#time.value;
    if (time) void time.seek(target);
    else if (this.#media && typeof this.#media.currentTime === 'number') (this.#media as unknown as HTMLMediaElement).currentTime = target;
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
    if (!this.#sentences.length || e.altKey || e.ctrlKey || e.metaKey) return;
    // Keys act on the live sentence, so leave any preview first.
    if (this.#preview() !== null) {
      this.#findPreview = null;
      this.#sliderPreview = null;
      this.#syncToTime(this.currentTime);
    }
    const s = this.#sentences[this.#index];
    const t = this.currentTime;
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
        target = Math.max(0, (this.duration || s.end) - 0.1);
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
