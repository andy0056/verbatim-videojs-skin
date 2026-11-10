/**
 * Verbatim icon family.
 *
 * One stroke weight (1.5 at 18px), round caps and joins. Play, pause and the speaker are filled: outlined
 * versions of those three read badly at control size, so only the secondary glyphs stay as line work.
 * The play triangle is drawn slightly right of centre so it looks centred inside a round or square button.
 */
import { registerIcons } from '@videojs/html/icons';

const svg = (body: string, fill = 'none') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="${fill}" aria-hidden="true" viewBox="0 0 18 18">${body}</svg>`;

const stroke = 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const playIcon = svg(
  '<path d="M5.5 3.2v11.6c0 .7.8 1.2 1.4.8l9.1-5.8a1 1 0 0 0 0-1.6L6.9 2.4a1 1 0 0 0-1.4.8z" fill="currentColor"/>'
);
export const pauseIcon = svg(
  '<rect x="3.5" y="3" width="4" height="12" rx="1" fill="currentColor"/><rect x="10.5" y="3" width="4" height="12" rx="1" fill="currentColor"/>'
);
export const restartIcon = svg(`<path d="M3 9a6 6 0 1 0 1.8-4.3L3 6.5" ${stroke}/><path d="M3 2.8v3.7h3.7" ${stroke}/>`);
export const seekIcon = svg(`<path d="M4.4 13.6a6.5 6.5 0 1 1 9.2 0" ${stroke}/><path d="M15.5 2.5v4h-4" ${stroke}/>`);

export const volumeHighIcon = svg(
  `<path d="M2 6.5h2.6L9 3v12L4.6 11.5H2z" fill="currentColor"/><path d="M11.8 6.4a3.6 3.6 0 0 1 0 5.2M13.9 4.2a6.7 6.7 0 0 1 0 9.6" ${stroke}/>`
);
export const volumeLowIcon = svg(
  `<path d="M2 6.5h2.6L9 3v12L4.6 11.5H2z" fill="currentColor"/><path d="M11.8 6.4a3.6 3.6 0 0 1 0 5.2" ${stroke}/>`
);
export const volumeOffIcon = svg(
  `<path d="M2 6.5h2.6L9 3v12L4.6 11.5H2z" fill="currentColor"/><path d="m11.5 6.75 4.5 4.5m0-4.5-4.5 4.5" ${stroke}/>`
);

export const captionsOffIcon = svg(
  `<rect x="1.5" y="3" width="15" height="12" rx="1.5" ${stroke}/><path d="M4.5 8h3.5M9.5 8h4M4.5 11h5M11 11h2.5" ${stroke}/>`
);
export const captionsOnIcon = svg(
  '<path fill="currentColor" fill-rule="evenodd" d="M3 2.25A2.25 2.25 0 0 0 .75 4.5v9A2.25 2.25 0 0 0 3 15.75h12a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 15 2.25zm1.5 5a.75.75 0 0 0 0 1.5H8a.75.75 0 0 0 0-1.5zm5 0a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5zm-5 3a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5zm6.5 0a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5z" clip-rule="evenodd"/>'
);

export const fullscreenEnterIcon = svg(`<path d="M11 2.5h4.5V7M7 15.5H2.5V11M15.5 2.5 10.75 7.25M2.5 15.5l4.75-4.75" ${stroke}/>`);
export const fullscreenExitIcon = svg(`<path d="M15 7h-4V3M3 11h4v4M15.5 2.5 11 7M2.5 15.5 7 11" ${stroke}/>`);

export const pipEnterIcon = svg(
  `<rect x="1.5" y="3" width="15" height="12" rx="1.5" ${stroke}/><rect x="9" y="8.5" width="6" height="4.5" rx="1" fill="currentColor"/>`
);
export const pipExitIcon = svg(
  `<rect x="1.5" y="3" width="15" height="12" rx="1.5" ${stroke}/><rect x="3" y="5" width="6" height="4.5" rx="1" fill="currentColor"/>`
);

export const airPlayEnterIcon = svg(
  `<path d="M3.5 13.5H2.5A1.5 1.5 0 0 1 1 12V4.5A1.5 1.5 0 0 1 2.5 3h13A1.5 1.5 0 0 1 17 4.5V12a1.5 1.5 0 0 1-1.5 1.5h-1" ${stroke}/><path d="m9 9.5 4.5 6h-9z" ${stroke}/>`
);
export const airPlayExitIcon = svg(
  `<path d="M3.5 13.5H2.5A1.5 1.5 0 0 1 1 12V4.5A1.5 1.5 0 0 1 2.5 3h13A1.5 1.5 0 0 1 17 4.5V12a1.5 1.5 0 0 1-1.5 1.5h-1" ${stroke}/><path d="m9 9.5 4.5 6h-9z" fill="currentColor"/>`
);
export const castEnterIcon = svg(
  `<path d="M1.5 7V4.5A1.5 1.5 0 0 1 3 3h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 15H9.5" ${stroke}/><path d="M1.5 10.5a4.5 4.5 0 0 1 4.5 4.5M1.5 13.5A1.5 1.5 0 0 1 3 15" ${stroke}/>`
);
export const castExitIcon = svg(
  `<path d="M1.5 7V4.5A1.5 1.5 0 0 1 3 3h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 15 15H9.5" ${stroke}/><path d="M1.5 10.5a4.5 4.5 0 0 1 4.5 4.5M1.5 13.5A1.5 1.5 0 0 1 3 15" ${stroke}/><path d="M5 6h9v6.5H9.9A6.1 6.1 0 0 0 5 8.6z" fill="currentColor"/>`
);

export const gearIcon = svg(
  `<path d="M7.6 1.5h2.8l.3 2.4.9.4 1.9-1.5 2 2-1.5 1.9.4.9 2.4.3v2.8l-2.4.3-.4.9 1.5 1.9-2 2-1.9-1.5-.9.4-.3 2.4H7.6l-.3-2.4-.9-.4-1.9 1.5-2-2 1.5-1.9-.4-.9-2.4-.3V7.6l2.4-.3.4-.9L2.5 4.5l2-2 1.9 1.5.9-.4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="9" cy="9" r="2.25" stroke="currentColor" stroke-width="1.4"/>`
);
export const chevronIcon = svg(`<path d="m7 4.5 4.5 4.5L7 13.5" ${stroke}/>`);
export const checkIcon = svg(`<path d="m3.5 9.5 3.5 3.5 7.5-8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`);
export const speedIcon = svg(`<path d="M2.5 11.5a6.5 6.5 0 1 1 13 0" ${stroke}/><path d="m9 11.5 3-4" ${stroke}/><circle cx="9" cy="11.5" r="1" fill="currentColor"/>`);
export const speechIcon = svg(`<path d="M3 3.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-3.5 3v-3H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" ${stroke}/>`);
export const switchesIcon = svg(`<path d="M2.5 5.5h13M2.5 12.5h13" ${stroke}/><circle cx="6.5" cy="5.5" r="2" fill="currentColor"/><circle cx="11.5" cy="12.5" r="2" fill="currentColor"/>`);
export const qualityIcon = switchesIcon;
export const searchIcon = svg(`<circle cx="7.75" cy="7.75" r="4.75" ${stroke}/><path d="m11.4 11.4 4.1 4.1" ${stroke}/>`);
export const linkIcon = svg(
  `<path d="M7.5 10.5a3 3 0 0 0 4.24 0l2.5-2.5A3 3 0 0 0 10 3.76l-.75.74" ${stroke}/><path d="M10.5 7.5a3 3 0 0 0-4.24 0l-2.5 2.5A3 3 0 0 0 8 14.24l.75-.74" ${stroke}/>`
);
export const closeIcon = svg(`<path d="m4.5 4.5 9 9m0-9-9 9" ${stroke}/>`);
export const transcriptIcon = svg(`<path d="M3 4.5h12M3 8h8M3 11.5h12M3 15h6" ${stroke}/>`);
export const spinnerIcon = svg(
  `<style>@keyframes vb-spin{to{transform:rotate(360deg)}}</style><path d="M9 2.5A6.5 6.5 0 1 1 2.5 9" ${stroke} style="transform-origin:9px 9px;animation:var(--media-spinner-animation, vb-spin .9s linear infinite)"/>`
);

registerIcons('verbatim', {
  'airplay-enter': airPlayEnterIcon,
  'airplay-exit': airPlayExitIcon,
  'captions-off': captionsOffIcon,
  'captions-on': captionsOnIcon,
  'cast-enter': castEnterIcon,
  'cast-exit': castExitIcon,
  check: checkIcon,
  chevron: chevronIcon,
  close: closeIcon,
  link: linkIcon,
  'fullscreen-enter': fullscreenEnterIcon,
  'fullscreen-exit': fullscreenExitIcon,
  gear: gearIcon,
  pause: pauseIcon,
  'pip-enter': pipEnterIcon,
  'pip-exit': pipExitIcon,
  play: playIcon,
  quality: qualityIcon,
  restart: restartIcon,
  search: searchIcon,
  seek: seekIcon,
  speech: speechIcon,
  speed: speedIcon,
  spinner: spinnerIcon,
  switches: switchesIcon,
  transcript: transcriptIcon,
  'volume-high': volumeHighIcon,
  'volume-low': volumeLowIcon,
  'volume-off': volumeOffIcon,
});
