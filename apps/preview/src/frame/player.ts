import '@videojs/html/video/player';
import '@videojs/html/media/mux-video';
import '@/video/skin';
import { readFragmentTime } from '@/video/verbatim-quote';
import skinTemplate from '@/video/skin.html?raw';

/**
 * What the preview plays.
 *
 * Verbatim needs the words of the video. Each clip below streams from Mux and names a WebVTT file for the
 * transcript: either a hand-checked file in `public/`, or nothing, in which case the generated text track
 * is read whole from Mux's WebVTT endpoint. `?clip=<key>` picks a clip; `?media=demo` plays the small
 * bundled file with hand-written captions, for offline work on the skin.
 */
interface Clip {
  key: string;
  title: string;
  playbackId: string;
  /** ID of Mux's generated text track, used when `transcript` is empty. */
  textTrackId?: string;
  /** A corrected copy of the captions. Generated captions sometimes split or mishear a word. */
  transcript?: string;
  chapters: string;
  /** Second shown before the video starts. */
  poster: number;
}

const CLIPS: Clip[] = [
  {
    key: 'intro',
    title: 'Verbatim, explained from inside it',
    playbackId: 'O28Esic7RygYKj3RRi00cLGXz7sHpKm029cCQhLmjmCYc',
    transcript: './intro.vtt',
    chapters: './intro-chapters.vtt',
    poster: 19,
  },
  {
    key: 'nasa',
    title: 'How are we made of star stuff? · NASA',
    playbackId: 'pKXQkIyGiC4S4urt7p7ivSqmItowQ0237J00E4NyF2JX8',
    textTrackId: 'JAAX9fsmL00GaYq00HmAGI6BT01CJtmSQq0001Wv361qMiAPo9MyUd8RLTA',
    // Mux's generated captions with two words corrected by hand (see the note in the file).
    transcript: './star-stuff.vtt',
    chapters: './star-stuff-chapters.vtt',
    poster: 1,
  },
];

const DEMO_SRC = './verbatim-demo.mp4';
const DEMO_CAPTIONS = './verbatim-demo.vtt';
const DEMO_CHAPTERS = './verbatim-demo-chapters.vtt';

const MEDIA_PLACEHOLDER = '<!-- Add a compatible media component here. -->';

/** Clips that can be played: those with a playback ID. */
export function playableClips(): readonly Clip[] {
  return CLIPS.filter((clip) => clip.playbackId);
}

/** The clip the address asks for, or the first playable one. Null when the bundled demo file is forced. */
export function currentClip(): Clip | null {
  if (/[?#&]media=demo\b/.test(location.href)) return null;
  const asked = /[?&]clip=([\w-]+)/.exec(location.search)?.[1];
  const playable = playableClips();
  return playable.find((clip) => clip.key === asked) ?? playable[0] ?? null;
}

export function createPlayer(): HTMLElement {
  const player = document.createElement('video-player');
  const clip = currentClip();

  let media: string;
  let transcriptSrc = '';
  if (clip) {
    // The manifest carries any text tracks for the captions menu and native rendering; the transcript
    // loads its words whole, from the corrected file or from Mux's WebVTT endpoint.
    media = `<mux-video src="https://stream.mux.com/${clip.playbackId}.m3u8" playsinline crossorigin><track kind="chapters" label="English" srclang="en" src="${clip.chapters}" default></mux-video>`;
    transcriptSrc =
      clip.transcript ||
      (clip.textTrackId ? `https://stream.mux.com/${clip.playbackId}/text/${clip.textTrackId}.vtt` : '');
    // A link to a sentence opens on the frame it was said over, not the opening frame.
    const linked = readFragmentTime(location.hash);
    const still = linked === null ? clip.poster : Math.round(linked * 10) / 10;
    player.setAttribute('poster', `https://image.mux.com/${clip.playbackId}/thumbnail.webp?time=${still}`);
    player.setAttribute('title', clip.title);
  } else {
    media = `<video src="${DEMO_SRC}" playsinline crossorigin preload="metadata"><track kind="captions" label="English" srclang="en" src="${DEMO_CAPTIONS}"><track kind="chapters" label="English" srclang="en" src="${DEMO_CHAPTERS}" default></video>`;
  }

  player.innerHTML = skinTemplate.replace(MEDIA_PLACEHOLDER, media);
  if (transcriptSrc) player.querySelector('verbatim-transcript')?.setAttribute('src', transcriptSrc);
  return player;
}
