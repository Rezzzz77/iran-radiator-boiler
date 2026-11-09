import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const kitScript = () => readFileSync(join(HERE, "kit", "iso-kit.mjs"), "utf8").replace(/^export /gm, "");
const THEME = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 460;
const HEIGHT = 680;

// Isometric projection fitted tightly around the boiler portrait aspect ratio
const P = k.fitProjection(
  [
    [-96, -49, -2],
    [96, -49, -2],
    [-96, 45, -2],
    [96, 45, -2],
    [-96, -49, 340],
    [96, -49, 340],
    [-96, 45, 340],
    [96, 45, 340],
  ],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 42 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);

// Helper: screen-space plane basis for front-facing (+y) dials & knobs
function dialBasis(center3D, normal3D = [0, 1, 0]) {
  const F = G.frameAlong(center3D, normal3D);
  const o = at(center3D);
  const pU = at(G.add3(center3D, F.u));
  const pV = at(G.add3(center3D, F.v));
  return {
    o,
    u: [pU[0] - o[0], pU[1] - o[1]],
    v: [pV[0] - o[0], pV[1] - o[1]],
  };
}

// Helper: build a 3D tube route as depth-sorted render items
function pipeQueueItems(items, partId, controlPoints, radius, { bend = 4, tone = "hi", maxLength = 22, bias = 0 } = {}) {
  const route = G.fillet(controlPoints, bend, 10, { P, tube: radius });
  const pieces = tubePieces(route, radius, P, { maxLength, spacing: 1.5, caps: true });
  pieces.forEach((piece) => {
    items.push({
      depth: planeDepth(4, piece.mid) + bias,
      html: `<g data-part="${partId}" class="boiler-part">${tubeSvg(piece, { tone })}</g>`,
    });
  });
  return route;
}

// Helper: build animated streamline path from 3D waypoints
function flowPathD(points3D, bend = 4) {
  const route = G.fillet(points3D, bend, 8, { P, tube: 1.5 });
  return k.pathOf(route.map((pt) => at(pt)));
}

// Render queue sorted back-to-front by world isometric depth within layered y-planes
const items = [];
const pushItem = (center3D, html, bias = 0) => {
  items.push({ depth: k.depthOf(center3D, P) + bias, html });
};
// Helper: deterministic plane-ordered depth for layered wall-to-front assembly
const planeDepth = (plane, [x, y, z]) => plane * 400 + y * 2.2 + x * 0.4 + z * 0.6;
const pushPlane = (plane, center3D, html) => {
  items.push({ depth: planeDepth(plane, center3D), html });
};

// 1. Backplate & Wall Mounting Bracket (شاسی اصلی)
{
  const out = [];
  const plate = { x: -95, y: -46, w: 190, d: 8, r: 4 };
  out.push(`<g data-part="backplate" class="boiler-part">`);
  out.push(S(k.slabOf(plate, 14, 290, P, 4, 1.2), { tone: "faint", halo: true }));
  const bracket = { x: -75, y: -49, w: 150, d: 4, r: 2 };
  out.push(S(k.slabOf(bracket, 290, 16, P, 3, 0.8), { tone: "mid" }));
  out.push(D([at([-62, -46, 298]), at([0, -46, 298]), at([62, -46, 298])], { size: 0.9, tone: "hi" }));
  for (const z of [60, 115, 175, 240]) {
    out.push(L(k.lineOnTop([-78, -38], [78, -38], z, P), { tone: "lo" }));
  }
  out.push(`</g>`);
  pushPlane(0, [0, -42, 160], out.join(""));
}

// 2. Expansion Vessel (منبع انبساط دیافراگمی ۸ لیتری)
{
  const out = [];
  out.push(`<g data-part="expansion_vessel" class="boiler-part">`);
  const vesselPlan = { x: -64, y: -37, w: 128, d: 12, r: 7 };
  out.push(S(k.slabOf(vesselPlan, 146, 116, P, 6, 1.8), { tone: "lo", className: "vessel-tank" }));
  out.push(L(k.planOutline(k.insetPlan(vesselPlan, 3), 262, P), { tone: "mid" }));
  // Schrader air charging valve on top
  out.push(S(k.cylinder(0, -31, 3.5, 262, 11, P, 24), { tone: "hi" }));
  out.push(S(k.cylinder(0, -31, 4.2, 270, 4, P, 24), { tone: "mid" }));
  out.push(D([at([0, -31, 274])], { size: 0.7, tone: "red" }));
  out.push(`</g>`);
  pushPlane(1, [0, -31, 205], out.join(""));

  // Capillary tube from vessel bottom to pump return manifold
  pipeQueueItems(
    items,
    "expansion_vessel",
    [
      [28, -31, 147],
      [28, -31, 108],
      [48, -22, 92],
      [54, -14, 70],
    ],
    1.6,
    { bend: 5, tone: "mid", bias: -800 },
  );
}

// 3. Sealed Combustion Chamber — Back & Interior Half (محفظه احتراق - بدنه پشت و چپ)
{
  const out = [];
  out.push(`<g data-part="combustion_chamber" class="boiler-part">`);
  // Back ceramic-lined wall
  out.push(S(k.slabOf({ x: -74, y: -24, w: 148, d: 5, r: 2 }, 122, 130, P, 3, 1), { tone: "lo", className: "chamber-cavity" }));
  // Left wall
  out.push(S(k.slabOf({ x: -74, y: -24, w: 5, d: 40, r: 2 }, 122, 130, P, 3, 1), { tone: "lo", className: "chamber-cavity" }));
  // Bottom burner tray
  out.push(S(k.slabOf({ x: -74, y: -24, w: 148, d: 40, r: 3 }, 118, 6, P, 4, 0.8), { tone: "mid" }));
  // Ceramic insulation seam lines on back wall
  for (const z of [150, 178, 206]) {
    out.push(L(k.lineOnTop([-68, -19], [68, -19], z, P), { tone: "faint" }));
  }
  out.push(`</g>`);
  pushPlane(2, [-20, -20, 185], out.join(""));
}

// 4. Primary Copper Finned Heat Exchanger (مبدل حرارتی اصلی مسی)
{
  const out = [];
  out.push(`<g data-part="primary_exchanger" class="boiler-part">`);
  // Left & Right copper headers
  out.push(S(k.cylinder(-62, -2, 6.5, 204, 32, P, 24), { tone: "lit", className: "copper-part" }));
  out.push(S(k.cylinder(62, -2, 6.5, 204, 32, P, 24), { tone: "lit", className: "copper-part" }));
  // Finned core block
  const finBlock = { x: -56, y: -15, w: 112, d: 28, r: 2 };
  out.push(S(k.slabOf(finBlock, 208, 24, P, 3, 0.8), { tone: "mid", className: "copper-fins" }));
  for (let x = -52; x <= 52; x += 4) {
    const pTop = at([x, -15, 232]);
    const pFront = at([x, 13, 232]);
    const pBot = at([x, 13, 208]);
    out.push(`<path class="iso-line" data-tone="lo" d="M${pTop[0].toFixed(1)} ${pTop[1].toFixed(1)}L${pFront[0].toFixed(1)} ${pFront[1].toFixed(1)}L${pBot[0].toFixed(1)} ${pBot[1].toFixed(1)}"/>`);
  }
  out.push(`</g>`);
  pushPlane(4.4, [0, -2, 220], out.join(""));
}

// 5. High-Limit Thermostat 105°C (کلید حرارتی / ترموستات حد ۱۰۵ درجه)
{
  const out = [];
  out.push(`<g data-part="limit_thermostat" class="boiler-part">`);
  const fLim = G.frameAlong([-62, 5, 222], [0, 1, 0]);
  out.push(S(G.disc(0, 4.5, 4.4, fLim, P), { tone: "hi", lit: true }));
  out.push(S(G.disc(4.5, 6.5, 3, fLim, P), { tone: "lo" }));
  const pDot = at([-62, 11.8, 222]);
  out.push(`<circle cx="${pDot[0].toFixed(1)}" cy="${pDot[1].toFixed(1)}" r="2.2" fill="var(--anatomy-red)" class="limit-dot"/>`);
  out.push(`</g>`);
  pushPlane(4.7, [-62, 8, 222], out.join(""));
}

// 6. Stainless Steel Gas Burner, Electrodes & Flame (مشعل استیل، الکترودها و شعله)
{
  const out = [];
  out.push(`<g data-part="gas_burner" class="boiler-part">`);
  // Distributor manifold rail
  out.push(S(k.slabOf({ x: -58, y: -6, w: 116, d: 10, r: 3 }, 124, 8, P, 4, 0.8), { tone: "hi" }));
  // 10 burner blades
  for (let x = -49.5; x <= 49.5; x += 11) {
    out.push(S(k.slabOf({ x: x - 3.2, y: -12, w: 6.4, d: 22, r: 1.5 }, 132, 14, P, 2, 0.5), { tone: "mid" }));
    out.push(L(k.lineOnTop([x - 1.8, 0], [x + 1.8, 0], 146, P), { tone: "lo" }));
  }
  // Ignition electrode (left) & Ionization flame-sense rod (right)
  out.push(S(k.cylinder(-14, 9, 2.3, 134, 15, P, 16), { tone: "lit" }));
  out.push(L(k.segment([-14, 9, 149], [-10, 3, 153], P), { tone: "lit" }));
  out.push(S(k.cylinder(14, 9, 2.3, 134, 15, P, 16), { tone: "lit" }));
  out.push(L(k.segment([14, 9, 149], [11, 2, 155], P), { tone: "lit" }));

  // Animated spark arc during ignition fault / startup
  const sp1 = at([-10, 3, 153]);
  const sp2 = at([-5, 1, 150]);
  out.push(`<path id="ignitionSpark" d="M${sp1[0].toFixed(1)} ${sp1[1].toFixed(1)} L${((sp1[0]+sp2[0])/2 - 3).toFixed(1)} ${(sp1[1]-4).toFixed(1)} L${sp2[0].toFixed(1)} ${sp2[1].toFixed(1)}" stroke="#ffe066" stroke-width="1.6" fill="none" opacity="0" stroke-linecap="round"/>`);

  // Dynamic Blue Flame Group
  const flameAnchor = at([0, 0, 146]);
  out.push(`<g class="flame-group" data-flame style="transform-origin:${flameAnchor[0].toFixed(1)}px ${flameAnchor[1].toFixed(1)}px;transition:opacity 0.25s ease,transform 0.25s ease;">`);
  for (let x = -49.5; x <= 49.5; x += 11) {
    const b = at([x, 0, 146]);
    const t = at([x, 0, 178]);
    out.push(`<path d="M${(b[0]-4.2).toFixed(1)} ${b[1].toFixed(1)} Q${b[0].toFixed(1)} ${(t[1]-6).toFixed(1)} ${b[0].toFixed(1)} ${t[1].toFixed(1)} Q${b[0].toFixed(1)} ${(t[1]-6).toFixed(1)} ${(b[0]+4.2).toFixed(1)} ${b[1].toFixed(1)} Z" fill="url(#blueFlameGrad)" filter="url(#flameGlow)"/>`);
    out.push(`<path d="M${(b[0]-1.8).toFixed(1)} ${b[1].toFixed(1)} Q${b[0].toFixed(1)} ${(t[1]+6).toFixed(1)} ${b[0].toFixed(1)} ${(t[1]+10).toFixed(1)} Q${b[0].toFixed(1)} ${(t[1]+6).toFixed(1)} ${(b[0]+1.8).toFixed(1)} ${b[1].toFixed(1)} Z" fill="#ffffffcc"/>`);
  }
  out.push(`</g>`);
  out.push(`</g>`);
  pushPlane(4.45, [0, 0, 146], out.join(""));
}

// 7. Sealed Combustion Chamber — Top Fume Hood & Front Cutaway Rim (بخش جلویی و هود محفظه احتراق)
{
  const out = [];
  out.push(`<g data-part="combustion_chamber" class="boiler-part">`);
  // Top collector hood
  out.push(S(k.slabOf({ x: -74, y: -24, w: 148, d: 40, r: 4 }, 244, 12, P, 4, 1), { tone: "mid" }));
  // Right-front cutaway corner pillar
  out.push(S(k.slabOf({ x: 70, y: 12, w: 4, d: 5, r: 1 }, 142, 102, P, 2, 0.4), { tone: "mid" }));
  // Front lower apron sill with sight-glass port
  out.push(S(k.slabOf({ x: -74, y: 13, w: 148, d: 4, r: 2 }, 122, 20, P, 3, 0.6), { tone: "mid" }));
  // Sight glass bezel on front of apron sill
  const fGlass = G.frameAlong([0, 17, 134], [0, 1, 0]);
  out.push(S(G.disc(0, 2, 7.5, fGlass, P), { tone: "hi" }));
  const gc = at([0, 19.1, 134]);
  out.push(`<circle cx="${gc[0].toFixed(1)}" cy="${gc[1].toFixed(1)}" r="5" class="sight-glass" fill="#00aaff44" stroke="var(--anatomy-mid)" stroke-width="0.7"/>`);
  out.push(`</g>`);
  pushPlane(5, [0, 16, 190], out.join(""));
}

