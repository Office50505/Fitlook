import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import express from "express";
import multer from "multer";

import {
  MAX_WAIT_MS,
  TryOnError,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MAX_WAIT_MS,
  VIDEO_POLL_INTERVAL_MS,
  buildGlassesPayload,
  buildPredictionPayload,
  buildVideoPayload,
  createPrediction,
  createGlassesPrediction,
  createVideoPrediction,
  fetchResultImage,
  fetchResultMedia,
  isAllowedResultUrl,
  uploadImage,
  waitForResult,
} from "./pruna.js";
import {
  createFitRoomTask,
  pollFitRoomTask,
  validateFitRoomInputs,
} from "./fitroom.js";
import { createJob, finishJob, getJob, publicJob, updateJob } from "./jobs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Deliberately not PORT: an ambient PORT from a parent tool would collide with
   the Vite dev server. Set API_PORT if 5000 is taken. */
const PORT = Number(process.env.API_PORT || 5000);
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

const app = express();

/* Uploads stay in memory and are dropped when the request ends - nothing
   customer-supplied is ever written to disk. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 2 },
});

/* ----------------------------------------------------------- validation */

function sanitizeFilename(name) {
  const base = path.basename(name || "").replace(/[^A-Za-z0-9._-]/g, "_");
  return base.replace(/^\.+/, "").slice(0, 100) || "upload.jpg";
}

/** Magic-number sniff for jpeg / png / webp. */
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  return (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function validateImage(file, label) {
  if (!file) throw new TryOnError(`Missing ${label} image.`, 400);

  const filename = sanitizeFilename(file.originalname);
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new TryOnError(
      `${capitalize(label)} image must be a jpg, jpeg, png or webp file.`,
      400
    );
  }
  if (!file.buffer?.length) {
    throw new TryOnError(`${capitalize(label)} image is empty.`, 400);
  }
  if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
    throw new TryOnError(`${capitalize(label)} file is not a supported image.`, 400);
  }
  if (!looksLikeImage(file.buffer)) {
    throw new TryOnError(
      `${capitalize(label)} file does not look like a real image.`,
      400
    );
  }
  return { buffer: file.buffer, filename, mimetype: file.mimetype, label };
}

const parseBool = (v) => ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/* --------------------------------------------------------------- routes */

app.post(
  "/api/tryon",
  upload.fields([
    { name: "person", maxCount: 1 },
    { name: "product", maxCount: 1 },
  ]),
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const deadline = started + MAX_WAIT_MS;
    const provider = String(req.body?.provider || "pruna").toLowerCase();

    const person = validateImage(req.files?.person?.[0], "person");
    const product = validateImage(req.files?.product?.[0], "product");

    if (provider === "fitroom") {
      if (!(process.env.FITROOM_API_KEY || "").trim()) {
        throw new TryOnError(
          "FITROOM_API_KEY is not set on the server. Add it to your .env file.",
          500
        );
      }
      const clothType = String(req.body?.cloth_type || "upper").toLowerCase();
      await validateFitRoomInputs({
        modelBuffer: person.buffer,
        clothBuffer: product.buffer,
        clothType,
      });
      const task = await createFitRoomTask({
        modelBuffer: person.buffer,
        clothBuffer: product.buffer,
        clothType,
        hdMode: parseBool(req.body?.hd_mode),
      });
      const imageUrl = await waitForFitRoomResult(task.task_id, deadline);
      res.json({
        success: true,
        image_url: `/api/image?url=${encodeURIComponent(imageUrl)}`,
        source_url: imageUrl,
        elapsed_seconds: Math.round((Date.now() - started) / 100) / 10,
      });
    } else {
      // Pruna (default)
      if (!(process.env.PRUNA_API_KEY || "").trim()) {
        throw new TryOnError(
          "PRUNA_API_KEY is not set on the server. Add it to your .env file.",
          500
        );
      }
      const turbo = parseBool(req.body?.turbo);
      const category = String(req.body?.category || "upper").toLowerCase();
      const prompt = String(req.body?.prompt || "").trim().slice(0, 5000);
      const personRef = await uploadImage(person);
      const productRef = await uploadImage(product);
      const prediction = category === "glasses"
        ? await createGlassesPrediction(buildGlassesPayload(personRef, productRef))
        : await createPrediction(buildPredictionPayload(personRef, productRef, turbo, prompt));
      const imageUrl = await waitForResult(prediction, deadline);
      res.json({
        success: true,
        image_url: `/api/image?url=${encodeURIComponent(imageUrl)}`,
        source_url: imageUrl,
        elapsed_seconds: Math.round((Date.now() - started) / 100) / 10,
      });
    }
  })
);

/* ------------------------------------------------------------------ video */

/* Video takes minutes, so this starts a background job and returns immediately;
   the browser polls /api/video/:id. */
app.post(
  "/api/video",
  express.json({ limit: "16kb" }),
  asyncRoute(async (req, res) => {
    if (!(process.env.PRUNA_API_KEY || "").trim()) {
      throw new TryOnError(
        "PRUNA_API_KEY is not set on the server. Add it to your .env file.",
        500
      );
    }

    // Must be a Pruna-hosted image - normally the try-on result we just made.
    const imageUrl = String(req.body?.image_url || "");
    if (!isAllowedResultUrl(imageUrl)) {
      throw new TryOnError("Generate a try-on image first.", 400);
    }

    const { prompt, aspectRatio } = readVideoOptions(req.body);

    const jobId = createJob();
    res.status(202).json(publicJob(getJob(jobId)));

    // Runs past the lifetime of this request; never rejects to the caller.
    runVideoJob(jobId, { imageUrl, prompt, aspectRatio });
  })
);

