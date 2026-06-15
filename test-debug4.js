const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-gpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text().substring(0,200)}`));

  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);

  // Fill and submit
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

  console.log('Page errors:', errors);
  console.log('Console logs (last 20):');
  logs.slice(-20).forEach(l => console.log(l));
  
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 300));
  console.log('Body text:', bodyText);

  await browser.close();
})().catch(e => console.error('ERR:', e.message.substring(0,150)));
