const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('currentProductPrice') || t.includes('priceDinar') || t.includes('priceFils')) logs.push(t);
  });

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  // Fill using evaluate to trigger React's onChange
  await page.evaluate(() => {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(emailInput, 'admin@company.com');
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    emailInput.dispatchEvent(new Event('change', { bubbles: true }));
    nativeInputValueSetter.call(passwordInput, 'ChangeMe123');
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.click('button[type=submit]');
  await page.waitForTimeout(3000);

  const afterBtns = await page.$$eval('button', els => els.map(e => e.textContent.trim().substring(0,30)));
  console.log('After login buttons:', JSON.stringify(afterBtns));

  if (afterBtns.includes('Products') || afterBtns.some(b => b.includes('Dashboard'))) {
    // Navigate
    await page.locator('button:has-text("Products")').first().click();
    await page.waitForTimeout(3000);
    await page.locator('tbody tr').first().click();
    await page.waitForTimeout(3000);
    await page.locator('button:has-text("Edit")').first().click();
    await page.waitForTimeout(3000);

    console.log('\n=== RUNTIME VALUES ===');
    if (logs.length > 0) {
      logs.forEach(l => console.log(l));
    } else {
      console.log('NO PRICE LOGS');
    }
  } else {
    console.log('Login failed. Buttons:', afterBtns);
  }

  await browser.close();
})().catch(e => console.error('ERR:', e.message.substring(0,150)));
