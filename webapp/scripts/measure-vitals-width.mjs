/**
 * Measures the Vital Signs table against its container at each breakpoint.
 *
 * The point is to prove the no-horizontal-scroll claim rather than assume it:
 * it reports, per width, the table's own width, the scroll container's
 * client width, and whether the table actually overflows (scrollWidth >
 * clientWidth). Run with the dev server up:
 *
 *   node scripts/measure-vitals-width.mjs
 *
 * Credentials come from the environment, not the file, so nothing secret
 * lands on disk:
 *   set OSEM_USER=...   set OSEM_PASS=...   node scripts/measure-vitals-width.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.OSEM_BASE_URL ?? "http://localhost:3000";
const USER = process.env.OSEM_USER;
const PASS = process.env.OSEM_PASS;

// 1366 is the smallest of the requested widths; below it the sidebar plus a
// 13-column table genuinely cannot fit, so mobile is expected to scroll.
const WIDTHS = [1366, 1440, 1600, 1920];
const MOBILE = [390, 768];

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', USER);
await page.fill('input[type="password"], input[name="password"]', PASS);
await page.click('button[type="submit"]');
await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30000 });

await page.goto(`${BASE}/clinical?tab=vitals`, { waitUntil: "networkidle" });
// Wait for the table itself, not just the page shell -- an empty result set
// renders a colSpan-only row with no <colgroup> widths to measure.
await page.waitForSelector("table colgroup", { timeout: 30000 });

async function measure(width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400); // let the resize settle before measuring
  return page.evaluate(() => {
    const table = document.querySelector("table");
    const scroller = table?.parentElement;
    if (!table || !scroller) return null;
    return {
      viewport: window.innerWidth,
      // The table is allowed to be wider than the box only when it is
      // deliberately scrollable; what matters is table vs. its container.
      tableWidth: Math.round(table.getBoundingClientRect().width),
      containerWidth: scroller.clientWidth,
      overflows: scroller.scrollWidth > scroller.clientWidth,
      // True horizontal scroll on the page itself is the bug being fixed.
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      // The last column reaching the container's right edge is how a short
      // colgroup shows up visually.
      lastColRight: Math.round(
        table.querySelector("tbody tr td:last-child")?.getBoundingClientRect().right ?? 0
      ),
      containerRight: Math.round(scroller.getBoundingClientRect().right),
    };
  });
}

const report = [];
for (const w of WIDTHS) report.push(await measure(w, 900));
for (const w of MOBILE) report.push(await measure(w, 800));

console.table(report);
await browser.close();
