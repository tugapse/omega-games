// Omega Terreno: a demo of the engine's terrain. A 3 × 3 terrain of chunks,
// painted by its height and slope rules; sculpt and paint it with a finger or
// the mouse, undo, bake the rules into the painting, make a new relief.
import RAPIER from '@dimforge/rapier3d-compat';
import { mat4, vec3, vec4 } from 'gl-matrix';
import {
  BrushSettings, cachedGroundTexture, Camera, CanvasViewport, ColliderBehaviour, Color, DefaultResourceLoader,
  DependencyManager, DirectionalLight, Engine, generateRelief, Light, LitMaterial, LitShader, Mesh,
  MeshRendererBehaviour, PhysicsWorld, RapierBackend, RenderPipelineSettings, RenderQuality, Resources,
  RigidBodyBehaviour, Scene, SceneEntity, SculptTool, SpherePrimitive, TerrainBehaviour, ToneMapping,
} from 'omega-game-engine';
import { rampAt } from './ramp';

const $ = (id: string) => document.getElementById(id)!;

// ---- Diagnostics: errors on screen (phones have no console), with the GPU's name ----
const problems: string[] = [];
function report(text: string): void {
  problems.push(text);
  const el = document.getElementById('diag');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = problems.slice(-12).join('\n\n');
}
for (const level of ['error', 'warn'] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    orig(...args);
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    if (level === 'error' || /shader|webgl|program/i.test(text)) report(`[${level}] ${text.slice(0, 1200)}`);
  };
}
window.addEventListener('error', (e) => report(`[erro] ${e.message}`));
window.addEventListener('unhandledrejection', (e) => report(`[erro] ${String((e as PromiseRejectionEvent).reason)}`));
const canvas = $('view') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

const gl = canvas.getContext('webgl2', { antialias: true })!;
new DependencyManager().registerDependencies();
Resources.setLoader(new DefaultResourceLoader(async (uri) => uri));
Resources.for(gl);
const SKY = [0.6, 0.75, 0.9];
gl.clearColor(SKY[0], SKY[1], SKY[2], 1);

const camera = new Camera();
camera.fieldOfView = 55;
camera.nearPlane = 0.3;
camera.farPlane = 2500;
camera.initialize();
Camera.setMainCamera(camera);

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  gl.viewport(0, 0, w, h);
  CanvasViewport.rendererWidth = w;
  CanvasViewport.rendererHeight = h;
  camera.aspectRatio = w / h;
  camera.updateProjectionMatrix();
}

// ---- Orbit camera ----
const HOME = { yaw: 0.8, pitch: 0.42, distance: 340 };
const orbit = { ...HOME, target: vec3.fromValues(0, 0, 0) };
const MIN_DISTANCE = 10, MAX_DISTANCE = 900;
/** Where the terrain entity sits: the 3 × 3 chunks centred on the origin. */
const TERRAIN_ORIGIN = [-192, -192];
/** Where the camera glides to (Centrar, a double tap); any hand on the camera stops it. */
let glide: { x: number; z: number; yaw?: number; pitch?: number; distance?: number } | null = null;
const eye = vec3.create();
const view = mat4.create();
function placeCamera(): void {
  const { yaw, pitch, distance, target } = orbit;
  vec3.set(eye,
    target[0] + Math.cos(pitch) * Math.sin(yaw) * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(pitch) * Math.cos(yaw) * distance);
  // Keep the eye above the ground.
  const ground = terrain?.heightAt(eye[0], eye[2]);
  if (ground !== undefined && eye[1] < ground + 3) eye[1] = ground + 3;
  camera.transform.setLocalPosition(eye[0], eye[1], eye[2]);
  camera.transform.lookAt(target);
  mat4.lookAt(view, eye, target, [0, 1, 0]);
}

/** The world ray under a canvas point (CSS pixels). */
function rayAt(px: number, py: number): { origin: vec3; dir: vec3 } {
  const r = canvas.getBoundingClientRect();
  const x = ((px - r.left) / r.width) * 2 - 1, y = 1 - ((py - r.top) / r.height) * 2;
  const inv = mat4.invert(mat4.create(), mat4.multiply(mat4.create(), camera.projectionMatrix, view))!;
  const far = vec4.transformMat4(vec4.create(), [x, y, 1, 1], inv);
  const to = vec3.fromValues(far[0] / far[3], far[1] / far[3], far[2] / far[3]);
  return { origin: vec3.clone(eye), dir: vec3.normalize(vec3.create(), vec3.sub(vec3.create(), to, eye)) };
}

