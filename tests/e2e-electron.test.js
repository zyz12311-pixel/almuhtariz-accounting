const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const path = require('path');

let electronApp;
let page;

test.beforeAll(async () => {
  // Launch Electron app
  electronApp = await electron.launch({
    args: [path.join(__dirname, '../electron/main.cjs')],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SMARTZ_DATA: path.join(__dirname, '../test-data'),
      PORT: '3114',
      HOST: '127.0.0.1'
    }
  });
  
  // Get the first window
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  
  // Wait for app to be ready
  await page.waitForSelector('#app', { timeout: 30000 });
});

test.afterAll(async () => {
  await electronApp?.close();
});

test('App launches and shows opening screen', async () => {
  // Should show opening screen or activity selection
  const opening = page.locator('.brand-opening, .activity-start, .auth-entry');
  await expect(opening.first()).toBeVisible({ timeout: 10000 });
});

test('Navigation between pages works', async () => {
  // Skip opening if present
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  // Select owner portal
  const ownerPortal = page.locator('[data-portal="owner"]');
  if (await ownerPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ownerPortal.click();
    await page.waitForSelector('#go', { timeout: 5000 });
    
    // Login
    await page.fill('#u', 'owner');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav', { timeout: 10000 });
  }
  
  // Test navigation to dashboard
  await page.click('a[href="#dashboard"]');
  await expect(page.locator('h1:has-text("نظرة عامة")')).toBeVisible({ timeout: 5000 });
  
  // Test navigation to invoices
  await page.click('a[href="#invoices"]');
  await expect(page.locator('h1:has-text("الفواتير")')).toBeVisible({ timeout: 5000 });
  
  // Test navigation to POS
  await page.click('a[href="#pos"]');
  await expect(page.locator('h1:has-text("نقطة البيع")')).toBeVisible({ timeout: 5000 });
  
  // Test navigation back to dashboard
  await page.click('a[href="#dashboard"]');
  await expect(page.locator('h1:has-text("نظرة عامة")')).toBeVisible({ timeout: 5000 });
});

test('Staff user can only access POS', async () => {
  // Login as staff
  await page.goto('http://127.0.0.1:3114');
  await page.waitForSelector('#app');
  
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  const staffPortal = page.locator('[data-portal="staff"]');
  if (await staffPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await staffPortal.click();
    await page.waitForSelector('#go');
    
    await page.fill('#u', 'cashier');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav');
  }
  
  // Staff should be redirected to POS
  await expect(page.locator('h1:has-text("نقطة البيع")')).toBeVisible({ timeout: 5000 });
  
  // Staff should not see admin navigation
  await expect(page.locator('a[href="#settings"]')).not.toBeVisible();
  await expect(page.locator('a[href="#reports"]')).not.toBeVisible();
  await expect(page.locator('a[href="#items"]')).not.toBeVisible();
});

test('Invoice printing opens external window', async () => {
  // This test verifies the print flow doesn't crash
  // We can't easily test external window opening in headless mode
  // but we can verify the print button exists and click doesn't error
  
  // Login as owner
  await page.goto('http://127.0.0.1:3114');
  await page.waitForSelector('#app');
  
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  const ownerPortal = page.locator('[data-portal="owner"]');
  if (await ownerPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ownerPortal.click();
    await page.waitForSelector('#go');
    
    await page.fill('#u', 'owner');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav');
  }
  
  // Navigate to new invoice
  await page.click('a[href="#new"]');
  await page.waitForSelector('#ln');
  
  // Fill minimal invoice
  await page.fill('#ln .d', 'اختبار طباعة');
  await page.fill('#ln .u', '100');
  await page.fill('#ln .q', '1');
  
  // Click issue
  await page.click('#issue');
  await page.waitForSelector('#confirm-issue');
  
  // Click confirm - this would trigger print in real app
  // In test, we just verify no crash
  await page.click('#confirm-issue');
  
  // Should show success or redirect
  await page.waitForTimeout(2000);
});

test('POS barcode scanner focus works', async () => {
  await page.goto('http://127.0.0.1:3114');
  await page.waitForSelector('#app');
  
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  const staffPortal = page.locator('[data-portal="staff"]');
  if (await staffPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await staffPortal.click();
    await page.waitForSelector('#go');
    
    await page.fill('#u', 'cashier');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav');
  }
  
  // Wait for POS to load
  await page.waitForSelector('#barcode-input', { timeout: 10000 });
  
  // Barcode input should be focused
  const barcodeInput = page.locator('#barcode-input');
  await expect(barcodeInput).toBeFocused();
  
  // Type in barcode input
  await barcodeInput.fill('123456789');
  await expect(barcodeInput).toHaveValue('123456789');
});

test('Logout works and clears session', async () => {
  await page.goto('http://127.0.0.1:3114');
  await page.waitForSelector('#app');
  
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  const ownerPortal = page.locator('[data-portal="owner"]');
  if (await ownerPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await ownerPortal.click();
    await page.waitForSelector('#go');
    
    await page.fill('#u', 'owner');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav');
  }
  
  // Click logout
  await page.click('#out');
  
  // Should reload and show login screen
  await page.waitForSelector('.auth-entry, .activity-start', { timeout: 10000 });
  
  // Verify we're back at login
  await expect(page.locator('#go')).toBeVisible();
});

test('Keyboard input works in POS', async () => {
  await page.goto('http://127.0.0.1:3114');
  await page.waitForSelector('#app');
  
  const skipBtn = page.locator('#skip-opening');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }
  
  const staffPortal = page.locator('[data-portal="staff"]');
  if (await staffPortal.isVisible({ timeout: 2000 }).catch(() => false)) {
    await staffPortal.click();
    await page.waitForSelector('#go');
    
    await page.fill('#u', 'cashier');
    await page.fill('#p', 'password123');
    await page.click('#go');
    await page.waitForSelector('nav');
  }
  
  await page.waitForSelector('#barcode-input', { timeout: 10000 });
  
  // Test physical keyboard simulation
  const barcodeInput = page.locator('#barcode-input');
  await barcodeInput.press('1');
  await barcodeInput.press('2');
  await barcodeInput.press('3');
  await expect(barcodeInput).toHaveValue('123');
  
  // Test Enter key submission
  await barcodeInput.fill('TEST-BARCODE');
  await barcodeInput.press('Enter');
  
  // Should not crash
  await page.waitForTimeout(1000);
});

test('Window.resize and Electron integration', async () => {
  // Test that Electron APIs are available
  const isElectron = await page.evaluate(() => window.electronAPI?.isElectron === true);
  expect(isElectron).toBe(true);
  
  // Test navigation helper
  const navResult = await page.evaluate(async () => {
    return await window.navigation.navigate('dashboard');
  });
  expect(typeof navResult).toBe('boolean');
  
  // Test printInvoice function exists
  const hasPrintFn = await page.evaluate(() => typeof window.electronAPI?.printInvoice === 'function');
  expect(hasPrintFn).toBe(true);
});