/**
 * <verbatim-find> — find in video.
 *
 * A search field for the transcript. Type a word and every place it is spoken becomes a tick on the
 * seek bar; the sentence of the nearest match is shown as a preview, and Enter jumps to it. Enter
 * again goes to the next place, Shift+Enter to the one before. Escape closes the field and returns
 * focus to the button that opened it.
 *
 * The element owns no markup: it wires up the parts it finds inside itself, so a skin can lay the
 * field out as it likes.
 *
 *   [data-part="input"]     the text field
 *   [data-part="count"]     "2 / 7", or "No matches" (visual)
 *   [data-part="status"]    the same with the match's time and sentence, for screen readers
 *   [data-part="previous"]  [data-part="next"]  [data-part="close"]   buttons
 *
 * The button that opens it is the element whose `aria-controls` is this element's id. Pressing "/"
 * anywhere in the player opens it too.
 */
import {
  UIElement,
  PlayerController,
  I18nController,
  playerContext,
  i18nContext,
  selectControls,
  selectTime,
  type PropertyValues,
} from '@videojs/html';
import type { VerbatimTranscriptElement } from './verbatim-transcript';

const MAX_TICKS = 240;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !('tagName' in el)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export class VerbatimFindElement extends UIElement {
  #controls = new PlayerController(this, playerContext, selectControls);
  #time = new PlayerController(this, playerContext, selectTime);
  #i18n = new I18nController(this, i18nContext);

  #disconnect: AbortController | null = null;
  #releaseLock: (() => void) | null = null;
  #root: HTMLElement | null = null;
  #transcript: VerbatimTranscriptElement | null = null;
  #trigger: HTMLElement | null = null;
  #input: HTMLInputElement | null = null;
  #count: HTMLElement | null = null;
  #status: HTMLElement | null = null;
  #ticks: HTMLElement | null = null;
  #ticksDuration = 0;

  #open = false;
  #pending = -1; // previewed, not yet jumped to
  #active = -1; // the match playback is at, or last passed

  /** Whether the field is showing. */
  get open(): boolean {
    return this.#open;
  }

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;

    this.#input = this.querySelector('[data-part="input"]');
    this.#count = this.querySelector('[data-part="count"]');
    this.#status = this.querySelector('[data-part="status"]');
    // Authored whitespace would keep the empty count from collapsing.
    if (this.#count) this.#count.textContent = '';
    if (this.#status) this.#status.textContent = '';
    this.toggleAttribute('data-open', false);
    this.setAttribute('inert', '');

    this.#input?.addEventListener('input', () => this.#run(), { signal });
    this.#input?.addEventListener('keydown', this.#onInputKeyDown, { signal });
    this.addEventListener('keydown', this.#onKeyDown, { signal });
    this.querySelector('[data-part="previous"]')?.addEventListener('click', () => this.step(-1), { signal });
    this.querySelector('[data-part="next"]')?.addEventListener('click', () => this.step(1), { signal });
    this.querySelector('[data-part="close"]')?.addEventListener('click', () => this.hide(), { signal });

    // Siblings may upgrade after us.
    queueMicrotask(() => this.#attach());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    this.#releaseLock?.();
    this.#releaseLock = null;
    this.#ticks?.remove();
    this.#ticks = null;
    this.#open = false;
  }

  update(changed: PropertyValues) {
    super.update(changed);
    if (this.#input) {
      const label = this.#translate('verbatim.find', 'Find in video');
      const placeholder = this.#translate('verbatim.find.placeholder', 'Find a word');
      if (this.#input.getAttribute('aria-label') !== label) this.#input.setAttribute('aria-label', label);
      if (this.#input.placeholder !== placeholder) this.#input.placeholder = placeholder;
    }
    if (!this.#open || !this.#transcript) return;

    // Ticks need the duration, which can arrive after the search.
    if (this.#transcript.duration !== this.#ticksDuration) this.#renderTicks();

    // With nothing pending, the selected match follows playback: the last one spoken.
    if (this.#pending === -1) {
      const results = this.#transcript.results;
      const now = this.#transcript.currentTime + 0.05;
      let passed = -1;
      for (let i = 0; i < results.length && results[i].time <= now; i++) passed = i;
      if (passed !== this.#active) {
        this.#active = passed;
        this.#transcript.markMatch(passed);
        this.#renderCount(false);
        this.#markTick();
      }
    }
  }

  // ---------------------------------------------------------------- public

  /** Open the field and put the cursor in it. */
  show(): void {
    const transcript = this.#transcript;
    if (this.#open || !transcript || transcript.hasAttribute('data-empty')) return;
    this.#open = true;
    this.removeAttribute('inert');
    this.toggleAttribute('data-open', true);
    this.#trigger?.setAttribute('aria-expanded', 'true');
    // Reading results takes longer than the idle timeout; hold the controls while the field is open.
    this.#releaseLock = this.#controls.value?.requestControlsLock?.() ?? null;
    this.#input?.focus({ preventScroll: true });
    this.#input?.select();
    if (this.#input?.value.trim()) this.#run();
  }

  /** Close the field, drop the search, and (by default) return focus to the button that opened it. */
  hide(restoreFocus = true): void {
    if (!this.#open) return;
    const hadFocus = this.contains(document.activeElement);
    this.#open = false;
    this.toggleAttribute('data-open', false);
    this.setAttribute('inert', '');
    this.#trigger?.setAttribute('aria-expanded', 'false');
    this.#releaseLock?.();
    this.#releaseLock = null;
    this.#pending = this.#active = -1;
    this.#transcript?.clearSearch();
    this.#ticks?.replaceChildren();
    if (this.#count) this.#count.textContent = '';
    if (this.#status) this.#status.textContent = '';
    if (restoreFocus && hadFocus) this.#trigger?.focus({ preventScroll: true });
  }

  toggle(): void {
    if (this.#open) this.hide();
    else this.show();
  }

  /** Go to the next (1) or previous (-1) place the query is spoken, wrapping at the ends. */
  step(direction: 1 | -1): void {
    const transcript = this.#transcript;
    const results = transcript?.results ?? [];
    if (!transcript || !results.length) return;
    const n = results.length;
    const now = transcript.currentTime;
    let index: number;

    if (this.#pending !== -1) {
      // A previewed match: Enter takes it, Shift+Enter takes the one before it.
      index = direction > 0 ? this.#pending : (this.#pending - 1 + n) % n;
    } else {
      const at = this.#active;
      const onIt = at !== -1 && now - results[at].time < 1.5;
      if (direction > 0) {
        index = onIt ? at + 1 : results.findIndex((m) => m.time > now + 0.05);
        if (index === -1 || index >= n) index = 0;
      } else {
        index = onIt ? at - 1 : at;
        if (index < 0) index = n - 1;
      }
    }

    this.#pending = -1;
    this.#active = index;
    transcript.showMatch(index, { seek: true });
    this.#renderCount(true);
    this.#markTick();
  }

  // ---------------------------------------------------------------- wiring

  #translate(key: string, fallback: string): string {
    // Skin-specific keys are not in Video.js's typed phrase list; the translator falls back to `default`.
    const translate = this.#i18n.value as unknown as (key: string, options: { default: string }) => string;
    try {
      return translate(key, { default: fallback }) || fallback;
    } catch {
      return fallback;
    }
  }

  #attach() {
    const signal = this.#disconnect?.signal;
    if (!signal || signal.aborted) return;
    const root = (this.closest('media-container') ?? this.closest('video-player')) as HTMLElement | null;
    const transcript = root?.querySelector('verbatim-transcript') ?? null;
    if (!root || !transcript) {
      setTimeout(() => this.isConnected && !this.#transcript && this.#attach(), 250);
      return;
    }
    this.#root = root;
    this.#transcript = transcript;
    this.#trigger = this.id ? root.querySelector(`[aria-controls="${this.id}"]`) : null;
    this.#trigger?.setAttribute('aria-expanded', 'false');
    this.#trigger?.addEventListener('click', () => this.toggle(), { signal });

    // "/" opens the field from anywhere in the player, as it does on most sites with search.
    root.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
        if (transcript.hasAttribute('data-empty')) return;
        event.preventDefault();
        if (this.#open) {
          this.#input?.focus({ preventScroll: true });
          this.#input?.select();
        } else this.show();
      },
      { signal }
    );

    // Escape closes the field from anywhere in the player, unless something nearer (a menu) took it.
    root.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || !this.#open || event.defaultPrevented) return;
        if (event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]')) return;
        event.preventDefault();
        this.hide();
      },
      { signal }
    );

    // Sentences are re-cut when the player changes width; the transcript keeps the search, we redraw.
    root.addEventListener(
      'verbatim-sentences',
      () => {
        if (!this.#open) return;
        if (transcript.hasAttribute('data-empty')) return this.hide(false);
        this.#renderTicks();
        this.#renderCount(false);
      },
      { signal }
    );
  }

  #onInputKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.step(event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? -1 : 1);
    }
  };

  #onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !this.#open) return;
    event.preventDefault();
    event.stopPropagation();
    this.hide();
  };

  // ---------------------------------------------------------------- search → view

  #run() {
    const transcript = this.#transcript;
    if (!transcript || !this.#input) return;
    const results = transcript.search(this.#input.value);
    this.#active = -1;
    this.#pending = -1;
    this.#renderTicks();
    if (results.length) {
      // Preview the next place it is spoken from here, without moving the video.
      const now = transcript.currentTime;
      let index = results.findIndex((m) => m.time >= now - 0.25);
      if (index === -1) index = 0;
      this.#pending = index;
      transcript.showMatch(index);
    }
    this.#renderCount(true);
    this.#markTick();
  }

  #renderCount(announce: boolean) {
    const transcript = this.#transcript;
    if (!transcript) return;
    const total = transcript.results.length;
    const query = this.#input?.value.trim() ?? '';
    const selected = this.#pending !== -1 ? this.#pending : this.#active;
    let text = '';
    if (total) text = `${selected + 1} / ${total}`;
    else if (query.length >= 2) text = this.#translate('verbatim.find.none', 'No matches');
    if (this.#count && this.#count.textContent !== text) this.#count.textContent = text;
    this.toggleAttribute('data-empty', !total && query.length >= 2);
    if (announce && this.#status) {
      const detail = total && selected !== -1 ? `, ${transcript.describeMatch(selected)}` : '';
      this.#status.textContent = `${text}${detail}`;
    }
  }

  /** One tick per match on the seek bar, where the thumb will stand when you go there. */
  #renderTicks() {
    const transcript = this.#transcript;
    const slider = this.#root?.querySelector('media-time-slider');
    if (!transcript || !slider) return;
    if (!this.#ticks || !this.#ticks.isConnected) {
      this.#ticks = document.createElement('div');
      this.#ticks.className = 'vb-find-ticks';
      this.#ticks.setAttribute('aria-hidden', 'true');
      slider.append(this.#ticks);
    }
    const duration = (this.#ticksDuration = transcript.duration);
    const results = transcript.results;
    const fragment = document.createDocumentFragment();
    if (duration > 0) {
      const stride = Math.max(1, Math.ceil(results.length / MAX_TICKS));
      for (let i = 0; i < results.length; i += stride) {
        const tick = document.createElement('i');
        tick.dataset.index = String(i);
        tick.style.setProperty('--vb-tick', (results[i].time / duration).toFixed(5));
        fragment.append(tick);
      }
    }
    this.#ticks.replaceChildren(fragment);
    this.#markTick();
  }

  #markTick() {
    if (!this.#ticks) return;
    const selected = String(this.#pending !== -1 ? this.#pending : this.#active);
    for (const tick of Array.from(this.#ticks.children) as HTMLElement[]) {
      tick.toggleAttribute('data-current', tick.dataset.index === selected);
    }
  }
}

if (!customElements.get('verbatim-find')) {
  customElements.define('verbatim-find', VerbatimFindElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'verbatim-find': VerbatimFindElement;
  }
}
