import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Test video URLs - using sample videos for testing
const drillVideos: Record<string, string> = {
  // Mobility drills
  'Hip Circles': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'Hip Flexor Stretch': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  '90/90 Hip Stretch': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',

  // Warmup drills
  'Crossover Row': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  'ATYT': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4',

  // Mechanics drills
  'Hinge Progression #1': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  'Hinge Progression #2': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4',

  // Recovery drills
  'Foam Roll Lats': 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
};

async function main() {
  console.log('Adding video URLs to drills...\n');

  for (const [title, videoUrl] of Object.entries(drillVideos)) {
    const drill = await prisma.drill.findFirst({
      where: { title },
    });

    if (drill) {
      await prisma.drill.update({
        where: { id: drill.id },
        data: { videoUrl },
      });
      console.log(`✓ Added video to: ${title}`);
    } else {
      console.log(`✗ Drill not found: ${title}`);
    }
  }

  console.log('\nDone! Videos added to the following drills:');
  console.log('- Hip Circles (mobility)');
  console.log('- Hip Flexor Stretch (mobility)');
  console.log('- 90/90 Hip Stretch (mobility)');
  console.log('- Crossover Row (warmup)');
  console.log('- ATYT (warmup)');
  console.log('- Hinge Progression #1 (mechanics)');
  console.log('- Hinge Progression #2 (mechanics)');
  console.log('- Foam Roll Lats (recovery)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
