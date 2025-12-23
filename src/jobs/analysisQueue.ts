import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

export const analysisQueue = new Queue('analysis', { connection });

export async function addAnalysisJob(analysisId: string) {
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
