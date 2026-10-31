import { focus, frame, pop, rise, scene, showShot, split } from "../../components/pakka";
import s33 from "../../assets/shots/33-python-agents-send-a-phishing-invoice-guard-holds-.png";
import s34 from "../../assets/shots/34-maker-sees-bank-changes-the-phishing-emails-asked-.png";
import s35 from "../../assets/shots/35-maker-calls-the-number-on-file-vendor-never-asked.png";
import s38 from "../../assets/shots/38-real-invoice-from-the-phishing-email-waits-for-a-c.png";
import s30 from "../../assets/shots/30-red-team-attacks-on-a-copy-of-the-real-ledger.png";

export default scene({
	id: "pakka-phishing",
	chapter: "Phishing ka hamla",
	html: split({
		kicker: "Ek nakli email, naye bank details",
		title: "Guard ne wahin roka.",
		points: [
			"Invoice aaya, guard ne payout roka",
			"Bank details ek change request bane",
			"Maker ne file wale number par call kiya",
			"Asli invoice, asli account, checker ki passkey ke baad",
			"Red team: 12 attacks, <b>0 paar</b>",
		],
		right: frame([s33, s34, s35, s38, s30], "business.pakka.local"),
		extra: `<div class="pk-callout" data-ref="never" style="right:30px;bottom:-30px"><small>Vendor ne kaha</small>"Humne kabhi nahi maanga"</div>`,
	}),
	steps: [
		(q) => { rise(q("k")); rise(q("t"), 120); rise(q("p0"), 300); showShot(q, 0, 200); },
		(q) => { focus(q, 1); showShot(q, 1); },
		(q) => { focus(q, 2); showShot(q, 2); pop(q("never"), 1500); },
		(q) => { focus(q, 3); showShot(q, 3); q("never").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }); },
		(q) => { focus(q, 4); showShot(q, 4); },
	],
});
