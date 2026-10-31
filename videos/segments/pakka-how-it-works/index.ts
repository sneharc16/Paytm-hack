import { pop, rise, scene } from "../../components/pakka";

const options = [
	["Chalne do", "Plan chalu rahega", "navy", "Koi PIN nahi"],
	["Is mahine skip", "Sirf is baar nahi katega", "green", "Koi PIN nahi"],
	["Pause karo", "Jab tak aap na kahein", "amber", "Passkey"],
	["Band karo", "AutoPay cancel", "red", "Passkey"],
];
const chips = options
	.map(([label, sub, tone, lock], i) => `
	<div class="h" data-ref="o${i}" style="display:flex;flex-direction:column;gap:14px;align-items:stretch">
		<div class="pk-chip" style="flex-direction:column;align-items:flex-start;padding:30px 32px;height:180px">
			<div style="display:flex;gap:16px;align-items:center;font-size:38px"><span style="width:30px;height:30px;border-radius:50%;border:2px solid var(--line-strong)"></span>${label}</div>
			<div style="font-weight:400;color:var(--slate);font-size:28px;margin-left:46px">${sub}</div>
		</div>
		<span class="pk-tag ${tone} h" data-ref="l${i}" style="align-self:flex-start">${lock}</span>
	</div>`)
	.join("");
const flow = ["Aapka faisla", "Rule ID", "Gateway", "Ledger"]
	.map((s, i) => `<div class="pk-chip h" data-ref="f${i}" style="padding:18px 34px;font-size:36px">${s}</div>${i < 3 ? `<div class="h" data-ref="g${i}" style="flex:1;height:2px;background:var(--line-strong)"></div>` : ""}`)
	.join("");

export default scene({
	id: "pakka-how-it-works",
	chapter: "Kaise kaam karta hai",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 80px;display:flex;flex-direction:column;justify-content:center;gap:56px">
		<div class="pk-card h" data-ref="r" style="display:flex;gap:30px;align-items:center;border-radius:var(--r-sheet)">
			<span class="pk-mark" style="font-size:34px"><i></i></span>
			<div style="flex:1">
				<div style="font-size:56px;font-weight:700;color:var(--navy)">Kal ₹299 StreamKaro ko jaayenge.</div>
				<div style="color:var(--slate);font-size:30px">Aapki bhasha mein, charge se pehle. Kya karna hai?</div>
			</div>
			<span class="pk-tag navy">Hinglish</span>
		</div>
		<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px">${chips}</div>
		<div class="h" data-ref="flowwrap" style="margin-top:24px">
			<div style="display:flex;align-items:center;gap:18px">${flow}</div>
			<div class="h" data-ref="nr" style="margin-top:26px;font-size:40px;font-weight:700;color:var(--navy)">Bina rule ke, ek rupaya bhi nahi hilta.</div>
		</div>
	</div>`,
	steps: [
		(q) => rise(q("r")),
		(q) => { for (let i = 0; i < 4; i++) rise(q(`o${i}`), i * 120); },
		(q) => { for (let i = 0; i < 4; i++) pop(q(`l${i}`), i * 250); },
		(q) => {
			rise(q("flowwrap"));
			for (let i = 0; i < 4; i++) {
				pop(q(`f${i}`), 200 + i * 450);
				if (i < 3) rise(q(`g${i}`), 400 + i * 450);
			}
			rise(q("nr"), 2200);
		},
	],
});
