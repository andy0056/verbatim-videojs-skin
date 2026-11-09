# Agent guide

This project is a Video.js HTML skin made by `videojs skin create`; `skin.json` records how. The skin is everything in `src/`, starting from `src/video/skin`. `apps/preview/` is a workbench that previews it; change it only when asked, except `apps/preview/src/frame/player` for the media the preview plays. `README.md` describes the rest.

- Use the `videojs-skin` skill when changing the skin. `npx @videojs/cli agents skills` prints how to install it.
- Keep every control keyboard operable, labeled, with a visible focus indicator, and in source order that matches its visual order. Keep the error dialog, hotkeys, and status announcer unless you replace them.
- Run `npm run typecheck` and `npm run build` after changes, and check the skin in the workbench with `npm run dev`. Deploy the workbench with `npm run deploy <vercel|netlify|cloudflare>` only when asked.
