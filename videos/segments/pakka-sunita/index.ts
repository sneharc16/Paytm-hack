import { focus, phone, pop, rise, scene, showShot, split } from "../../components/pakka";
import s15 from "../../assets/shots/15-reminder-arrives-written-live.png";
import s16 from "../../assets/shots/16-open-the-decision-sheet.png";
import s18 from "../../assets/shots/18-confirm-with-the-passkey-autopay-paused.png";

export default scene({
	id: "pakka-sunita",
	chapter: "Ek kahani",
	html: split({
		kicker: "Sunita, Lucknow",
		title: "₹2 ka trial, kal ₹299.",
		points: [
			"Charge se pehle Pakka ka reminder",
			"Chaaron options barabar, kuch pehle se chuna nahi",
			"Passkey se pakka kiya, <b>AutoPay ruk gaya</b>",
			"Bol kar bhi: <b>Is mahine skip karo</b>",
		],
		right: phone([s15, s16, s18]),
		extra: `
		<div class="pk-callout" data-ref="paid" style="left:-10px;bottom:140px"><small>Is mahine kata</small><b style="font-size:56px;color:var(--green)">₹0</b></div>
		<div class="pk-callout" data-ref="voice" style="right:-10px;bottom:60px;max-width:470px">
			<small>Sunita ne bola</small>"Is mahine skip karo"
			<div style="margin-top:12px"><span class="pk-tag green">Koi PIN nahi</span> <span class="pk-tag navy">SKIP_VIA_MERCHANT_V1</span></div>
		</div>`,
	}),
	steps: [
		(q) => { rise(q("k")); rise(q("t"), 120); rise(q("p0"), 300); showShot(q, 0, 200); },
		(q) => { focus(q, 1); showShot(q, 1); },
		(q) => { focus(q, 2); showShot(q, 2); pop(q("paid"), 800); },
		(q) => { focus(q, 3); pop(q("voice"), 300); },
	],
});
