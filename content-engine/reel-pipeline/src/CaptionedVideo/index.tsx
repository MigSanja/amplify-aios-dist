import { Caption, createTikTokStyleCaptions } from "@remotion/captions";
import { getVideoMetadata } from "@remotion/media-utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  cancelRender,
  Easing,
  getStaticFiles,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
  watchStaticFile,
} from "remotion";
import { z } from "zod";
import { loadFont } from "../load-font";
import { NoCaptionFile } from "./NoCaptionFile";
import { FakeTerminal, HeadroomCard } from "./Headroom";
import { MorphCard } from "./MorphCard";
import { Badge, CardsOverlay, ExplainerScene, HookOverlay, Overlays } from "./Overlays";
import SubtitlePage from "./SubtitlePage";

export type SubtitleProp = {
  startInSeconds: number;
  text: string;
};

export const captionedVideoSchema = z.object({
  src: z.string(),
});

export const calculateCaptionedVideoMetadata: CalculateMetadataFunction<
  z.infer<typeof captionedVideoSchema>
> = async ({ props }) => {
  const fps = 30;
  const metadata = await getVideoMetadata(props.src);

  return {
    fps,
    durationInFrames: Math.floor(metadata.durationInSeconds * fps),
  };
};

const getFileExists = (file: string) => {
  const files = getStaticFiles();
  const fileExists = files.find((f) => {
    return f.src === file;
  });
  return Boolean(fileExists);
};

// How many captions should be displayed at a time?
const SWITCH_CAPTIONS_EVERY_MS = 1200;

// Ein-/Ausblend-Fenster für den Picture-in-Picture-Modus (Erklär-Szenen)
const PIP_RAMP_MS = 550;

