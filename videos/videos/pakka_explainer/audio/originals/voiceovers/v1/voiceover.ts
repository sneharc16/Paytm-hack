import type { Voiceover } from "videowright";

// Written by videos/scripts/voiceover.ts. Sarvam Bulbul v3, hi-IN, speaker priya, pace 0.95.
const voiceover: Voiceover = {
	audio_file: "./audio.mp3",
	provider: "manual",
	voice: "priya",
	model: "bulbul:v3",
	notes: "Hinglish narration from script.ts, one Sarvam clip per beat; timing from clip lengths.",
	timing: {
		"perSegment": {
			"pakka-cold-open": [
				6.76,
				14.37,
				21.18
			],
			"pakka-problem": [
				6.98,
				15.49,
				20.05,
				27.84
			],
			"pakka-how-it-works": [
				7.53,
				17.93,
				24.37,
				36.84
			],
			"pakka-sunita": [
				7.15,
				15.03,
				21.12,
				29.63
			],
			"pakka-rules": [
				8.95,
				18.08,
				24.71
			],
			"pakka-languages": [
				9.86,
				16.66,
				27.96
			],
			"pakka-live": [
				5.37,
				12.62,
				21.12
			],
			"pakka-merchant": [
				7.89,
				14.16,
				20.69,
				30.11
			],
			"pakka-business": [
				7.69,
				13.42,
				20.51,
				27.68
			],
			"pakka-phishing": [
				10.04,
				16.58,
				22.92,
				28.92,
				34.46
			],
			"pakka-developers": [
				8.32,
				16.82,
				22.99
			],
			"pakka-proof": [
				9.23,
				13.52
			],
			"pakka-outro": [
				3.04,
				6.59
			]
		}
	},
};

export default voiceover;