/** Where the ray under a canvas point meets the level plane at height y (none towards the horizon). */
function planeAt(px: number, py: number, y: number): vec3 | undefined {
  const { origin, dir } = rayAt(px, py);
  if (dir[1] > -0.02) return undefined;
  const t = (y - origin[1]) / dir[1];
  return t > 0 ? vec3.scaleAndAdd(vec3.create(), origin, dir, t) : undefined;
}

/** Moves the camera so the ground that was under one canvas point is under another (grab and drag). */
function panBy(fromX: number, fromY: number, toX: number, toY: number): void {
  const y = orbit.target[1];
  const a = planeAt(fromX, fromY, y), b = planeAt(toX, toY, y);
  if (!a || !b) return;
  const dx = a[0] - b[0], dz = a[2] - b[2];
  // Near the horizon a pixel is a long way: no more than the distance in one step.
  const len = Math.hypot(dx, dz), k = len > orbit.distance ? orbit.distance / len : 1;
  orbit.target[0] += dx * k;
  orbit.target[2] += dz * k;
  keepInside();
  placeCamera();
}

/** Comes closer (factor < 1) or goes away, keeping the ground under a canvas point where it is. */
function zoomAt(px: number, py: number, factor: number): void {
  const next = clamp(orbit.distance * factor, MIN_DISTANCE, MAX_DISTANCE);
  const f = next / orbit.distance;
  const p = brushAt(px, py) ?? planeAt(px, py, orbit.target[1]);
  if (p) {
    orbit.target[0] += (p[0] - orbit.target[0]) * (1 - f);
    orbit.target[2] += (p[2] - orbit.target[2]) * (1 - f);
  }
  orbit.distance = next;
  keepInside();
  placeCamera();
}

/** Keeps the camera's target over the terrain. */
function keepInside(): void {
  const size = terrain.grid.settings.size;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of terrain.grid.all()) {
    x0 = Math.min(x0, c.originX); x1 = Math.max(x1, c.originX + size);
    z0 = Math.min(z0, c.originZ); z1 = Math.max(z1, c.originZ + size);
  }
  if (x0 > x1) return;
  orbit.target[0] = clamp(orbit.target[0], x0 + TERRAIN_ORIGIN[0], x1 + TERRAIN_ORIGIN[0]);
  orbit.target[2] = clamp(orbit.target[2], z0 + TERRAIN_ORIGIN[1], z1 + TERRAIN_ORIGIN[1]);
}

/** The camera on its way to `glide`. */
function glideOn(dt: number): void {
  if (!glide) return;
  const k = Math.min(1, dt * 5);
  const t = orbit.target;
  t[0] += (glide.x - t[0]) * k;
  t[2] += (glide.z - t[2]) * k;
  let done = Math.hypot(glide.x - t[0], glide.z - t[2]) < 0.05;
  if (glide.distance !== undefined) { orbit.distance += (glide.distance - orbit.distance) * k; done &&= Math.abs(glide.distance - orbit.distance) < 0.05; }
  if (glide.pitch !== undefined) { orbit.pitch += (glide.pitch - orbit.pitch) * k; done &&= Math.abs(glide.pitch - orbit.pitch) < 0.001; }
  if (glide.yaw !== undefined) {
    const d = Math.atan2(Math.sin(glide.yaw - orbit.yaw), Math.cos(glide.yaw - orbit.yaw));
    orbit.yaw += d * k;
    done &&= Math.abs(d) < 0.001;
  }
  if (done) glide = null;
}

/** Glides to the ground under a canvas point. */
function focusAt(px: number, py: number): void {
  const p = brushAt(px, py);
  if (p) glide = { x: p[0], z: p[2] };
}

