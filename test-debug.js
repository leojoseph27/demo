const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000', { timeout: 8000 });
    await page.waitForTimeout(3000);
    
    // Get all input elements
    const inputs = await page.$$eval('input', els => els.map(e => ({type:e.type, placeholder:e.placeholder, name:e.name, id:e.id})));
    console.log('Inputs:', JSON.stringify(inputs));
    
    // Get all button texts
    const buttons = await page.$$eval('button', els => els.map(e => e.textContent.trim()));
    console.log('Buttons:', JSON.stringify(buttons));
    
    // Try login with exact selectors
    if (inputs.length >= 2) {
      await page.type('input:nth-of-type(1)', 'admin@example.com');
      await page.type('input:nth-of-type(2)', 'admin123');
      await page.click('button');
      await page.waitForTimeout(3000);
      console.log('After login URL:', page.url());
      
      const inputs2 = await page.$$eval('input', els => els.map(e => ({type:e.type, placeholder:e.placeholder})));
      console.log('After login inputs:', JSON.stringify(inputs2));
      const buttons2 = await page.$$eval('button', els => els.map(e => e.textContent.trim().substring(0,30)));
      console.log('After login buttons:', JSON.stringify(buttons2));
    }
  } catch(e) {
    console.error('ERR:', e.message.split('\n')[0]);
  }
  await browser.close();
})();
