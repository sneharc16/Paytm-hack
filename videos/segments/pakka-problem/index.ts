import { rise, scene } from "../../components/pakka";

const card = (i: number, tag: string, tone: string, title: string, body: string) => `
	<div class="pk-card h" data-ref="c${i}">
		<span class="pk-tag ${tone}">${tag}</span>
		<div style="font-size:46px;font-weight:700;color:var(--navy);margin:18px 0 8px;line-height:1.15">${title}</div>
		<div style="color:var(--slate);font-size:34px">${body}</div>
	</div>`;

export default scene({
	id: "pakka-problem",
	chapter: "Problem",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 80px;display:flex;flex-direction:column">
		<div class="pk-title h" data-ref="t">AutoPay lagana aasaan, rokna mushkil.</div>
		<div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:32px">
			${card(0, "Trial", "amber", "₹2 ka trial, phir ₹299", "Trial khatam hote hi poora charge, bina pooche.")}
			${card(1, "Reminder", "amber", "Galat bhasha, galat samay", "Reminder aata bhi hai, to English mein, raat ke do baje.")}
			${card(2, "Refund", "red", "Hafton ki bhaag daud", "Paisa kat gaya, ab support ke chakkar.")}
			${card(3, "Merchant", "navy", "Merchant ka bhi nuksaan", "Failed retries, complaints, aur toota hua bharosa.")}
		</div>
	</div>`,
	steps: [
		(q) => { rise(q("t")); rise(q("c0"), 400); },
		(q) => rise(q("c1")),
		(q) => rise(q("c2")),
		(q) => rise(q("c3")),
	],
});
