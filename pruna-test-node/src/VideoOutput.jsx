import { ASPECT_RATIOS, PHASE_LABELS } from "./useVideoJob.js";

/** Shared controls + result markup for both video paths. */
export function VideoControls({
  prompt,
  setPrompt,
  aspectRatio,
  setAspectRatio,
  busy,
  onStart,
  startLabel,
  disabled,
}) {
  return (
    <>
      <label className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-neutral-400">
        Motion prompt
      </label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        rows={4}
        maxLength={5000}
        className="w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-[13px] leading-relaxed outline-none focus:border-neutral-400 disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">Aspect</span>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-950"
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onStart}
          disabled={busy || disabled}
          className="ml-auto rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {startLabel}
        </button>
      </div>
    </>
  );
}

export function VideoStatus({ busy, job, elapsed, error }) {
  return (
    <>
      {busy && (
        <>
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm dark:border-neutral-800 dark:bg-neutral-950">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-neutral-100" />
            <span>{PHASE_LABELS[job?.status] ?? "Starting video…"}</span>
            <span className="ml-auto tabular-nums text-neutral-500 dark:text-neutral-400">
              {elapsed.toFixed(1)}s
            </span>
          </div>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Video usually takes a few minutes. You can leave this tab open.
          </p>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm break-words text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </div>
      )}
    </>
  );
}

export function VideoResult({ videoUrl, job }) {
  if (!videoUrl) return null;
  return (
    <div className="mt-3">
      <video
        src={videoUrl}
        controls
        autoPlay
        loop
        muted
        playsInline
        className="block h-auto w-full rounded-xl bg-neutral-950"
      />
      <div className="mt-3 flex flex-wrap gap-2.5">
        <a
          href={videoUrl}
          download="tryon-video.mp4"
          className="grow rounded-lg bg-neutral-900 px-5 py-2.5 text-center text-sm font-medium text-white hover:opacity-90 sm:grow-0 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Download Video
        </a>
        <a
          href={videoUrl}
          target="_blank"
          rel="noopener"
          className="grow rounded-lg border border-neutral-300 px-5 py-2.5 text-center text-sm font-medium hover:bg-neutral-100 sm:grow-0 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          Open Full Size
        </a>
        {typeof job?.elapsed_seconds === "number" && (
          <span className="self-center text-xs text-neutral-500 dark:text-neutral-400">
            generated in {job.elapsed_seconds}s
          </span>
        )}
      </div>
    </div>
  );
}
