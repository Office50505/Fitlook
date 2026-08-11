/**
 * Pruna API client for p-image-try-on and p-video.
 *
 * The API key stays in this process. Nothing here is ever sent to the browser.
 */

const ORIGIN = "https://api.pruna.ai";
const BASE = `${ORIGIN}/v1`;
export const FILES_URL = `${BASE}/files`;
export const PREDICTIONS_URL = `${BASE}/predictions`;
const TRYON_MODEL = "p-image-try-on";
const GLASSES_MODEL = "p-try-on-glasses";
const VIDEO_MODEL = "p-video";

const UPLOAD_TIMEOUT_MS = 120_000;
const PREDICT_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;

export const POLL_INTERVAL_MS = 1000;
export const MAX_WAIT_MS = 120_000;

/* Video is far slower than the image try-on, so it gets its own budget and a
   gentler poll cadence. */
export const VIDEO_POLL_INTERVAL_MS = 2000;
export const VIDEO_MAX_WAIT_MS = 600_000;

const STATUS_DONE = new Set(["succeeded", "completed", "success", "done"]);
const STATUS_FAILED = new Set(["failed", "error", "canceled", "cancelled"]);

/** Error whose message is safe to show the user. */
export class TryOnError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "TryOnError";
    this.statusCode = statusCode;
  }
}

const apiKey = () => (process.env.PRUNA_API_KEY || "").trim();

function authHeaders(extra = {}) {
  return { apikey: apiKey(), ...extra };
}

/* -------------------------------------------------------------- extractors */

function dig(obj, ...keys) {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

const isHttpUrl = (v) => typeof v === "string" && v.startsWith("http");

/**
 * Pruna returns `generation_url` as a bare path (e.g.
 * "/v1/predictions/delivery/.../output.mp4"), so resolve those against the API
 * origin. Absolute URLs pass through untouched; anything else is rejected.
 */
export function resolveUrl(value) {
  if (typeof value !== "string" || !value) return null;
  if (isHttpUrl(value)) return value;
  if (value.startsWith("/")) return `${ORIGIN}${value}`;
  return null;
}

/** Pull the uploaded file's reference URL out of any documented response shape. */
export function extractFileReference(data) {
  if (!data || typeof data !== "object") return null;

  const candidates = [
    dig(data, "urls", "get"),
    data.url,
    data.file_url,
    data.download_url,
    data.uri,
    dig(data, "data", "urls", "get"),
    dig(data, "data", "url"),
    dig(data, "file", "urls", "get"),
  ];
  for (const candidate of candidates) {
    if (isHttpUrl(candidate)) return candidate;
  }

  for (const candidate of candidates) {
    const url = resolveUrl(candidate);
    if (url) return url;
  }

  const fileId = data.id ?? dig(data, "data", "id");
  if (typeof fileId === "string" && fileId) return `${FILES_URL}/${fileId}`;
  return null;
}

function firstUrl(value) {
  if (typeof value === "string") return resolveUrl(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = firstUrl(item);
      if (url) return url;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["url", "image", "generation_url", "download_url"]) {
      const url = firstUrl(value[key]);
      if (url) return url;
    }
  }
  return null;
}

/** Find the finished image URL across the documented/observed shapes. */
export function extractImageUrl(payload) {
  if (!payload || typeof payload !== "object") return null;

  const candidates = [
    payload.generation_url,
    payload.image_url,
    payload.url,
    payload.result,
    payload.output,
    dig(payload, "urls", "get"),
    dig(payload, "output", "url"),
    dig(payload, "output", "image"),
    dig(payload, "result", "url"),
  ];
  for (const candidate of candidates) {
    const url = firstUrl(candidate);
    if (url) return url;
  }

  const nested = payload.data ?? payload.prediction;
  if (nested && typeof nested === "object") return extractImageUrl(nested);
  return null;
}

export function extractStatus(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["status", "state"]) {
    if (typeof payload[key] === "string") return payload[key].toLowerCase();
  }
  if (payload.data && typeof payload.data === "object") {
    return extractStatus(payload.data);
  }
  return null;
}

export function extractPollUrl(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    dig(payload, "urls", "get"),
    payload.get_url,
    payload.status_url,
    payload.poll_url,
    dig(payload, "data", "urls", "get"),
  ];
  for (const candidate of candidates) {
    const url = resolveUrl(candidate);
    if (url) return url;
  }
  // Documented status endpoint shape, used only if no explicit URL came back.
  const id = payload.id ?? dig(payload, "data", "id");
  if (typeof id === "string" && id) return `${PREDICTIONS_URL}/status/${id}`;
  return null;
}

function extractFailureReason(payload) {
  if (!payload || typeof payload !== "object") return "The generation failed.";
  for (const key of ["error", "detail", "message", "logs"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 300);
    }
  }
  return "The generation failed.";
}

/* ------------------------------------------------------------------ helpers */

