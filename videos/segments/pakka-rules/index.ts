import { grow, pop, rise, scene } from "../../components/pakka";

// A day from 6 AM to midnight across 1680px: 18 hours, so 1 hour is 1680 / 18 px.
const H = 1680 / 18;
const x = (h: number) => (h - 6) * H;
const ticks = [6, 9, 12, 15, 18, 21, 24]
	.map((h) => `<div style="position:absolute;left:${x(h)}px;top:150px;transform:translateX(-50%);color:var(--slate);font-size:28px;white-space:nowrap">${h === 24 ? "12 AM" : h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`}</div>`)
	.join("");
const quiet = (from: number, to: number, ref: string, label: string) =>
	`<div class="h" data-ref="${ref}" style="position:absolute;left:${x(from)}px;width:${(to - from) * H}px;top:0;height:120px;border-radius:14px;background:var(--red-wash);border:1px solid #E8B9B9;display:grid;place-items:center;color:var(--red);font-weight:700;font-size:30px;text-align:center;line-height:1.1">${label}</div>`;
const attempts = [8.5, 14, 21.75, 22.5]
	.map((h, i) => `<div class="h" data-ref="a${i}" style="position:absolute;left:${x(h)}px;top:40px;width:40px;height:40px;margin-left:-20px;border-radius:50%;background:var(--surface);border:3px solid var(--navy);display:grid;place-items:center;font-size:22px;font-weight:700;color:var(--navy)">${i + 1}</div>`)
	.join("");

export default scene({
	id: "pakka-rules",
	chapter: "Samay ke niyam",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 80px;display:flex;flex-direction:column;justify-content:center">
		<div class="pk-title h" data-ref="t">Galat samay par koi charge nahi.</div>
		<div style="position:relative;height:220px;margin-top:40px">
			<div class="h" data-ref="bar" style="position:absolute;left:0;width:1680px;top:58px;height:4px;background:var(--line-strong);transform-origin:left"></div>
			${quiet(10, 13, "q0", "10 AM se 1 PM<br>charge nahi")}
			${quiet(17, 21.5, "q1", "5 PM se 9:30 PM<br>charge nahi")}
			${attempts}
			${ticks}
		</div>
		<div style="display:flex;gap:28px;margin-top:70px">
			<div class="pk-card h" data-ref="c0" style="flex:1"><div class="pk-big" style="font-size:96px">4</div><div style="color:var(--slate)">Ek cycle mein zyada se zyada attempts</div></div>
			<div class="pk-card h" data-ref="c1" style="flex:1.3"><div style="font-size:30px;color:var(--slate)">Rahul ka retry</div><div style="font-size:48px;font-weight:700;color:var(--navy)">Aaj 9:30 PM ke baad</div><span class="pk-tag navy pk-mono" style="font-size:24px">RETRY_SCHEDULE_V1</span></div>
			<div class="pk-card h" data-ref="c2" style="flex:1.3"><div style="font-size:30px;color:var(--slate)">Har faisle ke saath</div><div style="font-size:48px;font-weight:700;color:var(--navy)">Ek rule ID</div><span class="pk-tag green pk-mono" style="font-size:24px">PERSON_DECISION_V1</span></div>
		</div>
	</div>`,
	steps: [
		(q) => {
			rise(q("t"));
			q("bar").style.opacity = "1";
			grow(q("bar"), 200, 1200);
			pop(q("q0"), 1200);
			pop(q("q1"), 1700);
		},
		(q) => {
			for (let i = 0; i < 4; i++) pop(q(`a${i}`), i * 400);
			rise(q("c0"), 600);
			rise(q("c1"), 1600);
		},
		(q) => rise(q("c2")),
	],
});
