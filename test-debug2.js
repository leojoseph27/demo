const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();

  // Login
  await page.goto('http://localhost:3000', { timeout: 8000 });
  await page.waitForTimeout(2000);
  await page.locator('#login-email').fill('admin@example.com');
  await page.locator('#login-password').fill('admin123');
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(3000);

  // Check what's on page after login
  const buttons = await page.$$eval('button', els => els.map(e => e.textContent.trim().substring(0,40)));
  console.log('Buttons after login:', JSON.stringify(buttons));
  
  const links = await page.$$eval('a', els => els.map(e => e.textContent.trim().substring(0,40)));
  console.log('Links after login:', JSON.stringify(links));

  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body text:', bodyText);

  await browser.close();
})().catch(e => console.error('ERR:', e.message.substring(0,100)));
