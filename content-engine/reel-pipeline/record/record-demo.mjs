#!/usr/bin/env node
// Playwright-Screencast-Demo: fährt einen gescripteten Browser-Ablauf und
// zeichnet ihn als Video auf (für BrowserDemo-Szenen in Remotion).
// Demo-Flow: remotion.dev Startseite → scrollen → GitHub template-tiktok → scrollen.
import { chromium } from "playwright";

const OUT = process.argv[2] || "./recordings";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2, // scharfe Aufnahme (2880x1800 effektiv)
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();

const pause = (ms) => page.waitForTimeout(ms);
const smoothScroll = async (px, steps = 24) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await pause(40);
  }
};

// Szene 1: remotion.dev
await page.goto("https://www.remotion.dev", { waitUntil: "domcontentloaded" });
await pause(2200);
await smoothScroll(700);
await pause(1400);
await smoothScroll(700);
await pause(1600);

// Szene 2: GitHub-Repo
await page.goto("https://github.com/remotion-dev/template-tiktok", {
  waitUntil: "domcontentloaded",
});
await pause(2400);
await smoothScroll(800);
await pause(1800);

await ctx.close(); // schreibt das Video fertig
await browser.close();
console.log("OK: Screencast in " + OUT);
