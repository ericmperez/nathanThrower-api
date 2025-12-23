import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import prisma from './lib/prisma';
import { analysisProvider } from './services/analysisProvider';
import { getObject } from './lib/s3';
import fs from 'fs';
import path from 'path';
import os from 'os';

dotenv.config();

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const worker = new Worker(
  'analysis',
  async (job) => {
    const { analysisId } = job.data;
    console.log(`Processing analysis ${analysisId}...`);

    try {
      // Update status to processing
      await prisma.analysis.update({
        where: { id: analysisId },
        data: { status: 'processing' },
      });

      // Fetch analysis details
      const analysis = await prisma.analysis.findUnique({
        where: { id: analysisId },
        include: { videoAsset: true },
      });

      if (!analysis) {
        throw new Error('Analysis not found');
      }

      // Download video to temp location (optional for mock provider)
      const tempDir = os.tmpdir();
      const tempVideoPath = path.join(tempDir, `${analysisId}.mp4`);
      
      // In production, download from S3:
      // const videoData = await getObject(analysis.videoAsset.key);
      // fs.writeFileSync(tempVideoPath, videoData.Body as Buffer);
      
      // For mock, we don't need the actual file
      console.log(`Video key: ${analysis.videoAsset.key}`);

      // Run analysis
      const result = await analysisProvider.analyzeVideo(tempVideoPath, {
        pitchType: analysis.pitchType as any,
        handedness: analysis.handedness as any,
        goal: analysis.goal as any,
      });

      // Store results
      await prisma.analysisMetrics.create({
        data: {
          analysisId,
          data: result.metrics as any,
        },
      });

      await prisma.coachingReport.create({
        data: {
          analysisId,
          data: result.report as any,
        },
      });

      // Update analysis status
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'completed',
          updatedAt: new Date(),
        },
      });

      // Clean up temp file
      if (fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
      }

      console.log(`✅ Analysis ${analysisId} completed`);
    } catch (error: any) {
      console.error(`❌ Analysis ${analysisId} failed:`, error);

      // Update analysis with error
      await prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          errorMessage: error.message || 'Unknown error occurred',
        },
      });

      throw error;
    }
  },
  { connection, concurrency: 2 }
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

console.log('🔄 Analysis worker started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await worker.close();
  process.exit(0);
});
