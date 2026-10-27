// src/copy/lint.ts: regex pre-check for merchant offer copy (PRD 14.6), run before the L5 model.
export interface LintIssue { pattern: string; span: string; why: string; suggested_fix: string }

const RULES: { re: RegExp; pattern: string; why: string; fix: string }[] = [
  { re: /are you sure you want to lose[^.?!]*/i, pattern: "confirm_shaming", why: "Uses loss to stop someone cancelling.", fix: "Skip a month instead and keep your plan." },
  { re: /miss out[^.?!]*/i, pattern: "confirm_shaming", why: "Uses fear of missing out next to Cancel.", fix: "You can come back any time." },
  { re: /last chance|only today|abhi nahi toh kabhi nahi/i, pattern: "false_urgency", why: "Creates urgency the facts do not support.", fix: "This offer is available whenever you need it." },
  { re: /bachche ki padhai[^.?!]*/i, pattern: "confirm_shaming", why: "Uses guilt about a child's education to stop cancelling.", fix: "Is mahine skip karein, plan chalu rahega." },
  { re: /aap pachhtayenge|pachtaoge/i, pattern: "confirm_shaming", why: "Tells the customer they will regret it.", fix: "Jab chahein wapas aa sakte hain." },
  { re: /sach mein[^.?!]*(rokna|band|chhodna)[^.?!]*/i, pattern: "confirm_shaming", why: "Questions the customer's choice to make them feel guilty.", fix: "Is mahine skip karein, plan chalu rahega." },
  { re: /free(?! trial)[^.?!]*(forever|always)/i, pattern: "misleading_free", why: "Implies something is free when it is not.", fix: "State the price plainly." },
];

export const PATTERN_NAMES: Record<string, string> = {
  confirm_shaming: "Guilt or fear to stop cancelling", false_urgency: "Urgency that isn't real", trick_question: "Confusing wording",
  hidden_cost: "A cost that isn't shown", misleading_free: "Says free when it isn't", nagging: "Asking again and again",
};

export function lintOffer(text: string): LintIssue[] {
  const out: LintIssue[] = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) out.push({ pattern: r.pattern, span: m[0], why: r.why, suggested_fix: r.fix });
  }
  return out;
}
