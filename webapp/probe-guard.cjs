// Throwaway: with a dirty Purchase review, confirm switching sub-tabs now
// shows the unsaved-changes dialog instead of navigating away. Read-only.
const { chromium } = require("playwright");
const SUBMIT = "button[type=submit]";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill("#email", "test");
  await page.fill("#password", "test123");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click(SUBMIT),
  ]);

  await page.goto("http://localhost:3000/residents/medication/purchase?branch=6", { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);

  const rows = await page.locator("table tbody tr").count();
  console.log("list rows:", rows);
  if (rows < 2) { console.log("need at least one medicine row to test"); await browser.close(); return; }

  // Make the form dirty by editing a balance.
  const bal = page.locator('input[aria-label="Balance"]').first();
  await bal.fill("999");
  await page.waitForTimeout(600);

  // Click the "Charts" sub-tab.
  await page.locator("button", { hasText: /^Charts$/ }).first().click();
  await page.waitForTimeout(1200);

  const body = await page.locator("body").innerText();
  const stillOnPurchase = page.url().includes("/purchase");
  const hasDialog = /unsaved|Exit Without Saving|Save & Exit/i.test(body);
  console.log("still on purchase page:", stillOnPurchase);
  console.log("unsaved-changes dialog shown:", hasDialog);
  const m = body.match(/[^\n]*unsaved[^\n]*/i);
  if (m) console.log("dialog text:", m[0].trim().slice(0, 120));
  await page.screenshot({ path: "guard.png", fullPage: false });
  console.log("screenshot: guard.png");
  await browser.close();
})();
