/**
 * FitRoom API client for virtual try-on.
 *
 * The API key stays in this process. Nothing here is ever sent to the browser.
 */

const BASE = "https://platform.fitroom.app";
const TASKS_URL = `${BASE}/api/tryon/v2/tasks`;
const MODEL_CHECK_URL = `${BASE}/api/tryon/input_check/v1/model`;
const CLOTHES_CHECK_URL = `${BASE}/api/tryon/input_check/v1/clothes`;

const UPLOAD_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 30_000;

export const POLL_INTERVAL_MS = 2000;
export const MAX_WAIT_MS = 300_000; // 5 minutes - FitRoom tasks can take longer

export const CLOTH_TYPES = new Set(["upper", "lower", "full_set", "combo"]);

/** Error whose message is safe to show the user. */
export class FitRoomError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "FitRoomError";
    this.statusCode = statusCode;
  }
}

const apiKey = () => (process.env.FITROOM_API_KEY || "").trim();

function authHeaders(extra = {}) {
  return { "X-API-KEY": apiKey(), ...extra };
}

async function safeJson(response, context) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error(
      `${context}: non-JSON response (status=${response.status}): ${text.slice(0, 500)}`
    );
    throw new FitRoomError(`FitRoom returned an unreadable response during ${context}.`);
  }
}

async function describeFitRoomError(response) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (payload.error) return String(payload.error).slice(0, 300);
    if (payload.message) return String(payload.message).slice(0, 300);
    if (payload.errors && Array.isArray(payload.errors) && payload.errors.length) {
      return String(payload.errors[0]).slice(0, 300);
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${response.status}`;
}

function isTimeout(err) {
  return err?.name === "TimeoutError" || err?.name === "AbortError";
}

/**
 * Optionally validate images via FitRoom's check endpoints.
 * Logs warnings if images fail validation, but doesn't block the try-on.
 * This is permissive for dev/testing with synthetic images.
 */
export async function validateFitRoomInputs({ modelBuffer, clothBuffer, clothType }) {
  if (!CLOTH_TYPES.has(clothType)) {
    throw new FitRoomError(`Invalid cloth_type: ${clothType}. Must be one of: ${[...CLOTH_TYPES].join(", ")}`, 400);
  }

  // Warn if validation fails, but don't block the request.
  try {
    const modelForm = new FormData();
    modelForm.append("model_image", new Blob([modelBuffer], { type: "image/jpeg" }), "model.jpg");
    const modelRes = await fetch(MODEL_CHECK_URL, {
      method: "POST",
      headers: authHeaders(),
      body: modelForm,
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (modelRes.ok) {
      const modelCheck = await modelRes.json();
      if (!modelCheck.valid) {
        console.warn(`Model image validation: ${modelCheck.reason || "not suitable"}`);
      }
    }

    const clothForm = new FormData();
    clothForm.append("clothes_image", new Blob([clothBuffer], { type: "image/jpeg" }), "clothes.jpg");
    const clothRes = await fetch(CLOTHES_CHECK_URL, {
      method: "POST",
      headers: authHeaders(),
      body: clothForm,
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
    if (clothRes.ok) {
      const clothCheck = await clothRes.json();
      if (!clothCheck.valid) {
        console.warn(`Clothing image validation: ${clothCheck.reason || "not suitable"}`);
      }
    }
  } catch (err) {
    console.warn(`Skipping FitRoom validation: ${err.message}`);
  }

  return true;
}

/**
 * Create a try-on task. Images are sent as multipart form data directly.
 */
export async function createFitRoomTask({
  modelBuffer,
  clothBuffer,
  clothType,
  hdMode = false,
}) {
  let response;
  try {
    const form = new FormData();
    form.append("model_image", new Blob([modelBuffer], { type: "image/jpeg" }), "model.jpg");
    form.append("cloth_image", new Blob([clothBuffer], { type: "image/jpeg" }), "cloth.jpg");
    form.append("cloth_type", clothType);
    if (hdMode) form.append("hd_mode", "true");

    response = await fetch(TASKS_URL, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new FitRoomError("Timed out while starting the try-on generation.", 504);
    }
    console.error("Network error creating FitRoom task:", err.message);
    throw new FitRoomError("Could not reach FitRoom to start the generation.");
  }

  if (!response.ok) {
    const status = response.status;
    let message = await describeFitRoomError(response);
    if (status === 402) {
      message = "Insufficient FitRoom credits.";
    }
    throw new FitRoomError(
      `FitRoom rejected the request: ${message}`,
      status < 500 ? status : 502
    );
  }

  return safeJson(response, "the generation request");
}

/**
 * Poll a task's status. Returns the payload directly.
 */
export async function pollFitRoomTask(taskId) {
  let response;
  try {
    response = await fetch(`${TASKS_URL}/${taskId}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeout(err)) {
      throw new FitRoomError("Timed out while checking the generation status.", 504);
    }
    console.error("Network error polling FitRoom task:", err.message);
    throw new FitRoomError("Lost connection to FitRoom while checking the status.");
  }

  if (!response.ok) {
    throw new FitRoomError(
      `FitRoom returned an error while checking status: ${await describeFitRoomError(response)}`,
      502
    );
  }
  return safeJson(response, "the status check");
}

/**
 * Wait for task completion, polling until done or timeout.
 */
export async function waitForFitRoomResult(taskId, deadline) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (Date.now() < deadline) {
    const payload = await pollFitRoomTask(taskId);
    const status = (payload.status || "").toUpperCase();

    if (status === "COMPLETED") {
      const url = payload.download_signed_url;
      if (!url) {
        console.error("Task completed but no download_signed_url:", JSON.stringify(payload).slice(0, 1000));
        throw new FitRoomError("FitRoom did not return an image URL on completion.");
      }
      return url;
    }

    if (status === "FAILED") {
      throw new FitRoomError(
        `FitRoom generation failed: ${payload.error_message || "unknown error"}`,
        502
      );
    }

    // CREATED or PROCESSING - keep waiting
    await sleep(POLL_INTERVAL_MS);
  }

  throw new FitRoomError("The generation did not finish in time.", 504);
}
