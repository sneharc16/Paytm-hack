import { fade, pop, rise, scene } from "../../components/pakka";

const debits = [
	["StreamKaro", "299", "Trial khatam, poora charge"],
	["FitGhar", "499", "Teen mahine se use nahi kiya"],
	["PadhoAI", "799", "Bachche ki class band ho gayi"],
	["StadiumPass", "1,199", "Season khatam"],
];
const cards = debits
	.map(([who, amt, why], i) => `
	<div class="pk-card h" data-ref="d${i}" style="display:flex;align-items:center;gap:28px;padding:28px 34px">
		<div style="width:64px;height:64px;border-radius:16px;background:var(--navy-wash);display:grid;place-items:center;font-weight:800;color:var(--navy);font-size:32px">${who[0]}</div>
		<div style="flex:1"><div style="font-weight:700;font-size:36px">₹${amt} debited</div><div style="color:var(--slate);font-size:28px">AutoPay, ${who}</div></div>
		<span class="pk-tag red h" data-ref="w${i}">${why}</span>
	</div>`)
	.join("");

export default scene({
	id: "pakka-cold-open",
	html: `
	<div data-ref="a" style="position:absolute;inset:0;display:grid;grid-template-columns:760px 1fr;gap:80px;align-items:center;padding:0 var(--safe-x)">
		<div>
			<div class="pk-kicker h" data-ref="k">Har mahine</div>
			<div class="pk-title h" data-ref="t" style="font-size:96px">Lakhon AutoPay, apne aap katte hain.</div>
		</div>
		<div style="display:flex;flex-direction:column;gap:22px">${cards}</div>
	</div>
	<div data-ref="b" class="h" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
		<div class="pk-mark" style="font-size:150px"><i data-ref="logo"></i>Pakka</div>
		<div data-ref="tag" class="h" style="margin-top:40px;font-size:56px;color:var(--ink)">Paisa katne se pehle, aapse poochta hai.</div>
	</div>`,
	steps: [
		(q) => {
			rise(q("k"));
			rise(q("t"), 150);
			for (let i = 0; i < 4; i++) rise(q(`d${i}`), 500 + i * 450);
		},
		(q) => {
			for (let i = 0; i < 4; i++) pop(q(`w${i}`), i * 350);
		},
		(q) => {
			fade(q("a"), 0, 0, 450);
			fade(q("b"), 1, 450, 10);
			pop(q("b"), 450);
			rise(q("tag"), 1100);
		},
	],
});
