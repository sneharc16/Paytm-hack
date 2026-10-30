"use client";
// Review trail for one AI-written message: rounds, each criterion's verdict per round, contests and their
// outcome, the final status, what was masked and the voice used. Values are never shown, only counts.
import type { PakkaEvent, ReviewStamp } from "@/engine/types";
import { describeMasked } from "@/lib/privacy/mask";
import { reviewOf } from "@/lib/recorder";
import type { Session } from "@/engine/session";
import { nudgeVoiceText } from "@/lib/voice";
import { criteriaFor, RUBRIC } from "@/llm/agents/rubric";
import { reviewTrail } from "@/llm/hooks";
import { recordedNote } from "@/llm/tts";

const STATUS: Record<ReviewStamp["status"], { label: string; tone: string }> = {
  agreed: { label: "Agreed: every criterion passed", tone: "bg-green-wash text-green" },
  reviewer_final: { label: "Reviewer's final decision applied after 5 rounds", tone: "bg-amber-wash text-ink" },
  template: { label: "Sent as template", tone: "bg-canvas text-slate" },
};
const NAME = Object.fromEntries(RUBRIC.map((c) => [c.id, c.name]));

function voiceUsed(s: Session, e: PakkaEvent): string | null {
  if (e.type !== "nudge_sent" || !e.payload.cycleId) return null;
  const mer = s.idx.merchant.get(s.mandateOf(e.payload.cycleId).merchantId)!;
  const note = recordedNote({ language: e.payload.language, text: nudgeVoiceText(e, mer) });
  return note ? `Recorded note, ${note.voice} (${note.language === "en" ? "en-IN" : "hi-IN"})` : "Browser's Indian voice on the customer's phone, or text only";
}

export function ReviewTrail({ s, e }: { s: Session; e: PakkaEvent }) {
  const stamp = reviewOf(e);
  if (!stamp) return null;
  const full = reviewTrail(stamp.key);
  const rounds = full?.trail ?? stamp.trail?.map((t) => ({ ...t, fails: [], contests: [] })) ?? [];
  const ids = rounds.length ? Object.keys(rounds[0].verdicts) : [];
  const voice = voiceUsed(s, e);
  return (
    <div className="mt-2 rounded-[8px] border border-line bg-canvas p-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Review trail</span>
        <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${STATUS[stamp.status].tone}`}>{STATUS[stamp.status].label}</span>
        <span className="text-slate">{stamp.rounds} round{stamp.rounds === 1 ? "" : "s"}</span>
      </div>
      {stamp.status === "template" && stamp.reason && <p className="mt-1 text-slate">Why: {stamp.reason.replaceAll("_", " ")}</p>}
      {rounds.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="text-[12px]">
            <thead><tr><th className="pr-2 text-left font-semibold text-slate">Round</th>{ids.map((id) => <th key={id} title={NAME[id]} className="px-1 font-semibold text-slate">{id}</th>)}</tr></thead>
            <tbody>
              {rounds.map((r) => (
                <tr key={r.round}>
                  <td className="tnum pr-2">{r.round}</td>
                  {ids.map((id) => <td key={id} className="px-1 text-center" title={`${NAME[id]}: ${r.verdicts[id]}`}>{r.verdicts[id] === "pass" ? <span className="text-green">✓</span> : <span className="font-bold text-red">✗</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {full?.trail.some((r) => r.fails.length || r.contests.length) && (
        <ul className="mt-2 space-y-1">
          {full.trail.flatMap((r) => [
            ...r.fails.map((f, i) => <li key={`f${r.round}${i}`}><b>Round {r.round}, {f.criterion}</b> failed by {f.by === "code" ? "a code check" : "the reviewer"}{f.quote ? <>: &ldquo;{f.quote}&rdquo;</> : null}{f.fix ? <span className="text-slate">. Fix: {f.fix}</span> : null}</li>),
            ...r.contests.map((c, i) => <li key={`c${r.round}${i}`}><b>Round {r.round}, {c.criterion}</b> contested with &ldquo;{c.factsQuote}&rdquo;: {c.answer} <span className="text-slate">({c.reason})</span></li>),
          ])}
        </ul>
      )}
      {full?.binding && !full.binding.use_template && <p className="mt-1"><b>Binding decision:</b> {[...full.binding.remove.map((w) => `remove "${w}"`), ...full.binding.change.map((c) => `change "${c.from}" to "${c.to}"`), ...full.binding.include.map((w) => `include "${w}"`)].join("; ")}</p>}
      <p className="mt-1 text-slate">Privacy: {describeMasked(stamp.masked)}</p>
      {voice && <p className="text-slate">Voice: {voice}</p>}
      {stamp.rounds > 0 && <p className="text-slate">Criteria checked: {criteriaFor(e.type === "nudge_sent" ? "reminder" : e.type === "merchant_alerted" ? "alert" : e.type === "case_summary_written" ? "case_summary" : "intake").length}</p>}
    </div>
  );
}
