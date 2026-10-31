// Shared building blocks for the Pakka explainer: a scene factory that turns one script line into one visual step,
// the common page chrome, a framed screenshot window, and a few WAAPI motions.
import { defineSegment, type PlayerContext } from "videowright";
import "./pakka.css";
import { SCRIPT as V1 } from "../videos/pakka_explainer/script";
import { NEW_SCRIPT as V2 } from "../videos/pakka_explainer_v2/script";

// Scene ids are unique across videos, so one lookup serves both explainers.
const SCRIPT: Record<string, string[]> = { ...V1, ...V2 };

export type Q = (ref: string) => HTMLElement;
export type Step = (q: Q, ctx: PlayerContext) => void | Promise<void>;

/** A segment whose steps line up one to one with its script lines: step 0 plays on entry, step i after advance i. */
export function scene(o: { id: string; chapter?: string; html: string; steps: Step[] }) {
	const lines = SCRIPT[o.id];
	if (!lines) throw new Error(`No script for ${o.id}`);
	if (lines.length !== o.steps.length) throw new Error(`${o.id}: ${o.steps.length} steps for ${lines.length} lines`);
	let host: HTMLElement | null = null;
	// After unmount a late step gets a detached element, so it cannot throw into the next segment.
	const q: Q = (ref) => {
		if (!host) return document.createElement("div");
		const el = host.querySelector(`[data-ref="${ref}"]`);
		if (!el) throw new Error(`${o.id}: no element ${ref}`);
		return el as HTMLElement;
	};
	return defineSegment({
		id: o.id,
		advances: lines.map((_, i) => (i + 1) * 6),
		voiceover: lines.join(" "),
		mount(el) {
			host = el;
			const top = o.chapter
				? `<div class="pk-top"><span class="pk-mark"><i></i>Pakka</span><span class="pk-chapter">${o.chapter}</span></div>`
				: "";
			el.innerHTML = `<div class="pk-scene">${top}${o.html}</div>`;
		},
		async play(ctx) {
			for (let i = 0; i < o.steps.length; i++) {
				if (i > 0) await ctx.waitForNext();
				if (ctx.signal.aborted) return;
				void o.steps[i](q, ctx);
			}
			await ctx.waitForNext();
		},
		unmount() {
			host = null;
		},
	});
}

const EASE = "cubic-bezier(.2,.8,.2,1)";

export function rise(el: HTMLElement, delay = 0, duration = 650) {
	el.animate([{ opacity: 0, transform: "translateY(28px)" }, { opacity: 1, transform: "translateY(0)" }], {
		duration, delay, easing: EASE, fill: "both",
	});
}

export function pop(el: HTMLElement, delay = 0) {
	el.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)" }], {
		duration: 500, delay, easing: EASE, fill: "both",
	});
}

export function fade(el: HTMLElement, to: 0 | 1, delay = 0, duration = 500) {
	el.animate([{ opacity: to ? 0 : 1 }, { opacity: to }], { duration, delay, easing: EASE, fill: "both" });
}

/** Grows a bar or underline from the left. */
export function grow(el: HTMLElement, delay = 0, duration = 900) {
	el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration, delay, easing: EASE, fill: "both" });
}

export function rise_all(els: HTMLElement[], delay = 0, stagger = 120) {
	els.forEach((el, i) => rise(el, delay + i * stagger));
}

/** Indian digit grouping: 159334 is 1,59,334. */
export function inr(n: number) {
	const s = String(Math.round(n));
	if (s.length <= 3) return s;
	const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
	return `${head},${s.slice(-3)}`;
}

/** Counts a number up on the virtual clock. */
export async function countUp(el: HTMLElement, to: number, ms: number, ctx: PlayerContext, fmt: (n: number) => string = inr) {
	const frames = Math.max(1, Math.round(ms / 33));
	for (let i = 1; i <= frames; i++) {
		if (ctx.signal.aborted) return;
		el.textContent = fmt(to * (1 - (1 - i / frames) ** 3));
		await ctx.hold(33);
	}
	el.textContent = fmt(to);
}

/** A browser-like window holding stacked screenshots; `showShot` crossfades to one of them. */
export function frame(shots: string[], url = "pakka.local") {
	const imgs = shots.map((src, i) => `<img data-ref="shot${i}" src="${src}" style="opacity:0" alt="">`).join("");
	return `<div class="pk-frame" data-ref="frame"><div class="pk-chrome"><b></b><b></b><b></b><span>${url}</span></div><div class="pk-shots">${imgs}</div></div>`;
}

export function showShot(q: Q, i: number, delay = 0) {
	fade(q(`shot${i}`), 1, delay, 600);
}

/** Pans a tall-ish screenshot slightly so a still image breathes. */
export function drift(el: HTMLElement, duration = 9000) {
	el.animate([{ transform: "scale(1.0)" }, { transform: "scale(1.04)" }], { duration, easing: "linear", fill: "both" });
}

/** A phone-sized crop of the consumer app screenshots, stacked for crossfades like `frame`. */
export function phone(shots: string[]) {
	const imgs = shots.map((src, i) => `<img data-ref="shot${i}" src="${src}" style="opacity:0" alt="">`).join("");
	return `<div class="pk-phone" data-ref="frame">${imgs}</div>`;
}

/** Title and points on the left, a screenshot (or anything) on the right. Points are `p0`, `p1`, ... */
export function split(o: { kicker?: string; title: string; points: string[]; right: string; extra?: string }) {
	const pts = o.points.map((p, i) => `<div class="pk-point" data-ref="p${i}"><span>${p}</span></div>`).join("");
	return `<div class="pk-split">
		<div>
			${o.kicker ? `<div class="pk-kicker h" data-ref="k">${o.kicker}</div>` : ""}
			<div class="pk-title h" data-ref="t">${o.title}</div>
			<div class="pk-points">${pts}</div>
		</div>
		<div style="position:relative">${o.right}${o.extra ?? ""}</div>
	</div>`;
}

/** Fades the points before `i` back so the current one leads. */
export function focus(q: Q, i: number) {
	for (let j = 0; j < i; j++) q(`p${j}`).animate([{ opacity: 1 }, { opacity: 0.45 }], { duration: 400, fill: "forwards" });
	rise(q(`p${i}`), 150);
}
