import { focus, phone, pop, rise, scene, showShot, split } from "../../components/pakka";
import s12 from "../../assets/shots/12-sign-up-with-a-passkey.png";
import s13 from "../../assets/shots/13-paste-a-bank-sms-and-let-pakka-read-it.png";

export default scene({
	id: "pakka-live",
	chapter: "Live",
	html: split({
		kicker: "Asli log, asli AutoPay",
		title: "Ye sab live chalta hai.",
		points: [
			"Passkey se sign up, koi password nahi",
			"Bank ka SMS paste karo, Pakka AutoPay pehchaan leta hai",
			"Sirf paisa simulated hai, baaki sab asli",
		],
		right: phone([s12, s13]),
		extra: `<div class="pk-callout" data-ref="sim" style="left:-20px;bottom:120px;max-width:500px">
			<small>Simulated</small>Sirf paisa
			<div style="margin-top:10px"><span class="pk-tag green">Asli</span> log, passkeys, reminders</div>
		</div>`,
	}),
	steps: [
		(q) => { rise(q("k")); rise(q("t"), 120); rise(q("p0"), 300); showShot(q, 0, 200); },
		(q) => { focus(q, 1); showShot(q, 1); },
		(q) => { focus(q, 2); pop(q("sim"), 300); },
	],
});
