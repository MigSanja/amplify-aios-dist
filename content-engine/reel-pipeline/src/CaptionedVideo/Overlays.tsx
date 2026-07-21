import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const uiFont =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif';

export type BadgeItem = {
  startMs: number;
  durationMs: number;
  text: string;
  icon?: string;
  style?: "pill" | "comment"; // comment = iOS-Kommentar-Pill mit Avatar + Senden-Pfeil
};

export type ExplainerBullet = { ms: number; text: string };

export type ExplainerIcon = {
  glyph: string; // Zeichen/Emoji/Buchstabe im Icon (bis echtes Logo-Asset da ist)
  label: string;
  from: string; // Gradient-Start
  to: string; // Gradient-Ende
};

export type ExplainerStat = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  bars?: boolean;
  accent?: string; // Balken-/Zahlfarbe, Default iOS-Blau
};

export type ExplainerItem = {
  startMs: number;
  endMs: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  scene?: "bullets" | "iconConnect" | "stats" | "browser";
  bullets?: ExplainerBullet[];
  icons?: ExplainerIcon[]; // für iconConnect: genau 2
  stat?: ExplainerStat; // für stats
  browserSrc?: string; // für browser: Screencast-Datei in public/
  urlLabel?: string; // für browser: Text in der URL-Leiste
};

const serifFont = 'Georgia, "Times New Roman", serif';

export type HookIcon = {
  glyph: string;
  color: string; // Plattform-Farbe
  x: number; // Prozent
  y: number; // Prozent
};

export type HookItem = {
  startMs: number;
  durationMs: number;
  title1: string; // weiße Zeile
  title2: string; // Akzent-Zeile (Claude-Orange)
  icons: HookIcon[];
};

export type CardItem = { ms: number; text: string; negative?: boolean };

export type CardGroup = {
  startMs: number;
  endMs: number;
  items: CardItem[];
};

export type Overlays = {
  badges?: BadgeItem[];
  explainers?: ExplainerItem[];
  hooks?: HookItem[];
  cards?: CardGroup[];
  headrooms?: import("./Headroom").HeadroomItem[];
  terminals?: import("./Headroom").TerminalItem[];
  morphs?: import("./MorphCard").MorphCardItem[];
};

