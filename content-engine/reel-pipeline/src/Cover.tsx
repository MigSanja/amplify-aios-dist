import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { uiFont } from "./CaptionedVideo/Overlays";

// Cover-/Thumbnail-Komposition: Codex-Key-Art + Titel (als Still exportieren).
export const Cover: React.FC<{
  title1: string;
  title2: string;
  subtitle?: string;
}> = ({ title1, title2, subtitle }) => (
  <AbsoluteFill style={{ backgroundColor: "#060A14" }}>
    <Img
      src={staticFile("cover-bg.png")}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "6%",
        fontFamily: uiFont,
        textAlign: "center",
      }}
    >
      <div
        style={{
          color: "white",
          fontSize: 118,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          WebkitTextStroke: "8px rgba(0,0,0,0.8)",
          paintOrder: "stroke",
          textShadow: "0 12px 50px rgba(0,0,0,0.7)",
          lineHeight: 1.04,
        }}
      >
        {title1}
      </div>
      <div
        style={{
          color: "#D97757",
          fontSize: 128,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          WebkitTextStroke: "8px rgba(0,0,0,0.8)",
          paintOrder: "stroke",
          textShadow: "0 12px 50px rgba(0,0,0,0.7)",
          lineHeight: 1.04,
          maxWidth: "92%",
        }}
      >
        {title2}
      </div>
      {subtitle ? (
        <div
          style={{
            marginTop: 34,
            color: "rgba(255,255,255,0.85)",
            fontSize: 44,
            fontWeight: 600,
            background: "rgba(8,10,18,0.65)",
            border: "1px solid rgba(255,255,255,0.16)",
            borderRadius: 999,
            padding: "16px 42px",
            backdropFilter: "blur(8px)",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </AbsoluteFill>
  </AbsoluteFill>
);