// 8. Exhaust Fan & Coaxial Flue (فن سانتریفیوژ و دودکش دوجداره)
{
  const out = [];
  out.push(`<g data-part="exhaust_system" class="boiler-part">`);
  out.push(S(k.slabOf({ x: -42, y: -24, w: 84, d: 34, r: 4 }, 256, 6, P, 4, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -34, y: -20, w: 68, d: 30, r: 6 }, 262, 32, P, 6, 1.4), { tone: "mid" }));
  // Fan motor & spinning impeller marker
  out.push(S(k.cylinder(-12, -5, 15, 270, 28, P, 32), { tone: "lo" }));
  out.push(L(k.ring(-12, -5, 15, 284, P, 32), { tone: "faint" }));
  const fanC = at([-12, -5, 298.5]);
  out.push(`<g class="fan-spinner" style="transform-origin:${fanC[0].toFixed(1)}px ${fanC[1].toFixed(1)}px;">
    <line x1="${(fanC[0]-7).toFixed(1)}" y1="${fanC[1].toFixed(1)}" x2="${(fanC[0]+7).toFixed(1)}" y2="${fanC[1].toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.4" stroke-linecap="round"/>
    <line x1="${fanC[0].toFixed(1)}" y1="${(fanC[1]-7).toFixed(1)}" x2="${fanC[0].toFixed(1)}" y2="${(fanC[1]+7).toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.4" stroke-linecap="round"/>
  </g>`);
  // Venturi nozzle
  out.push(S(k.cylinder(20, 4, 2.6, 276, 16, P, 16), { tone: "lit" }));
  // Coaxial outer intake collar Ø100 & inner flue Ø60
  out.push(S(k.cylinder(0, -8, 26, 294, 22, P, 36), { tone: "hi" }));
  out.push(L(k.ring(0, -8, 26, 305, P, 36), { tone: "lo" }));
  out.push(S(k.cylinder(0, -8, 15, 316, 22, P, 32), { tone: "lit" }));
  out.push(L(k.ring(0, -8, 13, 338, P, 28), { tone: "lo" }));
  // Sampling ports
  out.push(S(k.cylinder(18, 10, 3, 296, 8, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(-18, 10, 3, 296, 8, P, 16), { tone: "mid" }));
  out.push(`</g>`);
  pushPlane(5.2, [0, -8, 295], out.join(""));
}

// 9. Air Pressure Switch (پرشر سوئیچ دود / هوا)
{
  const out = [];
  out.push(`<g data-part="air_pressure_switch" class="boiler-part">`);
  out.push(S(k.slabOf({ x: 38, y: -4, w: 18, d: 8, r: 2 }, 260, 4, P, 2), { tone: "mid" }));
  out.push(S(k.cylinder(58, 2, 13.5, 262, 12, P, 32), { tone: "hi" }));
  out.push(L(k.ring(58, 2, 10.5, 274, P, 28), { tone: "lo" }));
  out.push(S(k.slabOf({ x: 52, y: 13, w: 4, d: 2, r: 0.5 }, 268, 6, P, 2), { tone: "lit" }));
  out.push(S(k.slabOf({ x: 60, y: 13, w: 4, d: 2, r: 0.5 }, 268, 6, P, 2), { tone: "lit" }));
  const apsDot = at([58, 2, 274.5]);
  out.push(`<circle cx="${apsDot[0].toFixed(1)}" cy="${apsDot[1].toFixed(1)}" r="2.6" fill="var(--anatomy-green)" class="aps-dot"/>`);
  out.push(`</g>`);
  pushPlane(5.25, [58, 2, 268], out.join(""));

  // Silicone sampling tubes from fan venturi to APS
  const t1 = flowPathD([[20, 4, 288], [32, 14, 284], [46, 5, 270]], 4);
  const t2 = flowPathD([[20, 2, 280], [34, 10, 274], [46, 0, 265]], 4);
  pushPlane(
    5.3,
    [34, 10, 278],
    `<g data-part="air_pressure_switch" class="boiler-part">
      <path d="${t1}" stroke="var(--anatomy-red)" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path d="${t2}" stroke="var(--anatomy-strong)" stroke-width="1.5" stroke-dasharray="2.5,2.5" fill="none" stroke-linecap="round"/>
    </g>`,
  );
}

