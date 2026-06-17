// One-off image cropper driving system Chrome (no ImageMagick/PIL on this box).
// Usage: node scripts/crop.js <inFile> <x> <y> <w> <h> <outPng>
// Captures the native-pixel region (x,y,w,h) of an image to <outPng>.
const puppeteer = require("puppeteer-core");
const path = require("path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , inFile, x, y, w, h, out] = process.argv;
const X = +x, Y = +y, W = +w, H = +h;
const fileUrl = "file://" + path.resolve(inFile);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;overflow:hidden;background:#000}
     img{position:absolute;left:${-X}px;top:${-Y}px}</style>
     <img src="${fileUrl}">`,
    { waitUntil: "networkidle0" }
  );
  // Ensure the image is fully decoded at natural size before snapping.
  await page.evaluate(async () => {
    const img = document.querySelector("img");
    if (!img.complete) await img.decode();
  });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log(`wrote ${out} (${W}x${H}) from ${inFile} @ ${X},${Y}`);
})();
