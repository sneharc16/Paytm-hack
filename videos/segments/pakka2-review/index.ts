import { grow, pop, rise, scene } from "../../components/pakka";

// Writer, reviewer and consolidator in a row, the 11 rubric criteria, the code-check lock, and the template fallback.
const agents = [
	["Writer", "Draft likhta hai", "Main model"],
	["Reviewer", "11 rules par jaanchta hai", "Alag, fast model"],
	["Consolidator", "Round 5 ke baad faisla lagu", "Reviewer ki baat final"],
];
const agentCards = agents
	.map(([name, what, model], i) => `<div class="pk-card h" data-ref="a${i}" style="flex:1;padding:30px 34px">
		<span class="pk-tag navy">${i + 1}</span>
		<div style="font-size:48px;font-weight:800;color:var(--navy);margin-top:10px">${name}</div>
		<div style="font-size:32px;color:var(--ink)">${what}</div>
		<div style="font-size:26px;color:var(--slate);margin-top:6px">${model}</div></div>`)
	.join(`<div style="align-self:center;width:46px;height:3px;background:var(--line-strong)"></div>`);

const rules = ["Facts only", "Zaroori baatein", "Sahi actions", "Paisa decide nahi", "Koi push nahi", "Sahi script", "Length", "Chhote sentences", "Privacy", "Safety, 1930", "AI disclosure"];
const chips = rules
	.map((r, i) => `<div class="pk-chip h" data-ref="r${i}" style="padding:12px 20px;font-size:28px;gap:10px;justify-content:flex-start">
		<b style="color:var(--slate);font-weight:600">R${i + 1}</b>${r}</div>`)
	.join("");

export default scene({
	id: "pakka2-review",
	chapter: "Teen agents",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 70px;display:flex;flex-direction:column;gap:38px">
		<div class="pk-title h" data-ref="t" style="margin:0">Har AI message, teen agents</div>
		<div style="display:flex;gap:18px">${agentCards}</div>
		<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:14px">${chips}</div>
		<div style="display:flex;gap:26px">
			<div class="pk-card h" data-ref="code" style="flex:1.2;display:flex;align-items:center;gap:24px;padding:24px 32px">
				<span style="flex:none;width:56px;height:56px;border-radius:14px;background:var(--navy)"></span>
				<div><div style="font-size:36px;font-weight:800;color:var(--navy)">Code checks pehle</div>
				<div style="font-size:30px;color:var(--slate)">Code ne fail kiya, to reviewer pass nahi kar sakta</div></div>
			</div>
			<div class="pk-card h" data-ref="tpl" style="flex:1;padding:24px 32px;background:var(--amber-wash);border-color:transparent">
				<div style="font-size:36px;font-weight:800;color:var(--amber)">Phir bhi fail?</div>
				<div style="font-size:30px;color:var(--ink)">Haath se likha template jaata hai</div>
			</div>
		</div>
		<div style="height:6px;background:var(--line);border-radius:6px;overflow:hidden" class="h" data-ref="barw">
			<div data-ref="bar" style="height:100%;background:var(--cyan);transform-origin:left;transform:scaleX(0)"></div>
		</div>
	</div>`,
	steps: [
		(q) => {
			rise(q("t"));
			for (let i = 0; i < 3; i++) rise(q(`a${i}`), 400 + i * 350);
		},
		(q) => {
			q("a1").animate([{ borderColor: "var(--line)" }, { borderColor: "var(--navy)" }], { duration: 500, fill: "forwards" });
			rules.forEach((_, i) => pop(q(`r${i}`), 300 + i * 260));
		},
		(q) => {
			rise(q("code"));
		},
		(q) => {
			rise(q("barw"));
			grow(q("bar"), 200, 2600);
			q("a2").animate([{ borderColor: "var(--line)" }, { borderColor: "var(--navy)" }], { duration: 500, delay: 1800, fill: "forwards" });
			pop(q("tpl"), 3200);
		},
	],
});
