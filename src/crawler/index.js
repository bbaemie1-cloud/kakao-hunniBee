const { fetchPublicPolicies } = require('./api_fetcher');
const { scrapeMockNotices } = require('./web_scraper');
const { savePolicies } = require('./db');

async function runCrawler(apiKey = process.env.PUBLIC_API_KEY, port = process.env.PORT || 8080) {
  console.log('[Crawler] Starting crawler pipeline...');
  const results = [];

  // 1. Fetch from API
  const apiData = await fetchPublicPolicies(apiKey);
  results.push(...apiData);

  // 2. Scrape from web
  const scrapedData = await scrapeMockNotices(port);
  results.push(...scrapedData);

  // 3. Save to DB
  if (results.length > 0) {
    const saved = savePolicies(results);
    console.log(`[Crawler] Successfully saved ${results.length} policies to DB. Total policies: ${saved.length}`);
  } else {
    console.log('[Crawler] No policies found or fetched.');
  }
}

// Allow direct execution
if (require.main === module) {
  runCrawler().catch(console.error);
}

module.exports = { runCrawler };
