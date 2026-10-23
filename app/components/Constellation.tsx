"use client";

// The live constellation behind every page. Stars are the brands, artists and shows in published theses;
// lines are the theses; the nine agents ride an outer ring. When an agent acts, a pulse of light leaves its
// satellite and lands on the star it touched (window event "syzygy:pulse"). Pages can pull the camera
// toward the stars they're about (window event "syzygy:focus"). Drag turns it, the +/- buttons (or a pinch)
// zoom, and stars are picked by nearest-on-screen so they're easy to hit.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as THREE from "three";
import type { Graph, Star } from "@/lib/graph";
import { AGENTS, AGENT_LABEL, agentColor } from "@/lib/ui";
import { TYPE_HUE, type FocusEvent, type PulseEvent, type SkyFilter } from "@/lib/sky";


const hue = (t: string) => TYPE_HUE[t] ?? "#8b7cf6";
const BAND_HUE: Record<string, string> = { PITCH: "#ffb020", WATCH: "#5b6fd6" };


// ---- deterministic layout --------------------------------------------------------------------------

function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
}

/** A small 3D force layout: connected stars pull together, everything repels, flattened into a lens. */
function layout(g: Graph) {
  const n = g.stars.length, idx = new Map(g.stars.map((s, i) => [s.id, i]));
  const p = new Float32Array(n * 3);
  g.stars.forEach((s, i) => { const r = seeded(s.id); p[i * 3] = (r() - 0.5) * 30; p[i * 3 + 1] = (r() - 0.5) * 14; p[i * 3 + 2] = (r() - 0.5) * 30; });
  const links = g.arcs.map(a => [idx.get(a.a), idx.get(a.b)]).filter((x): x is [number, number] => x[0] != null && x[1] != null);
  const v = new Float32Array(n * 3);
  for (let it = 0; it < 240; it++) {
    const cool = 1 - it / 240;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz + 0.01, f = 9 / d2;
      v[i * 3] += dx * f; v[i * 3 + 1] += dy * f; v[i * 3 + 2] += dz * f;
      v[j * 3] -= dx * f; v[j * 3 + 1] -= dy * f; v[j * 3 + 2] -= dz * f;
    }
    for (const [a, b] of links) {
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01, f = (d - 5) * 0.04;
      v[a * 3] += dx / d * f; v[a * 3 + 1] += dy / d * f; v[a * 3 + 2] += dz / d * f;
      v[b * 3] -= dx / d * f; v[b * 3 + 1] -= dy / d * f; v[b * 3 + 2] -= dz / d * f;
    }
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { v[i * 3 + k] -= p[i * 3 + k] * 0.012; p[i * 3 + k] += Math.max(-2, Math.min(2, v[i * 3 + k])) * cool; v[i * 3 + k] *= 0.5; }
    }
  }
  // Fit into a lens about 36 units wide and 12 tall.
  let max = 1;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.hypot(p[i * 3], p[i * 3 + 2]));
  for (let i = 0; i < n; i++) { p[i * 3] *= 18 / max; p[i * 3 + 2] *= 18 / max; p[i * 3 + 1] = Math.max(-6, Math.min(6, p[i * 3 + 1] * 0.55)); }
  return p;
}

// ---- shaders -----------------------------------------------------------------------------------------

const STAR_VERT = /* glsl */ `
  attribute float size; attribute float phase; attribute float flare; attribute float dim;
  varying vec3 vColor; varying float vFlare; varying float vDim;
  uniform float uTime; uniform float uScale;
  void main() {
    vColor = color; vFlare = flare; vDim = dim;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.88 + 0.12 * sin(uTime * 1.3 + phase * 6.283);
    // Capped, so a big star seen up close stays a star instead of a blown-out disc.
    gl_PointSize = min(size * tw * (1.0 + flare * 0.7) * uScale / -mv.z, 90.0);
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vFlare; varying float vDim;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.32, 0.0, d);
    float halo = pow(1.0 - d, 2.6) * 0.75;
    vec3 c = mix(vColor, vec3(1.0), core * (0.55 + vFlare * 0.45));
    float a = (core + halo) * vDim * (1.0 + vFlare * 0.5);
    gl_FragColor = vec4(c * a, a);
  }`;

// ---- component ---------------------------------------------------------------------------------------

type Tip = { x: number; y: number; star: Star; touch?: boolean } | null;
type Controls = { zoom: (k: number) => void; reset: () => void };