async function safeJson(response, context) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(
      `${context}: non-JSON response (status=${response.status}): ${text.slice(0, 500)}`
    );
    throw new TryOnError(`Pruna returned an unreadable response during ${context}.`);
  }
}

/** Short, secret-free description of a Pruna error response. */
async function describeApiError(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    for (const key of ["error", "message", "detail", "title"]) {
      const value = payload?.[key];
      if (typeof value === "string" && value) return value.slice(0, 300);
      if (value && typeof value === "object") {
        const nested = value.message || value.detail;
        if (typeof nested === "string" && nested) return nested.slice(0, 300);
      }
    }
  } catch {
    /* fall through to the status code */
  }
  return `HTTP ${response.status}`;
}

function isTimeout(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError";
}

/* -------------------------------------------------------------- operations */

/** Upload one image buffer to Pruna, returning its file reference URL. */
export async function uploadImage({ buffer, filename, mimetype, label }) {
  const form = new FormData();
  form.append("content", new Blob([buffer], { type: mimetype }), filename);

  let response;
  try {
    response = await fetch(FILES_URL, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new TryOnError(`Timed out uploading the ${label} image to Pruna.`, 504);
    }
    console.error(`Network error uploading ${label} image:`, err.message);
    throw new TryOnError(`Could not reach Pruna to upload the ${label} image.`);
  }

  if (!response.ok) {
    throw new TryOnError(
      `Pruna rejected the ${label} image upload: ${await describeApiError(response)}`,
      response.status < 500 ? response.status : 502
    );
  }

  const payload = await safeJson(response, `the ${label} image upload`);
  const reference = extractFileReference(payload);
  if (!reference) {
    console.error(
      `Could not extract file reference for ${label}:`,
      JSON.stringify(payload).slice(0, 1000)
    );
    throw new TryOnError(
      `Pruna's upload response for the ${label} image had an unexpected format.`
    );
  }
  return reference;
}

/** Field names per the current p-image-try-on documentation. */
export function buildPredictionPayload(personRef, garmentRef, turbo, prompt = "") {
  const input = {
    person_image: personRef,
    garment_images: [garmentRef],
    turbo: Boolean(turbo),
    output_format: "jpg",
    output_quality: 95,
    preserve_input_size: true,
  };

  if (prompt) input.prompt = prompt;

  return {
    input: {
      ...input,
    },
  };
}

/** Field names required by Pruna's dedicated eyewear try-on model. */
export function buildGlassesPayload(personRef, glassesRef) {
  return {
    input: {
      person: personRef,
      glass: glassesRef,
    },
  };
}

