import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import skinTemplate from '@/video/skin.html?raw';

/**
 * What the preview plays.
 *
 * Verbatim reads the first captions track, so the demo media needs one. With a Mux playback ID and the ID of its
 * (auto-generated) text track, the preview streams from Mux and loads the whole transcript up front from Mux's
 * WebVTT endpoint. Without them it falls back to the bundled demo clip and its hand-written captions.
 */
const MUX_PLAYBACK_ID = '';
const MUX_TEXT_TRACK_ID = '';
const MUX_CHAPTERS = './verbatim-demo-chapters.vtt';

const DEMO_SRC = './verbatim-demo.mp4';
const DEMO_CAPTIONS = './verbatim-demo.vtt';
const DEMO_CHAPTERS = './verbatim-demo-chapters.vtt';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');

  let media: string;
  if (MUX_PLAYBACK_ID) {
    const captions = MUX_TEXT_TRACK_ID
      ? `<track kind="captions" label="English" srclang="en" src="https://stream.mux.com/${MUX_PLAYBACK_ID}/text/${MUX_TEXT_TRACK_ID}.vtt">`
      : '';
    media = `<mux-video src="https://stream.mux.com/${MUX_PLAYBACK_ID}.m3u8" playsinline crossorigin>${captions}<track kind="chapters" label="English" srclang="en" src="${MUX_CHAPTERS}" default></mux-video>`;
    player.setAttribute('poster', `https://image.mux.com/${MUX_PLAYBACK_ID}/thumbnail.webp?time=1`);
  } else {
    media = `<video src="${DEMO_SRC}" playsinline crossorigin preload="metadata"><track kind="captions" label="English" srclang="en" src="${DEMO_CAPTIONS}"><track kind="chapters" label="English" srclang="en" src="${DEMO_CHAPTERS}" default></video>`;
  }

  player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);
  return player;
}