export default function Constellation() {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const controls = useRef<Controls | null>(null);
  const onHome = usePathname() === "/";

  useEffect(() => {
    const el = host.current, labelLayer = labels.current;
    if (!el || !labelLayer) return;
    let disposed = false, raf = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = innerWidth < 760;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 1.75));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, el.clientWidth / el.clientHeight, 0.1, 400);
    // Orbit: the camera sits on a sphere around the sky; drag changes pitch (and turns the sky), zoom changes radius.
    const BASE_DIST = small ? 67 : 52, BASE_PITCH = Math.atan2(small ? 30 : 24, small ? 60 : 46);
    const orbit = { pitch: BASE_PITCH, zoom: 1, zoomTo: 1, heldUntil: 0 };
    const home = new THREE.Vector3();
    const placeHome = () => {
      const r = BASE_DIST / orbit.zoom;
      home.set(0, Math.sin(orbit.pitch) * r, Math.cos(orbit.pitch) * r);
    };
    placeHome();
    camera.position.copy(home);
    const target = new THREE.Vector3(0, 0, 0), lookAt = new THREE.Vector3();
    const world = new THREE.Group();
    // On wide screens the sky sits right of the headline, so text and stars don't fight.
    // On phones it rises above the headline instead.
    // A split card (front page) already gives the sky its own right-hand panel, so there it stays centred.
    const split = () => innerWidth >= 900 && !!el.closest(".split-sky");
    const placeWorld = () => world.position.set(split() ? 0 : innerWidth >= 900 ? 14 : 0, split() ? 0 : innerWidth >= 900 ? 3 : 15, 0);
    placeWorld();
    scene.add(world);

    // Far dust, so depth reads even where there are no stars.
    {
      const N = small ? 700 : 1600, pos = new Float32Array(N * 3), r = seeded("dust");
      for (let i = 0; i < N; i++) {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, rad = 70 + r() * 90, s = Math.sqrt(1 - u * u);
        pos.set([rad * s * Math.cos(th), rad * u * 0.6, rad * s * Math.sin(th)], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8892b0, size: 0.35, transparent: true, opacity: 0.45, depthWrite: false })));
    }

    // The agents' ring.
    const RING = 23;
    const ringGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 181 }, (_, i) => {
      const a = (i / 180) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * RING, 0, Math.sin(a) * RING);
    }));
    world.add(new THREE.Line(ringGeo, new THREE.LineBasicMaterial({ color: 0x3a4466, transparent: true, opacity: 0.55 })));
    const agentPos = new Map<string, THREE.Vector3>();
    const satGeo = new THREE.BufferGeometry();
    {
      const pos = new Float32Array(AGENTS.length * 3), col = new Float32Array(AGENTS.length * 3);
      AGENTS.forEach((a, i) => {
        const ang = (i / AGENTS.length) * Math.PI * 2 + 0.3, v = new THREE.Vector3(Math.cos(ang) * RING, 0, Math.sin(ang) * RING);
        agentPos.set(a, v); pos.set([v.x, v.y, v.z], i * 3);
        const c = new THREE.Color(agentColor(a)); col.set([c.r, c.g, c.b], i * 3);
      });
      satGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      satGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      satGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(AGENTS.length).fill(3.4), 1));
      satGeo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(AGENTS.length).map((_, i) => i / AGENTS.length), 1));
      satGeo.setAttribute("flare", new THREE.BufferAttribute(new Float32Array(AGENTS.length), 1));
      satGeo.setAttribute("dim", new THREE.BufferAttribute(new Float32Array(AGENTS.length).fill(1), 1));
    }
    const uniforms = { uTime: { value: 0 }, uScale: { value: el.clientHeight * 0.9 } };
    const starMat = new THREE.ShaderMaterial({ uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    world.add(new THREE.Points(satGeo, starMat));

    // Labels: the agents, plus the accounts once the graph arrives.
    const labelEls: { el: HTMLSpanElement; pos: THREE.Vector3; star?: number }[] = [];
    const addLabel = (text: string, pos: THREE.Vector3, cls: string, color?: string, star?: number) => {
      const s = document.createElement("span");
      s.className = cls; s.textContent = text;
      if (color) s.style.setProperty("--c", color);
      labelLayer.appendChild(s);
      labelEls.push({ el: s, pos, star });
      // Star names are links too: easier to hit than the star itself.
      if (star != null) {
        s.addEventListener("click", () => { location.href = stars[star].href; });
        s.addEventListener("pointerenter", e => { setHover(star); setTip({ x: e.clientX, y: e.clientY, star: stars[star] }); });
        s.addEventListener("pointerleave", () => { setHover(-1); setTip(null); });
      }
    };
    AGENTS.forEach(a => addLabel(AGENT_LABEL[a] ?? a, agentPos.get(a)!, "c-label c-agent", agentColor(a)));

    // Stars and arcs arrive from /api/graph.
    let stars: Star[] = [];
    const starIndex = new Map<string, number>();
    let starPos = new Float32Array(0);
    let starGeo: THREE.BufferGeometry | null = null, starPoints: THREE.Points | null = null;
    let arcGeo: THREE.BufferGeometry | null = null;
    const baseSize: number[] = [];
    let focus: Set<string> | null = null;
    // Legend filter (homepage only; a page's own focus wins). Isolated stars, the partners at the other end of their lines, the rest hidden.
    let filter: SkyFilter = null;
    let starLevel = new Float32Array(0); // 1 normal, 2 isolated, 0.5 partner, 0 hidden by the filter

    const curve = (a: THREE.Vector3, b: THREE.Vector3, lift = 0.18) => {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const ctrl = mid.clone().add(new THREE.Vector3(0, a.distanceTo(b) * lift, 0));
      return new THREE.QuadraticBezierCurve3(a, ctrl, b);
    };
    const starVec = (i: number) => new THREE.Vector3(starPos[i * 3], starPos[i * 3 + 1], starPos[i * 3 + 2]);

    function applyFocus() {
      if (!starGeo || !arcGeo) return;
      const dim = starGeo.getAttribute("dim") as THREE.BufferAttribute, size = starGeo.getAttribute("size") as THREE.BufferAttribute;
      const ac = arcGeo.getAttribute("color") as THREE.BufferAttribute, base = arcGeo.userData.base as Float32Array, ends = arcGeo.userData.ends as [string, string][];
      const bands = arcGeo.userData.bands as string[];
      const f = focus && focus.size ? null : filter;
      // Which lines the filter keeps, and from them which stars are isolated or partners.
      const arcOn = new Uint8Array(ends.length);
      starLevel = new Float32Array(stars.length).fill(f ? 0 : 1);
      if (f && "type" in f) stars.forEach((s, i) => { if (s.type === f.type) starLevel[i] = 2; });
      for (let s = 0; s < ends.length; s++) {
        if (!f) { arcOn[s] = 1; continue; }
        const ia = starIndex.get(ends[s][0])!, ib = starIndex.get(ends[s][1])!;
        arcOn[s] = "band" in f ? +(bands[s] === f.band) : +(starLevel[ia] === 2 || starLevel[ib] === 2);
        if (!arcOn[s]) continue;
        for (const j of [ia, ib]) if ("band" in f) starLevel[j] = 2; else if (starLevel[j] < 2) starLevel[j] = 0.5;
      }
      stars.forEach((s, i) => {
        if (f) { dim.setX(i, starLevel[i] === 2 ? 1 : starLevel[i] ? 0.5 : 0.08); size.setX(i, baseSize[i] * (starLevel[i] === 2 ? 1.5 : 1)); return; }
        const on = !focus || focus.has(s.id);
        dim.setX(i, on ? 1 : 0.16); size.setX(i, baseSize[i] * (focus && on ? 1.7 : 1));
      });
      dim.needsUpdate = size.needsUpdate = true;
      for (let s = 0; s < ends.length; s++) {
        const on = f ? arcOn[s] === 1 : !focus || (focus.has(ends[s][0]) && focus.has(ends[s][1]));
        const k = f ? (on ? 2 : 0.05) : !focus ? 1 : on ? 2.4 : 0.12;
        for (let v = 0; v < 2; v++) for (let c = 0; c < 3; c++) ac.array[(s * 2 + v) * 3 + c] = base[(s * 2 + v) * 3 + c] * k;
      }
      ac.needsUpdate = true;
      labelEls.forEach(l => { if (l.star != null) l.el.classList.toggle("c-dim", f ? starLevel[l.star] === 0 : !!focus && !focus.has(stars[l.star].id)); });
      labelLayer!.classList.toggle("focused", !!(focus && focus.size));
      // Camera eases toward the focused stars.
      if (focus && focus.size) {
        const c = new THREE.Vector3(); let k = 0;
        stars.forEach((s, i) => { if (focus!.has(s.id)) { c.add(starVec(i)); k++; } });
        if (k) { c.multiplyScalar(1 / k); target.copy(c); }
      } else target.set(0, 0, 0);
    }

    fetch("/api/graph").then(r => r.json() as Promise<Graph>).then(g => {
      if (disposed || !g.stars?.length) return;
      stars = g.stars;
      stars.forEach((s, i) => starIndex.set(s.id, i));
      starPos = layout(g);
      const n = stars.length, col = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n);
      stars.forEach((s, i) => {
        const c = new THREE.Color(hue(s.type)); col.set([c.r, c.g, c.b], i * 3);
        baseSize.push(size[i] = (1.7 + Math.log2(1 + s.degree) * 1.1) * (s.account ? 2.1 : 1));
        phase[i] = seeded(s.id)();
      });
      starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      starGeo.setAttribute("size", new THREE.BufferAttribute(size, 1));
      starGeo.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
      starGeo.setAttribute("flare", new THREE.BufferAttribute(new Float32Array(n), 1));
      starGeo.setAttribute("dim", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
      starPoints = new THREE.Points(starGeo, starMat);
      world.add(starPoints);

      // Arcs: each thesis as a gentle curve, PITCH warmer and brighter than WATCH.
      const SEG = 14, segs: number[] = [], cols: number[] = [], ends: [string, string][] = [], bands: string[] = [];
      for (const a of g.arcs) {
        const ia = starIndex.get(a.a), ib = starIndex.get(a.b);
        if (ia == null || ib == null) continue;
        const pts = curve(starVec(ia), starVec(ib)).getPoints(SEG);
        const c = new THREE.Color(BAND_HUE[a.band] ?? "#5b6fd6").multiplyScalar(a.band === "PITCH" ? 0.85 : 0.5);
        for (let k = 0; k < SEG; k++) {
          segs.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
          cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
          ends.push([a.a, a.b]);
          bands.push(a.band);
        }
      }
      arcGeo = new THREE.BufferGeometry();
      arcGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));
      arcGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cols), 3));
      arcGeo.userData = { base: new Float32Array(cols), ends, bands };
      world.add(new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));

      // Name the accounts: the companies the agents are working.
      stars.map((s, i) => [s, i] as const).filter(([s]) => s.account).sort((a, b) => b[0].degree - a[0].degree)
        .forEach(([s, i]) => addLabel(s.name, starVec(i), "c-label c-star", hue(s.type), i));
      applyFocus();
    }).catch(() => { /* the page still works without the sky */ });

    // ---- pulses: agent satellite → star ----
    const MAXP = 24, TRAIL = 10;
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    headGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3));
    headGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAXP), 1));
    headGeo.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(MAXP), 1));
    headGeo.setAttribute("flare", new THREE.BufferAttribute(new Float32Array(MAXP).fill(0.6), 1));
    headGeo.setAttribute("dim", new THREE.BufferAttribute(new Float32Array(MAXP).fill(1), 1));
    world.add(new THREE.Points(headGeo, starMat));
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXP * TRAIL * 6), 3));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAXP * TRAIL * 6), 3));
    world.add(new THREE.LineSegments(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    type Pulse = { curve: THREE.QuadraticBezierCurve3; t0: number; dur: number; color: THREE.Color; star: number; agent: number };
    const pulses: (Pulse | null)[] = Array(MAXP).fill(null);
    const satFlare = satGeo.getAttribute("flare") as THREE.BufferAttribute;

    const onPulse = (e: Event) => {
      const { agent, stars: ids } = (e as CustomEvent<PulseEvent>).detail;
      const from = agentPos.get(agent) ?? agentPos.get("scout")!;
      const ai = AGENTS.indexOf(agent as (typeof AGENTS)[number]);
      if (ai >= 0) satFlare.setX(ai, 1);
      const targets = ids.map(id => starIndex.get(id)).filter((x): x is number => x != null);
      for (const si of targets.length ? targets : [-1]) {
        const slot = pulses.findIndex(p => !p);
        if (slot < 0) return;
        const to = si >= 0 ? starVec(si) : new THREE.Vector3(0, 0, 0);
        pulses[slot] = { curve: curve(from, to, 0.35), t0: performance.now(), dur: reduced ? 600 : 1500, color: new THREE.Color(agentColor(agent)), star: si, agent: ai };
      }
    };
    const onFocus = (e: Event) => { const ids = (e as CustomEvent<FocusEvent>).detail.stars; focus = ids.length ? new Set(ids) : null; applyFocus(); };
    addEventListener("syzygy:pulse", onPulse);
    addEventListener("syzygy:focus", onFocus);
    const onFilter = (e: Event) => { filter = (e as CustomEvent<SkyFilter>).detail; applyFocus(); };
    addEventListener("syzygy:filter", onFilter);
    const pending = (window as unknown as { __syzygyFocus?: string[] }).__syzygyFocus;
    if (pending?.length) focus = new Set(pending);

    // ---- hover, click, drag, zoom ----
    // Picking is by screen distance: the nearest star within a comfortable radius, not a pixel-perfect ray hit.
    const mouse = new THREE.Vector2(9, 9), parallax = new THREE.Vector2();
    let hovered = -1;
    const proj = new THREE.Vector3(), eye = new THREE.Vector3();
    const pick = (cx: number, cy: number) => {
      if (!starGeo) return -1;
      const r = renderer.domElement.getBoundingClientRect(), size = starGeo.getAttribute("size") as THREE.BufferAttribute;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < stars.length; i++) {
        if (focus && focus.size && !focus.has(stars[i].id)) continue;
        if (filter && !(focus && focus.size) && !starLevel[i]) continue; // hidden by the legend filter
        world.localToWorld(proj.copy(starVec(i)));
        const depth = eye.copy(proj).applyMatrix4(camera.matrixWorldInverse).z;
        if (depth >= 0) continue;
        proj.project(camera);
        const x = r.left + ((proj.x + 1) / 2) * r.width, y = r.top + ((1 - proj.y) / 2) * r.height;
        const px = Math.min(90, (size.getX(i) * uniforms.uScale.value) / -depth) / renderer.getPixelRatio();
        const reach = Math.max(18, px * 0.45), d = Math.hypot(x - cx, y - cy);
        if (d < reach && d < bestD) { best = i; bestD = d; }
      }
      return best;
    };
    // The hovered star swells and its theses light up; the sky holds still so it doesn't slide away.
    function setHover(i: number) {
      if (i === hovered) return;
      hovered = i;
      if (!starGeo || !arcGeo) return;
      applyFocus();
      if (i < 0) return;
      const size = starGeo.getAttribute("size") as THREE.BufferAttribute;
      const ac = arcGeo.getAttribute("color") as THREE.BufferAttribute, base = arcGeo.userData.base as Float32Array, ends = arcGeo.userData.ends as [string, string][];
      const id = stars[i].id;
      size.setX(i, baseSize[i] * 2.2);
      for (let sg = 0; sg < ends.length; sg++) {
        const on = ends[sg][0] === id || ends[sg][1] === id;
        for (let v = 0; v < 2; v++) for (let c = 0; c < 3; c++) ac.array[(sg * 2 + v) * 3 + c] = base[(sg * 2 + v) * 3 + c] * (on ? 3 : 0.35);
      }
      ac.needsUpdate = size.needsUpdate = true;
    }

    const canvas = renderer.domElement;
    canvas.style.touchAction = "pan-y"; // vertical swipes still scroll the page on phones
    const downs = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; moved: number } | null = null, pinch0 = 0, zoom0 = 1, tapped = -1;
    const hold = (ms: number) => { orbit.heldUntil = performance.now() + ms; };

    const onDown = (e: PointerEvent) => {
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (downs.size === 2) {
        const [a, b] = [...downs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = orbit.zoomTo; drag = null; return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (downs.has(e.pointerId)) downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (downs.size === 2 && pinch0) {
        const [a, b] = [...downs.values()];
        orbit.zoomTo = Math.max(0.7, Math.min(3, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0)); hold(8000); return;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
        if (drag.moved > 5) {
          world.rotation.y += dx * 0.006;
          orbit.pitch = Math.max(0.08, Math.min(1.35, orbit.pitch + dy * 0.004));
          canvas.style.cursor = "grabbing"; setHover(-1); setTip(null); hold(8000); return;
        }
      }
      if (e.pointerType === "touch") return; // touch has no hover; a tap selects instead
      parallax.set(mouse.x, mouse.y);
      const i = pick(e.clientX, e.clientY);
      setHover(i);
      canvas.style.cursor = i >= 0 ? "pointer" : "grab";
      setTip(i >= 0 ? { x: e.clientX, y: e.clientY, star: stars[i] } : null);
    };
    const onUp = (e: PointerEvent) => {
      downs.delete(e.pointerId);
      if (downs.size < 2) pinch0 = 0;
      const wasDrag = !!drag && drag.moved > 5;
      drag = null;
      canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
      if (wasDrag) return;
      const i = pick(e.clientX, e.clientY);
      if (e.pointerType === "touch") {
        // First tap shows the star; tapping it again opens it.
        if (i >= 0 && i === tapped) { location.href = stars[i].href; return; }
        tapped = i; setHover(i); hold(8000);
        setTip(i >= 0 ? { x: e.clientX, y: e.clientY, star: stars[i], touch: true } : null);
        return;
      }
      if (i >= 0) location.href = stars[i].href;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", e => { downs.delete(e.pointerId); drag = null; pinch0 = 0; });
    // A touch fires pointerleave right after every tap; only a mouse leaving the sky clears the selection.
    canvas.addEventListener("pointerleave", e => { if (!drag && e.pointerType !== "touch") { setHover(-1); setTip(null); } });
    canvas.style.cursor = "grab";
    controls.current = {
      zoom: k => { orbit.zoomTo = Math.max(0.7, Math.min(3, orbit.zoomTo * k)); hold(8000); },
      reset: () => { orbit.zoomTo = 1; orbit.pitch = BASE_PITCH; orbit.heldUntil = 0; },
    };

    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight); uniforms.uScale.value = el.clientHeight * 0.9; placeWorld();
    };
    addEventListener("resize", onResize);

    // ---- frame loop ----
    const tmp = new THREE.Vector3();
    let last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      uniforms.uTime.value = now / 1000;
      // The sky turns slowly; it holds still while a page is focused on its own stars.
      // It also holds still under the pointer and for a few seconds after you drag or zoom it.
      const still = hovered >= 0 || drag != null || now < orbit.heldUntil;
      if (!reduced && !(focus && focus.size) && !still) world.rotation.y += dt * 0.025;
      orbit.zoom += (orbit.zoomTo - orbit.zoom) * Math.min(1, dt * 6);
      placeHome();

      // Camera: drift toward the focus, a little parallax from the pointer.
      // Unfocused, the camera looks at the middle of the page, so the shifted sky stays off the headline.
      // Focused, it looks at the stars the page is about.
      const focused = !!(focus && focus.size);
      // Focused stars are framed in the upper right on wide screens (where page heroes leave room),
      // top centre on phones: the camera aims below-left of them rather than at them.
      const wide = innerWidth >= 900;
      // Zoomed in, the camera slides over to the sky itself, which sits right of the headline.
      const zf = Math.max(0, Math.min(1, orbit.zoom - 1)), centre = new THREE.Vector3(world.position.x * zf, world.position.y * zf, 0);
      lookAt.lerp(focused ? world.localToWorld(tmp.copy(target)).add(new THREE.Vector3(wide ? -9 : 0, wide ? -4 : -7, 0)) : centre, 0.08);
      const want = focused ? world.localToWorld(tmp.copy(target)).add(new THREE.Vector3(wide ? -9 : 0, 3 / orbit.zoom, (small ? 34 : 24) / orbit.zoom)) : tmp.copy(home).add(centre);
      if (!reduced && !still) want.add(new THREE.Vector3(parallax.x * 2.2, parallax.y * 1.4, 0));
      camera.position.lerp(want, drag || pinch0 ? 0.25 : 0.06);
      camera.lookAt(lookAt);

      // Flares fade.
      if (starGeo) {
        const f = starGeo.getAttribute("flare") as THREE.BufferAttribute;
        let any = false;
        for (let i = 0; i < f.count; i++) if (f.getX(i) > 0) { f.setX(i, Math.max(0, f.getX(i) - dt * 0.9)); any = true; }
        if (any) f.needsUpdate = true;
      }
      for (let i = 0; i < satFlare.count; i++) satFlare.setX(i, Math.max(0, satFlare.getX(i) - dt * 1.2));
      satFlare.needsUpdate = true;

      // Pulses travel; their trail fades behind them.
      const hp = headGeo.getAttribute("position") as THREE.BufferAttribute, hc = headGeo.getAttribute("color") as THREE.BufferAttribute, hs = headGeo.getAttribute("size") as THREE.BufferAttribute;
      const tp = trailGeo.getAttribute("position") as THREE.BufferAttribute, tc = trailGeo.getAttribute("color") as THREE.BufferAttribute;
      for (let s = 0; s < MAXP; s++) {
        const p = pulses[s];
        if (!p) { hs.setX(s, 0); for (let k = 0; k < TRAIL * 6; k++) tc.array[s * TRAIL * 6 + k] = 0; continue; }
        const t = Math.min(1, (now - p.t0) / p.dur), e2 = 1 - Math.pow(1 - t, 3);
        const head = p.curve.getPoint(e2);
        hp.setXYZ(s, head.x, head.y, head.z); hc.setXYZ(s, p.color.r, p.color.g, p.color.b); hs.setX(s, 2.8);
        for (let k = 0; k < TRAIL; k++) {
          const a = p.curve.getPoint(Math.max(0, e2 - (k + 1) * 0.035)), b = p.curve.getPoint(Math.max(0, e2 - k * 0.035));
          const fade = (1 - k / TRAIL) * 0.9, o = (s * TRAIL + k) * 6;
          tp.array.set([a.x, a.y, a.z, b.x, b.y, b.z], o);
          tc.array.set([p.color.r * fade, p.color.g * fade, p.color.b * fade, p.color.r * fade, p.color.g * fade, p.color.b * fade], o);
        }
        if (t >= 1) {
          if (p.star >= 0 && starGeo) { (starGeo.getAttribute("flare") as THREE.BufferAttribute).setX(p.star, 1); starGeo.getAttribute("flare").needsUpdate = true; }
          pulses[s] = null;
        }
      }
      hp.needsUpdate = hc.needsUpdate = hs.needsUpdate = tp.needsUpdate = tc.needsUpdate = true;

      renderer.render(scene, camera);

      // Labels follow their stars. A label that would sit on top of one already placed is hidden,
      // agents first, then the busiest accounts; also hidden when off screen or behind the camera.
      const w = el.clientWidth, h = el.clientHeight, placed: [number, number, number, number][] = [];
      for (const l of labelEls) {
        const v = world.localToWorld(l.pos.clone()).project(camera);
        const x = ((v.x + 1) / 2) * w + 10, y = ((1 - v.y) / 2) * h + 10, lw = l.el.offsetWidth || 60, lh = 14;
        let vis = v.z < 1 && x > 4 && x + lw < w - 4 && y > 60 && y < h - 8;
        if (vis && placed.some(([px, py, pw, ph]) => x < px + pw + 6 && x + lw + 6 > px && y < py + ph && y + lh > py)) vis = false;
        if (vis) placed.push([x, y, lw, lh]);
        l.el.style.opacity = vis ? "" : "0";
        if (l.star != null) l.el.style.pointerEvents = vis && !l.el.classList.contains("c-dim") ? "" : "none";
        if (vis) l.el.style.transform = `translate(${x - 10}px, ${y - 10}px)`;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      removeEventListener("syzygy:pulse", onPulse);
      removeEventListener("syzygy:focus", onFocus);
      removeEventListener("syzygy:filter", onFilter);
      removeEventListener("resize", onResize);
      labelEls.forEach(l => l.el.remove());
      controls.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <>
      <div ref={host} className="sky" aria-hidden />
      <div ref={labels} className="sky-labels" aria-hidden />
      {tip && (
        <div className="sky-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <i style={{ background: hue(tip.star.type) }} />
          <strong>{tip.star.name}</strong>
          <span>{tip.star.type.replace("_", " ")}{tip.star.account ? " · account" : ""} · {tip.star.degree} thes{tip.star.degree === 1 ? "is" : "es"}{tip.touch ? " · tap again to open" : ""}</span>
        </div>
      )}
      {onHome && (
        <div className="sky-ctl" role="group" aria-label="Sky controls">
          <span>drag to turn</span>
          <button type="button" aria-label="Zoom in" onClick={() => controls.current?.zoom(1.35)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => controls.current?.zoom(1 / 1.35)}>&minus;</button>
          <button type="button" aria-label="Reset view" onClick={() => controls.current?.reset()}>reset</button>
        </div>
      )}
    </>
  );
}