// ---- Keys: WASD or the arrows move, Q and E turn ----
const keys = new Set<string>();
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
function moveByKeys(dt: number): void {
  const on = (...codes: string[]) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  const f = on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown');
  const r = on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft');
  const turn = on('KeyQ') - on('KeyE');
  if (!f && !r && !turn) return;
  glide = null;
  const s = Math.sin(orbit.yaw), c = Math.cos(orbit.yaw), speed = orbit.distance * 0.9 * dt;
  orbit.target[0] += (-s * f + c * r) * speed;
  orbit.target[2] += (-c * f - s * r) * speed;
  orbit.yaw += turn * 1.4 * dt;
  keepInside();
}

let scene: Scene, engine: Engine, terrain: TerrainBehaviour, world: PhysicsWorld;
let seed = Number(params.get('seed') ?? 7);

function makeRelief(): void {
  generateRelief(terrain.grid, { seed, scale: 360, amplitude: 120, octaves: 5, persistence: 0.42, ridges: 0.3, sharpness: 1.45, base: 8 });
  terrain.history.clear();
}

async function start(): Promise<void> {
  scene = new Scene();
  scene.name = 'Terreno';
  scene.sceneFog.enabled = true;
  scene.sceneFog.fogType = 1;
  scene.sceneFog.density = 0.00035;
  scene.sceneFog.color = new Color(SKY[0], SKY[1], SKY[2], 1);
  scene.setGlRenderingContext(gl);

  const ambient = new Light('Ambient');
  ambient.color = new Color(0.4, 0.46, 0.56, 1);
  scene.addEntity(ambient);
  const sun = new DirectionalLight('Sun');
  sun.color = new Color(1, 0.94, 0.84, 1.25);
  sun.transform.rotate(42, -35, 0);
  sun.castShadows = true;
  scene.addEntity(sun);

  const q = params.get('quality');
  const named: Record<string, RenderQuality> = { low: RenderQuality.Low, medium: RenderQuality.Medium, high: RenderQuality.High };
  const quality = q && q in named ? named[q] : RenderPipelineSettings.suggestedQuality(gl);

  const entity = new SceneEntity('Terrain');
  entity.transform.setLocalPosition(TERRAIN_ORIGIN[0], 0, TERRAIN_ORIGIN[1]);
  terrain = new TerrainBehaviour(gl);
  const m = terrain.material;
  m.layers[1].slope = [22, 90];
  m.layers[2].slope = [33, 90];
  m.layers[3].height = [38, 1000];
  if (quality === RenderQuality.Low) {
    m.triplanar = false;
    m.textureSize = 256;
    terrain.lodBias = 0.6;
  }
  m.changed(true);
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) terrain.grid.add(x, z);
  makeRelief();
  entity.addBehaviour(terrain);
  scene.addEntity(entity);

  world = new PhysicsWorld(await RapierBackend.load(RAPIER), { fixedTimeStep: 1 / 60, maxSubSteps: 4 });
  scene.addBehaviour(world);
  terrain.refreshColliders(true);

  engine = new Engine();
  engine.initialize(canvas);
  engine.loadScene(scene);
  const settings = scene.renderPipeline.settings;
  settings.toneMapping = ToneMapping.ACES;
  settings.applyQuality(quality);
  scene.isRunning = true;
  buildLayers();
  (window as any).terrainDemo = { scene, terrain, orbit, camera, brushAt, dropBalls, balls, rampAt, brush };
  requestAnimationFrame(frame);
  setTimeout(checkTerrain, 4000);
}

/** After a few seconds: is every chunk's shader compiled and drawn? If not, say why on screen. */
function checkTerrain(): void {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const renderers = terrain.grid.all().map((c) => terrain.rendererOf(c.cx, c.cz));
  const ready = renderers.filter((r) => r?.shader?.initialized && r.shader.shaderProgram).length;
  const glError = gl.getError();
  const linked = renderers[0]?.shader?.shaderProgram ? gl.getProgramParameter(renderers[0].shader.shaderProgram, gl.LINK_STATUS) : false;
  const line = `GPU: ${gpu}\nblocos: ${renderers.length}, shaders prontos: ${ready}, ligado: ${linked}, gl.getError: ${glError}`;
  (window as any).terrainDemo.diagnostics = line;
  if (ready < renderers.length || !linked || glError || params.has('debug')) report(line);
}

