import { useState } from "react";

import UploadCard from "./UploadCard.jsx";
import { VideoControls, VideoResult, VideoStatus } from "./VideoOutput.jsx";
import useVideoJob, { DEFAULT_ROTATION_PROMPT } from "./useVideoJob.js";

/** Standalone path: upload any image and animate it, with no try-on step. */
export default function ImageToVideo() {
  const [image, setImage] = useState(null);
  const [prompt, setPrompt] = useState(DEFAULT_ROTATION_PROMPT);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const { job, busy, error, elapsed, videoUrl, start, reset, setError } = useVideoJob();

  function pickImage(file) {
    setImage(file);
    reset();
  }

  function startVideo() {
    if (!image) return;
    const body = new FormData();
    body.append("image", image);
    body.append("prompt", prompt);
    body.append("aspect_ratio", aspectRatio);
    start("/api/video/upload", { method: "POST", body });
  }

  return (
    <>
      <UploadCard
        title="Your Image"
        hint="Click or drop any photo to animate"
        file={image}
        onChange={pickImage}
        onReject={setError}
        disabled={busy}
      />

      <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-semibold">Rotation Video</h2>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          5 seconds · 720p · 24fps — animates the image above directly, no
          clothing change.
        </p>

        <VideoControls
          prompt={prompt}
          setPrompt={setPrompt}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
          busy={busy}
          onStart={startVideo}
          startLabel={videoUrl ? "Regenerate Video" : "Generate Video"}
          disabled={!image}
        />
        <VideoStatus busy={busy} job={job} elapsed={elapsed} error={error} />
        <VideoResult videoUrl={videoUrl} job={job} />
      </section>
    </>
  );
}
