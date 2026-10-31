import { countUp, frame, inr, pop, rise, scene, showShot } from "../../components/pakka";
import s04 from "../../assets/shots/04-merchant-console.png";
import s06 from "../../assets/shots/06-ops-review-radar.png";

const stat = (i: number, label: string, tone: string, body: string) => `
	<div class="pk-card h" data-ref="c${i}" style="padding:26px 34px">
		<div class="pk-big" style="font-size:84px;color:var(--${tone})"><span data-ref="v${i}">0</span></div>
		<div style="color:var(--slate);font-size:32px;margin-top:6px">${label}</div>${body}
	</div>`;

export default scene({
	id: "pakka-merchant",
	chapter: "Merchant ki taraf",
	html: `
	<div class="pk-split" style="grid-template-columns:660px 1fr">
		<div style="display:flex;flex-direction:column;gap:22px">
			${stat(0, "Anchahe charges roke", "green", "")}
			${stat(1, "Phir bhi merchant ke liye collect", "navy", "")}
			${stat(2, "Mandates check hue", "navy", `<div class="h" data-ref="chose" style="font-size:34px;margin-top:6px"><b style="color:var(--navy)">318</b> logon ne khud chuna</div>`)}
		</div>
		<div style="position:relative">
			${frame([s04, s06], "merchant.pakka.local")}
			<div class="pk-callout" data-ref="radar" style="right:30px;bottom:-40px;max-width:600px">
				<small>Review Radar, INC-07</small><b>46 complaints</b>, PadhoAI ne chalu kiya: <b>Haan ke baad hi charge</b>
			</div>
		</div>
	</div>`,
	steps: [
		(q, ctx) => { rise(q("c0")); showShot(q, 0, 200); void countUp(q("v0"), 159334, 1800, ctx, (n) => `₹${inr(n)}`); },
		(q, ctx) => { rise(q("c1")); void countUp(q("v1"), 55016, 1500, ctx, (n) => `₹${inr(n)}`); },
		(q, ctx) => { rise(q("c2")); void countUp(q("v2"), 1300, 1200, ctx, inr); rise(q("chose"), 1700); },
		(q) => { showShot(q, 1); pop(q("radar"), 700); },
	],
});