// ---- Balls: Rapier bodies rolling on the chunks' heightfields ----
const balls: SceneEntity[] = [];
const ballColors = [[1, 0.35, 0.2], [0.2, 0.75, 1], [1, 0.82, 0.2], [0.85, 0.35, 1], [0.4, 1, 0.45]];
const ballMesh = new SpherePrimitive(0.5, 24, 16);

function dropBalls(): void {
  for (let k = 0; k < 5; k++) {
    if (balls.length >= 30) scene.removeEntity(balls.shift()!);
    const e = new SceneEntity('Ball');
    const x = orbit.target[0] + (Math.random() - 0.5) * 30, z = orbit.target[2] + (Math.random() - 0.5) * 30;
    const h = terrain.heightAt(x, z) ?? orbit.target[1];
    e.transform.setLocalPosition(x, h + 25 + k * 4, z);
    e.transform.setLocalScale(2, 2, 2);
    const m = new LitMaterial();
    const c = ballColors[k % ballColors.length];
    m.color = new Color(c[0], c[1], c[2], 1);
    m.specularStrength = 0.6;
    m.roughness = 0.3;
    const r = new MeshRendererBehaviour(gl);
    r.mesh = new Mesh();
    r.mesh.meshData = ballMesh;
    r.shader = new LitShader(gl, m);
    e.addBehaviour(r);
    const body = new RigidBodyBehaviour();
    body.ccd = true;
    e.addBehaviour(body);
    const col = new ColliderBehaviour({ type: 'sphere', radius: 0.5 });
    col.restitution = 0.3;
    col.friction = 0.6;
    col.density = 2;
    e.addBehaviour(col);
    scene.addEntity(e);
    balls.push(e);
  }
}

// ---- Tools ----
type Tool = 'view' | SculptTool | 'ramp' | 'paint' | 'erase';
let tool: Tool = 'view';
let layer = 0;
const brush: BrushSettings = { radius: 14, strength: 0.5, hardness: 0.35 };

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  ($('layers') as HTMLElement).style.display = t === 'paint' ? 'flex' : 'none';
  hint(t === 'view' ? 'Arrasta para rodar · Shift+arrastar ou dois dedos movem · toque duplo centra'
    : t === 'paint' ? 'Escolhe a camada e pinta · dois dedos movem a câmara'
    : t === 'ramp' ? 'Arrasta de um ponto a outro: uma rampa reta entre as duas alturas · Tamanho é a largura'
    : 'Arrasta no terreno · dois dedos movem a câmara');
  if (t === 'view') terrain?.showBrush(null);
  cancelRamp();
}

let hintTimer = 0;
function hint(text: string): void {
  const el = $('hint');
  el.textContent = text;
  el.style.opacity = '1';
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => (el.style.opacity = '0'), 3500);
}

function buildLayers(): void {
  const box = $('layers');
  box.innerHTML = '';
  terrain.material.layers.forEach((l, i) => {
    const b = document.createElement('button');
    b.className = 'layer' + (i === layer ? ' on' : '');
    b.title = l.name;
    const t = cachedGroundTexture(l.ground, 64);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(t.albedo.map((v, k) => (k % 4 === 3 ? 255 : v))), 64, 64), 0, 0);
    b.style.backgroundImage = `url(${c.toDataURL()})`;
    b.onclick = () => { layer = i; buildLayers(); hint(`A pintar: ${l.name}`); };
    box.appendChild(b);
  });
}