// 10. Secondary Plate Heat Exchanger (مبدل ثانویه صفحه‌ای ۱۶ پلیت)
{
  const out = [];
  out.push(`<g data-part="secondary_exchanger" class="boiler-part">`);
  const plateBox = { x: -56, y: -25, w: 32, d: 18, r: 3 };
  out.push(S(k.slabOf(plateBox, 54, 40, P, 4, 1.1), { tone: "lit" }));
  for (let z = 58; z <= 90; z += 3.2) {
    out.push(L(k.lineOnTop([-56, -7], [-24, -7], z, P), { tone: "mid" }));
  }
  out.push(S(k.cylinder(-50, -16, 4, 50, 4, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(-30, -16, 4, 50, 4, P, 16), { tone: "mid" }));
  out.push(`</g>`);
  pushPlane(3.2, [-40, -16, 74], out.join(""));
}

// 11. SIT 845 Sigma Gas Valve (شیر برقی گاز SIT 845)
{
  const out = [];
  out.push(`<g data-part="gas_valve" class="boiler-part">`);
  out.push(S(k.slabOf({ x: -14, y: -10, w: 28, d: 20, r: 4 }, 52, 30, P, 4, 1.2), { tone: "mid" }));
  // Twin safety coils on top
  out.push(S(k.cylinder(-6.5, 0, 6.2, 82, 16, P, 24), { tone: "lo", className: "gas-coil-blue" }));
  out.push(S(k.cylinder(6.5, 0, 6.2, 82, 16, P, 24), { tone: "lo", className: "gas-coil-blue" }));
  // Front-facing modulation coil along +y
  const fMod = G.frameAlong([0, 10, 67], [0, 1, 0]);
  out.push(S(G.disc(0, 7, 6.2, fMod, P), { tone: "hi", lit: true }));
  const modDot = at([0, 17.2, 67]);
  out.push(`<circle cx="${modDot[0].toFixed(1)}" cy="${modDot[1].toFixed(1)}" r="2.2" fill="var(--anatomy-blue)" class="gas-valve-dot"/>`);
  out.push(`</g>`);
  pushPlane(4.2, [0, 0, 70], out.join(""));
}

// 12. Three-Way Motorized Diverter Valve (شیر سه‌طرفه موتوری)
{
  const out = [];
  out.push(`<g data-part="three_way_valve" class="boiler-part">`);
  out.push(S(k.slabOf({ x: -72, y: -4, w: 22, d: 20, r: 4 }, 40, 24, P, 4, 1.1), { tone: "hi" }));
  const motorPlan = { x: -70, y: -2, w: 18, d: 16, r: 3 };
  out.push(S(k.slabOf(motorPlan, 64, 24, P, 4, 1), { tone: "lo", className: "actuator-body" }));
  out.push(L(k.planOutline(k.insetPlan(motorPlan, 2), 88, P), { tone: "faint" }));
  const vDot = at([-61, 6, 88.5]);
  out.push(`<circle cx="${vDot[0].toFixed(1)}" cy="${vDot[1].toFixed(1)}" r="3.2" fill="var(--anatomy-blue)" class="valve-indicator-dot"/>`);
  out.push(`</g>`);
  pushPlane(4.25, [-61, 6, 64], out.join(""));
}

// 13. Circulation Pump & Automatic Air Vent (پمپ سیرکولاتور و ایرونت)
{
  const out = [];
  out.push(`<g data-part="circulation_pump" class="boiler-part">`);
  // Pump hydraulic volute body
  out.push(S(k.slabOf({ x: 48, y: -14, w: 26, d: 22, r: 5 }, 48, 36, P, 5, 1.4), { tone: "lo" }));
  // Compact horizontal motor pointing +y toward viewer via lathe.mjs (clear of lower flow_meter)
  const fPump = G.frameAlong([61, 8, 67], [0, 1, 0]);
  out.push(S(G.solidOf([[0, 13], [10, 13], [11.5, 10.5], [12, 7.5], [14, 7.5]], fPump, P), { tone: "mid" }));
  // Center rotor bleed screw & live rotating spinner
  const pC = at([61, 22.3, 67]);
  out.push(`<circle cx="${pC[0].toFixed(1)}" cy="${pC[1].toFixed(1)}" r="4.6" fill="var(--anatomy-face)" stroke="var(--anatomy-hi)" stroke-width="0.8"/>`);
  out.push(`<g class="pump-spinner" style="transform-origin:${pC[0].toFixed(1)}px ${pC[1].toFixed(1)}px;">
    <line x1="${(pC[0]-3.4).toFixed(1)}" y1="${pC[1].toFixed(1)}" x2="${(pC[0]+3.4).toFixed(1)}" y2="${pC[1].toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="${pC[0].toFixed(1)}" y1="${(pC[1]-3.4).toFixed(1)}" x2="${pC[0].toFixed(1)}" y2="${(pC[1]+3.4).toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.3" stroke-linecap="round"/>
  </g>`);
  // Automatic brass air vent on top of volute
  out.push(S(k.cylinder(54, -6, 5.2, 84, 16, P, 20), { tone: "lit" }));
  out.push(S(k.cylinder(54, -6, 6.5, 100, 5, P, 20), { tone: "lo" }));
  out.push(D([at([54, -6, 105])], { size: 0.7, tone: "faint" }));
  out.push(`</g>`);
  pushPlane(4.55, [61, 8, 67], out.join(""));
}

// 14. Water Pressure Switch (پرشر سوئیچ آب / حداقل فشار)
{
  const out = [];
  out.push(`<g data-part="water_pressure_switch" class="boiler-part">`);
  // Hydraulic feed stem branching left from pump manifold
  out.push(S(k.cylinder(34, 8, 4.5, 58, 9, P, 20), { tone: "lit" }));
  out.push(S(k.slabOf({ x: 28, y: 3, w: 12, d: 10, r: 2 }, 67, 12, P, 3, 0.7), { tone: "lo" }));
  const wpsDot = at([34, 8, 79.5]);
  out.push(`<circle cx="${wpsDot[0].toFixed(1)}" cy="${wpsDot[1].toFixed(1)}" r="2.6" fill="var(--anatomy-green)" class="wps-dot"/>`);
  out.push(`</g>`);
  pushPlane(4.6, [34, 8, 68], out.join(""));
}

// 15. DHW Turbine Flow Meter (فلومتر توربینی / فلوسوئیچ آب مصرفی)
{
  const out = [];
  out.push(`<g data-part="flow_meter" class="boiler-part">`);
  out.push(S(k.cylinder(32, -2, 6, 22, 16, P, 22), { tone: "hi", lit: true }));
  out.push(S(k.slabOf({ x: 36, y: -5, w: 7, d: 6, r: 1.5 }, 25, 10, P, 2, 0.5), { tone: "lo" }));
  // Front-facing clear window with turbine spinner
  const fFlow = G.frameAlong([32, 3.8, 30], [0, 1, 0]);
  out.push(S(G.disc(0, 1.5, 4.2, fFlow, P), { tone: "mid" }));
  const flC = at([32, 5.5, 30]);
  out.push(`<g class="flow-spinner" style="transform-origin:${flC[0].toFixed(1)}px ${flC[1].toFixed(1)}px;">
    <line x1="${(flC[0]-2.8).toFixed(1)}" y1="${flC[1].toFixed(1)}" x2="${(flC[0]+2.8).toFixed(1)}" y2="${flC[1].toFixed(1)}" stroke="var(--anatomy-blue)" stroke-width="1.3" stroke-linecap="round"/>
    <line x1="${flC[0].toFixed(1)}" y1="${(flC[1]-2.8).toFixed(1)}" x2="${flC[0].toFixed(1)}" y2="${(flC[1]+2.8).toFixed(1)}" stroke="var(--anatomy-blue)" stroke-width="1.3" stroke-linecap="round"/>
  </g>`);
  out.push(`</g>`);
  pushPlane(4.3, [32, -1, 30], out.join(""));
}

// 16. Interactive Manual Filling Loop Valve (شیر پرکن دستی)
const fillingBasis = dialBasis([48, 22, 20]);
{
  const out = [];
  out.push(`<g data-part="filling_valve" id="svgFillingValve" class="boiler-part" style="cursor:pointer;">`);
  // Brass bypass body
  out.push(S(k.slabOf({ x: 42, y: 7, w: 12, d: 10, r: 2 }, 15, 10, P, 3, 0.7), { tone: "hi" }));
  // Blue knurled rotary knob pointing forward (+y)
  const fFill = G.frameAlong([48, 17, 20], [0, 1, 0]);
  out.push(S(G.disc(0, 5.5, 5.4, fFill, P), { tone: "mid", className: "filling-knob-body" }));
  out.push(L(G.ribsOf(fFill, 0.5, 5, 5.4, 16, P), { tone: "blue" }));
  const fk0 = at([48, 22.8, 20]);
  out.push(`<circle cx="${fk0[0].toFixed(1)}" cy="${fk0[1].toFixed(1)}" r="4.5" fill="none" stroke="var(--anatomy-blue)" stroke-width="1.4" class="filling-ring"/>`);
  out.push(`<line id="fillingKnobLine" x1="${(fk0[0]-3.2).toFixed(1)}" y1="${fk0[1].toFixed(1)}" x2="${(fk0[0]+3.2).toFixed(1)}" y2="${fk0[1].toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.8" stroke-linecap="round"/>`);
  out.push(`</g>`);
  pushPlane(5.1, [48, 14, 20], out.join(""));
}

// 17. 3-Bar Safety Relief Valve (شیر اطمینان ۳ بار)
{
  const out = [];
  out.push(`<g data-part="safety_valve" class="boiler-part">`);
  out.push(S(k.cylinder(24, 10, 2.4, 8, 14, P, 16), { tone: "mid" }));
  out.push(S(k.cylinder(24, 10, 4.5, 22, 16, P, 20), { tone: "lit" }));
  out.push(S(k.cylinder(24, 10, 6, 38, 8, P, 20), { tone: "lo", className: "safety-knob-red" }));
  out.push(L(k.knurl(24, 10, 6, 38, 46, 16, P), { tone: "red" }));
  out.push(D([at([24, 10, 46.2])], { size: 1.0, tone: "red" }));
  // Leak droplets shown when pressure > 3.0 bar
  const d1 = at([24, 10, 5]);
  const d2 = at([24, 10, -2]);
  out.push(`<g id="safetyLeakDrops" opacity="0">
    <circle cx="${d1[0].toFixed(1)}" cy="${d1[1].toFixed(1)}" r="2" fill="var(--anatomy-blue)"/>
    <circle cx="${d2[0].toFixed(1)}" cy="${d2[1].toFixed(1)}" r="1.6" fill="var(--anatomy-blue)"/>
  </g>`);
  out.push(`</g>`);
  pushPlane(5.05, [24, 10, 30], out.join(""));
}

// 18. NTC Temperature Sensors (سنسورهای NTC گرمایش و مصرفی)
{
  // Heating NTC on primary flow copper pipe
  const fNtcH = G.frameAlong([-64, 3, 184], [0, 1, 0]);
  const hOut = [];
  hOut.push(`<g data-part="ntc_sensors" class="boiler-part">`);
  hOut.push(S(G.disc(0, 4, 3.8, fNtcH, P), { tone: "hi", lit: true }));
  hOut.push(S(G.disc(4, 7, 2.8, fNtcH, P), { tone: "mid" }));
  const hDot = at([-64, 10.2, 184]);
  hOut.push(`<circle cx="${hDot[0].toFixed(1)}" cy="${hDot[1].toFixed(1)}" r="2.2" fill="var(--anatomy-blue)" class="ntc-heat-dot"/>`);
  hOut.push(`</g>`);
  pushPlane(4.7, [-64, 6, 184], hOut.join(""));

  // DHW NTC on secondary hot outlet pipe
  const fNtcD = G.frameAlong([-32, 3, 42], [0, 1, 0]);
  const dOut = [];
  dOut.push(`<g data-part="ntc_sensors" class="boiler-part">`);
  dOut.push(S(G.disc(0, 4, 3.5, fNtcD, P), { tone: "hi", lit: true }));
  dOut.push(S(G.disc(4, 6.8, 2.6, fNtcD, P), { tone: "mid" }));
  const dDot = at([-32, 10, 42]);
  dOut.push(`<circle cx="${dDot[0].toFixed(1)}" cy="${dDot[1].toFixed(1)}" r="2.2" fill="var(--anatomy-red)" class="ntc-dhw-dot"/>`);
  dOut.push(`</g>`);
  pushPlane(4.7, [-32, 6, 42], dOut.join(""));
}

// 19. 3D Copper Piping Circuit (شبکه لوله‌های مسی)
// Heating Return: Port 5 -> Pump -> Primary Exchanger Right Header
pipeQueueItems(items, "copper_pipes", [[64, -2, 12], [64, -2, 44]], 4.4, { bend: 4, tone: "hi" });
pipeQueueItems(items, "copper_pipes", [[64, -2, 80], [64, -2, 204]], 4.4, { bend: 4, tone: "hi" });
// Heating Flow: Primary Exchanger Left Header -> 3-Way Valve -> Port 1
pipeQueueItems(items, "copper_pipes", [[-64, -2, 204], [-64, -2, 88]], 4.4, { bend: 4, tone: "hi" });
pipeQueueItems(items, "copper_pipes", [[-64, -2, 40], [-64, -2, 12]], 4.4, { bend: 4, tone: "hi" });
// Internal DHW Primary Loop: 3-Way Valve -> Secondary Plate Exchanger -> Pump
pipeQueueItems(items, "copper_pipes", [[-56, -4, 52], [-50, -16, 52]], 3.6, { bend: 4, tone: "mid" });
pipeQueueItems(items, "copper_pipes", [[-30, -16, 50], [-10, -16, 42], [46, -12, 46]], 3.6, { bend: 6, tone: "mid" });
// Cold Water Inlet -> Flow Meter -> Secondary Exchanger
pipeQueueItems(items, "copper_pipes", [[32, -2, 12], [32, -2, 22]], 3.5, { bend: 3, tone: "hi" });
pipeQueueItems(items, "copper_pipes", [[32, -2, 38], [32, -16, 48], [-22, -16, 48], [-30, -16, 50]], 3.5, { bend: 6, tone: "hi" });
// DHW Hot Outlet: Secondary Exchanger -> Port 2
pipeQueueItems(items, "copper_pipes", [[-50, -16, 50], [-36, -6, 44], [-32, -2, 42], [-32, -2, 12]], 3.5, { bend: 5, tone: "hi" });
// Gas Supply Line: Port 3 -> SIT Gas Valve -> Burner Rail
pipeQueueItems(items, "copper_pipes", [[0, -2, 12], [0, -2, 52]], 4.4, { bend: 3, tone: "mid" });
pipeQueueItems(items, "copper_pipes", [[0, -2, 82], [0, -2, 124]], 4.2, { bend: 3, tone: "mid" });
// Filling Bypass Line: Cold Inlet Tee <-> Filling Valve <-> Heating Return Tee
pipeQueueItems(items, "copper_pipes", [[32, 3, 20], [42, 12, 20]], 2.5, { bend: 3, tone: "hi" });
pipeQueueItems(items, "copper_pipes", [[54, 12, 20], [64, 3, 20]], 2.5, { bend: 3, tone: "hi" });
// Pressure switch branch from pump manifold to water pressure switch
pipeQueueItems(items, "copper_pipes", [[48, -2, 58], [34, 8, 58]], 2.2, { bend: 3, tone: "mid" });

// 20. Bottom 5 Standard Brass Connection Ports (اتصالات ۵ گانه زیر دستگاه)
{
  const out = [];
  out.push(`<g data-part="bottom_connections" class="boiler-part">`);
  out.push(S(k.slabOf({ x: -85, y: -32, w: 170, d: 50, r: 4 }, 10, 6, P, 4, 0.8), { tone: "mid" }));
  const ports = [
    { x: -64, r: 6.5, tone: "lit" },
    { x: -32, r: 5.2, tone: "hi" },
    { x: 0, r: 6.5, tone: "mid" },
    { x: 32, r: 5.2, tone: "hi" },
    { x: 64, r: 6.5, tone: "lit" },
  ];
  ports.forEach((p) => {
    out.push(S(k.cylinder(p.x, -2, p.r, 0, 10, P, 20), { tone: p.tone }));
    out.push(S(k.cylinder(p.x, -2, p.r + 1.8, 3, 4.5, P, 12), { tone: "hi" }));
    out.push(L(k.ring(p.x, -2, p.r - 1.5, 0, P, 20), { tone: "lo" }));
  });
  out.push(`</g>`);
  pushPlane(2.8, [0, -4, 8], out.join(""));
}

// 21. Main Electronic Control Board (برد اصلی الکترونیک داخل جعبه بازشو)
{
  // Wiring harnesses connecting PCB up to sensors & valves (drawn in Plane 4.1 behind front tray)
  const wiresOut = `<g data-part="main_pcb" class="boiler-part">
    ${k.wireSvg(at([-62, 21, 36]), at([-64, 10, 184]), { via: [at([-76, 18, 110])], tone: "blue", ends: "both", size: 0.9 })}
    ${k.wireSvg(at([-10, 21, 36]), at([0, 14, 67]), { via: [at([-6, 17, 50])], tone: "mid", ends: "both", size: 0.9 })}
    ${k.wireSvg(at([10, 21, 36]), at([34, 8, 72]), { via: [at([22, 18, 52])], tone: "hi", ends: "both", size: 0.9 })}
  </g>`;
  pushPlane(4.1, [-20, 18, 60], wiresOut);

  const out = [];
  out.push(`<g data-part="main_pcb" class="boiler-part">`);
  // Cutaway electronics tray behind front fascia (completely clear of safety_valve at x=24 and pump at x=46)
  out.push(S(k.slabOf({ x: -76, y: 18, w: 88, d: 16, r: 3 }, 20, 14, P, 3, 0.8), { tone: "lo" }));
  // PCB substrate visible from top-front angle
  out.push(S(k.slabOf({ x: -74, y: 20, w: 84, d: 13, r: 2 }, 34, 2.5, P, 2, 0.4), { tone: "mid", className: "pcb-board" }));
  // Power transformer
  out.push(S(k.slabOf({ x: -70, y: 22, w: 14, d: 9, r: 1.5 }, 36.5, 7, P, 2, 0.5), { tone: "hi" }));
  // 2A Glass fuse holder
  out.push(S(k.slabOf({ x: -53, y: 22, w: 5, d: 9, r: 1 }, 36.5, 2.8, P, 2), { tone: "lit" }));
  // MCU Microprocessor IC + pin dots
  out.push(S(k.slabOf({ x: -45, y: 23, w: 16, d: 7, r: 1 }, 36.5, 2.2, P, 2), { tone: "lo" }));
  out.push(D([-43, -39, -35, -31].map((px) => at([px, 29.5, 38.8])), { size: 0.45, tone: "lit" }));
  // 3 Relays (Pump, Fan, Gas Valve)
  for (const rx of [-24, -14, -4]) {
    out.push(S(k.slabOf({ x: rx, y: 23, w: 7, d: 7, r: 1 }, 36.5, 5.5, P, 2, 0.4), { tone: "hi" }));
  }
  // Ignition spark module
  out.push(S(k.slabOf({ x: 5, y: 22, w: 6, d: 9, r: 1 }, 36.5, 6.5, P, 2, 0.4), { tone: "mid" }));
  // PCB status LED
  const pcbLed = at([-37, 26.5, 39]);
  out.push(`<circle cx="${pcbLed[0].toFixed(1)}" cy="${pcbLed[1].toFixed(1)}" r="2" fill="var(--anatomy-green)" class="pcb-led"/>`);
  out.push(`</g>`);
  pushPlane(6, [-32, 26, 36], out.join(""));
}

// 22. Front Control Fascia, Manometer, Knobs & 6 Diagnostic LEDs (پنل کنترل جلو)
const manoBasis = dialBasis([-34, 44.6, 23]);
const heatBasis = dialBasis([-8, 44.6, 23]);
const dhwBasis = dialBasis([12, 44.6, 23]);
const modeBasis = dialBasis([32, 44.6, 23]);
{
  const out = [];
  out.push(`<g data-part="control_panel" class="boiler-part">`);
  // Stepped console housing (top z=32 so main_pcb z=36..43 behind remains visible)
  const panelPlan = { x: -82, y: 35, w: 164, d: 9, r: 3 };
  out.push(S(k.slabOf(panelPlan, 14, 18, P, 3, 1), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(panelPlan, 1.5), 32, P), { tone: "lo" }));
  // Iran Radiator nameplate on front left
  const fPlate = G.frameAlong([-64, 44, 23], [0, 1, 0]);
  out.push(S(G.prismOf(fPlate, [[-12, -5], [12, -5], [12, 5], [-12, 5]], 0, 1.2, P), { tone: "hi" }));

  // Analog Manometer on front face (y=44)
  const fMano = G.frameAlong([-34, 44, 23], [0, 1, 0]);
  out.push(S(G.disc(0, 2.2, 7.6, fMano, P), { tone: "hi", lit: true }));
  out.push(L(G.circleOf(fMano, 2.3, 6.2, P, 28), { tone: "lo" }));
  // Green safe pressure arc (1 - 2 bar) & Red overpressure zone (>2.8 bar) & Needle
  const mc = manoBasis.o;
  const arcPts = (a0, a1, r) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const rad = ((a0 + ((a1 - a0) * i) / 10) * Math.PI) / 180;
      const cu = Math.sin(rad) * r;
      const cv = Math.cos(rad) * r;
      pts.push([mc[0] + manoBasis.u[0] * cu + manoBasis.v[0] * cv, mc[1] + manoBasis.u[1] * cu + manoBasis.v[1] * cv]);
    }
    return k.pathOf(pts);
  };
  out.push(`<path d="${k.pathOf(Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const cu = Math.cos(a) * 6.0;
    const cv = Math.sin(a) * 6.0;
    return [mc[0] + manoBasis.u[0] * cu + manoBasis.v[0] * cv, mc[1] + manoBasis.u[1] * cu + manoBasis.v[1] * cv];
  }), true)}" fill="#141414" stroke="var(--anatomy-mid)" stroke-width="0.6"/>`);
  out.push(`<path d="${arcPts(-62, 0, 4.9)}" stroke="var(--anatomy-green)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  out.push(`<path d="${arcPts(50, 125, 4.9)}" stroke="var(--anatomy-red)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`);
  out.push(`<line id="manometerNeedle" x1="${mc[0].toFixed(1)}" y1="${mc[1].toFixed(1)}" x2="${mc[0].toFixed(1)}" y2="${(mc[1]-5).toFixed(1)}" stroke="var(--anatomy-red)" stroke-width="1.4" stroke-linecap="round"/>`);

  // Heating Knob
  const fHeat = G.frameAlong([-8, 44, 23], [0, 1, 0]);
  out.push(S(G.disc(0, 3.5, 5.2, fHeat, P), { tone: "hi" }));
  out.push(`<line id="heatKnobLine" x1="${heatBasis.o[0].toFixed(1)}" y1="${heatBasis.o[1].toFixed(1)}" x2="${heatBasis.o[0].toFixed(1)}" y2="${(heatBasis.o[1]-4).toFixed(1)}" stroke="var(--anatomy-blue)" stroke-width="1.4" stroke-linecap="round"/>`);

  // DHW Knob
  const fDhw = G.frameAlong([12, 44, 23], [0, 1, 0]);
  out.push(S(G.disc(0, 3.5, 5.2, fDhw, P), { tone: "hi" }));
  out.push(`<line id="dhwKnobLine" x1="${dhwBasis.o[0].toFixed(1)}" y1="${dhwBasis.o[1].toFixed(1)}" x2="${dhwBasis.o[0].toFixed(1)}" y2="${(dhwBasis.o[1]-4).toFixed(1)}" stroke="var(--anatomy-red)" stroke-width="1.4" stroke-linecap="round"/>`);

  // Mode Selector Knob
  const fMode = G.frameAlong([32, 44, 23], [0, 1, 0]);
  out.push(S(G.disc(0, 3.2, 4.4, fMode, P), { tone: "mid" }));
  out.push(`<line id="modeKnobLine" x1="${modeBasis.o[0].toFixed(1)}" y1="${modeBasis.o[1].toFixed(1)}" x2="${modeBasis.o[0].toFixed(1)}" y2="${(modeBasis.o[1]-3.5).toFixed(1)}" stroke="var(--anatomy-lit)" stroke-width="1.3" stroke-linecap="round"/>`);

  // 6 Diagnostic LEDs: 30, 40, 50, 60, 70, 80
  const leds = [30, 40, 50, 60, 70, 80];
  leds.forEach((val, idx) => {
    const lx = 46 + idx * 5.8;
    const lp = at([lx, 44.3, 26]);
    const lb = at([lx, 44.3, 21]);
    out.push(`<circle cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="2.1" class="led-diag led-${val}" fill="var(--anatomy-lo)" stroke="var(--anatomy-mid)" stroke-width="0.4"/>`);
    out.push(`<text x="${lb[0].toFixed(1)}" y="${lb[1].toFixed(1)}" text-anchor="middle" font-size="4.4" fill="var(--anatomy-muted)" font-family="var(--anatomy-mono)">${val}</text>`);
  });

  // Reset micro-button
  const fRst = G.frameAlong([61, 44, 17], [0, 1, 0]);
  out.push(S(G.disc(0, 2, 2.2, fRst, P), { tone: "hi" }));
  out.push(`</g>`);
  pushPlane(7, [0, 40, 23], out.join(""));
}

