/**
 * <verbatim-quote> — a link to the sentence on show.
 *
 * Press the button and the address of this page, with the sentence's start time in its fragment
 * (`#t=17.76`, the Media Fragments form), is copied. Open such a link and the player starts at that
 * sentence. A change to the fragment while the page is open moves the player too, so pasting a link
 * into the same tab works.
 *
 * The element owns no markup: it wires up the parts it finds inside itself.
 *
 *   [data-part="button"]   copies the link
 *   [data-part="status"]   "Link copied" with the time, for screen readers
 *
 * While the confirmation shows, the element carries `data-copied` (or `data-failed` when the browser
 * refused the clipboard), so a skin can swap the icon and the tooltip text.
 *
 * Attributes
 *   href   the address to link to, when it should not be the page's own (an embed pointing at its
 *          canonical page, for instance)
 */
import { UIElement, I18nController, i18nContext, type PropertyValues } from '@videojs/html';
import type { VerbatimTranscriptElement } from './verbatim-transcript';

const CONFIRM_MS = 2000;

/** Read a start time from a URL fragment: `t=83`, `t=83.5`, `t=1:23`, `t=npt:83,90`. Seconds, or null. */
export function readFragmentTime(hash: string): number | null {
  const match = /(?:^|[#&])t=([^&]+)/.exec(hash);
  if (!match) return null;
  let value: string;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  value = value.replace(/^npt:/, '').split(',')[0];
  if (/^\d+(\.\d+)?$/.test(value)) return parseFloat(value);
  if (/^(\d+:)?\d{1,2}:\d{2}(\.\d+)?$/.test(value)) {
    return value.split(':').reduce((total, part) => total * 60 + parseFloat(part), 0);
  }
  return null;
}

/** Put a start time into an address, keeping any other `name=value` pairs already in its fragment. */
export function withFragmentTime(address: string, time: number): string {
  const url = new URL(address, location.href);
  // Round up, so the time always falls inside the sentence's first word and never just before it.
  const seconds = Math.max(0, Math.ceil(time * 100 - 1e-6) / 100);
  const kept = url.hash
    .slice(1)
    .split('&')
    .filter((pair) => pair.includes('=') && !pair.startsWith('t='));
  url.hash = [...kept, `t=${Number(seconds.toFixed(2))}`].join('&');
  return url.href;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

export class VerbatimQuoteElement extends UIElement {
  #i18n = new I18nController(this, i18nContext);

  #disconnect: AbortController | null = null;
  #transcript: VerbatimTranscriptElement | null = null;
  #button: HTMLElement | null = null;
  #status: HTMLElement | null = null;
  #timer = 0;

  connectedCallback() {
    super.connectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = new AbortController();
    const { signal } = this.#disconnect;

    this.#button = this.querySelector('[data-part="button"]');
    this.#status = this.querySelector('[data-part="status"]');
    if (this.#status) this.#status.textContent = '';
    this.#button?.addEventListener('click', () => void this.copy(), { signal });
    window.addEventListener('hashchange', () => this.#follow(), { signal });

    // Siblings may upgrade after us.
    queueMicrotask(() => this.#attach());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#disconnect?.abort();
    this.#disconnect = null;
    clearTimeout(this.#timer);
    this.#transcript = null;
  }

  update(changed: PropertyValues) {
    super.update(changed);
  }

  /** The link to the sentence on show, or null when there is no transcript. */
  get link(): string | null {
    const quote = this.#transcript?.quote();
    return quote ? withFragmentTime(this.getAttribute('href') || location.href, quote.time) : null;
  }

  /** Copy the link to the sentence on show. Resolves to whether the browser allowed it. */
  async copy(): Promise<boolean> {
    const quote = this.#transcript?.quote();
    const link = this.link;
    if (!quote || !link) return false;
    const copied = await this.#write(link);
    clearTimeout(this.#timer);
    this.toggleAttribute('data-copied', copied);
    this.toggleAttribute('data-failed', !copied);
    if (copied) this.#transcript?.flashQuote();
    if (this.#status) {
      this.#status.textContent = copied
        ? `${this.#translate('verbatim.quote.copied', 'Link copied')}, ${clock(quote.time)}`
        : this.#translate('verbatim.quote.failed', 'Could not copy the link');
    }
    this.dispatchEvent(new CustomEvent('verbatim-quote', { bubbles: true, detail: { link, copied, ...quote } }));
    this.#timer = window.setTimeout(() => {
      this.toggleAttribute('data-copied', false);
      this.toggleAttribute('data-failed', false);
      if (this.#status) this.#status.textContent = '';
    }, CONFIRM_MS);
    return copied;
  }

  // ---------------------------------------------------------------- internals

  #attach() {
    const signal = this.#disconnect?.signal;
    if (!signal || signal.aborted) return;
    const root = (this.closest('media-container') ?? this.closest('video-player')) as HTMLElement | null;
    const transcript = root?.querySelector('verbatim-transcript') ?? null;
    if (!root || !transcript) {
      setTimeout(() => this.isConnected && !this.#transcript && this.#attach(), 250);
      return;
    }
    this.#transcript = transcript;
    this.#follow();
  }

  /** Go where the page's address says, if it names a time. */
  #follow() {
    const time = readFragmentTime(location.hash);
    if (time !== null) this.#transcript?.startAt(time);
  }

  async #write(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* not allowed here (an embed without clipboard permission, say); try the older way */
    }
    try {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.setAttribute('aria-hidden', 'true');
      field.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none';
      this.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      this.#button?.focus({ preventScroll: true });
      return copied;
    } catch {
      return false;
    }
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
}

if (!customElements.get('verbatim-quote')) {
  customElements.define('verbatim-quote', VerbatimQuoteElement);
}

declare global {
  interface HTMLElementTagNameMap {
    'verbatim-quote': VerbatimQuoteElement;
  }
}