document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
$('radius').oninput = (e) => (brush.radius = Number((e.target as HTMLInputElement).value));
$('strength').oninput = (e) => (brush.strength = Number((e.target as HTMLInputElement).value) / 100);
$('hardness').oninput = (e) => (brush.hardness = Number((e.target as HTMLInputElement).value) / 100);
$('home').onclick = () => (glide = { x: 0, z: 0, ...HOME });
$('undo').onclick = () => terrain.undo();
$('redo').onclick = () => terrain.redo();
$('bake').onclick = () => { terrain.bakeRules(); hint('As regras estão agora na pintura: retoca-as à mão'); };
$('clear').onclick = () => { terrain.clearPainting(); hint('Sem pintura: só as regras'); };
$('regen').onclick = () => { seed++; makeRelief(); terrain.clearPainting(); terrain.history.clear(); };
$('balls').onclick = () => dropBalls();
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) terrain.redo(); else terrain.undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement instanceof HTMLInputElement) return;
  if (MOVE_KEYS.includes(e.code)) { e.preventDefault(); keys.add(e.code); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// ---- Pointer ----
// One finger (left button) works the tool, or turns the camera in Ver. Two
// fingers pinch, twist and move it. With the mouse: the right button turns,
// the middle one (or Shift) moves, the wheel comes closer to the cursor.
const pointers = new Map<number, { x: number; y: number }>();
let stroke: { x: number; y: number; target?: number } | null = null;
let pinch: { d: number; a: number; mid: [number, number] } | null = null;
let drag: { mode: 'turn' | 'move'; x: number; y: number } | null = null;
let ramping: { from: vec3; to: vec3 } | null = null;
let lastTap = { time: 0, x: 0, y: 0 };

/** The ground point under a canvas point, if any. */
function brushAt(x: number, y: number): vec3 | undefined {
  const { origin, dir } = rayAt(x, y);
  return terrain.raycast(origin, dir, 3000);
}

function pinchOf(): { d: number; a: number; mid: [number, number] } {
  const [a, b] = [...pointers.values()];
  return { d: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1), a: Math.atan2(b.y - a.y, b.x - a.x), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] };
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  glide = null;
  (document.activeElement as HTMLElement | null)?.blur?.();
  if (pointers.size === 2) {
    endStroke();
    cancelRamp();
    drag = null;
    pinch = pinchOf();
    return;
  }
  if (pointers.size > 2) return;
  if (e.button === 1 || e.shiftKey) { drag = { mode: 'move', x: e.clientX, y: e.clientY }; return; }
  if (e.button === 2) { drag = { mode: 'turn', x: e.clientX, y: e.clientY }; return; }
  if (tool === 'view') {
    const now = performance.now();
    if (now - lastTap.time < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { focusAt(e.clientX, e.clientY); lastTap.time = 0; }
    else lastTap = { time: now, x: e.clientX, y: e.clientY };
    drag = { mode: 'turn', x: e.clientX, y: e.clientY };
    return;
  }
  if (tool === 'ramp') {
    const p = brushAt(e.clientX, e.clientY);
    if (p) ramping = { from: p, to: vec3.clone(p) };
    return;
  }
  const p = brushAt(e.clientX, e.clientY);
  stroke = { x: e.clientX, y: e.clientY, target: p?.[1] };
  terrain.beginStroke(tool === 'paint' || tool === 'erase' ? 'splat' : 'heights');
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; }
  if (pinch && pointers.size >= 2) {
    const now = pinchOf();
    orbit.yaw -= now.a - pinch.a;
    placeCamera();
    zoomAt(now.mid[0], now.mid[1], pinch.d / now.d);
    panBy(pinch.mid[0], pinch.mid[1], now.mid[0], now.mid[1]);
    pinch = now;
    return;
  }
  if (drag) {
    if (drag.mode === 'turn') {
      orbit.yaw -= (e.clientX - drag.x) * 0.006;
      orbit.pitch = clamp(orbit.pitch + (e.clientY - drag.y) * 0.005, 0.08, 1.45);
    } else panBy(drag.x, drag.y, e.clientX, e.clientY);
    drag.x = e.clientX;
    drag.y = e.clientY;
    return;
  }
  if (ramping) {
    const g = brushAt(e.clientX, e.clientY);
    if (g) ramping.to = g;
    terrain.showBrush(ramping.to, brush.radius);
    const len = Math.hypot(ramping.to[0] - ramping.from[0], ramping.to[2] - ramping.from[2]);
    const deg = Math.atan2(Math.abs(ramping.to[1] - ramping.from[1]), len) * 180 / Math.PI;
    hint(`Rampa: ${Math.round(len)} m · ${Math.round(deg)}°`);
    return;
  }
  if (stroke) { stroke.x = e.clientX; stroke.y = e.clientY; }
  else if (tool !== 'view' && e.pointerType === 'mouse') {
    const g = brushAt(e.clientX, e.clientY);
    terrain.showBrush(g ?? null, brush.radius);
  }
});

function endStroke(): void {
  if (stroke) terrain.endStroke();
  stroke = null;
}

