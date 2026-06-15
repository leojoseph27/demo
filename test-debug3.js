const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000', { timeout: 8000 });
  await page.waitForTimeout(2000);
  
  // Check page before login
  const preText = await page.evaluate(() => document.body.innerText.substring(0, 200));
  console.log('Before login:', preText);

  // Try API login directly
  const loginRes = await page.evaluate(async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@company.com', password: 'ChangeMe123' })
    });
    return { status: res.status, body: await res.json() };
  });
  console.log('API login result:', JSON.stringify(loginRes));

  // Try UI login
  await page.locator('#login-email').fill('admin@company.com');
  await page.locator('#login-password').fill('ChangeMe123');
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(3000);

  const afterText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('After login:', afterText);
  
  const afterBtns = await page.$$eval('button', els => els.map(e => e.textContent.trim().substring(0,30)));
  console.log('After login buttons:', JSON.stringify(afterBtns));

  await browser.close();
})().catch(e => console.error('ERR:', e.message.substring(0,100)));