// Sort all boiler parts strictly back-to-front
items.sort((a, b) => a.depth - b.depth);

// Animated Hydraulic, Gas & Exhaust Streamlines (rendered over sorted copper pipes)
const FLOW_OVERLAYS = `
<g class="flow-overlay" pointer-events="none">
  <!-- Heating Flow & Return Loop -->
  <path id="flowHeatReturn" class="iso-line flow-stream" stroke="var(--anatomy-blue)" d="${flowPathD([[64, -2, 12], [64, -2, 62], [64, -2, 204], [0, -2, 220]], 5)}" opacity="0"/>
  <path id="flowHeatSupply" class="iso-line flow-stream" stroke="var(--anatomy-red)" d="${flowPathD([[0, -2, 220], [-64, -2, 204], [-64, -2, 52], [-64, -2, 12]], 5)}" opacity="0"/>
  <!-- Internal DHW Primary Loop (Primary -> 3-Way -> Plate Exchanger -> Pump) -->
  <path id="flowDhwInternal" class="iso-line flow-stream" stroke="var(--anatomy-red)" d="${flowPathD([[64, -2, 80], [64, -2, 204], [-64, -2, 204], [-64, -2, 52], [-50, -16, 52], [-30, -16, 50], [46, -12, 46]], 5)}" opacity="0"/>
  <!-- Domestic Cold -> Flow Meter -> Plate Exchanger -> Hot Tap Outlet -->
  <path id="flowDhwDomestic" class="iso-line flow-stream" stroke="#38bdf8" d="${flowPathD([[32, -2, 12], [32, -2, 38], [32, -16, 48], [-30, -16, 50]], 5)}" opacity="0"/>
  <path id="flowDhwHotOut" class="iso-line flow-stream" stroke="#fb923c" d="${flowPathD([[-50, -16, 50], [-34, -4, 43], [-32, -2, 12]], 4)}" opacity="0"/>
  <!-- Gas Supply -->
  <path id="flowGas" class="iso-line flow-stream" stroke="#fbbf24" d="${flowPathD([[0, -2, 12], [0, -2, 52], [0, -2, 82], [0, -2, 124]], 3)}" opacity="0"/>
  <!-- Filling Loop Bypass -->
  <path id="flowFilling" class="iso-line flow-stream" stroke="#22d3ee" d="${flowPathD([[32, 3, 20], [48, 12, 20], [64, 3, 20]], 3)}" opacity="0"/>
  <!-- Coaxial Exhaust Flow -->
  <path id="flowFlue" class="iso-line flow-stream" stroke="var(--anatomy-muted)" d="${flowPathD([[0, -8, 295], [0, -8, 344]], 2)}" opacity="0"/>
</g>
`;

// 23. Outer Enamel Casing (کاور بیرونی با برش نمایش پنل کنترل پایین)
const OUTER_CASING = (() => {
  const out = [];
  out.push(`<g id="outerCasingGroup" class="boiler-part" data-part="outer_casing" style="opacity:0;pointer-events:none;transition:opacity 0.35s ease;">`);
  const casePlan = { x: -90, y: -40, w: 180, d: 78, r: 8 };
  out.push(
    S(k.slabOf(casePlan, 44, 258, P, 8, 2.2), {
      tone: "mid",
      className: "enamel-case",
      inner: `
        ${L(k.lineOnTop([-70, 34], [-35, 34], 296, P), { tone: "lo" })}
        ${L(k.lineOnTop([-70, 34], [-35, 34], 291, P), { tone: "lo" })}
        ${L(k.lineOnTop([35, 34], [70, 34], 296, P), { tone: "lo" })}
        ${L(k.lineOnTop([35, 34], [70, 34], 291, P), { tone: "lo" })}
      `,
    }),
  );
  // Flame viewing window cutout on casing front
  const fg = G.frameAlong([0, 38, 148], [0, 1, 0]);
  out.push(S(G.disc(0, 1.2, 8, fg, P), { tone: "lo" }));
  out.push(`</g>`);
  return out.join("");
})();

const DEFS = `
<defs>
  <linearGradient id="blueFlameGrad" x1="0%" y1="100%" x2="0%" y2="0%">
    <stop offset="0%" stop-color="#0066ff" stop-opacity="0.92"/>
    <stop offset="60%" stop-color="#00d4ff" stop-opacity="0.88"/>
    <stop offset="100%" stop-color="#ffffff" stop-opacity="0.95"/>
  </linearGradient>
  <filter id="flameGlow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="2.6" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>
`;

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "آناتومی مهندسی ایزومتریک پکیج دیواری ایران رادیاتور",
  className: "boiler-svg",
  body: [DEFS, ...items.map((item) => item.html), FLOW_OVERLAYS, OUTER_CASING].join("\n"),
});

const DIAL_AXES = {
  mano: manoBasis,
  heat: heatBasis,
  dhw: dhwBasis,
  mode: modeBasis,
  filling: fillingBasis,
};

