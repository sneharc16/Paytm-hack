# Audio plan

Voiceover only, no music or effects.

| Cue | Source | Start |
|---|---|---|
| 1 | audio/originals/voiceovers/v1/audio.mp3 (Sarvam Bulbul, Hinglish) | 0s |

```bash
ffmpeg -y -i audio/originals/voiceovers/v1/audio.mp3 -c:a libmp3lame -q:a 2 {TRACK_OUT}
```
