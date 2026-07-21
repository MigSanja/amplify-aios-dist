#!/usr/bin/env node
// Schneidet Ähs/Pausen/Versprecher raus, basierend auf Deepgram-Wort-Timestamps.
// Logik: Deepgram transkribiert deutsche Füller (äh/ähm) meist NICHT → sie liegen in
// Lücken zwischen Wörtern. Lücken > GAP werden rausgeschnitten (mit Padding).
// Zusätzlich explizite Schnitte (Versprecher): --cut=22.145-22.465 (mehrfach möglich).
// Nutzung: node cut-fillers.mjs <video> <deepgram.json> [--gap=0.45] [--cut=a-b ...]
// Output: <video-basename>-cut.mp4 + -cut.json (Captions, Zeiten verschoben)
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const [video, dgPath] = args.filter((a) => !a.startsWith("--"));
const GAP = parseFloat((args.find((a) => a.startsWith("--gap=")) || "--gap=0.45").split("=")[1]);
const PAD = 0.12;
const extraCuts = args.filter((a) => a.startsWith("--cut=")).map((a) => {
  const [s, e] = a.split("=")[1].split("-").map(Number);
  return { start: s, end: e };
});

const dg = JSON.parse(fs.readFileSync(dgPath, "utf8"));
const words = dg.results.channels[0].alternatives[0].words;

// 1) Keep-Segmente aus Wort-Lücken bauen
const cuts = [...extraCuts];
cuts.push({ start: 0, end: Math.max(0, words[0].start - 0.25) }); // Vorlauf
for (let i = 0; i < words.length - 1; i++) {
  const gap = words[i + 1].start - words[i].end;
  if (gap > GAP) cuts.push({ start: words[i].end + PAD, end: words[i + 1].start - PAD });
}
const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]);
const duration = parseFloat(probe.stdout.toString().trim());
const last = words[words.length - 1].end;
if (duration - last > 0.6) cuts.push({ start: last + 0.4, end: duration }); // Nachlauf

cuts.sort((a, b) => a.start - b.start);
// überlappende Cuts mergen, Nullen raus
const merged = [];
for (const c of cuts) {
  if (c.end - c.start < 0.05) continue;
  const p = merged[merged.length - 1];
  if (p && c.start <= p.end + 0.01) p.end = Math.max(p.end, c.end);
  else merged.push({ ...c });
}
// Keep-Segmente = Komplement
const keeps = [];
let pos = 0;
for (const c of merged) {
  if (c.start - pos > 0.05) keeps.push({ start: pos, end: c.start });
  pos = c.end;
}
if (duration - pos > 0.05) keeps.push({ start: pos, end: duration });

console.log("Schnitte: " + merged.map((c) => c.start.toFixed(2) + "-" + c.end.toFixed(2)).join(", "));
console.log("Behalten: " + keeps.length + " Segmente, neu " +
  keeps.reduce((s, k) => s + k.end - k.start, 0).toFixed(1) + "s (vorher " + duration.toFixed(1) + "s)");

// 2) ffmpeg trim/concat
const fc = [];
keeps.forEach((k, i) => {
  fc.push(`[0:v]trim=start=${k.start}:end=${k.end},setpts=PTS-STARTPTS[v${i}]`);
  fc.push(`[0:a]atrim=start=${k.start}:end=${k.end},asetpts=PTS-STARTPTS[a${i}]`);
});
fc.push(keeps.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${keeps.length}:v=1:a=1[v][a]`);
const outVideo = video.replace(/\.[^.]+$/, "") + "-cut.mp4";
const ff = spawnSync("ffmpeg", ["-y", "-i", video, "-filter_complex", fc.join(";"),
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-c:a", "aac", "-b:a", "192k", outVideo],
  { stdio: ["ignore", "ignore", "pipe"] });
if (ff.status !== 0) {
  console.error("ffmpeg-Schnitt fehlgeschlagen:\n" + ff.stderr.toString().slice(-1000));
  process.exit(1);
}

// 3) Captions in neue Zeitachse mappen (Wörter in Cuts fliegen raus)
const toNew = (t) => {
  let nt = 0;
  for (const k of keeps) {
    if (t >= k.end) { nt += k.end - k.start; continue; }
    if (t >= k.start) return nt + (t - k.start);
    return null; // liegt in einem Cut
  }
  return nt;
};
const captions = [];
for (const w of words) {
  const s = toNew(w.start + 0.001), e = toNew(w.end - 0.001);
  if (s === null || e === null) continue; // rausgeschnitten
  captions.push({
    text: " " + (w.punctuated_word || w.word),
    startMs: Math.round(s * 1000),
    endMs: Math.round(e * 1000),
    timestampMs: Math.round(((s + e) / 2) * 1000),
    confidence: w.confidence ?? null,
  });
}
const outJson = outVideo.replace(/\.mp4$/, ".json");
fs.writeFileSync(outJson, JSON.stringify(captions, null, 2));
console.log("OK: " + outVideo + " + " + outJson + " (" + captions.length + " Wörter)");