const liveScript = `
const P = ${JSON.stringify(P)};
const DIALS = ${JSON.stringify(DIAL_AXES)};

// Layer mapping for system filter
const SYSTEM_LAYERS = {
  all: null,
  combustion: new Set(["combustion_chamber", "gas_burner", "primary_exchanger", "gas_valve", "limit_thermostat"]),
  hydraulics: new Set(["circulation_pump", "secondary_exchanger", "three_way_valve", "expansion_vessel", "safety_valve", "flow_meter", "filling_valve", "water_pressure_switch", "bottom_connections", "copper_pipes", "primary_exchanger"]),
  flue: new Set(["exhaust_system", "air_pressure_switch", "combustion_chamber"]),
  electronics: new Set(["main_pcb", "control_panel", "ntc_sensors", "limit_thermostat", "water_pressure_switch", "flow_meter", "air_pressure_switch", "three_way_valve", "gas_valve"])
};

// Iran Radiator Technical Knowledge Base
const KNOWLEDGE = {
  backplate: {
    title: "شاسی اصلی و صفحه نصب دیواری (Backplate)",
    desc: "تکیه‌گاه فولادی گالوانیزه با قلاب‌های تراز بالایی جهت تحمل وزن پکیج و عایق‌کاری پشت محفظه احتراق.",
    symptom: "لرزش بدنه و انتقال صدای فن یا پمپ به دیوار در صورت شل بودن رول‌بولت‌ها.",
    error: "مکانیکی — بدون خطای سنسور"
  },
  expansion_vessel: {
    title: "منبع انبساط دیافراگمی ۸ لیتری (Expansion Vessel)",
    desc: "جذب افزایش حجم آب مدار شوفاژ هنگام گرم شدن از طریق دیافراگم لاستیکی و باد نیتروژن ۱ بار پشت آن.",
    symptom: "بالا رفتن سریع فشار مانومتر هنگام داغ شدن رادیاتورها و تخلیه آب از شیر اطمینان ۳ بار.",
    error: "نوسان شدید فشار و چکه از شیر اطمینان (سپس خطای ۴۰-۷۰)"
  },
  exhaust_system: {
    title: "فن سانتریفیوژ و دودکش دوجداره ۶۰/۱۰۰ (Fan & Coaxial Flue)",
    desc: "تخلیه اجباری دود از لوله مرکزی ۶۰ میلی‌متری و مکش هوای تازه احتراق از جداره بیرونی ۱۰۰ میلی‌متری.",
    symptom: "قفل کردن پروانه، صدای زوزه بلبرینگ یا مسدود شدن مسیر خروجی دودکش.",
    error: "کد خطای ۴۰-۶۰-۸۰ (عدم گردش فن یا گرفتگی دودکش)"
  },
  air_pressure_switch: {
    title: "پرشر سوئیچ دود / هوا (Air Differential Switch)",
    desc: "سنسور اختلاف فشار دیافراگمی که با شیلنگ‌های ونتوری فن، باز بودن دودکش و مکش فن را به برد تایید می‌کند.",
    symptom: "فن کار می‌کند اما برد اجازه جرقه نمی‌دهد و شعله تشکیل نمی‌شود.",
    error: "کد خطای ۴۰-۶۰-۸۰ (خرابی پرشر هوا یا شیلنگ‌های سیلیکونی)"
  },
  combustion_chamber: {
    title: "محفظه احتراق بسته هرمتیک (Sealed Combustion Chamber)",
    desc: "محفظه آب‌بندی شده با عایق فیبر سرامیکی نسوز که تمام هوای احتراق را از بیرون ساختمان دریافت می‌کند.",
    symptom: "پوسیدگی واشر دور درب محفظه یا عایق سرامیکی باعث داغ شدن بیش از حد کاور می‌شود.",
    error: "بررسی دوره‌ای عایق حرارتی"
  },
  primary_exchanger: {
    title: "مبدل حرارتی اصلی مسی پره‌دار (Primary Heat Exchanger)",
    desc: "انتقال مستقیم حرارت مشعل به آب مدار شوفاژ از طریق لوله‌ها و پره‌های تمام‌مس با پوشش نسوز.",
    symptom: "صدای تق‌تق جوش آوردن آب به دلیل رسوب گچ و کاهش گردش آب در لوله‌ها.",
    error: "کد خطای ۸۰ یا ۴۰-۷۰ در صورت جوش آوردن مکرر"
  },
  limit_thermostat: {
    title: "ترموستات حد ۱۰۵ درجه (High-Limit Thermal Cutout)",
    desc: "کلید ایمنی سری شده با شیر گاز که با رسیدن دمای لوله رفت مبدل به ۱۰۵°C مدار احتراق را فوراً قطع می‌کند.",
    symptom: "پکیج ناگهان خاموش شده و حتی با ریست کردن، تا خنک شدن لوله اجازه روشن شدن نمی‌دهد.",
    error: "کد خطای ۸۰ (افزایش بیش از حد دمای مبدل اصلی)"
  },
  ntc_sensors: {
    title: "سنسورهای دمای NTC شوفاژ و آبگرم (NTC Thermistors)",
    desc: "ترمیستورهای ضریب منفی ۱۰ کیلو اهم جهت گزارش لحظه‌ای دمای مدار شوفاژ (لوله چپ) و آبگرم مصرفی (خروجی مبدل صفحه‌ای) به برد.",
    symptom: "سرد یا بیش از حد داغ شدن آب، نوسان دما یا استارت نخوردن گرمایش.",
    error: "کد خطای ۵۰-۸۰ (NTC شوفاژ) و ۵۰-۷۰ (NTC آبگرم مصرفی)"
  },
  gas_burner: {
    title: "مشعل استیل و الکترودهای جرقه / یونیزاسیون (Burner & Electrodes)",
    desc: "شعله‌پخش‌کن ۱۰ تیغه استنلس‌استیل با الکترود جرقه‌زن سرامیکی (چپ) و میله تشخیص شعله یونیزاسیون (راست).",
    symptom: "جرقه زدن طولانی، انفجاری روشن شدن یا خاموش شدن شعله ۳ ثانیه بعد از احتراق.",
    error: "کد خطای ۷۰-۸۰ (عدم تشکیل یا تشخیص شعله)"
  },
  secondary_exchanger: {
    title: "مبدل ثانویه صفحه‌ای ۱۶ پلیت استیل (Plate Heat Exchanger)",
    desc: "تبادل حرارت غیرمستقیم بین آب داغ مدار اولیه و آب سرد شهری بدون اختلاط دو مدار جهت تامین آبگرم بهداشتی.",
    symptom: "سرد و گرم شدن متناوب آب دوش حمام و افت فشار دبی آب گرم به علت رسوب‌گرفتگی.",
    error: "کاهش راندمان آبگرم مصرفی و بالا رفتن دمای مبدل (خطای ۸۰)"
  },
  three_way_valve: {
    title: "شیر سه‌طرفه موتوری برقی (3-Way Diverter Valve)",
    desc: "تغییر مسیر خودکار جریان آب داغ بین مدار رادیاتورها و مبدل صفحه‌ای (اولویت همیشگی با آبگرم مصرفی است).",
    symptom: "داغ شدن رادیاتورها در حالت تابستانه حین مصرف آبگرم یا سرد ماندن آب مصرفی در زمستان.",
    error: "گیرپاژ شفت یا خرابی موتور سنکرون ۲۲۰ ولت"
  },
  circulation_pump: {
    title: "پمپ سیرکولاتور و ایرونت خودکار (Circulation Pump & Air Vent)",
    desc: "چرخاندن مداوم آب در مدار بسته گرمایش همراه با هواگیر اتوماتیک برنجی در بالای کلگی پمپ.",
    symptom: "داغ شدن شدید مبدل اصلی و جوش آوردن دستگاه ظرف چند ثانیه پس از روشن شدن شعله.",
    error: "کد خطای ۸۰ (جوش آوردن سریع) یا ۴۰-۷۰ (عدم دبی آب)"
  },
  water_pressure_switch: {
    title: "پرشر سوئیچ حداقل فشار آب (Water Pressure Switch)",
    desc: "میکروسوئیچ دیافراگمی ایمنی که در فشار کمتر از ۰.۷ بار مدار را قطع می‌کند تا پکیج بدون آب روشن نشود.",
    symptom: "با وجود فشار ۱.۵ بار روی عقربه مانومتر، دستگاه همچنان خطای کم‌آبی می‌دهد (گرفتگی سوراخ دیافراغم).",
    error: "کد خطای ۴۰-۷۰ (افت فشار یا خرابی پرشر آب)"
  },
  flow_meter: {
    title: "فلومتر توربینی آب مصرفی (DHW Turbine Flow Meter)",
    desc: "حسگر اثر هال با پروانه چرخان در مسیر ورودی آب سرد که باز شدن شیر آبگرم خانه را با پالس دیجیتال به برد اعلام می‌کند.",
    symptom: "شیر آب گرم را باز می‌کنید اما پکیج هیچ عکس‌العملی نشان نمی‌دهد و آب سرد می‌ماند.",
    error: "عدم تشخیص تقاضای آبگرم (جرم‌گرفتگی توربین یا سوختن سنسور هال)"
  },
  gas_valve: {
    title: "شیر برقی گاز مدولار SIT 845 (SIT 845 Gas Valve)",
    desc: "مجهز به دو بوبین قطع ایمنی و یک بوبین مدولاسیون جریان-متغیر برای تنظیم دقیق ارتفاع شعله بین ۳۰ تا ۱۰۰ درصد.",
    symptom: "جرقه زده می‌شود ولی بوی گاز یا شعله‌ای نیست؛ یا شعله فقط با حداکثر قدرت می‌سوزد.",
    error: "کد خطای ۷۰-۸۰ (خرابی بوبین شیر گاز یا قطع جریان برق آن)"
  },
  filling_valve: {
    title: "شیر پرکن دستی مدار گرمایش (Manual Filling Valve)",
    desc: "شیر رابط بین ورودی آب سرد شهری و برگشت شوفاژ که با باز کردن آن، فشار مدار تا محدوده استاندارد ۱.۲ تا ۱.۵ بار تنظیم می‌شود.",
    symptom: "فراموش کردن بستن کامل شیر پرکن باعث بالا رفتن مداوم فشار تا ۳ بار و نشتی از شیر اطمینان می‌شود.",
    error: "تنظیم‌کننده خطای ۴۰-۷۰ (برای تست مستقیم روی این قطعه کلیک کنید!)"
  },
  safety_valve: {
    title: "شیر اطمینان فنری ۳ بار (3-Bar Safety Relief Valve)",
    desc: "سوپاپ مکانیکی محافظت از پوسته و مبدل‌ها که با عبور فشار آب از ۳ بار باز شده و آب اضافی را تخلیه می‌کند.",
    symptom: "چکه کردن دائمی آب زیر دستگاه به علت رسوب نشستن زیر واشر فنری پس از یک بار باز شدن.",
    error: "تخلیه اضطراری در فشار > ۳ بار و افت فشار متعاقب"
  },
  copper_pipes: {
    title: "شبکه لوله‌کشی مسی و مدارات هیدرولیک (Copper Piping)",
    desc: "لوله‌های تمام‌مس مقاوم در برابر خوردگی حرارتی که جریان رفت، برگشت، آب مصرفی و گاز را بین اجزا منتقل می‌کنند.",
    symptom: "نشتی از اورینگ‌ها و مهره‌ماسوره‌ها، هواگیری نشدن مدار یا زنگ‌زدگی اتصالات.",
    error: "افت تدریجی فشار بار و بروز خطای ۴۰-۷۰"
  },
  bottom_connections: {
    title: "اتصالات ۵ گانه استاندارد زیر پکیج (Bottom Manifold Ports)",
    desc: "از چپ به راست: رفت شوفاژ (3/4)، آبگرم مصرفی (1/2)، گاز (3/4)، آب سرد شهری (1/2) و برگشت شوفاژ (3/4).",
    symptom: "چکه زیر مهره‌ها یا یخ‌زدگی لوله‌ها در نصب بالکنی بدون عایق.",
    error: "نشتی و افت فشار سیستم"
  },
  main_pcb: {
    title: "برد اصلی کنترل الکترونیک (Main Microprocessor PCB)",
    desc: "مغز متفکر پکیج شامل میکروکنترلر، ترانس تغذیه، ۳ رله پمپ/فن/گاز، ماژول جرقه‌زن و فیوز شیشه‌ای ۲ آمپر.",
    symptom: "خاموشی کامل دستگاه، خطاهای کاذب متوالی، نرسیدن ولتاژ ۲۲۰ به پمپ یا فن (خرابی رله).",
    error: "چشمک زدن ترکیبی LEDها یا خاموشی کامل برد"
  },
  control_panel: {
    title: "پنل کنترل جلو، مانومتر و چراغ‌های عیب‌یاب (Fascia Panel)",
    desc: "رابط کاربری شامل مانومتر عقربه‌ای فشار، ولوم‌های دمای شوفاژ و آبگرم، سلکتور حالت و نوار ۶ تایی LEDهای ۳۰ تا ۸۰.",
    symptom: "عدم تغییر دما با چرخش ولوم (خرابی پتانسیومتر) یا گیر کردن عقربه مانومتر روی عدد ثابت.",
    error: "نمایشگر کدهای خطای ۳۰-۴۰-۵۰-۶۰-۷۰-۸۰ ایران رادیاتور"
  },
  outer_casing: {
    title: "کاور بیرونی با پوشش الکترواستاتیک (Outer Casing)",
    desc: "بدنه محافظ سفیدرنگ با شکاف‌های تهویه هوا در بالا و دسترسی آسان به پنل کنترل در قسمت پایین.",
    symptom: "لرزش کاور در صورت بسته نشدن پیچ‌های زیرین.",
    error: "محافظ فیزیکی اجزای داخلی"
  }
};

// Fault catalogue for Iran Radiator diagnostic simulator
const FAULT_META = {
  "40-70": {
    leds: [40, 70],
    part: "water_pressure_switch",
    banner: "⚠️ خطای ۴۰-۷۰: افت فشار آب (< ۰.۷ بار) یا قطع پرشر سوئیچ آب! شیر پرکن را باز کنید تا فشار به ۱.۵ بار برسد."
  },
  "40-60-80": {
    leds: [40, 60, 80],
    part: "air_pressure_switch",
    banner: "⚠️ خطای ۴۰-۶۰-۸۰: اختلال در فن تخلیه، گرفتگی دودکش دوجداره یا باز ماندن کنتاکت پرشر سوئیچ هوا."
  },
  "70-80": {
    leds: [70, 80],
    part: "gas_burner",
    banner: "⚠️ خطای ۷۰-۸۰: عدم تشکیل شعله یا عدم تشخیص یونیزاسیون! شیر گاز، الکترود جرقه یا فشار گاز ورودی بررسی شود."
  },
  "80": {
    leds: [80],
    part: "limit_thermostat",
    banner: "🔥 خطای ۸۰: دمای مبدل اصلی از ۱۰۵°C عبور کرد و ترموستات حد قطع شد (جوش آوردن / گیرپاژ پمپ یا رسوب مبدل)."
  },
  "50-80": {
    leds: [50, 80],
    part: "ntc_sensors",
    banner: "⚠️ خطای ۵۰-۸۰: قطع شدن یا اتصال کوتاه در سنسور NTC مدار گرمایش (شوفاژ) روی لوله رفت مبدل."
  },
  "50-70": {
    leds: [50, 70],
    part: "ntc_sensors",
    banner: "⚠️ خطای ۵۰-۷۰: قطع شدن یا خرابی سنسور NTC آبگرم مصرفی روی خروجی مبدل صفحه‌ای."
  },
  "3-BAR-LEAK": {
    leds: [],
    part: "safety_valve",
    banner: "💦 هشدار فشار بیش از حد (> ۳ بار): شیر اطمینان ۳ بار باز شده و در حال تخلیه آب است! شیر پرکن را ببندید."
  }
};

// DOM References
const flameGroup = document.querySelector("[data-flame]");
const ignitionSpark = document.getElementById("ignitionSpark");
const pumpSpinner = document.querySelector(".pump-spinner");
const fanSpinner = document.querySelector(".fan-spinner");
const flowSpinner = document.querySelector(".flow-spinner");
const valveDot = document.querySelector(".valve-indicator-dot");
const wpsDot = document.querySelector(".wps-dot");
const apsDot = document.querySelector(".aps-dot");
const limitDot = document.querySelector(".limit-dot");
const ntcHeatDot = document.querySelector(".ntc-heat-dot");
const ntcDhwDot = document.querySelector(".ntc-dhw-dot");
const pcbLed = document.querySelector(".pcb-led");
const sightGlass = document.querySelector(".sight-glass");
const safetyLeakDrops = document.getElementById("safetyLeakDrops");
const outerCasingEl = document.getElementById("outerCasingGroup");

// Flow overlay elements
const flowHeatReturn = document.getElementById("flowHeatReturn");
const flowHeatSupply = document.getElementById("flowHeatSupply");
const flowDhwInternal = document.getElementById("flowDhwInternal");
const flowDhwDomestic = document.getElementById("flowDhwDomestic");
const flowDhwHotOut = document.getElementById("flowDhwHotOut");
const flowGas = document.getElementById("flowGas");
const flowFilling = document.getElementById("flowFilling");
const flowFlue = document.getElementById("flowFlue");

// Needles / rotating markers
const manometerNeedle = document.getElementById("manometerNeedle");
const heatKnobLine = document.getElementById("heatKnobLine");
const dhwKnobLine = document.getElementById("dhwKnobLine");
const modeKnobLine = document.getElementById("modeKnobLine");
const fillingKnobLine = document.getElementById("fillingKnobLine");

// Controls & Readouts
const modeSelect = document.getElementById("modeSelect");
const tapToggle = document.getElementById("tapToggle");
const fillToggle = document.getElementById("fillToggle");
const heatSlider = document.getElementById("heatSlider");
const dhwSlider = document.getElementById("dhwSlider");
const pressSlider = document.getElementById("pressSlider");
const caseToggle = document.getElementById("caseToggle");
const themeToggle = document.getElementById("themeToggle");
const resetFaultBtn = document.getElementById("resetFaultBtn");
const statusBanner = document.getElementById("statusBanner");

const readoutMode = document.getElementById("readoutMode");
const readoutTemp = document.getElementById("readoutTemp");
const readoutDhw = document.getElementById("readoutDhw");
const readoutPress = document.getElementById("readoutPress");
const readoutFlame = document.getElementById("readoutFlame");
const readoutPump = document.getElementById("readoutPump");
const readoutFan = document.getElementById("readoutFan");
const readoutValve = document.getElementById("readoutValve");

const inspTitle = document.getElementById("inspTitle");
const inspDesc = document.getElementById("inspDesc");
const inspSymptom = document.getElementById("inspSymptom");
const inspErrorCode = document.getElementById("inspErrorCode");

// State
const state = {
  mode: "winter",
  tapOpen: false,
  fillingOpen: false,
  heatSet: 65,
  dhwSet: 45,
  pressure: 1.5,
  casingVisible: false,
  layer: "all",
  pinnedPart: null,
  injectedFault: null, // null | "40-70" | "40-60-80" | "70-80" | "80" | "50-80" | "50-70"
  activeFault: null,
  burnerOn: true,
  pumpOn: true,
  fanOn: true,
  flamePower: 78,
  currentTemp: 64,
  currentDhw: 21,
  pumpAngle: 0,
  fanAngle: 0,
  flowAngle: 0,
  blinkPhase: false
};

// Project a rotating dial pointer onto the precomputed isometric front-plane basis
function setDialLine(lineEl, basis, angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  // Angle 0 points straight up (+Z -> +V in frameAlong), +90 points right (+U)
  const cu = Math.sin(rad) * radius;
  const cv = Math.cos(rad) * radius;
  const ox = basis.o[0];
  const oy = basis.o[1];
  const tx = ox + basis.u[0] * cu + basis.v[0] * cv;
  const ty = oy + basis.u[1] * cu + basis.v[1] * cv;
  lineEl.setAttribute("x1", ox.toFixed(1));
  lineEl.setAttribute("y1", oy.toFixed(1));
  lineEl.setAttribute("x2", tx.toFixed(1));
  lineEl.setAttribute("y2", ty.toFixed(1));
}

function inspectPart(key, pin = false) {
  if (!key || !KNOWLEDGE[key]) return;
  const data = KNOWLEDGE[key];
  inspTitle.textContent = data.title;
  inspDesc.textContent = data.desc;
  inspSymptom.textContent = data.symptom;
  inspErrorCode.textContent = data.error;
  if (pin) state.pinnedPart = key;
  document.querySelectorAll(".boiler-part").forEach((el) => {
    const match = el.getAttribute("data-part") === key;
    el.classList.toggle("part-active", match);
  });
}

function applyLayerFilter(layer) {
  state.layer = layer;
  const allow = SYSTEM_LAYERS[layer];
  document.querySelectorAll("[data-layer-btn]").forEach((btn) => {
    const active = btn.getAttribute("data-layer-btn") === layer;
    btn.classList.toggle("chip-active", active);
  });
  document.querySelectorAll(".boiler-part").forEach((el) => {
    const part = el.getAttribute("data-part");
    if (!part || part === "outer_casing") return;
    if (!allow) el.classList.remove("part-dimmed");
    else el.classList.toggle("part-dimmed", !allow.has(part));
  });
}

function updateFaultButtons() {
  document.querySelectorAll("[data-fault-btn]").forEach((btn) => {
    const code = btn.getAttribute("data-fault-btn");
    const active = (code === "none" && !state.injectedFault && !state.activeFault) || state.activeFault === code;
    btn.classList.toggle("fault-active", active);
  });
}

function clearLeds() {
  document.querySelectorAll(".led-diag").forEach((el) => {
    el.setAttribute("fill", "var(--anatomy-lo)");
    el.style.filter = "none";
  });
}

function setLed(num, color) {
  const el = document.querySelector(".led-" + num);
  if (el) {
    el.setAttribute("fill", color);
    el.style.filter = "drop-shadow(0 0 3px " + color + ")";
  }
}

function tick() {
  state.blinkPhase = !state.blinkPhase;

  // Interactive Filling Valve behavior (rounded to avoid IEEE-754 drift)
  if (state.fillingOpen) {
    state.pressure = Math.min(3.4, Math.round((state.pressure + 0.12) * 100) / 100);
    pressSlider.value = state.pressure.toFixed(1);
    document.getElementById("pressVal").textContent = state.pressure.toFixed(1) + " bar";
    if (state.pressure >= 0.7 && state.injectedFault === "40-70") {
      state.injectedFault = null;
    }
  }

  // Overpressure safety bleed
  if (state.pressure > 3.0 && !state.fillingOpen) {
    state.pressure = Math.max(2.9, Math.round((state.pressure - 0.03) * 100) / 100);
    pressSlider.value = state.pressure.toFixed(1);
    document.getElementById("pressVal").textContent = state.pressure.toFixed(1) + " bar";
  }

  // Resolve Active Fault
  if (state.injectedFault) {
    state.activeFault = state.injectedFault;
  } else if (state.pressure < 0.7) {
    state.activeFault = "40-70";
  } else if (state.pressure > 3.0) {
    state.activeFault = "3-BAR-LEAK";
  } else {
    state.activeFault = null;
  }

  // Operation & Thermal State Machine
  if (state.mode === "off") {
    state.burnerOn = false;
    state.pumpOn = false;
    state.fanOn = false;
    state.flamePower = 0;
  } else if (state.activeFault && state.activeFault !== "3-BAR-LEAK") {
    state.burnerOn = false;
    state.flamePower = 0;
    if (state.activeFault === "40-60-80") {
      state.fanOn = false;
      state.pumpOn = false;
    } else if (state.activeFault === "80") {
      // Overheat: pump keeps running for emergency cooling!
      state.pumpOn = true;
      state.fanOn = true;
      state.currentTemp = Math.min(106, state.currentTemp + 2.5);
    } else if (state.activeFault === "70-80") {
      state.fanOn = true;
      state.pumpOn = true;
    } else {
      state.fanOn = false;
      state.pumpOn = false;
    }
  } else if (state.mode === "summer") {
    if (state.tapOpen) {
      state.burnerOn = true;
      state.pumpOn = true;
      state.fanOn = true;
      state.flamePower = Math.max(35, Math.min(100, Math.round(35 + (state.dhwSet - 30) * 2)));
      state.currentDhw += (state.dhwSet - state.currentDhw) * 0.16;
      state.currentTemp += (36 - state.currentTemp) * 0.05;
    } else {
      state.burnerOn = false;
      state.pumpOn = false;
      state.fanOn = false;
      state.flamePower = 0;
      state.currentDhw += (19 - state.currentDhw) * 0.06;
      state.currentTemp += (24 - state.currentTemp) * 0.04;
    }
  } else if (state.mode === "winter") {
    if (state.tapOpen) {
      state.burnerOn = true;
      state.pumpOn = true;
      state.fanOn = true;
      state.flamePower = Math.max(40, Math.min(100, Math.round(40 + (state.dhwSet - 30) * 1.9)));
      state.currentDhw += (state.dhwSet - state.currentDhw) * 0.16;
    } else {
      state.burnerOn = true;
      state.pumpOn = true;
      state.fanOn = true;
      state.flamePower = Math.max(30, Math.min(100, Math.round(30 + (state.heatSet - 30) * 1.3)));
      state.currentTemp += (state.heatSet - state.currentTemp) * 0.12;
      state.currentDhw += (19 - state.currentDhw) * 0.06;
    }
  }

  // Update Rotating Visuals
  if (state.pumpOn) state.pumpAngle = (state.pumpAngle + 45) % 360;
  if (state.fanOn) state.fanAngle = (state.fanAngle + 65) % 360;
  if (state.tapOpen) state.flowAngle = (state.flowAngle + 70) % 360;

  pumpSpinner.style.transform = "rotate(" + state.pumpAngle + "deg)";
  fanSpinner.style.transform = "rotate(" + state.fanAngle + "deg)";
  flowSpinner.style.transform = "rotate(" + state.flowAngle + "deg)";

  // Flame & Sight glass
  const flameScaleY = state.burnerOn ? (0.45 + (state.flamePower / 100) * 0.65).toFixed(2) : "0.1";
  flameGroup.style.opacity = state.burnerOn ? "0.96" : "0";
  flameGroup.style.transform = "scaleY(" + flameScaleY + ")";
  sightGlass.setAttribute("fill", state.burnerOn ? "#00b4ffaa" : "#111111aa");
  ignitionSpark.setAttribute("opacity", state.activeFault === "70-80" && state.blinkPhase ? "1" : "0");

  // Safety leak droplets
  safetyLeakDrops.setAttribute("opacity", state.pressure > 3.0 && state.blinkPhase ? "0.95" : "0");

  // Front Panel Isometric Needles & Knobs
  setDialLine(manometerNeedle, DIALS.mano, -125 + (state.pressure / 4) * 250, 5.4);
  setDialLine(heatKnobLine, DIALS.heat, -120 + ((state.heatSet - 30) / 55) * 240, 4.2);
  setDialLine(dhwKnobLine, DIALS.dhw, -120 + ((state.dhwSet - 30) / 30) * 240, 4.2);
  const modeAng = state.mode === "off" ? -70 : state.mode === "summer" ? 0 : 70;
  setDialLine(modeKnobLine, DIALS.mode, modeAng, 3.6);
  setDialLine(fillingKnobLine, DIALS.filling, state.fillingOpen ? 90 : 0, 3.4);

  // Sensor & Actuator Indicator Dots
  if (state.mode === "off") {
    valveDot.setAttribute("fill", "var(--anatomy-mid)");
    readoutValve.textContent = "خاموش (Standby)";
    readoutValve.style.color = "var(--anatomy-muted)";
  } else if (state.tapOpen) {
    valveDot.setAttribute("fill", "var(--anatomy-green)");
    readoutValve.textContent = "اولویت آبگرم مصرفی (DHW Priority)";
    readoutValve.style.color = "var(--anatomy-green)";
  } else if (state.mode === "winter") {
    valveDot.setAttribute("fill", "var(--anatomy-blue)");
    readoutValve.textContent = "مدار رادیاتورها (Central Heating)";
    readoutValve.style.color = "var(--anatomy-blue)";
  } else {
    valveDot.setAttribute("fill", "var(--anatomy-mid)");
    readoutValve.textContent = "آماده‌به‌کار تابستانه";
    readoutValve.style.color = "var(--anatomy-muted)";
  }

  wpsDot.setAttribute("fill", state.activeFault === "40-70" || state.pressure < 0.7 ? "var(--anatomy-red)" : "var(--anatomy-green)");
  apsDot.setAttribute("fill", state.activeFault === "40-60-80" ? "var(--anatomy-red)" : state.fanOn ? "var(--anatomy-green)" : "var(--anatomy-mid)");
  limitDot.setAttribute("fill", state.activeFault === "80" ? "var(--anatomy-red)" : "var(--anatomy-mid)");
  ntcHeatDot.setAttribute("fill", state.activeFault === "50-80" ? "var(--anatomy-red)" : "var(--anatomy-blue)");
  ntcDhwDot.setAttribute("fill", state.activeFault === "50-70" ? "var(--anatomy-red)" : "var(--anatomy-red)");
  pcbLed.setAttribute("fill", state.activeFault ? "var(--anatomy-red)" : "var(--anatomy-green)");

  // Animated Hydraulic & Gas Streamlines
  const heatingActive = state.pumpOn && state.mode === "winter" && !state.tapOpen && !state.activeFault;
  const dhwLoopActive = state.pumpOn && state.tapOpen && (!state.activeFault || state.activeFault === "3-BAR-LEAK");
  const domesticActive = state.tapOpen && state.activeFault !== "50-70";
  flowHeatReturn.setAttribute("opacity", heatingActive ? "0.85" : "0");
  flowHeatSupply.setAttribute("opacity", heatingActive ? "0.85" : "0");
  flowDhwInternal.setAttribute("opacity", dhwLoopActive ? "0.9" : "0");
  flowDhwDomestic.setAttribute("opacity", state.tapOpen ? "0.9" : "0");
  flowDhwHotOut.setAttribute("opacity", domesticActive && state.burnerOn ? "0.9" : "0");
  flowGas.setAttribute("opacity", state.burnerOn ? "0.95" : "0");
  flowFilling.setAttribute("opacity", state.fillingOpen ? "0.95" : "0");
  flowFlue.setAttribute("opacity", state.fanOn ? "0.7" : "0");

  // Fault Highlight Pulse
  const faultPart = state.activeFault && FAULT_META[state.activeFault] ? FAULT_META[state.activeFault].part : null;
  document.querySelectorAll(".boiler-part").forEach((el) => {
    const p = el.getAttribute("data-part");
    el.classList.toggle("part-fault", Boolean(faultPart && p === faultPart));
  });

  // Diagnostic LEDs & Banner
  clearLeds();
  if (state.activeFault && FAULT_META[state.activeFault]) {
    const f = FAULT_META[state.activeFault];
    if (f.leds.length) {
      if (state.blinkPhase) f.leds.forEach((n) => setLed(n, "var(--anatomy-red)"));
    } else if (state.burnerOn) {
      [30, 40, 50, 60].forEach((n) => setLed(n, "var(--anatomy-green)"));
    }
    statusBanner.textContent = f.banner;
    statusBanner.style.color = "var(--anatomy-red)";
    statusBanner.style.borderColor = "var(--anatomy-red)";
  } else if (state.burnerOn) {
    const activeTemp = state.tapOpen ? state.currentDhw : state.currentTemp;
    [30, 40, 50, 60, 70, 80].forEach((t) => {
      if (activeTemp >= t - 5) setLed(t, "var(--anatomy-green)");
    });
    statusBanner.textContent = state.tapOpen
      ? "✅ در حال تامین آبگرم مصرفی (DHW Priority): فلومتر فعال، شیر سه‌طرفه روی مبدل صفحه‌ای، مشعل روشن."
      : "✅ وضعیت عادی گرمایش (Winter CH): احتراق مدولار فعال، پمپ در گردش و انتقال حرارت به رادیاتورها.";
    statusBanner.style.color = "var(--anatomy-green)";
    statusBanner.style.borderColor = "var(--anatomy-lo)";
  } else {
    if (state.mode !== "off") setLed(30, "var(--anatomy-green)");
    statusBanner.textContent = state.mode === "off"
      ? "⚫ پکیج خاموش (Standby): تغذیه برق برد متصل، تمام مشعل‌ها و پمپ متوقف است."
      : "⚪ آماده‌به‌کار (تابستانه): در انتظار باز شدن شیر آبگرم و فرمان فلومتر توربینی.";
    statusBanner.style.color = "var(--anatomy-text)";
    statusBanner.style.borderColor = "var(--anatomy-lo)";
  }

  // Telemetry Readouts
  readoutMode.textContent = state.mode === "winter" ? "زمستانه (شوفاژ + آبگرم)" : state.mode === "summer" ? "تابستانه (فقط آبگرم)" : "خاموش";
  readoutTemp.textContent = state.activeFault === "50-80" ? "ERR (NTC)" : Math.round(state.currentTemp) + " °C";
  readoutDhw.textContent = state.activeFault === "50-70" ? "ERR (NTC)" : Math.round(state.currentDhw) + " °C";
  readoutPress.textContent = state.pressure.toFixed(1) + " bar";
  readoutPress.style.color = state.pressure < 0.7 || state.pressure > 3.0 ? "var(--anatomy-red)" : "var(--anatomy-green)";
  readoutFlame.textContent = state.burnerOn ? "روشن (Modulating " + state.flamePower + "%)" : "خاموش";
  readoutFlame.style.color = state.burnerOn ? "var(--anatomy-blue)" : "var(--anatomy-muted)";
  readoutPump.textContent = state.pumpOn ? "در حال گردش" : "متوقف";
  readoutPump.style.color = state.pumpOn ? "var(--anatomy-green)" : "var(--anatomy-muted)";
  readoutFan.textContent = state.fanOn ? "فعال (Venturi OK)" : "خاموش";
  readoutFan.style.color = state.fanOn ? "var(--anatomy-green)" : "var(--anatomy-muted)";

  updateFaultButtons();
}

// Event Listeners
modeSelect.addEventListener("change", (e) => {
  state.mode = e.target.value;
  tick();
});

tapToggle.addEventListener("click", () => {
  state.tapOpen = !state.tapOpen;
  tapToggle.textContent = state.tapOpen ? "🚰 بستن شیر آبگرم (Close Tap)" : "🚰 باز کردن شیر آبگرم (Open Tap)";
  tapToggle.classList.toggle("btn-active", state.tapOpen);
  tick();
});

function toggleFilling() {
  state.fillingOpen = !state.fillingOpen;
  fillToggle.textContent = state.fillingOpen ? "💧 بستن شیر پرکن (در حال پر کردن...)" : "💧 باز کردن شیر پرکن (تنظیم فشار)";
  fillToggle.classList.toggle("btn-active", state.fillingOpen);
  tick();
}
fillToggle.addEventListener("click", toggleFilling);
document.getElementById("svgFillingValve").addEventListener("click", (e) => {
  e.stopPropagation();
  inspectPart("filling_valve", true);
  toggleFilling();
});

heatSlider.addEventListener("input", (e) => {
  state.heatSet = Number(e.target.value);
  document.getElementById("heatVal").textContent = state.heatSet + "°C";
  tick();
});

dhwSlider.addEventListener("input", (e) => {
  state.dhwSet = Number(e.target.value);
  document.getElementById("dhwVal").textContent = state.dhwSet + "°C";
  tick();
});

pressSlider.addEventListener("input", (e) => {
  state.pressure = Number(e.target.value);
  document.getElementById("pressVal").textContent = state.pressure.toFixed(1) + " bar";
  tick();
});

caseToggle.addEventListener("click", () => {
  state.casingVisible = !state.casingVisible;
  outerCasingEl.style.opacity = state.casingVisible ? "0.95" : "0";
  outerCasingEl.style.pointerEvents = state.casingVisible ? "auto" : "none";
  caseToggle.textContent = state.casingVisible ? "👁️ مخفی‌سازی کاور (نمای داخلی)" : "📦 نمایش کاور بیرونی";
});

themeToggle.addEventListener("click", () => {
  const body = document.body;
  const next = body.getAttribute("data-theme") === "light" ? "dark" : "light";
  body.setAttribute("data-theme", next);
  themeToggle.textContent = next === "light" ? "🌙 تم تاریک" : "☀️ تم روشن";
});

resetFaultBtn.addEventListener("click", () => {
  state.injectedFault = null;
  state.fillingOpen = false;
  fillToggle.textContent = "💧 باز کردن شیر پرکن (تنظیم فشار)";
  fillToggle.classList.remove("btn-active");
  if (state.pressure < 0.9 || state.pressure > 2.8) {
    state.pressure = 1.5;
    pressSlider.value = "1.5";
    document.getElementById("pressVal").textContent = "1.5 bar";
  }
  state.currentTemp = Math.min(state.currentTemp, state.heatSet);
  tick();
});

// System layer filters
document.querySelectorAll("[data-layer-btn]").forEach((btn) => {
  btn.addEventListener("click", () => applyLayerFilter(btn.getAttribute("data-layer-btn")));
});

// Fault simulator buttons
document.querySelectorAll("[data-fault-btn]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const code = btn.getAttribute("data-fault-btn");
    if (code === "none") {
      resetFaultBtn.click();
      return;
    }
    state.injectedFault = code;
    if (code === "40-70") {
      state.pressure = 0.4;
      pressSlider.value = "0.4";
      document.getElementById("pressVal").textContent = "0.4 bar";
    }
    if (FAULT_META[code]) inspectPart(FAULT_META[code].part, true);
    tick();
  });
});

// Part hover & tap-to-pin inspection (mobile friendly!)
document.querySelectorAll(".boiler-part").forEach((el) => {
  el.addEventListener("mouseenter", () => {
    if (!state.pinnedPart) inspectPart(el.getAttribute("data-part"), false);
  });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    const key = el.getAttribute("data-part");
    if (key === "filling_valve") return;
    inspectPart(key, true);
  });
});

document.querySelector(".boiler-svg").addEventListener("click", () => {
  state.pinnedPart = null;
  document.querySelectorAll(".boiler-part").forEach((el) => el.classList.remove("part-active"));
});

// Quick-inspect part selector pills for easy touch exploration
document.querySelectorAll("[data-jump-part]").forEach((btn) => {
  btn.addEventListener("click", () => inspectPart(btn.getAttribute("data-jump-part"), true));
});

// Start simulation loop
tick();
setInterval(tick, 350);
`;

