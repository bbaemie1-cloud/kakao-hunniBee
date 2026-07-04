const { chromium } = require('playwright');

async function scrapeMockNotices(port = 8080) {
  console.log('[Web Scraper] Starting headless browser for scraping...');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = `http://localhost:${port}/mock_notices.html`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });

    const notices = await page.evaluate(() => {
      const items = document.querySelectorAll('.notice-item');
      const results = [];
      items.forEach((item, index) => {
        results.push({
          id: `scrape_mock_${index}`,
          title: item.querySelector('.title')?.innerText || '',
          category: item.querySelector('.category')?.innerText || '',
          target_audience: item.querySelector('.target')?.innerText || '',
          benefits: item.querySelector('.benefits')?.innerText || '',
          deadline: item.querySelector('.deadline')?.innerText || '',
          source_url: item.querySelector('.source')?.href || ''
        });
      });
      return results;
    });

    console.log(`[Web Scraper] Successfully scraped ${notices.length} notices.`);
    return notices;
  } catch (error) {
    console.error('[Web Scraper] Scraping failed. Server might be down:', error.message);
    return [];
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeMockNotices };
