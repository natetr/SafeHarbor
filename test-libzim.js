import { Archive } from '@openzim/libzim';

async function testZimAccess() {
  try {
    // Test with Climate Change Wikipedia ZIM
    const zimPath = '/Users/nate/Documents/SafeHarbor/zim/wikipedia_en_climate-change_mini_2025-10.zim';

    console.log('Opening ZIM file:', zimPath);
    const archive = new Archive(zimPath);

    console.log('ZIM loaded successfully!');
    console.log('Entry count:', archive.entryCount);
    console.log('Article count:', archive.articleCount);
    console.log('All entry count:', archive.allEntryCount);

    // Try to iterate through some entries
    console.log('\nListing first 10 articles:');
    let count = 0;
    for (const entry of archive.iterByPath()) {
      if (entry.isRedirect) continue;

      console.log(`  ${count + 1}. ${entry.title} (${entry.path})`);
      count++;

      if (count >= 10) break;
    }

    console.log('\nTest completed successfully!');
  } catch (err) {
    console.error('Error:', err);
  }
}

testZimAccess();
