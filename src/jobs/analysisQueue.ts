import { Queue } from 'bullmq';

// Only initialize Redis queue if REDIS_HOST is explicitly set
// This prevents deployment failures when Redis isn't available
const isRedisConfigured = !!process.env.REDIS_HOST;

const connection = isRedisConfigured ? {
  host: process.env.REDIS_HOST!,
  port: parseInt(process.env.REDIS_PORT || '6379'),
} : undefined;

// Analysis queue is optional - only created when Redis is configured
export const analysisQueue = connection ? new Queue('analysis', { connection }) : null;

export async function addAnalysisJob(analysisId: string) {
  if (!analysisQueue) {
    console.warn('⚠️ Analysis queue not configured - Redis not available. Analysis job skipped:', analysisId);
    return; // Gracefully skip if Redis isn't configured
  }

  await analysisQueue.add(
    'process-analysis',
    { analysisId },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    }
  );
}
