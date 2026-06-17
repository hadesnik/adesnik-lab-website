// Reusable screenshot + responsive-diagnostics tool driving the system Chrome.
// Usage: node scripts/shot.js <baseUrl> <route> <outPrefix>
//   e.g. node scripts/shot.js http://localhost:8123 / home
const puppeteer = require("puppeteer-core");

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const [, , baseUrl = "http://localhost:8123", route = "/", out = "page"] =
  process.argv;
const url = baseUrl.replace(/\/$/, "") + route;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
  });

  // Desktop
  const dp = await browser.newPage();
  await dp.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
  await dp.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
  await dp.screenshot({ path: `previews/${out}-desktop.png`, fullPage: true });

  // Mobile
  const mp = await browser.newPage();
  await mp.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await mp.goto(url, { waitUntil: "networkidle0", timeout: 30000 });

  const diag = await mp.evaluate(() => {
    const tg = document.querySelector(".nav-toggle");
    const nv = document.querySelector(".primary-nav");
    return {
      innerWidth: window.innerWidth,
      mqMobile: window.matchMedia("(max-width: 860px)").matches,
      toggleDisplay: tg ? getComputedStyle(tg).display : "(none found)",
      navDisplay: nv ? getComputedStyle(nv).display : "(none found)",
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
    };
  });
  console.log(`[${out}] ` + JSON.stringify(diag));
  // Flag horizontal overflow (scrollWidth noticeably wider than viewport)
  if (diag.docScrollW > diag.docClientW + 2) {
    console.log(`[${out}] ⚠ horizontal overflow: ${diag.docScrollW} > ${diag.docClientW}`);
  }

  await mp.screenshot({ path: `previews/${out}-mobile.png`, fullPage: true });

  // Open the mobile menu and capture it
  const tgEl = await mp.$(".nav-toggle");
  if (tgEl) {
    await tgEl.click();
    const openState = await mp.evaluate(() => {
      const nv = document.querySelector(".primary-nav");
      return {
        navDisplayOpen: nv ? getComputedStyle(nv).display : "(none)",
        isOpen: nv ? nv.classList.contains("is-open") : false,
      };
    });
    console.log(`[${out}] menu-open ` + JSON.stringify(openState));
    await mp.screenshot({ path: `previews/${out}-mobile-open.png` });
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
