<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep narration readiness and estimated phrase timing in the browser-safe narration-timeline module; both preview and export use it to avoid silent completion and inconsistent captions.
- Burn Arabic captions using browser-shaped canvas PNGs in the lazy FFmpeg export, because the bundled core does not guarantee Arabic text shaping or font filters.
- Preserve selected voice settings in generator project data and overlap speech generation with the existing single-video queue, avoiding duplicate video requests.
- The client advertising form saves its brief and logo into an owned generator project and uses the existing generator flow; do not represent a quoted price as a completed payment without a verified payment service.