const pageCss = `
<style>
.anatomy-container { direction: rtl; text-align: right; font-family: system-ui, -apple-system, sans-serif; }
.boiler-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
@media (max-width: 960px) {
  .iso-page { width: min(1200px, 100% - 16px) !important; margin: 16px auto 48px !important; }
  .boiler-grid { grid-template-columns: 1fr; gap: 14px; }
}
.boiler-card { background: var(--anatomy-card); border: 1px solid var(--anatomy-lo); border-radius: 12px; padding: 14px; box-shadow: var(--anatomy-lift); min-width: 0; }
.iso-btn {
  padding: 7px 12px; min-height: 38px; border-radius: 7px; cursor: pointer; font-size: 12px; font-weight: 600;
  background: var(--anatomy-face); color: var(--anatomy-strong); border: 1px solid var(--anatomy-lo);
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
}
.iso-btn:hover { border-color: var(--anatomy-mid); }
.iso-btn.btn-active { background: var(--anatomy-blue); color: #fff; border-color: var(--anatomy-blue); }
.chip-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip-btn {
  padding: 6px 10px; min-height: 36px; border-radius: 999px; cursor: pointer; font-size: 11.5px; font-weight: 600;
  background: var(--anatomy-face); color: var(--anatomy-text); border: 1px solid var(--anatomy-lo);
}
.chip-btn.chip-active { background: var(--anatomy-blue); color: #fff; border-color: var(--anatomy-blue); }
.chip-btn.fault-active { background: var(--anatomy-red); color: #fff; border-color: var(--anatomy-red); }
.boiler-part { cursor: pointer; transition: opacity 0.25s ease, filter 0.2s ease; }
.boiler-part.part-dimmed { opacity: 0.13; }
.boiler-part.part-active { filter: drop-shadow(0 0 6px var(--anatomy-blue)); }
.boiler-part.part-fault { filter: drop-shadow(0 0 8px var(--anatomy-red)); }
.flow-stream { stroke-width: 2.3 !important; stroke-dasharray: 4 7 !important; stroke-linecap: round; animation: iso-flow 1100ms linear infinite; transition: opacity 0.25s ease; }
.pcb-board .iso-top, .pcb-board .iso-fill { fill: #133b27; }
[data-theme="light"] .pcb-board .iso-top, [data-theme="light"] .pcb-board .iso-fill { fill: #cbe8d6; }
.copper-fins .iso-top { fill: #5e3824; }
[data-theme="light"] .copper-fins .iso-top { fill: #e3b298; }
.copper-part .iso-shade, .copper-part .iso-top { fill: #9c5b37; }
[data-theme="light"] .copper-part .iso-shade, [data-theme="light"] .copper-part .iso-top { fill: #d68b60; }
.gas-coil-blue .iso-shade { fill: #1e40af; }
.safety-knob-red .iso-top { fill: #b91c1c; }
@media (prefers-reduced-motion: reduce) {
  .flow-stream { animation: none; }
}
</style>
`;

