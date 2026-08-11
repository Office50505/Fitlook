import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 2000;

export const DEFAULT_ROTATION_PROMPT = "Create a clean fashion lookbook video using the input image as the exact visual reference.\n\nThe person performs one slow, smooth 360-degree turn on the spot to showcase the outfit from the front, side, back, opposite side, and return toward the front. The rotation should be natural, controlled, and continuous, like a professional ecommerce fashion model displaying an outfit.\n\nKeep the person's feet close to the same position with minimal natural foot adjustment required for turning. Keep the arms relaxed naturally beside the body with only subtle movement caused by the rotation. No walking toward or away from the camera, no dramatic posing, no dancing, and no unnecessary gestures.\n\nIDENTITY LOCK: Preserve the exact same person throughout the entire video. Keep the face, facial features, skin tone, hairstyle, hair length, body shape, body proportions, age appearance, and overall identity consistent in every frame. Do not morph, regenerate, beautify, or alter the face during the rotation.\n\nOUTFIT LOCK: Preserve the exact outfit from the input image throughout the entire video. The clothing design, colors, patterns, prints, logos, embroidery, fabric texture, neckline, sleeves, fit, garment length, waistband, stitching, layering, accessories, and footwear must remain consistent. Do not redesign, replace, recolor, simplify, or hallucinate clothing details while the person turns.\n\nWhen previously unseen side or back portions of the outfit become visible, generate them as a natural and physically consistent continuation of the visible garment design. Do not introduce random patterns, logos, colors, accessories, openings, or garment changes.\n\nMaintain realistic fabric physics with only subtle natural folds and movement caused by the body turning. Avoid excessive cloth fluttering or deformation.\n\nCAMERA LOCK: Use a completely fixed camera position. No camera movement, orbit, pan, tilt, zoom, dolly, tracking, shake, reframing, or perspective changes. The PERSON rotates; the CAMERA does not.\n\nKeep the person fully visible and consistently framed throughout the video. Do not crop the head, feet, hands, or outfit during the rotation.\n\nBACKGROUND & LIGHTING LOCK: Preserve the original clean background and lighting throughout the entire video. No background changes, darkening, exposure shifts, flickering, cinematic lighting changes, spotlights, color grading, or added objects.\n\nMotion should be smooth, realistic, stable, and suitable for a premium ecommerce fashion lookbook.\n\nFINAL PRIORITY:\n\n1. Exact identity preservation.\n2. Exact outfit preservation.\n3. One slow natural 360-degree body rotation.\n4. Fixed camera and consistent framing.\n5. Stable background and lighting.\n6. Realistic body and fabric motion.\n7. No visual morphing, flickering, warping, or unwanted changes.";

export const ASPECT_RATIOS = ["9:16", "1:1", "16:9", "4:3", "3:4"];

export const PHASE_LABELS = {
  starting: "Starting video…",
  processing: "Generating rotation video…",
  succeeded: "Done",
  failed: "Failed",
};

/**
 * Drives a background video job: kicks it off, then polls until it finishes.
 * The caller supplies the request, so this works for both the try-on result
 * (JSON) and a standalone upload (FormData).
 */
export default function useVideoJob() {
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const startedAt = useRef(0);
  const pollRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    // Must be reset on mount, not just set on unmount: StrictMode mounts,
    // unmounts and remounts, which would otherwise leave polling dead.
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      clearTimeout(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => clearInterval(id);
  }, [busy]);

  const poll = useCallback(async (jobId) => {
    if (cancelled.current) return;
    try {
      const response = await fetch(`/api/video/${jobId}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
      }
      if (cancelled.current) return;
      setJob(payload);

      if (payload.status === "succeeded") {
        setBusy(false);
        return;
      }
      if (payload.status === "failed") {
        setError(payload.error || "The video generation failed.");
        setBusy(false);
        return;
      }
      pollRef.current = setTimeout(() => poll(jobId), POLL_MS);
    } catch (err) {
      if (cancelled.current) return;
      setError(err.message || "Lost contact with the server while generating.");
      setBusy(false);
    }
  }, []);

  const start = useCallback(
    async (url, options) => {
      clearTimeout(pollRef.current);
      setError("");
      setJob(null);
      setBusy(true);
      setElapsed(0);
      startedAt.current = Date.now();

      try {
        const response = await fetch(url, options);
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error("The server returned an unreadable response.");
        }
        if (!response.ok) {
          throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
        }
        setJob(payload);
        pollRef.current = setTimeout(() => poll(payload.job_id), POLL_MS);
      } catch (err) {
        setError(err.message || "Could not start the video.");
        setBusy(false);
      }
    },
    [poll]
  );

  const reset = useCallback(() => {
    clearTimeout(pollRef.current);
    setJob(null);
    setError("");
    setBusy(false);
    setElapsed(0);
  }, []);

  const videoUrl = job?.status === "succeeded" ? job.video_url : null;

  return { job, busy, error, elapsed, videoUrl, start, reset, setError };
}
