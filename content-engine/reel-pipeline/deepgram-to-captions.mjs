#!/usr/bin/env node
// Deepgram prerecorded REST → @remotion/captions Caption[] JSON
// Nutzung: node deepgram-to-captions.mjs <video.mp4> [--language=de] [--model=nova-2]
// Output: <video>.json neben dem Video (Format das template-tiktok erwartet)
// Key: DEEPGRAM_API_KEY aus ~/AIOS/.env (gleiches Pattern wie dashboard/rechnung.js)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const video = args.find((a) => !a.startsWith("--"));
if (!video || !fs.existsSync(video)) {
  console.error("Nutzung: node deepgram-to-captions.mjs <video> [--language=de] [--model=nova-2]");
  process.exit(1);
}
const opt = (name, def) => {
  const m = args.find((a) => a.startsWith("--" + name + "="));
  return m ? m.split("=")[1] : def;
};
const language = opt("language", "de");
const model = opt("model", language === "multi" ? "nova-3" : "nova-2");

const ROOT = path.join(os.homedir(), "Desktop", "Jarvis");
function envVal(name) {
  try {
    const e = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = e.match(new RegExp("^" + name + "=(.+)$", "m"));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const key = envVal("DEEPGRAM_API_KEY");
if (!key) {
  console.error("DEEPGRAM_API_KEY fehlt in " + ROOT + "/.env");
  process.exit(1);
}

// 1) Audio extrahieren (WAV mono 16k — lossless, klein genug)
const workAudio = video.replace(/\.[^.]+$/, "") + "-audio.wav";
const ff = spawnSync("ffmpeg", ["-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", workAudio], { stdio: ["ignore", "ignore", "pipe"] });
if (ff.status !== 0) {
  console.error("ffmpeg Audio-Extract fehlgeschlagen:\n" + ff.stderr.toString().slice(-800));
  process.exit(1);
}

// 2) Deepgram prerecorded REST mit Wort-Timestamps
const url = `https://api.deepgram.com/v1/listen?model=${model}&language=${language}&smart_format=true&punctuate=true&utterances=true`;
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: "Token " + key, "Content-Type": "audio/wav" },
  body: fs.readFileSync(workAudio),
});
if (!res.ok) {
  console.error("Deepgram-Fehler " + res.status + ": " + (await res.text()).slice(0, 500));
  process.exit(1);
}
const dg = await res.json();
const rawOut = video.replace(/\.[^.]+$/, "") + "-deepgram.json";
fs.writeFileSync(rawOut, JSON.stringify(dg, null, 2)); // Debug-Pflicht

const words = dg?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
if (!words.length) {
  console.error("Keine Wörter im Transkript — Sprache/Audio prüfen (raw: " + rawOut + ")");
  process.exit(1);
}

// 3) → Caption[] (Format @remotion/captions: text mit führendem Leerzeichen, ms)
const captions = words.map((w) => ({
  text: " " + (w.punctuated_word || w.word),
  startMs: Math.round(w.start * 1000),
  endMs: Math.round(w.end * 1000),
  timestampMs: Math.round(((w.start + w.end) / 2) * 1000),
  confidence: w.confidence ?? null,
}));
const out = video.replace(/\.[^.]+$/, ".json");
fs.writeFileSync(out, JSON.stringify(captions, null, 2));
fs.unlinkSync(workAudio);
console.log("OK: " + captions.length + " Wörter → " + out);
console.log("Transkript-Anfang: " + captions.slice(0, 12).map((c) => c.text).join("").trim());
