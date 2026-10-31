import { countUp, pop, rise, scene } from "../../components/pakka";

const stats = [
	[206, "Unit tests"],
	[24, "Python SDK tests"],
	[39, "Screenshot tour steps"],
];
const cards = stats
	.map(([, label], i) => `<div class="pk-card h" data-ref="c${i}" style="flex:1;text-align:center;padding:44px 20px">
		<div class="pk-big" style="font-size:150px"><span data-ref="v${i}">0</span></div>
		<div style="color:var(--slate);font-size:36px;margin-top:10px">${label}</div>
		<span class="pk-tag green" style="margin-top:16px">Pass</span></div>`)
	.join("");

export default scene({
	id: "pakka-proof",
	chapter: "Saboot",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 80px;display:flex;flex-direction:column;justify-content:center;gap:80px">
		<div style="display:flex;gap:32px">${cards}</div>
		<div class="h" data-ref="z" style="display:flex;align-items:center;justify-content:center;gap:30px">
			<span class="pk-big" style="font-size:150px;color:var(--green)">₹0</span>
			<span style="font-size:56px;font-weight:700;color:var(--navy);line-height:1.15">bina rule ke hila.<br><span style="font-weight:400;color:var(--slate);font-size:40px">Har move par ek rule ID.</span></span>
		</div>
	</div>`,
	steps: [
		(q, ctx) => {
			stats.forEach(([n], i) => {
				rise(q(`c${i}`), i * 250);
				void countUp(q(`v${i}`), n as number, 1400, ctx, (x) => String(Math.round(x)));
			});
		},
		(q) => pop(q("z")),
	],
});
