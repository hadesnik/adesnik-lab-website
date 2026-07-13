// One-off image cropper driving system Chrome (no ImageMagick/PIL on this box).
// Usage: node scripts/crop.js <inFile> <x> <y> <w> <h> <outPng>
// Captures the native-pixel region (x,y,w,h) of an image to <outPng>.
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { pathToFileURL } = require("url");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , inFile, x, y, w, h, out] = process.argv;
const X = +x, Y = +y, W = +w, H = +h;
const fileUrl = pathToFileURL(path.resolve(inFile)).href;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  // A real file:// document can load a file:// image (opaque about:blank cannot).
  const tmpHtml = path.join(os.tmpdir(), `crop-${W}x${H}.html`);
  fs.writeFileSync(
    tmpHtml,
    `<style>html,body{margin:0;padding:0;overflow:hidden;background:#000}
     img{position:absolute;left:${-X}px;top:${-Y}px}</style>
     <img src="${fileUrl}">`
  );
  await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "load" });
  // Ensure the image is fully loaded + decoded at natural size before snapping.
  await page.evaluate(async () => {
    const img = document.querySelector("img");
    if (!img.complete)
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("image failed to load"));
      });
    await img.decode();
  });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
  await browser.close();
  console.log(`wrote ${out} (${W}x${H}) from ${inFile} @ ${X},${Y}`);
})();
