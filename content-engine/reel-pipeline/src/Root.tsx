import { Composition, staticFile } from "remotion";
import {
  CaptionedVideo,
  calculateCaptionedVideoMetadata,
  captionedVideoSchema,
} from "./CaptionedVideo";
import { Cover } from "./Cover";
import { Faceless } from "./Faceless";
import { Autopilot } from "./Autopilot";

// Each <Composition> is an entry in the sidebar!

export const RemotionRoot: React.FC = () => {
  return (
    <>
    <Composition
      id="CaptionedVideo"
      component={CaptionedVideo}
      calculateMetadata={calculateCaptionedVideoMetadata}
      schema={captionedVideoSchema}
      width={1080}
      height={1920}
      defaultProps={{
        src: staticFile("reel3-cut.mp4"),
      }}
    />
      <Composition
        id="Faceless"
        component={Faceless}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={477}
      />
      <Composition
        id="Cover"
        component={Cover}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1}
        defaultProps={{
          title1: "Claude Code",
          title2: "Content Autopilot",
          subtitle: "Video rein. Fertiger Content raus.",
        }}
      />
      <Composition
        id="Autopilot"
        component={Autopilot}
        width={1080}
        height={1920}
        fps={30}
        durationInFrames={1245}
      />
    </>
  );
};
