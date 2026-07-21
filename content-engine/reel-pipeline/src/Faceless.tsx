import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Faceless-Reel: kein Talking-Head — AI-Bilder, schnelle Schnitte, Typo, VO (ElevenLabs).
// Szenen-Timings sind auf public/vo.mp3 gemappt (Deepgram-Wort-Timestamps in vo.json).

const uiFont =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif';
const serifFont = 'Georgia, "Times New Roman", serif';
const BG = "#070B15";

const Grid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundImage:
        "repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 90px), repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 90px)",
    }}
  />
);

// Bild mit Punch-in beim Schnitt + langsamem Ken-Burns.
const KenImg: React.FC<{ src: string; zoomFrom?: number; zoomTo?: number }> = ({
  src,
  zoomFrom = 1.06,
  zoomTo = 1.16,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const punch = spring({ frame, fps, config: { damping: 20, stiffness: 200 } });
  const ken = interpolate(frame, [0, durationInFrames], [zoomFrom, zoomTo], {
    easing: Easing.inOut(Easing.quad),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Img
        src={staticFile(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${ken * interpolate(punch, [0, 1], [1.05, 1])})`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(7,11,21,0.35) 0%, rgba(7,11,21,0) 35%, rgba(7,11,21,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// Großes Wort knallt rein (Stempel).
const Stamp: React.FC<{ text: string; y?: string; accent?: boolean }> = ({
  text,
  y = "44%",
  accent,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 11, stiffness: 210 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: y }}>
      <div
        style={{
          fontFamily: uiFont,
          fontWeight: 900,
          fontSize: 108,
          textTransform: "uppercase",
          color: accent ? "#D97757" : "white",
          WebkitTextStroke: "7px rgba(0,0,0,0.8)",
          paintOrder: "stroke",
          textShadow: "0 12px 50px rgba(0,0,0,0.65)",
          transform: `scale(${interpolate(pop, [0, 1], [1.6, 1])}) rotate(${interpolate(pop, [0, 1], [-6, -2])}deg)`,
          opacity: pop,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// Serif-Zeile, Wörter faden nacheinander ein.
const SerifLine: React.FC<{ words: { t: string; ms: number }[]; startMs: number; size?: number }> = ({
  words,
  startMs,
  size = 100,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000 + startMs;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "84%", textAlign: "center", lineHeight: 1.25 }}>
        {words.map((w, i) => {
          const p = interpolate(tMs, [w.ms, w.ms + 350], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });
          return (
            <span
              key={i}
              style={{
                fontFamily: serifFont,
                fontSize: size,
                fontWeight: 700,
                color: "white",
                opacity: p,
                display: "inline-block",
                transform: `translateY(${interpolate(p, [0, 1], [26, 0])}px)`,
                marginRight: 26,
              }}
            >
              {w.t}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Rote NO-Cards (Szene 4)
const NoCards: React.FC<{ items: { t: string; ms: number }[]; startMs: number }> = ({
  items,
  startMs,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tMs = (frame / fps) * 1000 + startMs;
  const activeIdx = items.reduce((a, b, i) => (tMs >= b.ms ? i : a), -1);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "80%" }}>
        {items.map((c, i) => {
          const pop = spring({
            frame: frame - Math.round(((c.ms - startMs) / 1000) * fps),
            fps,
            config: { damping: 13, stiffness: 170 },
          });
          const shown = tMs >= c.ms;
          const isActive = i === activeIdx;
          return (
            <div
              key={i}
              style={{
                opacity: shown ? (isActive ? pop : 0.5) : 0,
                transform: `scale(${shown ? 0.95 + 0.05 * (isActive ? pop : 0) : 0.95})`,
                background: "rgba(5,7,12,0.92)",
                border: "2.5px solid rgba(255,59,48,0.85)",
                borderRadius: 12,
                padding: "30px 34px",
                textAlign: "center",
                color: "white",
                fontSize: 54,
                fontWeight: 800,
                textTransform: "uppercase",
                fontFamily: uiFont,
              }}
            >
              <span style={{ color: "#FF3B30" }}>OHNE </span>
              {c.t}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// CTA: iOS-Kommentar-Pill
const CommentPill: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 160 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "18px 22px 18px 18px",
          borderRadius: 999,
          background: "rgba(8,10,16,0.92)",
          border: "1.5px solid rgba(255,255,255,0.22)",
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          transform: `scale(${pop})`,
          fontFamily: uiFont,
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "linear-gradient(145deg,#D97757,#8F4630)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          A
        </div>
        <span style={{ color: "white", fontSize: 52, fontWeight: 800, padding: "0 16px" }}>
          {text}
        </span>
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: "50%",
            background: "#0A84FF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 36,
            fontWeight: 800,
          }}
        >
          ↑
        </div>
      </div>
    </AbsoluteFill>
  );
};

const sec = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

export const Faceless: React.FC = () => {
  const { fps } = useVideoConfig();
  const S = (ms: number) => sec(ms, fps);
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Audio src={staticFile("vo2.mp3")} />

      {/* 1: Kinetic Type "Während du schläfst, arbeitet dein KI-Mitarbeiter." */}
      <Sequence from={0} durationInFrames={S(2500)}>
        <AbsoluteFill style={{ backgroundColor: BG }}>
          <Grid />
          <SerifLine
            startMs={0}
            words={[
              { t: "Während", ms: 0 },
              { t: "du", ms: 160 },
              { t: "schläfst,", ms: 400 },
              { t: "arbeitet", ms: 960 },
              { t: "dein", ms: 1360 },
              { t: "KI-Mitarbeiter.", ms: 1600 },
            ]}
          />
        </AbsoluteFill>
      </Sequence>

      {/* 2: Roboter am Schreibtisch + Wort-Stempel */}
      <Sequence from={S(2500)} durationInFrames={S(4150 - 2500)}>
        <KenImg src="broll-1.png" />
        <Sequence from={S(2800 - 2500)}>
          <Stamp text="recherchiert" />
        </Sequence>
        <Sequence from={S(3520 - 2500)}>
          <Stamp text="schreibt" y="56%" accent />
        </Sequence>
      </Sequence>

      {/* 3: Roboterhand (harter Schnitt) + "plant deinen Content" */}
      <Sequence from={S(4150)} durationInFrames={S(5350 - 4150)}>
        <KenImg src="broll-2.png" zoomFrom={1.12} zoomTo={1.02} />
        <Sequence from={0}>
          <Stamp text="plant" />
        </Sequence>
        <Sequence from={S(4800 - 4150)}>
          <Stamp text="deinen Content" y="56%" accent />
        </Sequence>
      </Sequence>

      {/* 4: Roboter-Team + "JEDEN TAG." */}
      <Sequence from={S(5350)} durationInFrames={S(6100 - 5350)}>
        <KenImg src="broll-3.png" zoomFrom={1.02} zoomTo={1.12} />
        <Sequence from={S(5440 - 5350)}>
          <Stamp text="Jeden Tag." />
        </Sequence>
      </Sequence>

      {/* 5: NO-Cards */}
      <Sequence from={S(6100)} durationInFrames={S(8500 - 6100)}>
        <AbsoluteFill style={{ backgroundColor: BG }}>
          <Grid />
          <NoCards
            startMs={6100}
            items={[
              { t: "Pause", ms: 6450 },
              { t: "Urlaub", ms: 7250 },
              { t: "Ausreden", ms: 7950 },
            ]}
          />
        </AbsoluteFill>
      </Sequence>

      {/* 6: "wird jede Woche besser" + wachsende Balken */}
      <Sequence from={S(8500)} durationInFrames={S(10650 - 8500)}>
        <AbsoluteFill style={{ backgroundColor: BG }}>
          <Grid />
          <SerifLine
            startMs={8500}
            size={92}
            words={[
              { t: "Und", ms: 8560 },
              { t: "das", ms: 8720 },
              { t: "Beste:", ms: 8960 },
              { t: "jede", ms: 9760 },
              { t: "Woche", ms: 10000 },
              { t: "besser.", ms: 10320 },
            ]}
          />
          <GrowBars startMs={8500} />
        </AbsoluteFill>
      </Sequence>

      {/* 7: Roboterhand + CTA */}
      <Sequence from={S(10650)} durationInFrames={S(15900 - 10650)}>
        <KenImg src="broll-1.png" zoomFrom={1.16} zoomTo={1.04} />
        <Sequence from={S(10900 - 10650)}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: "22%" }}>
            <div
              style={{
                fontFamily: uiFont,
                fontWeight: 800,
                fontSize: 58,
                color: "white",
                textShadow: "0 8px 34px rgba(0,0,0,0.7)",
                width: "80%",
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              Willst du so einen Mitarbeiter in deinem Business?
            </div>
          </AbsoluteFill>
        </Sequence>
        <Sequence from={S(13800 - 10650)}>
          <CommentPill text="AUTO" />
        </Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};

// kleine wachsende Balken unter der Serif-Zeile (Szene 6)
const GrowBars: React.FC<{ startMs: number }> = ({ startMs }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heights = [0.3, 0.45, 0.62, 0.8, 1];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: "18%" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 170 }}>
        {heights.map((h, i) => {
          const grow = spring({
            frame: frame - Math.round(((startMs + 1100 - startMs) / 1000) * fps) - i * 4,
            fps,
            config: { damping: 15, stiffness: 100 },
          });
          return (
            <div
              key={i}
              style={{
                width: 52,
                height: h * 170 * grow,
                borderRadius: 10,
                background: "linear-gradient(180deg,#0A84FF,rgba(10,132,255,0.3))",
                boxShadow: i === heights.length - 1 ? "0 0 36px rgba(10,132,255,0.5)" : "none",
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
