import { useEffect, useState } from "react";

import { VideoControls, VideoResult, VideoStatus } from "./VideoOutput.jsx";
import useVideoJob, { DEFAULT_ROTATION_PROMPT } from "./useVideoJob.js";

/** Animates an existing try-on result (already hosted on Pruna). */
export default function VideoPanel({ sourceUrl }) {
  const [prompt, setPrompt] = useState(DEFAULT_ROTATION_PROMPT);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const { job, busy, error, elapsed, videoUrl, start, reset } = useVideoJob();

  // A new try-on result invalidates any previous video.
  useEffect(() => {
    reset();
  }, [sourceUrl, reset]);

  function startVideo() {
    start("/api/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: sourceUrl,
        prompt,
        aspect_ratio: aspectRatio,
      }),
    });
  }

  return (
    <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-1 text-sm font-semibold">Rotation Video</h2>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        5 seconds · 720p · 24fps — animates the try-on result above.
      </p>

      <VideoControls
        prompt={prompt}
        setPrompt={setPrompt}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        busy={busy}
        onStart={startVideo}
        startLabel={videoUrl ? "Regenerate Video" : "Generate Video"}
      />
      <VideoStatus busy={busy} job={job} elapsed={elapsed} error={error} />
      <VideoResult videoUrl={videoUrl} job={job} />
    </section>
  );
}
