import { countUp, pop, rise, scene } from "../../components/pakka";

const hello = ["नमस्ते", "Namaste", "வணக்கம்", "নমস্কার", "नमस्कार", "నమస్కారం", "ನಮಸ್ಕಾರ", "നമസ്കാരം", "નમસ્તે", "ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "ନମସ୍କାର", "Hello"];
const tiles = hello.map((h, i) => `<div class="pk-chip h" data-ref="h${i}" style="height:96px;font-size:36px;font-weight:600">${h}</div>`).join("");
const step = (i: number, title: string, body: string, tone: string) => `
	<div class="pk-card h" data-ref="s${i}" style="flex:1"><span class="pk-tag ${tone}">${i + 1}</span>
	<div style="font-size:40px;font-weight:700;color:var(--navy);margin-top:10px">${title}</div><div style="color:var(--slate);font-size:30px">${body}</div></div>`;

export default scene({
	id: "pakka-languages",
	chapter: "Aapki bhasha",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 80px;display:grid;grid-template-columns:520px 1fr;gap:70px;align-items:center">
		<div>
			<div class="pk-big h" data-ref="n" style="font-size:240px"><span data-ref="num">0</span></div>
			<div class="pk-title h" data-ref="t" style="margin-top:10px">Bhartiya bhashayein</div>
		</div>
		<div style="display:flex;flex-direction:column;gap:30px">
			<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px">${tiles}</div>
			<div style="display:flex;gap:22px">
				${step(0, "Sarvam likhta hai", "Har reminder live, aapki bhasha mein", "navy")}
				${step(1, "Facts se check", "Har line asli data se milaayi jaati hai", "green")}
				${step(2, "Fail? Template", "Check fail ho to likha hua template", "amber")}
			</div>
			<div class="h" data-ref="f" style="display:flex;gap:20px;align-items:center;font-size:38px;font-weight:700;color:var(--navy)">
				AI kabhi paise ka faisla nahi karta.
				<span class="pk-chip" style="padding:10px 26px;font-size:32px;margin-left:auto">Sunein</span>
			</div>
		</div>
	</div>`,
	steps: [
		(q, ctx) => {
			rise(q("n"));
			rise(q("t"), 200);
			void countUp(q("num"), 24, 1400, ctx, (n) => String(Math.round(n)));
			for (let i = 0; i < hello.length; i++) pop(q(`h${i}`), 300 + i * 160);
		},
		(q) => { rise(q("s0")); rise(q("s1"), 1800); },
		(q) => { rise(q("s2")); rise(q("f"), 1800); },
	],
});