const bodyHtml = `
${pageCss}
<div class="anatomy-container">
  <header style="margin-bottom:14px;border-bottom:1px solid var(--anatomy-lo);padding-bottom:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <h1 style="margin:0;font-size:20px;color:var(--anatomy-strong);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        🔥 آناتومی مهندسی پکیج دیواری ایران رادیاتور
        <span style="font-size:11px;background:var(--anatomy-face);border:1px solid var(--anatomy-lo);padding:2px 8px;border-radius:4px;color:var(--anatomy-hi);">سری L / M / E دو مبدله</span>
      </h1>
      <p style="margin:4px 0 0;font-size:12.5px;color:var(--anatomy-text);">
        مدل ایزومتریک تعاملی ۲۲ قطعه کلیدی، جریان هیدرولیک زنده و شبیه‌ساز کدهای خطای برد آنالوگ
      </p>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button id="themeToggle" class="iso-btn">${THEME === "light" ? "🌙 تم تاریک" : "☀️ تم روشن"}</button>
      <button id="caseToggle" class="iso-btn">📦 نمایش کاور بیرونی</button>
      <button id="resetFaultBtn" class="iso-btn btn-active">🔄 ریست برد و خطاها</button>
    </div>
  </header>

  <div id="statusBanner" style="background:var(--anatomy-card);border:1px solid var(--anatomy-lo);padding:10px 14px;border-radius:8px;font-size:12.5px;font-weight:600;margin-bottom:14px;color:var(--anatomy-green);">
    ✅ در حال بارگذاری وضعیت...
  </div>

  <div class="boiler-grid">
    <!-- Left Stage: Isometric Boiler Diagram + Layer Filters -->
    <div class="boiler-card" style="position:relative;">
      <div class="chip-bar" aria-label="فیلتر لایه‌های سیستم">
        <button class="chip-btn chip-active" data-layer-btn="all">همه سیستم‌ها</button>
        <button class="chip-btn" data-layer-btn="combustion">🔥 احتراق و گاز</button>
        <button class="chip-btn" data-layer-btn="hydraulics">💧 هیدرولیک و آب</button>
        <button class="chip-btn" data-layer-btn="flue">💨 دودکش و هوا</button>
        <button class="chip-btn" data-layer-btn="electronics">⚡ الکترونیک و سنسورها</button>
      </div>

      <div class="iso-stage" style="width:100%;max-width:520px;margin:0 auto;position:relative;">
        <div style="position:absolute;top:4px;left:4px;background:var(--anatomy-face);opacity:0.88;padding:3px 8px;border-radius:5px;border:1px solid var(--anatomy-lo);font-size:10px;color:var(--anatomy-muted);direction:ltr;pointer-events:none;">
          ISOMETRIC · Az 42° · El 30°
        </div>
        ${svg}
      </div>

      <div style="margin-top:10px;border-top:1px solid var(--anatomy-lo);padding-top:10px;">
        <div style="font-size:11px;color:var(--anatomy-muted);margin-bottom:6px;">
          💡 برای مشاهده جزئیات فنی روی هر قطعه در تصویر ضربه بزنید یا از دسترسی سریع زیر استفاده کنید:
        </div>
        <div class="chip-bar" style="margin-bottom:0;">
          <button class="chip-btn" data-jump-part="filling_valve">شیر پرکن</button>
          <button class="chip-btn" data-jump-part="flow_meter">فلومتر</button>
          <button class="chip-btn" data-jump-part="ntc_sensors">سنسورهای NTC</button>
          <button class="chip-btn" data-jump-part="water_pressure_switch">پرشر آب</button>
          <button class="chip-btn" data-jump-part="main_pcb">برد اصلی</button>
          <button class="chip-btn" data-jump-part="three_way_valve">شیر سه‌طرفه</button>
          <button class="chip-btn" data-jump-part="gas_valve">شیر گاز SIT</button>
          <button class="chip-btn" data-jump-part="air_pressure_switch">پرشر هوا</button>
        </div>
      </div>
    </div>

    <!-- Right Column: Controls, Fault Simulator, Telemetry, Inspector -->
    <div style="display:flex;flex-direction:column;gap:14px;min-width:0;">

      <!-- Operating Controls -->
      <div class="boiler-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--anatomy-strong);border-bottom:1px solid var(--anatomy-lo);padding-bottom:6px;">
          🎛️ کنترل عملکرد پکیج
        </h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="font-size:12px;color:var(--anatomy-text);display:block;margin-bottom:4px;">حالت کاری دستگاه:</label>
            <select id="modeSelect" style="width:100%;min-height:38px;padding:6px 10px;background:var(--anatomy-face);color:var(--anatomy-strong);border:1px solid var(--anatomy-mid);border-radius:6px;font-size:12px;">
              <option value="winter" selected>زمستانه (شوفاژ + آبگرم)</option>
              <option value="summer">تابستانه (فقط آبگرم مصرفی)</option>
              <option value="off">خاموش (Standby)</option>
            </select>
          </div>

          <div style="display:grid;grid-template-columns:1fr;gap:8px;">
            <button id="tapToggle" class="iso-btn">🚰 باز کردن شیر آبگرم (Open Tap)</button>
            <button id="fillToggle" class="iso-btn">💧 باز کردن شیر پرکن (تنظیم فشار)</button>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span>دمای شوفاژ:</span><strong id="heatVal" style="color:var(--anatomy-blue);">65°C</strong>
            </div>
            <input id="heatSlider" type="range" min="30" max="85" value="65" style="width:100%;accent-color:var(--anatomy-blue);">
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span>دمای آبگرم مصرفی:</span><strong id="dhwVal" style="color:var(--anatomy-red);">45°C</strong>
            </div>
            <input id="dhwSlider" type="range" min="30" max="60" value="45" style="width:100%;accent-color:var(--anatomy-red);">
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span>فشار هیدرولیک (مانومتر):</span><strong id="pressVal" style="color:var(--anatomy-green);">1.5 bar</strong>
            </div>
            <input id="pressSlider" type="range" min="0.2" max="3.4" step="0.1" value="1.5" style="width:100%;accent-color:var(--anatomy-green);">
          </div>
        </div>
      </div>

      <!-- Iran Radiator Diagnostic Fault Simulator -->
      <div class="boiler-card">
        <h3 style="margin:0 0 10px;font-size:14px;color:var(--anatomy-strong);border-bottom:1px solid var(--anatomy-lo);padding-bottom:6px;">
          🚨 شبیه‌ساز کدهای خطای ایران رادیاتور
        </h3>
        <div class="chip-bar" style="margin-bottom:0;">
          <button class="chip-btn fault-active" data-fault-btn="none">✅ عملکرد عادی</button>
          <button class="chip-btn" data-fault-btn="40-70">40-70 افت فشار</button>
          <button class="chip-btn" data-fault-btn="40-60-80">40-60-80 فن/دودکش</button>
          <button class="chip-btn" data-fault-btn="70-80">70-80 عدم شعله</button>
          <button class="chip-btn" data-fault-btn="80">80 جوش آوردن >105°</button>
          <button class="chip-btn" data-fault-btn="50-80">50-80 NTC شوفاژ</button>
          <button class="chip-btn" data-fault-btn="50-70">50-70 NTC آبگرم</button>
        </div>
      </div>

      <!-- Live Telemetry -->
      <div class="boiler-card">
        <div style="font-size:12px;font-weight:700;color:var(--anatomy-strong);margin-bottom:8px;">📊 تله‌متری لحظه‌ای برد</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11.5px;">
          <div>وضعیت: <strong id="readoutMode" style="color:var(--anatomy-strong);">-</strong></div>
          <div>فشار مدار: <strong id="readoutPress" style="color:var(--anatomy-green);direction:ltr;display:inline-block;">1.5 bar</strong></div>
          <div>دمای شوفاژ: <strong id="readoutTemp" style="color:var(--anatomy-blue);direction:ltr;display:inline-block;">64 °C</strong></div>
          <div>دمای آبگرم: <strong id="readoutDhw" style="color:var(--anatomy-red);direction:ltr;display:inline-block;">21 °C</strong></div>
          <div>مشعل: <strong id="readoutFlame">-</strong></div>
          <div>پمپ: <strong id="readoutPump">-</strong></div>
          <div>فن دودکش: <strong id="readoutFan">-</strong></div>
          <div>شیر ۳ طرفه: <strong id="readoutValve">-</strong></div>
        </div>
      </div>

      <!-- Technical Component Inspector -->
      <div id="inspectorCard" class="boiler-card" style="border-color:var(--anatomy-blue);">
        <h4 id="inspTitle" style="margin:0 0 8px;font-size:13.5px;color:var(--anatomy-strong);border-bottom:1px solid var(--anatomy-lo);padding-bottom:6px;">
          🔍 بازرس فنی قطعات (روی یک قطعه کلیک کنید)
        </h4>
        <div style="font-size:12px;line-height:1.65;color:var(--anatomy-text);margin-bottom:8px;">
          <strong>عملکرد مهندسی:</strong> <span id="inspDesc">تمام ۲۲ قطعه کلیدی پکیج شامل مدار احتراق، پمپ، مبدل‌ها، فلومتر، سنسورهای NTC، پرشر آب و برد اصلی قابل بررسی و آزمایش هستند.</span>
        </div>
        <div style="font-size:12px;line-height:1.65;color:var(--anatomy-text);margin-bottom:8px;">
          <strong>علائم خرابی:</strong> <span id="inspSymptom" style="color:var(--anatomy-red);">برای شبیه‌سازی خرابی، از پنل کدهای خطا یا شیر پرکن استفاده کنید.</span>
        </div>
        <div style="font-size:11.5px;line-height:1.6;color:var(--anatomy-text);background:var(--anatomy-face);padding:6px 10px;border-radius:6px;border-right:3px solid var(--anatomy-red);">
          <strong>کد خطای مرتبط:</strong> <span id="inspErrorCode" style="color:var(--anatomy-strong);font-weight:600;">چراغ‌های ۳۰، ۴۰، ۵۰، ۶۰، ۷۰، ۸۰</span>
        </div>
      </div>

    </div>
  </div>

  <!-- Piping Legend Footer -->
  <footer style="margin-top:18px;border-top:1px solid var(--anatomy-lo);padding-top:12px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--anatomy-muted);">
    <div style="display:flex;flex-wrap:wrap;gap:12px;">
      <span>🔴 <strong>رفت شوفاژ:</strong> 3/4 اینچ</span>
      <span>🟠 <strong>آبگرم مصرفی:</strong> 1/2 اینچ</span>
      <span>🟡 <strong>ورودی گاز:</strong> 3/4 اینچ</span>
      <span>🩵 <strong>آب سرد شهری:</strong> 1/2 اینچ</span>
      <span>🔵 <strong>برگشت شوفاژ:</strong> 3/4 اینچ</span>
    </div>
    <div>ساخته‌شده با Anatomy Isometric Kit</div>
  </footer>
</div>
`;

const fullHtml = k.pageHtml({
  title: "Iran Radiator Combi Boiler Anatomy - پکیج ایران رادیاتور",
  theme: THEME,
  body: bodyHtml,
  script: kitScript() + liveScript,
  width: 1200,
});

const outName = THEME === "light" ? "index-light.html" : "index.html";
writeFileSync(join(HERE, outName), fullHtml);
console.log(`Successfully generated projects/iran-radiator-boiler/${outName} (${(fullHtml.length / 1024).toFixed(1)} KB)`);
