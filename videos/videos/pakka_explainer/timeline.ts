import "../../styles/pakka/tokens.css";
import type { Timeline } from "videowright";
import track from "./audio/tracks/v1/track";
import { ORDER } from "./script";

// Segment order is the script order, so the narration and the timeline cannot drift apart.
const timeline: Timeline = {
	meta: { title: "Pakka: har AutoPay, aapki marzi se" },
	segments: ORDER.map((id, i) => ({ id, transition: i === 0 ? undefined : "fade" })),
	default_audio_track: track,
};

export default timeline;
