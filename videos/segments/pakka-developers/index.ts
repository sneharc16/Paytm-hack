import { focus, frame, pop, rise, scene, showShot, split } from "../../components/pakka";
import s23 from "../../assets/shots/23-sign-with-a-passkey-the-api-key-is-shown-once.png";
import s29 from "../../assets/shots/29-audit-export.png";

const code = `<span style="color:var(--slate)"># pip install requests cryptography</span>
<b>from</b> pakka_business <b>import</b> PakkaAgent

agent = PakkaAgent.from_env()
inv = agent.submit_invoice("INV-2041", "v_1",
        "PO-2041", gstin, lines, gst)
p = agent.propose(inv["invoiceId"])
agent.attest(p["intentHash"], "approve",
        ["Three way match ok"])`;

export default scene({
	id: "pakka-developers",
	chapter: "Developers",
	html: split({
		kicker: "Python SDK",
		title: "Kuch lines, aur agent taiyaar.",
		points: [
			"Passkey se sign karo, API key sirf ek baar dikhti hai",
			"Har request agent ki apni key se signed",
			"Webhooks verified, poora audit trail",
		],
		right: frame([s23, s29], "business.pakka.local"),
		extra: `<pre class="pk-card pk-mono h" data-ref="code" style="position:absolute;left:-40px;right:60px;bottom:-30px;margin:0;font-size:25px;line-height:1.5;color:var(--ink);box-shadow:0 18px 50px rgba(0,46,110,.16);white-space:pre">${code}</pre>`,
	}),
	steps: [
		(q) => { rise(q("k")); rise(q("t"), 120); rise(q("p0"), 300); showShot(q, 0, 200); },
		(q) => { focus(q, 1); pop(q("code"), 200); },
		(q) => {
			focus(q, 2);
			q("code").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" });
			showShot(q, 1, 200);
		},
	],
});
