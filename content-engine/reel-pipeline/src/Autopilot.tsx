import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const serif = 'Georgia, "Times New Roman", serif';
const ui =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif';
const mono = 'ui-monospace, "SF Mono", Menlo, monospace';

const BG = "#03070e";
const CYAN = "#36e0ff";
const TEAL = "#3fd0c9";
const GOLD = "#e8c37a";
const VIOLET = "#8f8cf5";
const INK = "#F4F8FF";
const MUTE = "#9fb2c9";

type IconName =
  | "search"
  | "spark"
  | "film"
  | "chat"
  | "mic"
  | "wave"
  | "text"
  | "eye";

const sceneDurations = [209, 137, 106, 101, 170, 153, 156, 213] as const;

const formatDe = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const usePop = (startFrame: number, config = { damping: 16, stiffness: 150 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - startFrame, fps, config });
};

const Burst: React.FC<{ color?: string; size?: number }> = ({ color = CYAN, size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" style={{ filter: `drop-shadow(0 0 12px ${color})` }}>
    <path
      d="M20 2v36M2 20h36M7.3 7.3l25.4 25.4M32.7 7.3 7.3 32.7"
      stroke={color}
      strokeWidth="3.2"
      strokeLinecap="round"
    />
    <circle cx="20" cy="20" r="3.4" fill={color} />
  </svg>
);

const Icon: React.FC<{ name: IconName; color: string; size?: number }> = ({
  name,
  color,
  size = 46,
}) => {
  const common = {
    stroke: color,
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ filter: `drop-shadow(0 0 10px ${color})` }}>
      {name === "search" ? (
        <>
          <circle cx="28" cy="28" r="16" {...common} />
          <path d="M40 40l13 13" {...common} />
        </>
      ) : null}
      {name === "spark" ? <Burst color={color} size={size} /> : null}
      {name === "film" ? (
        <>
          <rect x="12" y="14" width="40" height="36" rx="6" {...common} />
          <path d="M26 24l16 8-16 8V24Z" fill={color} stroke="none" />
          <path d="M20 14v36M44 14v36M12 25h8M44 25h8M12 39h8M44 39h8" {...common} />
        </>
      ) : null}
      {name === "chat" ? (
        <path d="M14 18h36v24H28l-12 9V42h-2V18Z" {...common} />
      ) : null}
      {name === "mic" ? (
        <>
          <rect x="24" y="10" width="16" height="30" rx="8" {...common} />
          <path d="M16 30c0 10 7 17 16 17s16-7 16-17M32 47v9M24 56h16" {...common} />
        </>
      ) : null}
      {name === "wave" ? (
        <path d="M9 34c5 0 5-16 10-16s5 28 10 28 5-28 10-28 5 16 10 16h6" {...common} />
      ) : null}
      {name === "text" ? (
        <>
          <path d="M14 18h36M14 30h30M14 42h36" {...common} />
          <circle cx="50" cy="30" r="2.2" fill={color} />
        </>
      ) : null}
      {name === "eye" ? (
        <>
          <path d="M8 32s8-15 24-15 24 15 24 15-8 15-24 15S8 32 8 32Z" {...common} />
          <circle cx="32" cy="32" r="7" {...common} />
        </>
      ) : null}
    </svg>
  );
};