/** Lays the ramp being drawn, if it is long enough. */
function finishRamp(): void {
  if (!ramping) return;
  const { from, to } = ramping;
  ramping = null;
  if (Math.hypot(to[0] - from[0], to[2] - from[2]) < 1) return;
  rampAt(terrain, from, to, brush.radius, brush.hardness);
}

function cancelRamp(): void {
  ramping = null;
}

const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    drag = null;
    endStroke();
    if (e.type === 'pointercancel') cancelRamp(); else finishRamp();
    if (e.pointerType !== 'mouse') terrain.showBrush(null);
  }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); glide = null; zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.001)); }, { passive: false });

// ---- The ramp being drawn, over the canvas ----
const overlay = $('overlay') as HTMLCanvasElement;
const octx = overlay.getContext('2d')!;
let overlayDrawn = false;
const viewProj = mat4.create();

/** A world point on the canvas (CSS pixels), or undefined behind the camera. */
function toScreen(p: ArrayLike<number>): [number, number] | undefined {
  const c = vec4.transformMat4(vec4.create(), [p[0], p[1], p[2], 1], viewProj);
  if (c[3] <= 0.01) return undefined;
  return [(c[0] / c[3] * 0.5 + 0.5) * overlay.clientWidth, (0.5 - c[1] / c[3] * 0.5) * overlay.clientHeight];
}

function drawOverlay(): void {
  if (!ramping && !overlayDrawn) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
  overlayDrawn = false;
  if (!ramping) return;
  const { from: a, to: b } = ramping;
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  if (len < 1) return;
  mat4.multiply(viewProj, camera.projectionMatrix, view);
  const px = -dz / len * brush.radius, pz = dx / len * brush.radius;
  const corners = [
    [a[0] + px, a[1], a[2] + pz], [b[0] + px, b[1], b[2] + pz],
    [b[0] - px, b[1], b[2] - pz], [a[0] - px, a[1], a[2] - pz],
  ].map(toScreen);
  const ends = [toScreen(a), toScreen(b)];
  if (corners.some((c) => !c) || ends.some((c) => !c)) return;
  octx.beginPath();
  corners.forEach((c, k) => (k ? octx.lineTo(c![0], c![1]) : octx.moveTo(c![0], c![1])));
  octx.closePath();
  octx.fillStyle = 'rgba(45, 226, 255, 0.18)';
  octx.fill();
  octx.strokeStyle = 'rgba(45, 226, 255, 0.9)';
  octx.lineWidth = 1.5;
  octx.stroke();
  octx.setLineDash([6, 5]);
  octx.beginPath();
  octx.moveTo(ends[0]![0], ends[0]![1]);
  octx.lineTo(ends[1]![0], ends[1]![1]);
  octx.stroke();
  octx.setLineDash([]);
  octx.fillStyle = '#ffd23f';
  for (const e of ends) { octx.beginPath(); octx.arc(e![0], e![1], 4, 0, Math.PI * 2); octx.fill(); }
  overlayDrawn = true;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The tool at work while a finger is down. */
function applyTool(dt: number): void {
  if (!stroke) return;
  const p = brushAt(stroke.x, stroke.y);
  terrain.showBrush(p ?? null, brush.radius);
  if (!p) return;
  if (tool === 'paint') terrain.paintAt(layer, p, brush, dt);
  else if (tool === 'erase') terrain.paintAt(0, p, brush, dt, true);
  else if (tool !== 'view' && tool !== 'ramp') terrain.sculptAt(tool, p, brush, dt, stroke.target);
}

// The orbit's target follows the ground under it.
function followGround(dt: number): void {
  const h = terrain.heightAt(orbit.target[0], orbit.target[2]) ?? 0;
  orbit.target[1] += (h - orbit.target[1]) * Math.min(1, dt * 3);
}

let last = 0, fpsTime = 0, fpsFrames = 0;
function frame(now: number): void {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  resize();
  applyTool(dt);
  moveByKeys(dt);
  glideOn(dt);
  followGround(dt);
  placeCamera();
  drawOverlay();
  ($('undo') as HTMLButtonElement).disabled = !terrain.history.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !terrain.history.canRedo;
  engine.update(dt);
  engine.render();
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { $('stats').textContent = `${Math.round(fpsFrames / fpsTime)} fps`; fpsFrames = 0; fpsTime = 0; }
  requestAnimationFrame(frame);
}

setTool('view');
void start();
