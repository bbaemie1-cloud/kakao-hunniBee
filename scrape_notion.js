const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    console.log('Navigating to Notion page...');
    await page.goto('https://app.notion.com/p/3749b97b4888803bb90bef3ddbcfbcfb?v=4739b97b488883b3a439089fe7dfba63&p=3749b97b4888806b8564ee264e2fafde&pm=s', { waitUntil: 'load', timeout: 30000 });
    
    // Wait for the notion content block to appear
    await page.waitForSelector('.notion-page-content', { timeout: 15000 }).catch(() => console.log('notion-page-content not found, trying body'));
    
    // Extract text
    const text = await page.evaluate(() => {
      const content = document.querySelector('.notion-page-content');
      if (content) return content.innerText;
      return document.body.innerText;
    });
    
    console.log("=== NOTION CONTENT START ===");
    console.log(text);
    console.log("=== NOTION CONTENT END ===");
  } catch (error) {
    console.error('Error fetching Notion page:', error);
  } finally {
    await browser.close();
  }
})();
