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

// MorphCard — Mechanik aus eine Referenz-Vorlage (dicht analysiert 15.07.):
// EINE Karte über/vor dem Kopf, die durch Zustände MORPHT (Blur-Dissolve statt Schnitt),
// deren Inhalt zu den gesprochenen Worten von innen WÄCHST (Icons/Pills/Notizen),
// mit farbiger Oberkante + Fortschritts-Segmenten. Ab Sekunde 0 präsent.
// STATUS: 🧪 im Test — nichts hiervon ist bestätigt (siehe STYLE.md).

export type CardSlot = {
  ms: number;
  kind: "icon" | "pill" | "note";
  text: string;
  color?: string;
};

export type CardState = {
  ms: number;
  title: string;
  accent: string;
  filled: number;
  slots?: CardSlot[];
};

export type MorphCardItem = {
  startMs: number;
  endMs: number;
  segments: number;
  states: CardState[];
  /** Intro: Logo/Glyph + Bar mit allen Segmenten bunt, morpht dann in state[0] */
  intro?: { glyph: string; color: string; endMs: number; rainbow: string[] };
};

const MORPH_MS = 420;

export const MorphCard: React.FC<{ item: MorphCardItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000 + item.startMs;

  const introActive = item.intro ? tMs < item.intro.endMs : false;
  // aktiver Zustand
  let idx = 0;
  item.states.forEach((s, i) => {
    if (tMs >= s.ms) idx = i;
  });
  const state = item.states[idx];

  // Morph-Fenster: kurz vor/nach einem Zustandswechsel blurren + leicht skalieren
  const switchMs = introActive ? item.intro!.endMs : state.ms;
  const sinceSwitch = tMs - switchMs;
  const morphP = interpolate(Math.abs(sinceSwitch), [0, MORPH_MS], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const blurPx = morphP * 9;
  const morphScale = 1 - morphP * 0.03;

  const inP = spring({ frame, fps, config: { damping: 16, stiffness: 120 } });
  const outP = interpolate(tMs, [item.endMs - 400, item.endMs], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const accent = introActive ? item.intro!.color : state.accent;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: "14.5%" }}>
      {/* Logo-Intro schwebt über der Karte */}
      {introActive && item.intro ? (
        <div
          style={{
            position: "absolute",
            top: "2%",
            width: 148,
            height: 148,
            borderRadius: 34,
            background: item.intro.color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 84,
            color: "#fff",
            boxShadow: `0 26px 70px rgba(0,0,0,.55), 0 0 60px ${item.intro.color}66`,
            transform: `scale(${interpolate(inP, [0, 1], [0.6, 1])}) translateY(${interpolate(inP, [0, 1], [-40, 0])}px)`,
            filter: `blur(${blurPx * 0.6}px)`,
            opacity: 1 - morphP * 0.35,
            fontFamily: uiFont,
          }}
        >
          {item.intro.glyph}
        </div>
      ) : null}

      <div
        style={{
          width: "80%",
          borderRadius: 22,
          background: "rgba(10,12,18,0.9)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(18px)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.6)",
          overflow: "hidden",
          fontFamily: uiFont,
          opacity: outP,
          filter: `blur(${blurPx}px)`,
          transform: `scale(${interpolate(inP, [0, 1], [0.93, 1]) * morphScale}) translateY(${interpolate(inP, [0, 1], [-30, 0])}px)`,
        }}
      >
        {/* farbige Oberkante */}
        <div style={{ height: 4, background: accent, boxShadow: `0 0 22px ${accent}` }} />

        <div style={{ padding: "18px 22px 22px" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "center",
              marginBottom: 14,
              minHeight: 26,
            }}
          >
            {!introActive ? (
              <>
                <div
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: "50%",
                    background: accent,
                    boxShadow: `0 0 12px ${accent}`,
                  }}
                />
                <div
                  style={{
                    color: "rgba(255,255,255,0.82)",
                    fontSize: 21,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                  }}
                >
                  {state.title}
                </div>
              </>
            ) : null}
          </div>

          {/* Segmente */}
          <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
            {Array.from({ length: item.segments }).map((_, i) => {
              const col = introActive
                ? item.intro!.rainbow[i % item.intro!.rainbow.length]
                : i < state.filled
                  ? state.accent
                  : "rgba(255,255,255,0.13)";
              return (
                <div key={i} style={{ flex: 1 }}>
                  <div
                    style={{
                      height: 11,
                      borderRadius: 6,
                      background: col,
                      boxShadow: col.startsWith("rgba(255,255,255,0.13") ? "none" : `0 0 14px ${col}77`,
                    }}
                  />
                  <div
                    style={{
                      textAlign: "center",
                      color: "rgba(255,255,255,0.4)",
                      fontSize: 15,
                      fontWeight: 700,
                      marginTop: 5,
                    }}
                  >
                    {i + 1}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inhalt wächst von innen */}
          {!introActive ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                marginTop: 12,
                minHeight: 30,
              }}
            >
              {(state.slots ?? []).map((s, i) => {
                const pop = spring({
                  frame: frame - Math.round(((s.ms - item.startMs) / 1000) * fps),
                  fps,
                  config: { damping: 13, stiffness: 170 },
                });
                if (tMs < s.ms) return null;
                const col = s.color ?? accent;
                if (s.kind === "icon") {
                  return (
                    <div
                      key={i}
                      style={{
                        fontSize: 46,
                        transform: `scale(${pop})`,
                        filter: `drop-shadow(0 6px 18px ${col}88)`,
                      }}
                    >
                      {s.text}
                    </div>
                  );
                }
                if (s.kind === "pill") {
                  return (
                    <div
                      key={i}
                      style={{
                        transform: `scale(${pop})`,
                        background: col,
                        color: "#fff",
                        fontSize: 21,
                        fontWeight: 800,
                        padding: "7px 20px",
                        borderRadius: 9,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {s.text}
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    style={{
                      opacity: pop,
                      transform: `translateY(${interpolate(pop, [0, 1], [10, 0])}px)`,
                      color: col,
                      fontSize: 24,
                      fontWeight: 600,
                    }}
                  >
                    {s.text}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