async function createTryOnPrediction(payload, model) {
  let response;
  try {
    response = await fetch(PREDICTIONS_URL, {
      method: "POST",
      headers: authHeaders({
        Model: model,
        "Try-Sync": "true",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new TryOnError("Timed out while starting the try-on generation.", 504);
    }
    console.error("Network error creating prediction:", err.message);
    throw new TryOnError("Could not reach Pruna to start the generation.");
  }

  if (!response.ok) {
    throw new TryOnError(
      `Pruna rejected the generation request: ${await describeApiError(response)}`,
      response.status < 500 ? response.status : 502
    );
  }
  return safeJson(response, "the generation request");
}

export function createPrediction(payload) {
  return createTryOnPrediction(payload, TRYON_MODEL);
}

export function createGlassesPrediction(payload) {
  return createTryOnPrediction(payload, GLASSES_MODEL);
}

/* --------------------------------------------------------------- p-video */

export const DEFAULT_ROTATION_PROMPT = "Create a clean fashion lookbook video using the input image as the exact visual reference.\n\nThe person performs one slow, smooth 360-degree turn on the spot to showcase the outfit from the front, side, back, opposite side, and return toward the front. The rotation should be natural, controlled, and continuous, like a professional ecommerce fashion model displaying an outfit.\n\nKeep the person's feet close to the same position with minimal natural foot adjustment required for turning. Keep the arms relaxed naturally beside the body with only subtle movement caused by the rotation. No walking toward or away from the camera, no dramatic posing, no dancing, and no unnecessary gestures.\n\nIDENTITY LOCK: Preserve the exact same person throughout the entire video. Keep the face, facial features, skin tone, hairstyle, hair length, body shape, body proportions, age appearance, and overall identity consistent in every frame. Do not morph, regenerate, beautify, or alter the face during the rotation.\n\nOUTFIT LOCK: Preserve the exact outfit from the input image throughout the entire video. The clothing design, colors, patterns, prints, logos, embroidery, fabric texture, neckline, sleeves, fit, garment length, waistband, stitching, layering, accessories, and footwear must remain consistent. Do not redesign, replace, recolor, simplify, or hallucinate clothing details while the person turns.\n\nWhen previously unseen side or back portions of the outfit become visible, generate them as a natural and physically consistent continuation of the visible garment design. Do not introduce random patterns, logos, colors, accessories, openings, or garment changes.\n\nMaintain realistic fabric physics with only subtle natural folds and movement caused by the body turning. Avoid excessive cloth fluttering or deformation.\n\nCAMERA LOCK: Use a completely fixed camera position. No camera movement, orbit, pan, tilt, zoom, dolly, tracking, shake, reframing, or perspective changes. The PERSON rotates; the CAMERA does not.\n\nKeep the person fully visible and consistently framed throughout the video. Do not crop the head, feet, hands, or outfit during the rotation.\n\nBACKGROUND & LIGHTING LOCK: Preserve the original clean background and lighting throughout the entire video. No background changes, darkening, exposure shifts, flickering, cinematic lighting changes, spotlights, color grading, or added objects.\n\nMotion should be smooth, realistic, stable, and suitable for a premium ecommerce fashion lookbook.\n\nFINAL PRIORITY:\n\n1. Exact identity preservation.\n2. Exact outfit preservation.\n3. One slow natural 360-degree body rotation.\n4. Fixed camera and consistent framing.\n5. Stable background and lighting.\n6. Realistic body and fabric motion.\n7. No visual morphing, flickering, warping, or unwanted changes.";

export const VIDEO_ASPECT_RATIOS = new Set([
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "1:1",
]);

/**
 * Field names per the current p-video docs. `image` is the first frame, so the
 * try-on result drives the video. duration/resolution are the requested 5s/720p.
 */
export function buildVideoPayload({ imageUrl, prompt, aspectRatio = "9:16" }) {
  return {
    input: {
      image: imageUrl,
      prompt: prompt || DEFAULT_ROTATION_PROMPT,
      duration: 5,
      resolution: "720p",
      fps: 24,
      aspect_ratio: VIDEO_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "9:16",
    },
  };
}

/**
 * Start a video prediction. Deliberately async - no Try-Sync header, since
 * video takes far longer than the 60s sync window allows.
 */
export async function createVideoPrediction(payload) {
  let response;
  try {
    response = await fetch(PREDICTIONS_URL, {
      method: "POST",
      headers: authHeaders({
        Model: VIDEO_MODEL,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new TryOnError("Timed out while starting the video generation.", 504);
    }
    console.error("Network error creating video prediction:", err.message);
    throw new TryOnError("Could not reach Pruna to start the video.");
  }

  if (!response.ok) {
    throw new TryOnError(
      `Pruna rejected the video request: ${await describeApiError(response)}`,
      response.status < 500 ? response.status : 502
    );
  }
  return safeJson(response, "the video request");
}

export async function pollOnce(pollUrl) {
  let response;
  try {
    response = await fetch(pollUrl, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new TryOnError("Timed out while checking the generation status.", 504);
    }
    console.error("Network error polling prediction:", err.message);
    throw new TryOnError("Lost connection to Pruna while checking the status.");
  }

  if (!response.ok) {
    throw new TryOnError(
      `Pruna returned an error while checking status: ${await describeApiError(response)}`,
      502
    );
  }
  return safeJson(response, "the status check");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Return the finished image URL, polling if the prediction is still running.
 * `poll` is injectable so the flow can be tested without touching the network.
 */
export async function waitForResult(initialPayload, deadline, options = {}) {
  // Tolerate a bare poller as the third argument: silently falling back to the
  // real network here would be an easy and expensive mistake.
  const {
    poll = pollOnce,
    intervalMs = POLL_INTERVAL_MS,
    onStatus,
  } = typeof options === "function" ? { poll: options } : options;

  let payload = initialPayload;

  let status = extractStatus(payload);
  let imageUrl = extractImageUrl(payload);
  if (imageUrl && (status === null || STATUS_DONE.has(status))) return imageUrl;
  if (status && STATUS_FAILED.has(status)) {
    throw new TryOnError(extractFailureReason(payload));
  }

  const pollUrl = extractPollUrl(payload);
  if (!pollUrl) {
    console.error(
      "No result and no poll URL in prediction response:",
      JSON.stringify(payload).slice(0, 1000)
    );
    throw new TryOnError("Pruna's response did not contain a result or a status URL.");
  }

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    payload = await poll(pollUrl);
    status = extractStatus(payload);
    if (status) onStatus?.(status);
    if (status && STATUS_FAILED.has(status)) {
      throw new TryOnError(extractFailureReason(payload));
    }
    imageUrl = extractImageUrl(payload);
    if (imageUrl && (status === null || STATUS_DONE.has(status))) return imageUrl;
  }

  throw new TryOnError("The generation did not finish in time.", 504);
}

/** Only Pruna hosts may be proxied, and no sneaky `api.pruna.ai.evil.com`. */
export function isAllowedResultUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "pruna.ai" || host.endsWith(".pruna.ai");
}

export function fetchResultImage(url) {
  return fetchResultMedia(url);
}

/** `extraHeaders` carries the browser's Range header through for video seeking. */
export function fetchResultMedia(url, extraHeaders = {}) {
  return fetch(url, {
    headers: authHeaders(extraHeaders),
    signal: AbortSignal.timeout(120_000),
  });
}