export const CaptionedVideo: React.FC<{
  src: string;
}> = ({ src }) => {
  const [subtitles, setSubtitles] = useState<Caption[]>([]);
  const [overlays, setOverlays] = useState<Overlays>({});
  const { delayRender, continueRender } = useDelayRender();
  const [handle] = useState(() => delayRender());
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const tMs = (frame / fps) * 1000;

  const subtitlesFile = src
    .replace(/.mp4$/, ".json")
    .replace(/.mkv$/, ".json")
    .replace(/.mov$/, ".json")
    .replace(/.webm$/, ".json");

  const fetchSubtitles = useCallback(async () => {
    try {
      await loadFont();
      const res = await fetch(subtitlesFile);
      const data = (await res.json()) as Caption[];
      setSubtitles(data);
      // Overlays (optional): <video>.overlays.json neben dem Video
      try {
        const oRes = await fetch(subtitlesFile.replace(/\.json$/, ".overlays.json"));
        setOverlays((await oRes.json()) as Overlays);
      } catch {
        setOverlays({});
      }
      continueRender(handle);
    } catch (e) {
      cancelRender(e);
    }
  }, [continueRender, handle, subtitlesFile]);

  useEffect(() => {
    fetchSubtitles();

    const c = watchStaticFile(subtitlesFile, () => {
      fetchSubtitles();
    });

    return () => {
      c.cancel();
    };
  }, [fetchSubtitles, src, subtitlesFile]);

  const { pages } = useMemo(() => {
    return createTikTokStyleCaptions({
      combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
      captions: subtitles ?? [],
    });
  }, [subtitles]);

  // PiP-Fortschritt: 0 = Vollbild, 1 = klein mit Ring (während Erklär-Szenen)
  const explainers = overlays.explainers ?? [];
  let pip = 0;
  let activeExplainer = null;
  for (const ex of explainers) {
    const p =
      interpolate(tMs, [ex.startMs, ex.startMs + PIP_RAMP_MS], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      }) *
      interpolate(tMs, [ex.endMs - PIP_RAMP_MS, ex.endMs], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      });
    if (p > pip) pip = p;
    if (p > 0.01) activeExplainer = ex;
  }

  // Video-Container: Vollbild → oben rechts klein (46%), mit rotierendem Farbring
  const w = interpolate(pip, [0, 1], [100, 46]);
  const top = interpolate(pip, [0, 1], [0, 6]);
  const left = interpolate(pip, [0, 1], [0, 49]);
  const radius = pip * 30;
  const ringPad = pip * 7;

  return (
    <AbsoluteFill style={{ backgroundColor: "#0B1020" }}>
      {activeExplainer ? (
        <ExplainerScene item={activeExplainer} progress={pip} />
      ) : null}
      <div
        style={{
          position: "absolute",
          width: w + "%",
          height: w + "%",
          top: top + "%",
          left: left + "%",
          padding: ringPad,
          borderRadius: radius + ringPad,
          background:
            pip > 0.01
              ? `conic-gradient(from ${frame * 3}deg, #0A84FF, #64D2FF, #5E5CE6, #0040DD, #00C7FF, #0A84FF)`
              : "transparent",
          boxShadow:
            pip > 0.01
              ? `0 24px 90px rgba(0,0,0,${0.5 * pip}), 0 0 ${70 * pip}px rgba(10,132,255,${0.5 * pip})`
              : "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: radius,
            overflow: "hidden",
          }}
        >
          <OffthreadVideo
            style={{ objectFit: "cover", width: "100%", height: "100%" }}
            src={src}
          />
        </div>
      </div>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const subtitleStartFrame = (page.startMs / 1000) * fps;
        const subtitleEndFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * fps : Infinity,
          subtitleStartFrame + SWITCH_CAPTIONS_EVERY_MS,
        );
        const durationInFrames = subtitleEndFrame - subtitleStartFrame;
        if (durationInFrames <= 0) {
          return null;
        }

        return (
          <Sequence
            key={index}
            from={subtitleStartFrame}
            durationInFrames={durationInFrames}
          >
            <SubtitlePage key={index} page={page} />;
          </Sequence>
        );
      })}
      {(overlays.hooks ?? []).map((h, i) => {
        const from = Math.round((h.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round((h.durationMs / 1000) * fps));
        return (
          <Sequence key={"hook-" + i} from={from} durationInFrames={dur}>
            <HookOverlay item={h} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {(overlays.morphs ?? []).map((m, i) => {
        const from = Math.round((m.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round(((m.endMs - m.startMs) / 1000) * fps));
        return (
          <Sequence key={"morph-" + i} from={from} durationInFrames={dur}>
            <MorphCard item={m} />
          </Sequence>
        );
      })}
      {(overlays.headrooms ?? []).map((h, i) => {
        const from = Math.round((h.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round(((h.endMs - h.startMs) / 1000) * fps));
        return (
          <Sequence key={"hr-" + i} from={from} durationInFrames={dur}>
            <HeadroomCard item={h} />
          </Sequence>
        );
      })}
      {(overlays.terminals ?? []).map((t, i) => {
        const from = Math.round((t.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round(((t.endMs - t.startMs) / 1000) * fps));
        return (
          <Sequence key={"term-" + i} from={from} durationInFrames={dur}>
            <FakeTerminal item={t} />
          </Sequence>
        );
      })}
      {(overlays.cards ?? []).map((g, i) => {
        const from = Math.round((g.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round(((g.endMs - g.startMs) / 1000) * fps));
        return (
          <Sequence key={"cards-" + i} from={from} durationInFrames={dur}>
            <CardsOverlay group={g} />
          </Sequence>
        );
      })}
      {(overlays.badges ?? []).map((b, i) => {
        const from = Math.round((b.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round((b.durationMs / 1000) * fps));
        return (
          <Sequence key={"badge-" + i} from={from} durationInFrames={dur}>
            <Badge item={b} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {getFileExists(subtitlesFile) ? null : <NoCaptionFile />}
    </AbsoluteFill>
  );
};
