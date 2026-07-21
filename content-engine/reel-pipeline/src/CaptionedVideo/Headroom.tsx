import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { uiFont } from "./Overlays";

// Bausteine aus den Stil-Analysen 15.07.:
// - HeadroomCard  → eine Referenz-Vorlage (Karte über dem Kopf, Fortschritts-Segmente, Alex bleibt GROSS)
// - FakeTerminal  → Austin Marchese (CLI-Karte, getippte Zeilen) — komplett animiert, kein Recording

export type HeadroomStep = { ms: number; label: string };
export type HeadroomItem = {
  startMs: number;
  endMs: number;
  title: string;
  steps: HeadroomStep[];
};

export type TerminalLine = { ms: number; text: string; kind?: "cmd" | "out" | "ok" };
export type TerminalItem = {
  startMs: number;
  endMs: number;
  lines: TerminalLine[];
  title?: string;
};

const CARD_BG = "rgba(8,11,20,0.9)";
const CARD_BORDER = "1.5px solid rgba(255,255,255,0.14)";
const BLAU = "#0A84FF";
const GRUEN = "#30D158";

const cardShell: React.CSSProperties = {
  background: CARD_BG,
  border: CARD_BORDER,
  borderRadius: 26,
  backdropFilter: "blur(16px)",
  boxShadow: "0 26px 80px rgba(0,0,0,0.6), 0 0 60px rgba(10,132,255,0.12)",
  fontFamily: uiFont,
};

export const HeadroomCard: React.FC<{ item: HeadroomItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000 + item.startMs;
  const inP = spring({ frame, fps, config: { damping: 16, stiffness: 130 } });
  const out = interpolate(tMs, [item.endMs - 400, item.endMs], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const doneCount = item.steps.filter((s) => tMs >= s.ms).length;
  const current = item.steps[Math.max(0, doneCount - 1)];
  const allDone = doneCount === item.steps.length;
  const accent = allDone ? GRUEN : BLAU;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: "7%" }}>
      <div
        style={{
          ...cardShell,
          width: "84%",
          padding: "26px 30px 30px",
          opacity: out,
          transform: `translateY(${interpolate(inP, [0, 1], [-60, 0])}px) scale(${interpolate(inP, [0, 1], [0.94, 1])})`,
        }}
      >
        {/* Header: Punkt + Titel */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: accent,
              boxShadow: `0 0 16px ${accent}`,
            }}
          />
          <div
            style={{
              color: "rgba(255,255,255,0.9)",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            {item.title}
          </div>
        </div>

        {/* Fortschritts-Segmente */}
        <div style={{ display: "flex", gap: 12, marginBottom: 22 }}>
          {item.steps.map((s, i) => {
            const on = tMs >= s.ms;
            const grow = spring({
              frame: frame - Math.round(((s.ms - item.startMs) / 1000) * fps),
              fps,
              config: { damping: 14, stiffness: 140 },
            });
            const isLast = i === item.steps.length - 1;
            const col = on ? (isLast && allDone ? GRUEN : BLAU) : "rgba(255,255,255,0.14)";
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 6,
                  background: col,
                  transform: `scaleX(${on ? grow : 1})`,
                  transformOrigin: "left",
                  boxShadow: on ? `0 0 18px ${col}88` : "none",
                }}
              />
            );
          })}
        </div>

        {/* Aktueller Schritt */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 44 }}>
          <div
            style={{
              width: 36,
              height: 36,
              minWidth: 36,
              borderRadius: "50%",
              border: `2.5px solid ${accent}`,
              background: allDone ? GRUEN : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 20,
              fontWeight: 800,
            }}
          >
            {allDone ? "✓" : doneCount}
          </div>
          <div style={{ color: "#fff", fontSize: 34, fontWeight: 700, lineHeight: 1.2 }}>
            {current?.label ?? ""}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const FakeTerminal: React.FC<{ item: TerminalItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000 + item.startMs;
  const inP = spring({ frame, fps, config: { damping: 17, stiffness: 120 } });
  const out = interpolate(tMs, [item.endMs - 400, item.endMs], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const visible = item.lines.filter((l) => tMs >= l.ms);
  const blink = Math.floor((frame / fps) * 2) % 2 === 0;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: "9%" }}>
      <div
        style={{
          ...cardShell,
          width: "86%",
          overflow: "hidden",
          opacity: out,
          transform: `translateY(${interpolate(inP, [0, 1], [50, 0])}px) scale(${interpolate(inP, [0, 1], [0.95, 1])})`,
        }}
      >
        {/* Titelleiste */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "14px 18px",
            background: "rgba(255,255,255,0.05)",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
          ))}
          <div
            style={{
              marginLeft: 12,
              color: "rgba(255,255,255,0.5)",
              fontSize: 20,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {item.title ?? "claude-code"}
          </div>
        </div>
        {/* Zeilen */}
        <div
          style={{
            padding: "22px 24px 26px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 27,
            lineHeight: 1.65,
            minHeight: 210,
          }}
        >
          {visible.map((l, i) => {
            const p = interpolate(tMs, [l.ms, l.ms + 160], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.quad),
            });
            const col = l.kind === "ok" ? GRUEN : l.kind === "cmd" ? "#fff" : "rgba(255,255,255,0.62)";
            const isLast = i === visible.length - 1;
            return (
              <div key={i} style={{ opacity: p, color: col, whiteSpace: "pre-wrap" }}>
                {l.kind === "cmd" ? <span style={{ color: "#D97757" }}>❯ </span> : null}
                {l.text}
                {isLast && blink ? <span style={{ color: BLAU }}>▋</span> : null}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
