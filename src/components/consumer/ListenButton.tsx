"use client";
// One play button for everything Pakka says: the Doosri Haan sheet and Pakka se poochho answers.
// speak() tries a recorded note, then the browser's Indian voice; with neither, it shows the "read it below" line.
// Give it a key of the text, so a new text starts from a fresh, stopped button.
import { useEffect, useRef, useState } from "react";
import { Pause, Volume2 } from "lucide-react";
import { t } from "@/copy/strings";
import type { Lang } from "@/engine/types";
import { speak, type Speaking } from "@/llm/tts";

export function ListenButton({ text, lang, onVoice }: { text: string; lang: Lang; onVoice?: (v: { provider: string; voice?: string }) => void }) {
  const [state, setState] = useState<"idle" | "playing" | "error">("idle");
  const current = useRef<Speaking | null>(null);
  useEffect(() => () => current.current?.stop(), []);
  const toggle = async () => {
    if (state === "playing") { current.current?.stop(); setState("idle"); return; }
    const s = await speak({ text, language: lang });
    current.current = s;
    onVoice?.({ provider: s.provider, voice: s.voice });
    if (s.provider === "text") { setState("error"); return; }
    setState("playing");
    s.done.then(() => setState((x) => (x === "playing" ? "idle" : x)));
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button onClick={toggle} data-voice-state={state} className="btn-soft inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-semibold">
        {state === "playing" ? <Pause size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}{t(lang, "sheet.listen")}
      </button>
      {state === "error" && <span className="text-right text-[13px] text-slate">{t(lang, "voice.error")}</span>}
    </span>
  );
}
