import { pop, rise, scene } from "../../components/pakka";

// A customer's question on the left; each personal value is swapped for a typed token before the model sees it.
const parts: [string, string, string][] = [
	["9876543210", "&lt;PHONE_1&gt;", "Phone"],
	["rahul.m@upi", "&lt;UPI_1&gt;", "UPI ID"],
	["482913", "&lt;SECRET_1&gt;", "OTP"],
];
const val = (i: number) => `<span data-ref="raw${i}" style="display:inline-block;background:var(--red-wash);color:var(--red);border-radius:10px;padding:0 10px;line-height:1.4">${parts[i][0]}</span>`;

/** Fades a value out, puts its token in its place, and fades that in. */
function swap(el: HTMLElement, token: string, delay: number) {
	el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, delay, fill: "forwards" });
	setTimeout(() => {
		el.innerHTML = token;
		el.className = "pk-mono";
		Object.assign(el.style, { background: "var(--navy-wash)", color: "var(--navy)", fontSize: ".8em" });
		el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, fill: "forwards" });
	}, delay + 380);
}
const vault = parts
	.map(([raw, tok, label], i) => `<div class="h" data-ref="v${i}" style="display:flex;justify-content:space-between;gap:20px;font-size:32px;padding:14px 0;border-top:1px solid var(--line)">
		<span class="pk-mono" style="color:var(--navy);font-size:28px">${tok}</span>
		<span style="color:var(--slate)">${label}</span>
		<span data-ref="vv${i}" style="font-weight:700;color:var(--ink)">${raw}</span></div>`)
	.join("");

export default scene({
	id: "pakka2-privacy",
	chapter: "Privacy",
	html: `
	<div style="position:absolute;inset:150px var(--safe-x) 70px;display:grid;grid-template-columns:1.15fr .85fr;gap:60px;align-items:center">
		<div style="display:flex;flex-direction:column;gap:34px">
			<div class="pk-title h" data-ref="t" style="margin:0">Model ko sirf tokens dikhte hain</div>
			<div class="pk-card h" data-ref="q" style="font-size:42px;line-height:1.75;border-radius:28px 28px 28px 6px">
				<div style="font-size:26px;color:var(--slate);margin-bottom:6px">Pakka se poochho</div>
				Rahul here, mera number ${val(0)}. UPI ${val(1)} se ₹299 kata, OTP ${val(2)} bhi aaya tha. Kyun?
			</div>
			<div class="h" data-ref="m" style="display:flex;align-items:center;gap:24px">
				<span class="pk-chip" style="padding:16px 30px;font-size:36px">AI model</span>
				<span style="font-size:34px;color:var(--slate)">sees <b style="color:var(--navy)">&lt;PHONE_1&gt;</b>, never the number</span>
			</div>
		</div>
		<div style="display:flex;flex-direction:column;gap:26px">
			<div class="pk-card h" data-ref="vault">
				<div style="display:flex;align-items:center;gap:14px;font-size:38px;font-weight:800;color:var(--navy);margin-bottom:8px">
					<span style="width:40px;height:40px;border-radius:10px;background:var(--navy);display:inline-block"></span>Pakka ka vault
				</div>
				<div style="font-size:28px;color:var(--slate);margin-bottom:10px">Asli values sirf hamare server par</div>
				${vault}
			</div>
			<div class="pk-card h" data-ref="fail" style="background:var(--amber-wash);border-color:transparent">
				<div style="font-size:38px;font-weight:800;color:var(--amber)">Masking fail?</div>
				<div style="font-size:34px;color:var(--ink)">Model ko kuch bhi nahi bheja jaata. Template use hota hai.</div>
			</div>
		</div>
	</div>`,
	steps: [
		(q) => {
			rise(q("t"));
			rise(q("q"), 300);
		},
		(q) => {
			parts.forEach((p, i) => swap(q(`raw${i}`), p[1], 500 + i * 600));
			rise(q("m"), 2200);
			rise(q("vault"), 3000);
			parts.forEach((_, i) => rise(q(`v${i}`), 3300 + i * 200));
		},
		(q) => {
			const otp = q("vv2");
			otp.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" });
			setTimeout(() => {
				otp.textContent = "••••";
				otp.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: "forwards" });
			}, 350);
			pop(q("fail"), 2400);
		},
	],
});
