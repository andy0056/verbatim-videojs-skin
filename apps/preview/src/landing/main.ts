import '@videojs/html/i18n';
import '@/skin.css';
import { createPlayer, currentClip, playableClips } from '../frame/player';

// The i18n provider follows the page's `lang` and loads Video.js's built-in translations for it.
const i18n = document.createElement('media-i18n');
const stage = document.getElementById('stage')!;
i18n.append(createPlayer());
stage.append(i18n);

// Width presets, so the responsive layout can be judged without leaving the page.
const sizes = Array.from(document.querySelectorAll<HTMLButtonElement>('.size'));
for (const button of sizes) {
  button.addEventListener('click', () => {
    stage.style.maxWidth = `${button.dataset.w}px`;
    for (const other of sizes) other.setAttribute('aria-pressed', String(other === button));
  });
}

// Links to a sentence (`#t=…`) are followed by the player itself; bring it into view when one is used.
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#t="]')) {
  link.addEventListener('click', () => {
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  });
}

// The page is written for the introduction clip. On the NASA clip the credit line and the example
// quote change to match, and the switch link points back.
const clip = currentClip();
const switcher = document.getElementById('clip-switch') as HTMLAnchorElement | null;
if (switcher) switcher.hidden = playableClips().length < 2;
if (clip?.key === 'nasa') {
  const credit = document.getElementById('credit');
  if (credit) {
    credit.innerHTML =
      'Playing <em>How are we made of star stuff?</em> from NASA\'s <a href="https://images.nasa.gov/">image and video library</a>, streamed from Mux. The words are Mux\'s auto-generated captions with two slips corrected by hand. The player works from that WebVTT alone; there are no word-level timestamps.';
  }
  const example = document.getElementById('quote-example') as HTMLAnchorElement | null;
  if (example) {
    example.href = '#t=81.73';
    example.textContent = '“we are made of star stuff, we are a way for the universe to know itself.”';
  }
  if (switcher) {
    switcher.href = './';
    switcher.textContent = 'Back to the introduction';
  }
}
