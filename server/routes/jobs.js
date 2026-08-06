import express from 'express';
import { requireUser } from './auth.js';
import { getJobStatus } from '../utils/jobQueue.js';

const router = express.Router();
const allowedQueues = new Set(['tryon', 'profile']);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get('/:queueName/:jobId', requireUser, asyncRoute(async (req, res) => {
  const queueName = String(req.params.queueName || '').trim();
  const jobId = String(req.params.jobId || '').trim();
  if (!allowedQueues.has(queueName) || !jobId) return res.status(404).json({ message: 'Job not found' });

  const job = await getJobStatus(queueName, jobId);
  if (!job) return res.status(404).json({ message: 'Job not found' });

  const ownerId = String(job.data?.userId || '');
  if (!ownerId || ownerId !== req.user._id.toString()) return res.status(404).json({ message: 'Job not found' });

  res.json({
    job: {
      id: job.id,
      queue: job.queue,
      name: job.name,
      state: job.state,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      result: job.result,
      createdAt: job.createdAt,
      processedAt: job.processedAt,
      finishedAt: job.finishedAt
    }
  });
}));

export default router;