const Stage: React.FC<{
  children: React.ReactNode;
  chip: string;
  dot: string;
  glow?: string;
  glowY?: number;
}> = ({ children, chip, dot, glow = CYAN, glowY = 760 }) => {
  const frame = useCurrentFrame();
  const breath = 1 + Math.sin((frame / 120) * Math.PI * 2) * 0.03;
  const chipIn = usePop(0, { damping: 18, stiffness: 120 });

  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: "hidden", fontFamily: ui }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% ${glowY}px, ${glow}29 0%, rgba(54,224,255,0.08) 28%, transparent 58%), radial-gradient(circle at 50% ${glowY + 60}px, rgba(63,208,201,0.10) 0%, transparent 68%)`,
          transform: `scale(${breath})`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at center, transparent 44%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {children}
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 150,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 20px",
          borderRadius: 12,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: INK,
          fontFamily: mono,
          fontSize: 26,
          letterSpacing: 2,
          textTransform: "uppercase",
          opacity: chipIn,
          transform: `translateY(${interpolate(chipIn, [0, 1], [-12, 0])}px)`,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dot,
            boxShadow: `0 0 18px ${dot}`,
          }}
        />
        {chip}
      </div>
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 1770,
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: mono,
          fontSize: 26,
          color: MUTE,
        }}
      >
        <Burst color={CYAN} size={22} />
        @dein_handle
      </div>
    </AbsoluteFill>
  );
};

const FloatingCards: React.FC = () => {
  const frame = useCurrentFrame();
  const cards = [
    { x: 44, y: 220, accent: CYAN, w: 204 },
    { x: 792, y: 214, accent: TEAL, w: 212 },
    { x: 28, y: 670, accent: VIOLET, w: 198 },
    { x: 834, y: 708, accent: GOLD, w: 202 },
    { x: 72, y: 1180, accent: TEAL, w: 210 },
    { x: 794, y: 1215, accent: CYAN, w: 200 },
    { x: 124, y: 1580, accent: GOLD, w: 206 },
    { x: 744, y: 1608, accent: VIOLET, w: 214 },
  ];

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {cards.map((card, index) => {
        const x = card.x + Math.cos(frame / 55 + index) * 4;
        const y = card.y + Math.sin(frame / 40 + index) * 6;
        const opacity = 0.1 + (index % 5) * 0.02;
        return (
          <div
            key={`${card.x}-${card.y}`}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: card.w,
              height: 74,
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              filter: "blur(0.5px)",
              opacity,
              transform: `translateY(${Math.sin(frame / 80 + index) * 2}px)`,
            }}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                background: `${card.accent}33`,
                border: `1px solid ${card.accent}66`,
                boxShadow: `0 0 18px ${card.accent}33`,
              }}
            />
            <div style={{ flex: 1, display: "grid", gap: 8 }}>
              <span
                style={{
                  width: index % 2 === 0 ? "82%" : "68%",
                  height: 8,
                  borderRadius: 999,
                  background: MUTE,
                  opacity: 0.42,
                }}
              />
              <span
                style={{
                  width: index % 3 === 0 ? "58%" : "74%",
                  height: 7,
                  borderRadius: 999,
                  background: MUTE,
                  opacity: 0.25,
                }}
              />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const CountUp: React.FC<{
  from: number;
  to: number;
  frame: number;
  startFrame: number;
  dur: number;
}> = ({ from, to, frame, startFrame, dur }) => {
  const p = interpolate(frame, [startFrame, startFrame + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const reached = frame > startFrame + dur;
  const wiggle = reached ? Math.round(Math.sin(frame * 0.65) * 4) : 0;
  const value = Math.round(interpolate(p, [0, 1], [from, to]) + wiggle);
  return <>{formatDe(value)}</>;
};

const Headline: React.FC<{ line1: string; line2: string; subtitle?: string; start?: number }> = ({
  line1,
  line2,
  subtitle,
  start = 3,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = line1.split(" ");
  const line2In = spring({ frame: frame - start - 14, fps, config: { damping: 16, stiffness: 120 } });
  const underline = spring({
    frame: frame - start - 27,
    fps,
    config: { damping: 20, stiffness: 110 },
  });
  const subtitleIn = spring({
    frame: frame - start - 36,
    fps,
    config: { damping: 18, stiffness: 110 },
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 310,
        left: 80,
        right: 80,
        textAlign: "center",
      }}
    >
      <div style={{ lineHeight: 1.02 }}>
        {words.map((word, index) => {
          const p = spring({
            frame: frame - start - index * 4,
            fps,
            config: { damping: 17, stiffness: 115 },
          });
          return (
            <span
              key={word}
              style={{
                display: "inline-block",
                marginRight: index === words.length - 1 ? 0 : 22,
                fontFamily: serif,
                fontWeight: 700,
                color: INK,
                fontSize: 92,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [28, 0])}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
      <div
        style={{
          display: "inline-block",
          marginTop: 4,
          fontFamily: serif,
          fontStyle: "italic",
          color: GOLD,
          fontSize: 96,
          lineHeight: 1.02,
          opacity: line2In,
          transform: `translateY(${interpolate(line2In, [0, 1], [24, 0])}px)`,
        }}
      >
        {line2}
        <div
          style={{
            height: 6,
            marginTop: 12,
            borderRadius: 3,
            background: GOLD,
            transformOrigin: "left",
            transform: `scaleX(${underline})`,
            boxShadow: `0 0 22px ${GOLD}66`,
          }}
        />
      </div>
      {subtitle ? (
        <div
          style={{
            marginTop: 26,
            fontFamily: ui,
            fontSize: 34,
            color: MUTE,
            opacity: subtitleIn,
            transform: `translateY(${interpolate(subtitleIn, [0, 1], [16, 0])}px)`,
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
};

const ProofPill: React.FC<{ start: number; value: number }> = ({ start, value }) => {
  const frame = useCurrentFrame();
  const pop = usePop(start, { damping: 13, stiffness: 150 });
  return (
    <div
      style={{
        position: "absolute",
        top: 705,
        left: "50%",
        display: "flex",
        alignItems: "center",
        gap: 16,
        width: 500,
        justifyContent: "center",
        padding: "20px 34px",
        borderRadius: 999,
        background: "rgba(54,224,255,0.14)",
        border: "1px solid rgba(54,224,255,0.4)",
        boxShadow: "0 0 52px rgba(54,224,255,0.22)",
        opacity: pop,
        transform: `translateX(-50%) scale(${interpolate(pop, [0, 1], [0.88, 1])})`,
        whiteSpace: "nowrap",
      }}
    >
      <Icon name="eye" color={CYAN} size={40} />
      <span style={{ fontFamily: ui, fontSize: 48, fontWeight: 800, color: INK }}>
        <CountUp from={0} to={value} frame={frame} startFrame={start} dur={45} />
      </span>
      <span style={{ fontFamily: ui, fontSize: 34, color: MUTE }}>Views · 3 Tage</span>
    </div>
  );
};

const CornerMarks: React.FC = () => (
  <>
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        width: 19,
        height: 19,
        borderLeft: "2px solid rgba(11,18,32,0.35)",
        borderTop: "2px solid rgba(11,18,32,0.35)",
        borderTopLeftRadius: 4,
      }}
    />
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: 19,
        height: 19,
        borderRight: "2px solid rgba(11,18,32,0.35)",
        borderTop: "2px solid rgba(11,18,32,0.35)",
        borderTopRightRadius: 4,
      }}
    />
  </>
);

const MiniThumb: React.FC<{ gradient: string }> = ({ gradient }) => (
  <div
    style={{
      width: 98,
      height: 58,
      margin: "0 auto 13px",
      borderRadius: 12,
      background: gradient,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.38)",
    }}
  />
);

const ProofLines: React.FC<{ index: number }> = ({ index }) => {
  const emphasis: React.CSSProperties = {
    color: "#b8860b",
    fontFamily: serif,
    fontStyle: "italic",
    fontWeight: 700,
  };

  if (index === 0) {
    return (
      <>
        <Burst color={GOLD} size={25} />
        <div>Claude schneidet</div>
        <div style={emphasis}>jeden Frame</div>
      </>
    );
  }

  if (index === 1) {
    return (
      <>
        <MiniThumb gradient={`linear-gradient(135deg, ${CYAN}, ${TEAL})`} />
        <div>50 Reels analysiert</div>
        <div>
          wird zur <span style={emphasis}>CONTENT-MASCHINE</span>
        </div>
      </>
    );
  }

  if (index === 2) {
    return (
      <>
        <MiniThumb gradient={`linear-gradient(135deg, ${TEAL}, ${VIOLET})`} />
        <div
          style={{
            display: "inline-flex",
            margin: "0 auto 10px",
            padding: "4px 9px",
            borderRadius: 999,
            background: "rgba(11,18,32,0.08)",
            fontFamily: mono,
            fontSize: 13,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          skript
        </div>
        <div>
          Hook + <span style={emphasis}>Skript</span>
        </div>
        <div>in Sekunden</div>
      </>
    );
  }

  if (index === 3) {
    return (
      <>
        <div>Dieses Reel</div>
        <div>kommt von</div>
        <div style={emphasis}>Claude</div>
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.18, opacity: 0.68 }}>
          läuft wie eine Content-Fabrik
        </div>
      </>
    );
  }

  return (
    <>
      <Burst color={CYAN} size={25} />
      <div>Voiceover, Musik,</div>
      <div>Captions,</div>
      <div style={emphasis}>alles automatisch</div>
    </>
  );
};

const ReelCardFan: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rotations = [-10, -4, 2, 7, 12];
  const values = [5972, 1843, 1164, 384, 224];

  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        top: 1030,
        display: "flex",
        justifyContent: "center",
        gap: 22,
      }}
    >
      {values.map((value, index) => {
        const s = start + index * 7;
        const p = spring({ frame: frame - s, fps, config: { damping: 14, stiffness: 145 } });
        const isTop = index === 0;
        return (
          <div key={value} style={{ display: "grid", justifyItems: "center", gap: 14 }}>
            <div
              style={{
                position: "relative",
                width: 156,
                height: 256,
                borderRadius: 16,
                padding: "30px 14px 14px",
                background: "#f4f1ea",
                border: "1px solid rgba(255,255,255,0.35)",
                boxShadow: isTop
                  ? `0 0 34px ${CYAN}55, 0 24px 62px rgba(0,0,0,0.42)`
                  : "0 22px 54px rgba(0,0,0,0.36)",
                color: "#0b1220",
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [52, 0])}px) scale(${interpolate(p, [0, 1], [0.84, 1])}) rotate(${rotations[index]}deg)`,
              }}
            >
              <CornerMarks />
              {isTop ? (
                <div
                  style={{
                    position: "absolute",
                    top: -14,
                    left: 16,
                    display: "inline-flex",
                    padding: "6px 12px",
                    borderRadius: 999,
                    background: CYAN,
                    color: BG,
                    fontFamily: mono,
                    fontSize: 18,
                    fontWeight: 800,
                    boxShadow: `0 0 18px ${CYAN}88`,
                  }}
                >
                  TOP
                </div>
              ) : null}
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontFamily: ui,
                  fontSize: 18,
                  fontWeight: 800,
                  lineHeight: 1.15,
                }}
              >
                <ProofLines index={index} />
              </div>
              {isTop ? (
                <div
                  style={{
                    position: "absolute",
                    left: 18,
                    right: 18,
                    bottom: 18,
                    height: 5,
                    borderRadius: 999,
                    background: "rgba(11,18,32,0.13)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${interpolate(p, [0, 1], [0, 84])}%`,
                      height: "100%",
                      background: CYAN,
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div
              style={{
                display: "inline-flex",
                padding: isTop ? "8px 15px" : "8px 13px",
                borderRadius: 999,
                background: isTop ? CYAN : "rgba(255,255,255,0.08)",
                border: isTop ? `1px solid ${CYAN}` : "1px solid rgba(255,255,255,0.14)",
                color: isTop ? BG : MUTE,
                fontFamily: mono,
                fontSize: 20,
                fontWeight: isTop ? 800 : 600,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [18, 0])}px)`,
              }}
            >
              <CountUp from={0} to={value} frame={frame} startFrame={s} dur={42} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const TerminalInput: React.FC = () => {
  const frame = useCurrentFrame();
  const panelIn = usePop(28, { damping: 15, stiffness: 135 });
  const chipIn = usePop(45, { damping: 15, stiffness: 145 });
  const command = "claude analysiere dieses reel";
  const chars = Math.max(0, Math.min(command.length, Math.floor((frame - 38) / 1.45)));
  const cursorOn = Math.floor(frame / 10) % 2 === 0;

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 760,
          left: 98,
          right: 98,
          borderRadius: 16,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.13)",
          boxShadow: "0 28px 92px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.10)",
          overflow: "hidden",
          opacity: panelIn,
          transform: `translateY(${interpolate(panelIn, [0, 1], [34, 0])}px)`,
        }}
      >
        <div
          style={{
            height: 62,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 24px",
            borderBottom: "1px solid rgba(255,255,255,0.09)",
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span key={color} style={{ width: 14, height: 14, borderRadius: "50%", background: color }} />
          ))}
          <span style={{ marginLeft: 12, fontFamily: mono, fontSize: 22, color: MUTE }}>
            reel-analyzer
          </span>
        </div>
        <div style={{ padding: "38px 34px 44px", fontFamily: mono, fontSize: 40, color: INK }}>
          <span style={{ color: CYAN }}>$ </span>
          {command.slice(0, chars)}
          <span
            style={{
              display: "inline-block",
              width: 21,
              height: 38,
              marginLeft: 6,
              transform: "translateY(6px)",
              background: INK,
              opacity: cursorOn ? 1 : 0,
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1044,
          left: "50%",
          display: "inline-flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 19px",
          borderRadius: 999,
          border: "1px solid rgba(54,224,255,0.35)",
          background: "rgba(54,224,255,0.07)",
          boxShadow: "0 0 30px rgba(54,224,255,0.14)",
          opacity: chipIn,
          transform: `translateX(-50%) translateY(${interpolate(chipIn, [0, 1], [20, 0])}px)`,
        }}
      >
        <Icon name="search" color={CYAN} size={28} />
        <span style={{ fontFamily: mono, fontSize: 24, color: MUTE }}>jedes Reel · jeder Account</span>
      </div>
    </>
  );
};

const FrameStrip: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stripIn = usePop(30, { damping: 15, stiffness: 135 });
  const active = Math.floor(frame / 11) % 6;
  const pop = spring({
    frame: frame % 11,
    fps,
    config: { damping: 13, stiffness: 190 },
  });
  const gradients = [
    `linear-gradient(160deg, #1fd36d, ${TEAL})`,
    `linear-gradient(160deg, ${TEAL}, ${CYAN})`,
    "linear-gradient(160deg, #35e6ff, #2e78ff)",
    "linear-gradient(160deg, #246bff, #5e6cff)",
    `linear-gradient(160deg, ${VIOLET}, #c77dff)`,
    "linear-gradient(160deg, #c77dff, #ff75bd)",
  ];
  const holes = Array.from({ length: 22 }, (_, index) => index);

  return (
    <div
      style={{
        position: "absolute",
        top: 770,
        left: "50%",
        width: 880,
        opacity: stripIn,
        transform: `translateX(-50%) translateY(${interpolate(stripIn, [0, 1], [34, 0])}px)`,
      }}
    >
      <div
        style={{
          position: "relative",
          height: 242,
          padding: "36px 30px",
          borderRadius: 10,
          background: "#0a0a0a",
          border: "1px solid rgba(255,255,255,0.14)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.42)",
        }}
      >
        {[14, 212].map((top) => (
          <div
            key={top}
            style={{
              position: "absolute",
              top,
              left: 26,
              right: 26,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            {holes.map((hole) => (
              <span
                key={hole}
                style={{
                  width: 19,
                  height: 10,
                  borderRadius: 3,
                  background: "#f4f1ea",
                  opacity: 0.78,
                }}
              />
            ))}
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {gradients.map((gradient, index) => (
            <div
              key={gradient}
              style={{
                position: "relative",
                width: 120,
                height: 150,
                borderRadius: 8,
                background: gradient,
                overflow: "hidden",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.26)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.18), transparent 42%, rgba(0,0,0,0.26))",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 0,
                  height: 0,
                  borderTop: "16px solid transparent",
                  borderBottom: "16px solid transparent",
                  borderLeft: "25px solid rgba(255,255,255,0.62)",
                  transform: "translate(-42%, -50%)",
                }}
              />
              {active === index ? (
                <div
                  style={{
                    position: "absolute",
                    inset: -3,
                    borderRadius: 10,
                    border: `2.5px solid ${CYAN}`,
                    boxShadow: `0 0 22px ${CYAN}`,
                    transform: `scale(${interpolate(pop, [0, 1], [1.04, 1])})`,
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 24,
          textAlign: "center",
          fontFamily: mono,
          fontSize: 24,
          letterSpacing: 3,
          color: CYAN,
          textShadow: `0 0 18px ${CYAN}88`,
        }}
      >
        ▸ FRAME STREAM
      </div>
    </div>
  );
};

const IconTile: React.FC<{
  glyph: IconName;
  label: string;
  color: string;
  active: boolean;
}> = ({ glyph, label, color, active }) => {
  const glow = active ? `0 0 34px ${color}55, inset 0 1px 0 rgba(255,255,255,0.16)` : "none";
  return (
    <div style={{ width: 132, display: "grid", justifyItems: "center", gap: 18 }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: active ? `${color}18` : "rgba(255,255,255,0.05)",
          border: `1px solid ${active ? color : "rgba(255,255,255,0.12)"}`,
          boxShadow: glow,
          transform: `scale(${active ? 1.04 : 1})`,
        }}
      >
        <Icon name={glyph} color={active ? color : MUTE} />
      </div>
      <div
        style={{
          fontFamily: mono,
          fontSize: 22,
          letterSpacing: 1.3,
          color: active ? INK : MUTE,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const Pipeline: React.FC<{
  tiles: { glyph: IconName; label: string; color: string; activateAtFrame: number }[];
  start?: number;
  top?: number;
}> = ({ tiles, start = 36, top = 1090 }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const pulse = clamp01(((frame - start) % 72) / 72);
  const activeColor = tiles.reduce((color, tile) => (frame >= tile.activateAtFrame ? tile.color : color), tiles[0].color);

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 118,
        right: 118,
        height: 190,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          top: 48,
          height: 3,
          background: "rgba(255,255,255,0.12)",
        }}
      >
        <div
          style={{
            width: `${p * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${CYAN}, ${TEAL}, ${GOLD})`,
            boxShadow: `0 0 20px ${activeColor}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -5,
            left: `${pulse * 100}%`,
            width: 13,
            height: 13,
            borderRadius: "50%",
            background: activeColor,
            boxShadow: `0 0 22px ${activeColor}`,
            transform: "translateX(-50%)",
            opacity: p,
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", position: "relative" }}>
        {tiles.map((tile) => (
          <IconTile
            key={tile.label}
            glyph={tile.glyph}
            label={tile.label}
            color={tile.color}
            active={frame >= tile.activateAtFrame}
          />
        ))}
      </div>
    </div>
  );
};

const Typewriter: React.FC<{ text: string; start: number; speed?: number; color?: string }> = ({
  text,
  start,
  speed = 1.7,
  color = INK,
}) => {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.min(text.length, Math.floor((frame - start) / speed)));
  const cursorOn = Math.floor(frame / 12) % 2 === 0;
  return (
    <span style={{ color }}>
      {text.slice(0, chars)}
      <span style={{ opacity: cursorOn ? 1 : 0, color }}>|</span>
    </span>
  );
};

const ChatCard: React.FC = () => {
  const frame = useCurrentFrame();
  const userIn = usePop(20, { damping: 14, stiffness: 150 });
  const assistantIn = usePop(55, { damping: 14, stiffness: 135 });
  const typing = frame < 82;

  return (
    <div
      style={{
        position: "absolute",
        top: 760,
        left: 96,
        right: 96,
        padding: 28,
        borderRadius: 22,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 30px 90px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Burst color={CYAN} size={24} />
        <span style={{ fontFamily: ui, fontSize: 30, fontWeight: 600, color: INK }}>Claude Code</span>
        <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 20, color: TEAL }}>
          verbunden
        </span>
      </div>
      <div
        style={{
          marginTop: 34,
          marginLeft: "auto",
          width: 590,
          padding: "22px 26px",
          borderRadius: 24,
          background: "rgba(54,224,255,0.17)",
          border: "1px solid rgba(54,224,255,0.32)",
          color: INK,
          fontFamily: ui,
          fontSize: 34,
          lineHeight: 1.18,
          opacity: userIn,
          transform: `translateY(${interpolate(userIn, [0, 1], [24, 0])}px)`,
        }}
      >
        Schreib Hook + Skript aus diesem Reel
      </div>
      <div style={{ marginTop: 22, display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 42,
            height: 42,
            marginTop: 18,
            borderRadius: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(54,224,255,0.13)",
            border: "1px solid rgba(54,224,255,0.28)",
            opacity: assistantIn,
          }}
        >
          <Burst color={CYAN} size={21} />
        </div>
        <div
          style={{
            width: 640,
            minHeight: 126,
            padding: "22px 26px",
            borderRadius: 24,
            background: "rgba(255,255,255,0.075)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: INK,
            fontFamily: ui,
            fontSize: 34,
            lineHeight: 1.22,
            opacity: assistantIn,
            transform: `translateY(${interpolate(assistantIn, [0, 1], [24, 0])}px)`,
          }}
        >
          {typing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, height: 44 }}>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: CYAN,
                    opacity: 0.55 + Math.sin((frame - dot * 5) / 6) * 0.28,
                    transform: `translateY(${Math.sin((frame - dot * 5) / 6) * -8}px)`,
                    boxShadow: `0 0 16px ${CYAN}77`,
                  }}
                />
              ))}
            </div>
          ) : (
            <Typewriter text={'Hook: "Claude baut jetzt komplette Reels..."'} start={82} />
          )}
        </div>
      </div>
    </div>
  );
};

const CommentBox: React.FC<{ typed: string; glow: string; posted: number; start?: number }> = ({
  typed,
  glow,
  posted,
  start = 40,
}) => {
  const frame = useCurrentFrame();
  const boxIn = usePop(start - 8, { damping: 14, stiffness: 140 });
  const sent = frame >= posted;

  return (
    <div
      style={{
        position: "absolute",
        left: 102,
        right: 102,
        top: 1010,
        opacity: boxIn,
        transform: `translateY(${interpolate(boxIn, [0, 1], [28, 0])}px)`,
      }}
    >
      <div
        style={{
          marginLeft: 8,
          marginBottom: 14,
          fontFamily: mono,
          color: MUTE,
          fontSize: 22,
          letterSpacing: 2,
        }}
      >
        KOMMENTARE
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          minHeight: 94,
          padding: "12px 14px 12px 18px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.055)",
          border: `1.5px solid ${glow}`,
          boxShadow: `0 0 44px ${glow}33`,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: `linear-gradient(145deg, ${glow}, ${VIOLET})`,
          }}
        />
        <div style={{ flex: 1, fontFamily: ui, fontSize: 38, color: INK }}>
          <Typewriter text={typed} start={start} speed={2.3} />
        </div>
        <div
          style={{
            padding: "18px 26px",
            borderRadius: 999,
            background: glow,
            color: BG,
            fontFamily: ui,
            fontSize: 28,
            fontWeight: 800,
            transform: `scale(${sent ? 0.96 : 1})`,
          }}
        >
          {sent ? "Gepostet" : "Posten"}
        </div>
      </div>
    </div>
  );
};

const Toast: React.FC<{ title: string; subtitle: string; start: number }> = ({ title, subtitle, start }) => {
  const y = usePop(start, { damping: 13, stiffness: 130 });
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 124,
        right: 124,
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 24px",
        borderRadius: 22,
        background: "rgba(255,255,255,0.075)",
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 22px 80px rgba(0,0,0,0.42)",
        opacity: y,
        transform: `translateY(${interpolate(y, [0, 1], [-160, 120])}px)`,
      }}
    >
      <div
        style={{
          width: 58,
          height: 58,
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(54,224,255,0.16)",
          border: "1px solid rgba(54,224,255,0.32)",
        }}
      >
        <Burst color={CYAN} size={28} />
      </div>
      <div>
        <div style={{ fontFamily: ui, fontWeight: 600, fontSize: 30, color: INK }}>{title}</div>
        <div style={{ marginTop: 5, fontFamily: mono, fontSize: 22, color: MUTE }}>{subtitle}</div>
      </div>
    </div>
  );
};

const ProgressBar: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + 38], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return (
    <div
      style={{
        position: "absolute",
        top: 1355,
        left: 170,
        right: 170,
        height: 18,
        borderRadius: 999,
        background: "rgba(255,255,255,0.08)",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)",
      }}
    >
      <div
        style={{
          width: `${p * 100}%`,
          height: "100%",
          background: CYAN,
          boxShadow: `0 0 28px ${CYAN}`,
        }}
      />
    </div>
  );
};

const Scene0: React.FC = () => (
  <Stage chip="00 · PROOF" dot={CYAN} glow={CYAN} glowY={650}>
    <Headline line1="Claude baut jetzt" line2="Reels." />
    <ProofPill start={150} value={10903} />
    <ReelCardFan start={165} />
  </Stage>
);

const Scene1: React.FC = () => (
  <Stage chip="01 · ABLAUF" dot={CYAN} glow={CYAN} glowY={760}>
    <Headline line1="So läuft der ganze" line2="Ablauf." />
    <Pipeline
      start={55}
      tiles={[
        { glyph: "search", label: "Analyse", color: CYAN, activateAtFrame: 58 },
        { glyph: "spark", label: "Skript", color: GOLD, activateAtFrame: 66 },
        { glyph: "film", label: "Bauen", color: TEAL, activateAtFrame: 74 },
        { glyph: "chat", label: "Leads", color: CYAN, activateAtFrame: 82 },
      ]}
    />
  </Stage>
);

const Scene2Input: React.FC = () => (
  <Stage chip="02 · INPUT" dot={CYAN} glow={CYAN} glowY={760}>
    <FloatingCards />
    <Headline line1="Es startet mit einem" line2="viralen Reel." />
    <TerminalInput />
  </Stage>
);

const Scene2Study: React.FC = () => (
  <Stage chip="03 · STUDY" dot={TEAL} glow={TEAL} glowY={760}>
    <FloatingCards />
    <Headline line1="Claude analysiert" line2="jeden Frame." />
    <FrameStrip />
  </Stage>
);

const Scene3: React.FC = () => (
  <Stage chip="04 · SKRIPT" dot={GOLD} glow={CYAN} glowY={760}>
    <FloatingCards />
    <Headline line1="Dann schreibt es" line2="Hook + Skript." />
    <ChatCard />
    <ProgressBar start={120} />
  </Stage>
);

const Scene4: React.FC = () => (
  <Stage chip="05 · MACHT ALLES" dot={TEAL} glow={CYAN} glowY={750}>
    <FloatingCards />
    <Headline line1="Claude macht" line2="alles." />
    <Pipeline
      start={0}
      tiles={[
        { glyph: "mic", label: "Voiceover", color: VIOLET, activateAtFrame: 0 },
        { glyph: "wave", label: "Musik", color: TEAL, activateAtFrame: 24 },
        { glyph: "text", label: "Captions", color: CYAN, activateAtFrame: 46 },
        { glyph: "spark", label: "Animationen", color: GOLD, activateAtFrame: 72 },
      ]}
    />
  </Stage>
);

const Scene5: React.FC = () => (
  <Stage chip="06 · LEADS" dot={TEAL} glow={TEAL} glowY={760}>
    <Headline
      line1="Jeder Kommentar,"
      line2="jeder Lead."
      subtitle="Auto-Antwort + DM. Rund um die Uhr."
    />
    <CommentBox typed="Interesse!" glow={TEAL} posted={55} start={24} />
    <Toast title="Claude · Antwort raus" subtitle="DM an deinen Lead ✓" start={70} />
  </Stage>
);

const Scene6: React.FC = () => (
  <Stage chip="07 · GUIDE" dot={CYAN} glow={CYAN} glowY={760}>
    <Headline
      line1="Kommentier"
      line2="„GUIDE“."
      subtitle="Claude schickt dir die Anleitung per DM."
    />
    <CommentBox typed="GUIDE" glow={CYAN} posted={110} start={40} />
    <Toast title="Claude · Anleitung gesendet ✓" subtitle="check deine DMs" start={130} />
  </Stage>
);

export const Autopilot: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: BG }}>
    <Audio src={staticFile("vo5.mp3")} />
    {/* Musik-Bett (Variante A, Alex' Wahl 17.07.): treibender Tech-Puls, ab Frame 0 auf Pegel.
        Nur 6 Frames Einblende (gegen Klick), Ausblende zum Schluss. */}
    <Audio
      src={staticFile("music-a.mp3")}
      volume={(f) =>
        interpolate(f, [0, 6, 1150, 1245], [0, 0.25, 0.25, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      }
    />
    <Sequence from={0} durationInFrames={sceneDurations[0]}>
      <Scene0 />
    </Sequence>
    <Sequence from={209} durationInFrames={sceneDurations[1]}>
      <Scene1 />
    </Sequence>
    <Sequence from={346} durationInFrames={sceneDurations[2]}>
      <Scene2Input />
    </Sequence>
    <Sequence from={452} durationInFrames={sceneDurations[3]}>
      <Scene2Study />
    </Sequence>
    <Sequence from={553} durationInFrames={sceneDurations[4]}>
      <Scene3 />
    </Sequence>
    <Sequence from={723} durationInFrames={sceneDurations[5]}>
      <Scene4 />
    </Sequence>
    <Sequence from={876} durationInFrames={sceneDurations[6]}>
      <Scene5 />
    </Sequence>
    <Sequence from={1032} durationInFrames={sceneDurations[7]}>
      <Scene6 />
    </Sequence>
  </AbsoluteFill>
);