// Hook-Overlay: Plattform-Icons an den Rändern + fetter Zwei-Zeilen-Titel (Gennaro-Stil).
export const HookOverlay: React.FC<{
  item: HookItem;
  durationInFrames: number;
}> = ({ item, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titlePop = spring({ frame: frame - 4, fps, config: { damping: 13, stiffness: 130 } });
  return (
    <AbsoluteFill style={{ opacity: out, fontFamily: uiFont }}>
      {item.icons.map((ic, i) => {
        const pop = spring({ frame: frame - i * 4, fps, config: { damping: 11, stiffness: 150 } });
        const float = Math.sin((frame / fps) * 2.2 + i) * 7;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: ic.x + "%",
              top: ic.y + "%",
              transform: `translate(-50%,-50%) scale(${pop}) translateY(${float}px)`,
              width: 118,
              height: 118,
              borderRadius: 30,
              background: "rgba(10,14,24,0.82)",
              border: `2px solid ${ic.color}`,
              boxShadow: `0 0 34px ${ic.color}55, 0 14px 40px rgba(0,0,0,0.45)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 56,
              color: ic.color,
              fontWeight: 800,
              backdropFilter: "blur(6px)",
            }}
          >
            {ic.glyph}
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: "58%",
          textAlign: "center",
          transform: `scale(${titlePop})`,
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            WebkitTextStroke: "7px rgba(0,0,0,0.85)",
            paintOrder: "stroke",
            textShadow: "0 10px 40px rgba(0,0,0,0.6)",
            lineHeight: 1.05,
          }}
        >
          {item.title1}
        </div>
        <div
          style={{
            color: "#D97757",
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            WebkitTextStroke: "7px rgba(0,0,0,0.85)",
            paintOrder: "stroke",
            textShadow: "0 10px 40px rgba(0,0,0,0.6)",
            lineHeight: 1.05,
          }}
        >
          {item.title2}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Checklist-/Negativ-Cards: schwarze Balken stapeln sich mittig (über der Brust).
export const CardsOverlay: React.FC<{ group: CardGroup }> = ({ group }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Läuft in einer Sequence → Frame/Zeit ist LOKAL, item.ms ist absolut → relativ rechnen
  const tMs = (frame / fps) * 1000 + group.startMs;
  const out = interpolate(tMs, [group.endMs - 350, group.endMs], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const activeIdx = group.items.reduce((a, b, i) => (tMs >= b.ms ? i : a), -1);
  return (
    <AbsoluteFill
      style={{
        opacity: out,
        alignItems: "center",
        justifyContent: "center",
        fontFamily: uiFont,
        paddingTop: "16%",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "84%" }}>
        {group.items.map((c, i) => {
          const pop = spring({
            frame: frame - Math.round(((c.ms - group.startMs) / 1000) * fps),
            fps,
            config: { damping: 14, stiffness: 160 },
          });
          const isActive = i === activeIdx;
          const shown = tMs >= c.ms;
          return (
            <div
              key={i}
              style={{
                opacity: shown ? (isActive ? pop : 0.45) : 0,
                transform: `scale(${shown ? 0.94 + 0.06 * (isActive ? pop : 0) : 0.94})`,
                background: "rgba(5,7,12,0.88)",
                border: c.negative
                  ? "2.5px solid rgba(255,59,48,0.85)"
                  : "2px solid rgba(255,255,255,0.28)",
                borderRadius: 10,
                padding: "24px 30px",
                textAlign: "center",
                color: "white",
                fontSize: 40,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.02em",
                boxShadow: "0 16px 50px rgba(0,0,0,0.5)",
              }}
            >
              {c.negative ? (
                <span>
                  <span style={{ color: "#FF3B30" }}>NO </span>
                  {c.text}
                </span>
              ) : (
                c.text
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Glas-Pill oben, z.B. "✳ Claude 5" wenn der Name fällt.
export const Badge: React.FC<{ item: BadgeItem; durationInFrames: number }> = ({
  item,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 170 } });
  const opacity = interpolate(
    frame,
    [durationInFrames - 10, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (item.style === "comment") {
    return (
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", paddingTop: "18%" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            padding: "16px 20px 16px 16px",
            borderRadius: 999,
            background: "rgba(8,10,16,0.92)",
            border: "1.5px solid rgba(255,255,255,0.2)",
            boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
            transform: `scale(${pop})`,
            opacity,
            fontFamily: uiFont,
          }}
        >
          <div
            style={{
              width: 66,
              height: 66,
              borderRadius: "50%",
              background: "linear-gradient(145deg,#D97757,#8F4630)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            A
          </div>
          <span style={{ color: "white", fontSize: 46, fontWeight: 800, letterSpacing: "0.02em", padding: "0 14px" }}>
            {item.text}
          </span>
          <div
            style={{
              width: 62,
              height: 62,
              borderRadius: "50%",
              background: "#0A84FF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              fontSize: 34,
              fontWeight: 800,
            }}
          >
            ↑
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: "11%" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "22px 44px",
          borderRadius: 999,
          background: "rgba(12,16,28,0.72)",
          border: "1.5px solid rgba(255,255,255,0.16)",
          backdropFilter: "blur(14px)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          transform: `scale(${pop}) translateY(${interpolate(pop, [0, 1], [-30, 0])}px)`,
          opacity,
          fontFamily: uiFont,
        }}
      >
        {item.icon ? (
          <span style={{ color: "#D97757", fontSize: 46, lineHeight: 1 }}>
            {item.icon}
          </span>
        ) : null}
        <span
          style={{
            color: "white",
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
        >
          {item.text}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// Icon-Verbindungs-Szene: zwei Icons sliden rein, Linie wächst, Puls wandert.
const IconConnect: React.FC<{ item: ExplainerItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = Math.round((item.startMs / 1000) * fps);
  const local = frame - startFrame;
  const icons = item.icons ?? [];
  if (icons.length < 2) return null;
  const slideA = spring({ frame: local - 6, fps, config: { damping: 14, stiffness: 120 } });
  const slideB = spring({ frame: local - 14, fps, config: { damping: 14, stiffness: 120 } });
  const line = spring({ frame: local - 26, fps, config: { damping: 18, stiffness: 90 } });
  const pulseX = (local / fps) % 1.6;
  const pulse = interpolate(pulseX, [0, 1.6], [0, 100]);

  const iconBox = (ic: ExplainerIcon, s: number, dir: number) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
        transform: `translateX(${interpolate(s, [0, 1], [dir * 260, 0])}px)`,
        opacity: s,
      }}
    >
      <div
        style={{
          width: 150,
          height: 150,
          borderRadius: 36,
          background: `linear-gradient(145deg, ${ic.from}, ${ic.to})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 72,
          color: "white",
          boxShadow: "0 24px 70px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25)",
          fontFamily: uiFont,
          fontWeight: 800,
        }}
      >
        {ic.glyph}
      </div>
      <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 27, fontWeight: 600, fontFamily: uiFont }}>
        {ic.label}
      </div>
    </div>
  );

  return (
    <div
      style={{
        position: "absolute",
        top: "56%",
        left: 64,
        width: "82%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
      }}
    >
      {iconBox(icons[0], slideA, -1)}
      <div style={{ width: 220, height: 6, margin: "0 24px", position: "relative", top: -24 }}>
        <div
          style={{
            width: line * 100 + "%",
            height: "100%",
            borderRadius: 3,
            background: "linear-gradient(90deg, rgba(10,132,255,0.2), #0A84FF, rgba(100,210,255,0.9))",
          }}
        />
        {line > 0.95 ? (
          <div
            style={{
              position: "absolute",
              top: -7,
              left: pulse + "%",
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#64D2FF",
              boxShadow: "0 0 24px #0A84FF",
            }}
          />
        ) : null}
      </div>
      {iconBox(icons[1], slideB, 1)}
    </div>
  );
};

