// Builds the Hinglish voiceover for videos/pakka_explainer with Sarvam Bulbul, and the audio track timed from it.
// Run from the repo root (it reuses the app's Sarvam client and reads SARVAM_API_KEY from .env.local):
//   npx tsx --env-file-if-exists=.env --env-file-if-exists=.env.local --tsconfig tsconfig.json videos/scripts/voiceover.ts
// Each script line becomes one clip. Clips are joined with a short gap inside a segment and a longer one between
// segments; every advance fires at the end of its line plus that gap. Clips are cached, so reruns only speak new lines.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { speak } from "@/lib/server/sarvam";
import { sha256 } from "@/lib/hash";
import { ORDER, SCRIPT } from "../videos/pakka_explainer/script";

const VIDEO = join(import.meta.dirname, "../videos/pakka_explainer");
const VO = join(VIDEO, "audio/originals/voiceovers/v1");
const CLIPS = join(VO, "clips");
const TRACK = join(VIDEO, "audio/tracks/v1");
const LEAD = 0.4, GAP_LINE = 0.45, GAP_SEGMENT = 0.9, GAP_END = 2.5, RATE = 22050;

for (const d of [CLIPS, TRACK]) mkdirSync(d, { recursive: true });

const ffprobe = (f: string) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const silence = (s: number) => {
	const f = join(CLIPS, `silence-${s}.wav`);
	if (!existsSync(f)) execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `anullsrc=r=${RATE}:cl=mono`, "-t", String(s), f]);
	return f;
};

const parts: string[] = [silence(LEAD)];
const perSegment: Record<string, number[]> = {};
let t = LEAD, segStart = 0;
for (const id of ORDER) {
	const lines = SCRIPT[id];
	perSegment[id] = [];
	for (const [i, text] of lines.entries()) {
		const clip = join(CLIPS, `${sha256(text).slice(0, 12)}.wav`);
		if (!existsSync(clip)) {
			const r = await speak(text, "hinglish");
			if (!r.ok) throw new Error(`${id} line ${i + 1}: ${r.reason}`);
			writeFileSync(clip, Buffer.from(r.data.wav, "base64"));
		}
		const gap = i < lines.length - 1 ? GAP_LINE : id === ORDER.at(-1) ? GAP_END : GAP_SEGMENT;
		t += ffprobe(clip) + gap;
		parts.push(clip, silence(gap));
		perSegment[id].push(Number((t - segStart).toFixed(2)));
	}
	segStart += perSegment[id].at(-1)!;
	console.log(`${id.padEnd(22)} ${perSegment[id].at(-1)!.toFixed(1)}s  (ends ${t.toFixed(1)}s)`);
}

// Join every part (all mono 22.05 kHz WAV) into the voiceover mp3, then render the track from the audio plan's command.
const list = join(CLIPS, "concat.txt");
writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-q:a", "2", join(VO, "audio.mp3")]);
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(VO, "audio.mp3"), "-c:a", "libmp3lame", "-q:a", "2", join(TRACK, "track.mp3")]);
const length = ffprobe(join(TRACK, "track.mp3"));
const timing = JSON.stringify({ perSegment }, null, "\t");

writeFileSync(join(VO, "voiceover.ts"), `import type { Voiceover } from "videowright";

// Written by videos/scripts/voiceover.ts. Sarvam Bulbul v3, hi-IN, speaker priya, pace 0.95.
const voiceover: Voiceover = {
	audio_file: "./audio.mp3",
	provider: "manual",
	voice: "priya",
	model: "bulbul:v3",
	notes: "Hinglish narration from script.ts, one Sarvam clip per beat; timing from clip lengths.",
	timing: ${timing.replace(/\n/g, "\n\t")},
};

export default voiceover;
`);

const plan = `# Audio plan

Voiceover only, no music or effects.

| Cue | Source | Start |
|---|---|---|
| 1 | audio/originals/voiceovers/v1/audio.mp3 (Sarvam Bulbul, Hinglish) | 0s |

\`\`\`bash
ffmpeg -y -i audio/originals/voiceovers/v1/audio.mp3 -c:a libmp3lame -q:a 2 {TRACK_OUT}
\`\`\`
`;
writeFileSync(join(VIDEO, "audio/audio_plan.md"), plan);
writeFileSync(join(TRACK, "plan_snapshot.md"), plan);
writeFileSync(join(TRACK, "track.ts"), `import type { AudioTrack } from "videowright";

// Written by videos/scripts/voiceover.ts.
const track: AudioTrack = {
	audio_file: "./audio/tracks/v1/track.mp3",
	length_s: ${length.toFixed(2)},
	audio_plan_path: "../../audio_plan.md",
	plan_snapshot_path: "./plan_snapshot.md",
	created_at: "${new Date().toISOString()}",
	timing: ${timing.replace(/\n/g, "\n\t")},
};

export default track;
`);
console.log(`track ${length.toFixed(1)}s`);
