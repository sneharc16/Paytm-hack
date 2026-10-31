import { focus, frame, pop, rise, scene, showShot, split } from "../../components/pakka";
import s25 from "../../assets/shots/25-governor-signs-in-with-a-passkey-overview.png";
import s37 from "../../assets/shots/37-checker-approves-with-a-passkey-guard-releases-the.png";

const layers = ["3 agent signatures", "Logon ki passkeys", "28 guard checks"]
	.map((s, i) => `<span class="pk-tag navy h" data-ref="y${i}" style="font-size:30px;padding:8px 22px">${s}</span>`)
	.join(" ");

export default scene({
	id: "pakka-business",
	chapter: "Pakka for Business",
	html: split({
		kicker: "Vendor payouts, AI agents ke saath",
		title: "Agent paisa nahi hila sakte.",
		points: [
			"Companies apne payouts AI agents se chalati hain",
			"Agent sirf propose kar sakta hai",
			`Har payout par teen parat<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">${layers}</div>`,
			"₹50,000 se upar: <b>checker ki passkey</b> zaroori",
		],
		right: frame([s25, s37], "business.pakka.local"),
	}),
	steps: [
		(q) => { rise(q("k")); rise(q("t"), 120); rise(q("p0"), 300); showShot(q, 0, 200); },
		(q) => focus(q, 1),
		(q) => { focus(q, 2); for (let i = 0; i < 3; i++) pop(q(`y${i}`), 600 + i * 700); },
		(q) => { focus(q, 3); showShot(q, 1, 300); },
	],
});
