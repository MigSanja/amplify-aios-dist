#!/usr/bin/env node
// GitHub-Screencast: remotion-dev/template-tiktok Repo, sanft scrollen.
import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  recordVideo: { dir: "./rec-github", size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const smoothScroll = async (px, steps = 26) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await pause(38);
  }
};

await page.goto("https://github.com/remotion-dev/template-tiktok", {
  waitUntil: "domcontentloaded",
});
await pause(2600);
await smoothScroll(500);
await pause(1500);
await smoothScroll(600);
await pause(1800);

await ctx.close();
await browser.close();
console.log("OK");