// Stat-Szene: große Zahl zählt hoch, optional wachsender Bar-Chart.
const StatsScene: React.FC<{ item: ExplainerItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000;
  const stat = item.stat;
  if (!stat) return null;
  const accent = stat.accent ?? "#0A84FF";
  const p = interpolate(tMs, [item.startMs + 250, item.startMs + 2100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const shown = Math.round(stat.value * p);
  const heights = [0.34, 0.52, 0.44, 0.66, 0.82, 1];
  return (
    <div style={{ position: "absolute", top: "52%", left: 64, width: "82%", textAlign: "center" }}>
      <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 36, fontWeight: 600, fontFamily: uiFont, marginBottom: 14 }}>
        {stat.label}
      </div>
      <div style={{ color: "white", fontSize: 96, fontWeight: 700, fontFamily: serifFont, letterSpacing: "-0.01em" }}>
        {(stat.prefix ?? "") + shown.toLocaleString("de-DE") + (stat.suffix ?? "")}
      </div>
      {stat.bars === false ? null : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: 20,
            height: 190,
            marginTop: 36,
          }}
        >
          {heights.map((h, i) => {
            const grow = spring({
              frame: frame - Math.round((item.startMs / 1000) * fps) - 10 - i * 5,
              fps,
              config: { damping: 16, stiffness: 90 },
            });
            return (
              <div
                key={i}
                style={{
                  width: 64,
                  height: h * 190 * grow,
                  borderRadius: 12,
                  background: `linear-gradient(180deg, ${accent}, rgba(10,132,255,0.35))`,
                  boxShadow: i === heights.length - 1 ? `0 0 44px ${accent}66` : "none",
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

// Browser-Demo: Screencast im Browser-Rahmen mit Ken-Burns-Zoom + Vignette (Gennaro-Look).
const BrowserScene: React.FC<{ item: ExplainerItem }> = ({ item }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const startFrame = Math.round((item.startMs / 1000) * fps);
  const local = Math.max(0, frame - startFrame);
  if (!item.browserSrc) return null;
  const zoom = interpolate(local, [0, 8 * fps], [1.0, 1.14], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.quad),
  });
  const drift = interpolate(local, [0, 8 * fps], [0, -30], { extrapolateRight: "clamp" });
  const pop = spring({ frame: local - 4, fps, config: { damping: 15, stiffness: 110 } });
  return (
    <div
      style={{
        position: "absolute",
        top: "47%",
        left: "6%",
        width: "88%",
        borderRadius: 22,
        overflow: "hidden",
        background: "#0D1117",
        border: "1.5px solid rgba(255,255,255,0.14)",
        boxShadow: "0 30px 90px rgba(0,0,0,0.6), 0 0 60px rgba(10,132,255,0.18)",
        transform: `translateY(${interpolate(pop, [0, 1], [80, 0])}px)`,
        opacity: pop,
        fontFamily: uiFont,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          background: "rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <div key={c} style={{ width: 14, height: 14, borderRadius: "50%", background: c }} />
        ))}
        <div
          style={{
            marginLeft: 14,
            flex: 1,
            background: "rgba(0,0,0,0.35)",
            borderRadius: 8,
            padding: "6px 16px",
            color: "rgba(255,255,255,0.75)",
            fontSize: 24,
          }}
        >
          {item.urlLabel ?? ""}
        </div>
      </div>
      <div style={{ position: "relative", aspectRatio: "1440/900", overflow: "hidden" }}>
        <OffthreadVideo
          muted
          src={staticFile(item.browserSrc)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${zoom}) translateY(${drift}px)`,
          }}
        />
        {/* Vignette */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "inset 0 0 90px 30px rgba(5,8,14,0.75)",
          }}
        />
      </div>
    </div>
  );
};

// Erklär-Szene hinter dem verkleinerten Video: dunkler Grund, Titel, Check-Punkte.
export const ExplainerScene: React.FC<{
  item: ExplainerItem;
  progress: number; // 0..1 Ein-/Ausblendung
}> = ({ item, progress }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000;

  return (
    <AbsoluteFill
      style={{
        opacity: progress,
        background:
          "radial-gradient(120% 70% at 20% 0%, rgba(10,132,255,0.16), transparent 55%), linear-gradient(165deg, #0B1020 0%, #0E1728 55%, #0B1322 100%)",
        fontFamily: uiFont,
        padding: "72px 64px",
      }}
    >
      {/* feines Grid */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 90px), repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 90px)",
        }}
      />
      <div style={{ position: "relative", width: "42%" }}>
        {item.eyebrow ? (
          <div
            style={{
              color: "#8AB8FF",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.22em",
              marginBottom: 18,
            }}
          >
            {item.eyebrow}
          </div>
        ) : null}
        <div
          style={{
            color: "white",
            fontSize: 74,
            fontWeight: item.scene && item.scene !== "bullets" ? 700 : 800,
            lineHeight: 1.04,
            letterSpacing: "-0.01em",
            fontFamily:
              item.scene && item.scene !== "bullets" ? serifFont : uiFont,
          }}
        >
          {item.title}
        </div>
        {item.subtitle ? (
          <div
            style={{
              color: "rgba(255,255,255,0.66)",
              fontSize: 38,
              fontWeight: 500,
              marginTop: 16,
              lineHeight: 1.3,
            }}
          >
            {item.subtitle}
          </div>
        ) : null}
      </div>

      {item.scene === "iconConnect" ? <IconConnect item={item} /> : null}
      {item.scene === "stats" ? <StatsScene item={item} /> : null}
      {item.scene === "browser" ? <BrowserScene item={item} /> : null}
      <div
        style={{
          position: "absolute",
          left: 64,
          top: "53%",
          width: "80%",
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        {(item.bullets ?? []).map((b, i) => {
          const local = spring({
            frame: frame - Math.round((b.ms / 1000) * fps),
            fps,
            config: { damping: 15, stiffness: 150 },
          });
          const reached = tMs >= b.ms;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "26px 30px",
                borderRadius: 22,
                background: "rgba(255,255,255,0.055)",
                border: "1.5px solid rgba(255,255,255,0.11)",
                opacity: reached ? local : 0,
                transform: `translateX(${interpolate(local, [0, 1], [-46, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  minWidth: 52,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: reached ? "#0A84FF" : "transparent",
                  border: "2.5px solid " + (reached ? "#0A84FF" : "rgba(255,255,255,0.35)"),
                  color: "white",
                  fontSize: 30,
                  fontWeight: 800,
                }}
              >
                ✓
              </div>
              <div
                style={{
                  color: "rgba(255,255,255,0.94)",
                  fontSize: 40,
                  fontWeight: 600,
                  lineHeight: 1.25,
                }}
              >
                {b.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
