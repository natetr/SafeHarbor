import { startZIMIndexing, getIndexingStatus } from './server/services/zimIndexingService.js';

async function testIndexing() {
  try {
    console.log('Starting indexing test with 100 articles...\n');

    // Start indexing for Climate Change ZIM (ID 32) with only 100 articles as a test
    const result = await startZIMIndexing(32, {
      maxArticles: 100,
      batchSize: 10
    });

    console.log('Indexing started:', result);
    console.log('\nMonitoring progress...\n');

    // Monitor progress for 60 seconds
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const status = await getIndexingStatus(32);
      if (status) {
        console.log(`[${i + 1}s] Status: ${status.status}, Progress: ${status.indexed_articles || 0}/${status.total_articles || 0} (${(status.progress_percent || 0).toFixed(1)}%)`);

        if (status.status === 'completed' || status.status === 'failed') {
          console.log('\n✓ Indexing completed!');
          console.log('Final status:', status);
          break;
        }
      }
    }

  } catch (err) {
    console.error('Test failed:', err);
  }

  process.exit(0);
}

testIndexing();