/* Standalone image -> video: upload any image and animate it directly, with no
   try-on step. Same job machinery, different way of getting the first frame. */
app.post(
  "/api/video/upload",
  upload.single("image"),
  asyncRoute(async (req, res) => {
    if (!(process.env.PRUNA_API_KEY || "").trim()) {
      throw new TryOnError(
        "PRUNA_API_KEY is not set on the server. Add it to your .env file.",
        500
      );
    }

    const image = validateImage(req.file, "source");
    const { prompt, aspectRatio } = readVideoOptions(req.body);

    // Upload before responding so a rejected image is reported synchronously.
    const imageUrl = await uploadImage(image);

    const jobId = createJob();
    res.status(202).json(publicJob(getJob(jobId)));

    runVideoJob(jobId, { imageUrl, prompt, aspectRatio });
  })
);

function readVideoOptions(body) {
  const prompt = String(body?.prompt || "").slice(0, 5000);
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  if (!VIDEO_ASPECT_RATIOS.has(aspectRatio)) {
    throw new TryOnError("Unsupported aspect ratio.", 400);
  }
  return { prompt, aspectRatio };
}

async function runVideoJob(jobId, options) {
  try {
    const prediction = await createVideoPrediction(buildVideoPayload(options));
    updateJob(jobId, { status: "processing" });

    const videoUrl = await waitForResult(prediction, Date.now() + VIDEO_MAX_WAIT_MS, {
      intervalMs: VIDEO_POLL_INTERVAL_MS,
      onStatus: (status) => updateJob(jobId, { status }),
    });

    finishJob(jobId, { status: "succeeded", videoUrl });
  } catch (err) {
    const message =
      err instanceof TryOnError
        ? err.message
        : "Unexpected error while generating the video.";
    if (!(err instanceof TryOnError)) console.error("Video job failed:", err);
    finishJob(jobId, { status: "failed", error: message });
  }
}

app.get("/api/video/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: "Unknown video job." });
  }
  const payload = publicJob(job);
  res.json({
    ...payload,
    success: job.status !== "failed",
    // Proxied so the API key is never needed in the browser.
    video_url: job.videoUrl
      ? `/api/media?url=${encodeURIComponent(job.videoUrl)}`
      : null,
  });
});

/* Result URLs live on api.pruna.ai and can require the apikey header, so the
   image is streamed through the backend rather than handed to the browser. */
app.get(
  "/api/image",
  asyncRoute(async (req, res) => {
    const url = String(req.query.url || "");
    if (!isAllowedResultUrl(url)) {
      return res
        .status(400)
        .json({ success: false, error: "Refusing to proxy a non-Pruna URL." });
    }

    let upstream;
    try {
      upstream = await fetchResultImage(url);
    } catch (err) {
      console.error("Error fetching result image:", err.message);
      return res
        .status(502)
        .json({ success: false, error: "Could not download the generated image." });
    }

    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ success: false, error: "Could not download the generated image." });
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
    res.setHeader("Content-Disposition", 'inline; filename="tryon-result.jpg"');
    Readable.fromWeb(upstream.body).pipe(res);
  })
);

/* Same proxy as /api/image, but forwards Range so <video> can seek. */
app.get(
  "/api/media",
  asyncRoute(async (req, res) => {
    const url = String(req.query.url || "");
    if (!isAllowedResultUrl(url)) {
      return res
        .status(400)
        .json({ success: false, error: "Refusing to proxy a non-Pruna URL." });
    }

    const forwarded = {};
    if (req.headers.range) forwarded.Range = req.headers.range;

    let upstream;
    try {
      upstream = await fetchResultMedia(url, forwarded);
    } catch (err) {
      console.error("Error fetching result media:", err.message);
      return res
        .status(502)
        .json({ success: false, error: "Could not download the generated video." });
    }

    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .json({ success: false, error: "Could not download the generated video." });
    }

    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!upstream.headers.get("content-type")) res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", 'inline; filename="tryon-video.mp4"');

    res.status(upstream.status === 206 ? 206 : 200);
    Readable.fromWeb(upstream.body).pipe(res);
  })
);

/* In production the built React app is served from the same origin. */
const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

/* -------------------------------------------------------- error handling */

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found." });
});

// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature.
app.use((err, req, res, _next) => {
  if (err instanceof TryOnError) {
    console.warn("Try-on error:", err.message);
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Those images are too large. Limit is 15 MB each."
        : "Those uploads could not be read.";
    return res.status(413).json({ success: false, error: message });
  }
  console.error("Unexpected server error:", err);
  res.status(500).json({
    success: false,
    error: "Unexpected server error. Check the server logs.",
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

app.listen(PORT, "127.0.0.1", () => {
  if (!(process.env.PRUNA_API_KEY || "").trim()) {
    console.warn("PRUNA_API_KEY is not set - requests will fail until you set it.");
  }
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});

export default app;
