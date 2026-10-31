import { pop, rise, scene } from "../../components/pakka";

export default scene({
	id: "pakka-outro",
	html: `
	<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
		<div class="pk-mark h" data-ref="m" style="font-size:150px"><i></i>Pakka</div>
		<div class="h" data-ref="t" style="margin-top:36px;font-size:64px;font-weight:700;color:var(--navy)">Har AutoPay, aapki marzi se.</div>
		<div class="h" data-ref="s" style="margin-top:60px;font-size:30px;color:var(--slate)">Shukriya. Awaaz: Sarvam Bulbul. Is demo mein paisa simulated hai.</div>
	</div>`,
	steps: [
		(q) => { pop(q("m")); rise(q("t"), 500); },
		(q) => rise(q("s")),
	],
});
