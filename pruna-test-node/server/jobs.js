/**
 * In-memory job store for video generation.
 *
 * Video can take several minutes, which is far too long to hold a single HTTP
 * request open, so the browser starts a job and then polls this store.
 * Deliberately not a database - jobs die with the process, which is right for
 * a local test harness.
 */

import { randomUUID } from "node:crypto";

const JOB_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const jobs = new Map();

export function createJob() {
  const id = randomUUID();
  jobs.set(id, {
    id,
    status: "starting",
    videoUrl: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  });
  return id;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

export function finishJob(id, patch) {
  return updateJob(id, { ...patch, finishedAt: Date.now() });
}

/** Shape sent to the browser. Never leaks internal fields. */
export function publicJob(job) {
  const reference = job.finishedAt ?? Date.now();
  return {
    job_id: job.id,
    status: job.status,
    video_url: job.videoUrl,
    error: job.error,
    elapsed_seconds: Math.round((reference - job.startedAt) / 100) / 10,
  };
}

const sweep = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id);
  }
}, SWEEP_INTERVAL_MS);

// Don't keep the process alive just for the sweeper.
sweep.unref();
