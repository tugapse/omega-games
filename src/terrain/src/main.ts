// Omega Terreno: a demo of the engine's terrain. A 3 × 3 terrain of chunks,
// painted by its height and slope rules; sculpt and paint it with a finger or
// the mouse, undo, bake the rules into the painting, generate a new relief.
import RAPIER from '@dimforge/rapier3d-compat';
import { mat4, vec2, vec3, vec4 } from 'gl-matrix';
import {
  BrushSettings, cachedGroundTexture, Camera, CanvasViewport, ColliderBehaviour, Color, DefaultResourceLoader,
  DependencyManager, DirectionalLight, Engine, exportHeightmap, Heightmap, heightmapToRaw, heightmapToRgba, Light,
  LitMaterial, LitShader, Mesh, MeshData, MeshRendererBehaviour, PhysicsWorld, RapierBackend, rawToHeightmap,
  RenderLayer, RenderPipelineSettings, rgbaToHeightmap,
  RenderQuality, Resources, RigidBodyBehaviour, Scene, SceneEntity, SculptTool, SpherePrimitive, TerrainBehaviour,
  ToneMapping, touchAround,
} from 'omega-game-engine';
import { erode, stamp, StampShape, terrace } from './brushes';
import { Area, areaOf, generate, GenSettings, GEN_DEFAULT, heightField, preview, PRESETS, SLIDERS, smoothHeightmap } from './generator';
import { fillChunk } from './grow';
import { scatterTrees, Tree, TREE_RULES } from './scatter';
import { treeMeshes, trunkRadius } from './trees';
import { rampAt } from './ramp';
import { fromBase64, packWorld, SavedWorld, toBase64, unpackWorld } from './save';

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

const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
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
  if (walking) { placeWalker(); return; }
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
  const s = Math.sin(orbit.yaw), c = Math.cos(orbit.yaw);
  const speed = (walking ? (running ? RUN : WALK) : orbit.distance * 0.9) * dt;
  orbit.target[0] += (-s * f + c * r) * speed;
  orbit.target[2] += (-c * f - s * r) * speed;
  orbit.yaw += turn * 1.4 * dt;
  keepInside();
}

let scene: Scene, engine: Engine, terrain: TerrainBehaviour, world: PhysicsWorld;
/** The relief the terrain was generated from (new chunks carry it on), the box it was made for, and its image if it came from one. */
let gen: GenSettings = { ...GEN_DEFAULT, seed: Number(params.get('seed') ?? GEN_DEFAULT.seed) };
let genArea: Area = { x0: 0, z0: 0, x1: 384, z1: 384 };
let genImage: Heightmap | null = null;

function makeRelief(): void {
  genArea = areaOf(terrain.grid);
  generate(terrain.grid, reliefAt());
  terrain.history.clear();
}

/** The relief's height at a terrain-space point: what a new chunk starts from. */
function reliefAt(): (x: number, z: number) => number {
  return heightField(gen, genArea, genImage);
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
  makeWater();
  buildLayers();
  buildStamps();
  if (!params.has('seed')) await loadLocal();
  saved = signature();
  (window as any).terrainDemo = { scene, terrain, orbit, camera, brushAt, dropBalls, balls, rampAt, brush, setTool, setWalking, setWater, growAt, worldNow, loadWorld, water, openGen, closeGen, openHeightImage, get gen() { return gen; }, get walking() { return walking; }, get waterEntity() { return waterEntity; } };
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
  // gl.getError alone does not open the panel: the engine's lit meshes (the
  // balls, the water) leave an INVALID_OPERATION on some drivers, drift too.
  if (ready < renderers.length || !linked || params.has('debug')) report(line);
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
type Tool = 'view' | SculptTool | 'ramp' | 'terrace' | 'stamp' | 'erode' | 'grow' | 'paint' | 'erase';
let tool: Tool = 'view';
let layer = 0;
let stampShape: StampShape = 'hill';
/** The terrace brush's step (m). */
let step = 6;
/** The most chunks the terrain grows to. */
const MAX_CHUNKS = 25;
const STAMPS: { shape: StampShape; name: string }[] = [
  { shape: 'hill', name: 'Monte' }, { shape: 'crater', name: 'Cratera' }, { shape: 'plateau', name: 'Planalto' }, { shape: 'volcano', name: 'Vulcão' },
];
const HINTS: Record<Tool, string> = {
  view: 'Arrasta para rodar · Shift+arrastar ou dois dedos movem · toque duplo centra',
  raise: 'Arrasta no terreno · dois dedos movem a câmara',
  lower: 'Arrasta no terreno · dois dedos movem a câmara',
  smooth: 'Arrasta no terreno · dois dedos movem a câmara',
  flatten: 'Aplana à altura onde começas · dois dedos movem a câmara',
  noise: 'Arrasta no terreno · dois dedos movem a câmara',
  ramp: 'Arrasta de um ponto a outro: uma rampa reta entre as duas alturas · Tamanho é a largura',
  terrace: 'Arrasta para fazer socalcos · Degrau é a altura de cada um',
  stamp: 'Escolhe a forma e toca no terreno · Tamanho é a largura, Força a altura',
  erode: 'Arrasta: a chuva escava ravinas e enche as covas',
  grow: 'Toca num + para juntar um bloco ao terreno (não se anula)',
  paint: 'Escolhe a camada e pinta · dois dedos movem a câmara',
  erase: 'Arrasta para voltar às regras · dois dedos movem a câmara',
};
const brush: BrushSettings = { radius: 14, strength: 0.5, hardness: 0.35 };

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('layers').style.display = t === 'paint' ? 'flex' : 'none';
  $('stamps').style.display = t === 'stamp' ? 'flex' : 'none';
  $('stepBox').style.display = t === 'terrace' ? 'flex' : 'none';
  hint(HINTS[t]);
  settleGen();
  if (t === 'view' || t === 'grow') terrain?.showBrush(null);
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

function buildStamps(): void {
  const box = $('stamps');
  box.innerHTML = '';
  for (const { shape, name } of STAMPS) {
    const b = document.createElement('button');
    b.textContent = name;
    b.className = shape === stampShape ? 'on' : '';
    b.onclick = () => { stampShape = shape; buildStamps(); };
    box.appendChild(b);
  }
}

document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
$('radius').oninput = (e) => (brush.radius = Number((e.target as HTMLInputElement).value));
$('strength').oninput = (e) => (brush.strength = Number((e.target as HTMLInputElement).value) / 100);
$('hardness').oninput = (e) => (brush.hardness = Number((e.target as HTMLInputElement).value) / 100);
$('home').onclick = () => (glide = { x: 0, z: 0, ...HOME });
$('undo').onclick = () => { settleGen(); terrain.undo(); };
$('redo').onclick = () => { settleGen(); terrain.redo(); };
$('step').oninput = (e) => (step = Number((e.target as HTMLInputElement).value));
$('bake').onclick = () => { terrain.bakeRules(); hint('As regras estão agora na pintura: retoca-as à mão'); closeMenu(); };
$('clear').onclick = () => { terrain.clearPainting(); hint('Sem pintura: só as regras'); closeMenu(); };
$('genOpen').onclick = () => openGen();
// Asks twice, on the button itself (no browser dialog): nothing of this can be undone.
let resetArmed = 0;
$('reset').onclick = () => {
  const b = $('reset');
  if (!resetArmed) {
    b.textContent = '⚠ Toca outra vez: apaga tudo';
    b.classList.add('armed');
    resetArmed = window.setTimeout(() => { resetArmed = 0; b.textContent = '⟲ Recomeçar do zero'; b.classList.remove('armed'); }, 3000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = 0;
  b.textContent = '⟲ Recomeçar do zero';
  b.classList.remove('armed');
  closeMenu();
  resetAll();
};
$('balls').onclick = () => dropBalls();
$('more').onclick = () => $('menu').classList.toggle('open');
$('walk').onclick = () => setWalking(!walking);
$('water').onclick = () => setWater(!water.on, water.level);
$('treesBtn').onclick = () => setTrees(!trees.on, trees.density);
// Like the generator: the trees follow once the slider is let go.
$('density').onchange = (e) => setTrees(true, Number((e.target as HTMLInputElement).value) / 100);
$('level').oninput = (e) => setWater(true, Number((e.target as HTMLInputElement).value));
$('save').onclick = () => { void saveLocal(true); closeMenu(); };
$('export').onclick = () => { void exportFile(); closeMenu(); };
$('import').onclick = () => ($('file') as HTMLInputElement).click();
$('file').onchange = (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  closeMenu();
  if (f) void importFile(f);
};
function closeMenu(): void { $('menu').classList.remove('open'); }
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); settleGen(); if (e.shiftKey) terrain.redo(); else terrain.undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement instanceof HTMLInputElement) return;
  running = e.shiftKey;
  if (MOVE_KEYS.includes(e.code)) { e.preventDefault(); keys.add(e.code); }
  if (e.code === 'Escape') { if (walking) setWalking(false); closeMenu(); closeGen(); }
  if (e.code === 'KeyG' && !walking) { if (genOpen) closeGen(); else openGen(); }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); running = e.shiftKey; });
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
  (document.activeElement as HTMLElement | null)?.blur?.();
  closeMenu();
  settleGen();
  if (walking) { walkDown(e); return; }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  glide = null;
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
  if (tool === 'stamp') { stampAt(e.clientX, e.clientY); return; }
  if (tool === 'grow') { growAt(e.clientX, e.clientY); return; }
  const p = brushAt(e.clientX, e.clientY);
  stroke = { x: e.clientX, y: e.clientY, target: p?.[1] };
  terrain.beginStroke(tool === 'paint' || tool === 'erase' ? 'splat' : 'heights');
});

canvas.addEventListener('pointermove', (e) => {
  if (walking) { walkMove(e); return; }
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
  else if (tool !== 'view' && tool !== 'grow' && e.pointerType === 'mouse') {
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
  if (walking) { walkUp(e); return; }
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
canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (walking) return; glide = null; zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.001)); }, { passive: false });

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
  if (!ramping && !overlayDrawn && tool !== 'grow' && !stick) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(overlay.clientWidth * dpr), h = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, overlay.clientWidth, overlay.clientHeight);
  overlayDrawn = false;
  mat4.multiply(viewProj, camera.projectionMatrix, view);
  if (stick) drawStick();
  else if (tool === 'grow' && !walking) drawGrowMarkers();
  if (!ramping) return;
  const { from: a, to: b } = ramping;
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  if (len < 1) return;
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
  else if (tool === 'terrace') {
    const l = terrain.toLocal(p);
    terrain.history.saveAround(terrain.grid, l[0], l[2], brush.radius);
    terrace(terrain.grid, l[0], l[2], brush, dt, step);
  } else if (tool === 'erode') {
    const l = terrain.toLocal(p);
    terrain.history.saveAround(terrain.grid, l[0], l[2], brush.radius * 1.6);
    // About 1200 drops a second for a 14 m brush, more for a bigger one.
    const drops = Math.min(250, Math.round(1200 * dt * (brush.radius / 14) ** 2));
    erode(terrain.grid, l[0], l[2], brush, drops);
  } else if (tool === 'raise' || tool === 'lower' || tool === 'smooth' || tool === 'flatten' || tool === 'noise') {
    terrain.sculptAt(tool, p, brush, dt, stroke.target);
  }
}

// The orbit's target follows the ground under it.
function followGround(dt: number): void {
  const h = terrain.heightAt(orbit.target[0], orbit.target[2]) ?? 0;
  orbit.target[1] += (h - orbit.target[1]) * Math.min(1, dt * 3);
}

// ---- Stamps and growing: one tap ----

/** A stamp under a canvas point (one undo step). */
function stampAt(px: number, py: number): void {
  const p = brushAt(px, py);
  if (!p) return;
  const l = terrain.toLocal(p);
  terrain.beginStroke('heights');
  terrain.history.saveAround(terrain.grid, l[0], l[2], brush.radius);
  stamp(terrain.grid, stampShape, l[0], l[2], brush.radius, brush.strength * 40);
  terrain.endStroke();
}

/** The free cells a chunk can be added at, each with where to draw its +. */
function growSpots(): { cx: number; cz: number; corners: vec3[]; mid: vec3 }[] {
  if (terrain.grid.count >= MAX_CHUNKS) return [];
  const size = terrain.grid.settings.size;
  return terrain.grid.freeNeighbours().map(([cx, cz]) => {
    // The height at the middle of the border it would share with a neighbour.
    let y = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!terrain.grid.get(cx + dx, cz + dz)) continue;
      y = terrain.grid.heightAt((cx + 0.5 + dx * 0.5) * size + dx, (cz + 0.5 + dz * 0.5) * size + dz) ?? 0;
      break;
    }
    const x0 = cx * size + TERRAIN_ORIGIN[0], z0 = cz * size + TERRAIN_ORIGIN[1];
    return {
      cx, cz,
      corners: [[0, 0], [size, 0], [size, size], [0, size]].map(([u, v]) => vec3.fromValues(x0 + u, y, z0 + v)),
      mid: vec3.fromValues(x0 + size / 2, y, z0 + size / 2),
    };
  });
}

function drawGrowMarkers(): void {
  for (const spot of growSpots()) {
    const quad = spot.corners.map(toScreen), mid = toScreen(spot.mid);
    if (quad.some((q) => !q) || !mid) continue;
    octx.beginPath();
    quad.forEach((q, k) => (k ? octx.lineTo(q![0], q![1]) : octx.moveTo(q![0], q![1])));
    octx.closePath();
    octx.fillStyle = 'rgba(157, 255, 63, 0.10)';
    octx.fill();
    octx.setLineDash([6, 6]);
    octx.strokeStyle = 'rgba(157, 255, 63, 0.75)';
    octx.lineWidth = 1.5;
    octx.stroke();
    octx.setLineDash([]);
    octx.beginPath();
    octx.arc(mid[0], mid[1], 17, 0, Math.PI * 2);
    octx.fillStyle = 'rgba(12, 9, 24, 0.8)';
    octx.fill();
    octx.strokeStyle = '#9dff3f';
    octx.stroke();
    octx.fillStyle = '#9dff3f';
    octx.font = 'bold 22px system-ui';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText('+', mid[0], mid[1] + 1);
  }
  overlayDrawn = true;
}

/** Whether a canvas point is inside a polygon on the canvas. */
function inside(pt: [number, number], poly: [number, number][]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) yes = !yes;
  }
  return yes;
}

/** Adds the chunk whose + (or square) is under a canvas point. */
function growAt(px: number, py: number): void {
  if (terrain.grid.count >= MAX_CHUNKS) { hint(`O terreno já tem ${MAX_CHUNKS} blocos`); return; }
  const r = canvas.getBoundingClientRect();
  const pt: [number, number] = [px - r.left, py - r.top];
  mat4.multiply(viewProj, camera.projectionMatrix, view);
  let best: { cx: number; cz: number } | undefined, bestD = 40;
  for (const spot of growSpots()) {
    const mid = toScreen(spot.mid), quad = spot.corners.map(toScreen);
    const d = mid ? Math.hypot(mid[0] - pt[0], mid[1] - pt[1]) : Infinity;
    const hit = !quad.some((q) => !q) && inside(pt, quad as [number, number][]);
    if (d < bestD || (hit && !best)) { best = spot; bestD = Math.min(d, bestD); }
  }
  if (!best) return;
  const n = terrain.grid.settings.resolution;
  terrain.addChunk(best.cx, best.cz);
  fillChunk(terrain.grid, best.cx, best.cz, reliefAt());
  touchAround(terrain.grid, { i0: best.cx * n, j0: best.cz * n, i1: (best.cx + 1) * n, j1: (best.cz + 1) * n });
  hint(`Bloco novo: ${terrain.grid.count} de ${MAX_CHUNKS}`);
}

// ---- Water: a see-through plane at a level ----
const water = { on: false, level: 0 };
const WATER_ALPHA = Number(params.get('wateralpha') ?? 0.7);
let waterEntity: SceneEntity;

/** A level grid `size` metres across in `n` × `n` squares, facing up both ways round. */
function waterMesh(size: number, n: number): MeshData {
  const v: vec3[] = [], uv: vec2[] = [], idx: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    v.push(vec3.fromValues((i / n - 0.5) * size, 0, (j / n - 0.5) * size));
    uv.push(vec2.fromValues(i / n, j / n));
    if (i && j) {
      const k = j * (n + 1) + i;
      idx.push(k - n - 2, k - 1, k, k - n - 2, k, k - n - 1);
      idx.push(k - n - 2, k, k - 1, k - n - 2, k - n - 1, k);
    }
  }
  const m = new MeshData(v, v.map(() => vec3.fromValues(0, 1, 0)), uv, idx);
  m.providedNormals = true;
  return m;
}

function makeWater(): void {
  waterEntity = new SceneEntity('Water');
  const m = new LitMaterial();
  m.color = new Color(0.12, 0.36, 0.55, WATER_ALPHA);
  m.specularStrength = 0.6;
  m.roughness = 0.2;
  const r = new MeshRendererBehaviour(gl);
  r.mesh = new Mesh();
  r.mesh.meshData = waterMesh(6000, 24);
  r.shader = new LitShader(gl, m);
  if (WATER_ALPHA < 1) {
    r.renderLayer = RenderLayer.TRANSPARENT;
    r.writeToDephBuffer = false;
  }
  r.castShadows = false;
  waterEntity.addBehaviour(r);
}

function setWater(on: boolean, level: number): void {
  if (on !== water.on) { if (on) scene.addEntity(waterEntity); else scene.removeEntity(waterEntity); }
  water.on = on;
  water.level = level;
  waterEntity.transform.setLocalPosition(0, level, 0);
  $('water').classList.toggle('on', on);
  $('waterBox').style.display = on ? 'flex' : 'none';
  ($('level') as HTMLInputElement).value = String(level);
}

// ---- Saving: in the browser after every change, and to a file ----
const STORE = 'omega-terreno';
let saved = '', saveAt = 0;

/** Changes whenever the ground, the painting or the water does. */
function signature(): string {
  let v = 0;
  for (const c of terrain.grid.all()) v += c.heightVersion * 3 + c.splatVersion * 7 + c.cx * 101 + c.cz * 13;
  return `${terrain.grid.count}:${v}:${gen.seed}:${water.on}:${water.level}:${trees.on}:${trees.density}`;
}

function worldNow(): SavedWorld {
  return { v: 1, seed: gen.seed, gen: { ...gen, area: genArea }, water: { ...water }, trees: { on: trees.on, density: trees.density }, chunks: terrain.saveChunks() };
}

/** Saves 1.5 s after the last change (not during a stroke). */
function autosave(now: number): void {
  if (terrain.history.isOpen) return;
  const sig = signature();
  if (sig !== saved) { saved = sig; saveAt = now + 1500; }
  if (saveAt && now >= saveAt) { saveAt = 0; void saveLocal(false); }
}

async function saveLocal(say: boolean): Promise<void> {
  try {
    localStorage.setItem(STORE, toBase64(await packWorld(worldNow())));
    $('saved').textContent = `Guardado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
    if (say) hint('Guardado neste browser');
  } catch {
    $('saved').textContent = 'Não coube no browser: exporta para um ficheiro';
    if (say) hint('Não coube no browser: exporta para um ficheiro');
  }
}

async function loadLocal(): Promise<void> {
  let text: string | null = null;
  try { text = localStorage.getItem(STORE); } catch { /* no storage */ }
  if (!text) return;
  try {
    loadWorld(await unpackWorld(fromBase64(text)));
    hint('Continuas onde ficaste · o Gerador de relevo (no ☰, ou G) faz outro');
  } catch (err) {
    report(`[aviso] o terreno guardado não abriu: ${String(err)}`);
  }
}

function loadWorld(w: SavedWorld): void {
  settleGen();
  endStroke();
  cancelRamp();
  // Remove every chunk (and its entity) first: the chunks' renderers hold the
  // chunk data, so loading over chunks that have entities would leave them
  // drawing the old data.
  for (const c of terrain.grid.all()) terrain.removeChunk(c.cx, c.cz);
  terrain.loadChunks(w.chunks);
  terrain.sync();
  terrain.history.clear();
  const { area, ...settings } = w.gen ?? { ...GEN_DEFAULT, seed: w.seed, area: { x0: 0, z0: 0, x1: 384, z1: 384 } };
  gen = { ...GEN_DEFAULT, ...settings };
  genArea = area;
  genImage = null;
  if (genOpen) { draft = { ...gen }; draftImage = null; syncGenInputs(); queuePreview(); }
  setTrees(w.trees?.on ?? true, w.trees?.density ?? TREE_RULES.density);
  setWater(w.water.on, w.water.level);
  keepInside();
  saved = signature();
}

/** Back to how the demo starts: 3 × 3 chunks of the original relief, no painting, water or balls, the camera home. */
function resetAll(): void {
  settleGen();
  endStroke();
  cancelRamp();
  for (const c of terrain.grid.all()) terrain.removeChunk(c.cx, c.cz);
  for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) terrain.addChunk(x, z);
  gen = { ...GEN_DEFAULT };
  genImage = null;
  makeRelief();
  terrain.clearPainting();
  terrain.history.clear();
  terrain.sync();
  setWater(false, 0);
  setTrees(true, TREE_RULES.density);
  while (balls.length) scene.removeEntity(balls.pop()!);
  if (walking) setWalking(false);
  orbit.target[0] = orbit.target[2] = 0;
  glide = { x: 0, z: 0, ...HOME };
  if (genOpen) { draft = { ...gen }; draftImage = null; syncGenInputs(); queuePreview(); }
  hint('Tudo de novo: o relevo original, 3 × 3 blocos');
}

async function exportFile(): Promise<void> {
  const bytes = await packWorld(worldNow());
  download(new Blob([bytes as BlobPart], { type: 'application/gzip' }), `terreno-${new Date().toISOString().slice(0, 10)}.terreno`);
}

async function importFile(f: File): Promise<void> {
  try {
    loadWorld(await unpackWorld(new Uint8Array(await f.arrayBuffer())));
    hint(`Aberto: ${f.name}`);
  } catch {
    hint('Esse ficheiro não é um terreno guardado');
  }
}

// ---- Andar: on foot, at eye height ----
let walking = false, running = false, walkPitch = 0;
const EYE = 1.7, WALK = 5, RUN = 16;
/** The touch stick (left part of the screen) and the finger looking around. */
let stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
let looking: { id: number; x: number; y: number } | null = null;

function setWalking(on: boolean): void {
  walking = on;
  document.body.classList.toggle('walking', on);
  $('walk').innerHTML = on ? '✕ <span class="lbl">Sair</span>' : '🚶 <span class="lbl">Andar</span>';
  stick = looking = null;
  pointers.clear();
  pinch = drag = null;
  endStroke();
  cancelRamp();
  terrain.showBrush(null);
  glide = null;
  if (on) {
    walkPitch = -0.08;
    hint('Arrasta para olhar · WASD (Shift corre) ou o lado esquerdo do ecrã para andar · Esc sai');
  } else {
    orbit.distance = 70;
    orbit.pitch = 0.35;
    hint(HINTS[tool]);
  }
}

function placeWalker(): void {
  const t = orbit.target;
  bumpTrunks(t);
  let ground = terrain?.heightAt(t[0], t[2]) ?? t[1];
  // In the water you swim: the eyes stay above the surface.
  if (water.on) ground = Math.max(ground, water.level - 1.2);
  vec3.set(eye, t[0], ground + EYE, t[2]);
  const cp = Math.cos(walkPitch);
  const at = vec3.fromValues(eye[0] - Math.sin(orbit.yaw) * cp, eye[1] + Math.sin(walkPitch), eye[2] - Math.cos(orbit.yaw) * cp);
  camera.transform.setLocalPosition(eye[0], eye[1], eye[2]);
  camera.transform.lookAt(at);
  mat4.lookAt(view, eye, at, [0, 1, 0]);
}

function walkDown(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' && !stick && e.clientX < window.innerWidth * 0.4) {
    stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  } else if (!looking) looking = { id: e.pointerId, x: e.clientX, y: e.clientY };
}

function walkMove(e: PointerEvent): void {
  if (stick?.id === e.pointerId) { stick.x = e.clientX; stick.y = e.clientY; }
  if (looking?.id === e.pointerId) {
    orbit.yaw -= (e.clientX - looking.x) * 0.005;
    walkPitch = clamp(walkPitch - (e.clientY - looking.y) * 0.004, -1.3, 1.3);
    looking.x = e.clientX;
    looking.y = e.clientY;
  }
}

function walkUp(e: PointerEvent): void {
  if (stick?.id === e.pointerId) stick = null;
  if (looking?.id === e.pointerId) looking = null;
}

/** Walking with the touch stick: 70 px out is full speed (running past it). */
function moveByStick(dt: number): void {
  if (!walking || !stick) return;
  const dx = stick.x - stick.x0, dy = stick.y - stick.y0, len = Math.hypot(dx, dy);
  if (len < 6) return;
  const k = Math.min(len / 70, 1.4) / len;
  const f = -dy * k, r = dx * k;
  const speed = (Math.hypot(f, r) > 1.15 ? RUN : WALK) * dt;
  const s = Math.sin(orbit.yaw), c = Math.cos(orbit.yaw);
  orbit.target[0] += (-s * f + c * r) * speed;
  orbit.target[2] += (-c * f - s * r) * speed;
  keepInside();
}

function drawStick(): void {
  if (!stick) return;
  const r = canvas.getBoundingClientRect();
  const x0 = stick.x0 - r.left, y0 = stick.y0 - r.top;
  const dx = stick.x - stick.x0, dy = stick.y - stick.y0, len = Math.hypot(dx, dy), k = len > 70 ? 70 / len : 1;
  octx.beginPath();
  octx.arc(x0, y0, 70, 0, Math.PI * 2);
  octx.fillStyle = 'rgba(12, 9, 24, 0.35)';
  octx.fill();
  octx.strokeStyle = 'rgba(246, 241, 255, 0.5)';
  octx.lineWidth = 2;
  octx.stroke();
  octx.beginPath();
  octx.arc(x0 + dx * k, y0 + dy * k, 26, 0, Math.PI * 2);
  octx.fillStyle = 'rgba(45, 226, 255, 0.7)';
  octx.fill();
  overlayDrawn = true;
}

let last = 0, fpsTime = 0, fpsFrames = 0;
function frame(now: number): void {
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  resize();
  applyTool(dt);
  moveByKeys(dt);
  moveByStick(dt);
  glideOn(dt);
  followGround(dt);
  placeCamera();
  drawOverlay();
  updateTrees();
  if (genOpen) drawGenView();
  ($('undo') as HTMLButtonElement).disabled = !terrain.history.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !terrain.history.canRedo;
  engine.update(dt);
  engine.render();
  autosave(now);
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) { $('stats').textContent = `${Math.round(fpsFrames / fpsTime)} fps${trees.on ? ` · ${treeCount()} 🌲` : ''}`; fpsFrames = 0; fpsTime = 0; }
  requestAnimationFrame(frame);
}


// ---- The relief generator: numbers, a preview, and the terrain following live ----

const PREVIEW = 160;
/** What the panel shows; it becomes `gen` when it reaches the terrain. */
let draft: GenSettings = { ...gen };
let draftImage: Heightmap | null = null;
let genOpen = false;
let genPixels: ImageData | null = null;
let previewQueued = false;
/** A live generation is one undo step: it stays open while the numbers move, and closes on the next other action. */
let genStroke: { gen: GenSettings; image: Heightmap | null; area: Area; cleared: boolean } | null = null;
let genDirty = false, liveTimer = 0, previewTimer = 0;
/** How long after a number is let go the terrain follows, and how long the preview waits while one moves. */
const LIVE_DELAY = 350, PREVIEW_IDLE = 160;
const genView = $('genView') as HTMLCanvasElement;
const genCtx = genView.getContext('2d')!;
const genLive = $('genLive') as HTMLInputElement;
const genGrey = $('genGrey') as HTMLInputElement;
const genSeed = $('genSeed') as HTMLInputElement;
/** Only the noise has these: an image does not. */
const NOISE_ONLY: (keyof GenSettings)[] = ['octaves', 'persistence', 'ridges', 'sharpness'];

function openGen(): void {
  closeMenu();
  if (walking) setWalking(false);
  draft = { ...gen };
  draftImage = genImage;
  genOpen = true;
  $('gen').classList.add('open');
  document.body.classList.add('gen');
  syncGenInputs();
  queuePreview();
}

function closeGen(): void {
  if (!genOpen) return;
  settleGen();
  genOpen = false;
  $('gen').classList.remove('open');
  document.body.classList.remove('gen');
}

/** Writes the draft into every chunk (opening the undo step the first time). */
function applyDraft(): void {
  if (!genStroke) {
    endStroke();
    cancelRamp();
    // Painting made for the old relief would lie on the new one: cleared (its
    // own undo step), so the rules paint the new ground by height and slope.
    const cleared = isPainted();
    if (cleared) { terrain.clearPainting(); hint('Pintura limpa: as regras pintam o relevo novo · ↶ Anular duas vezes repõe-na'); }
    genStroke = { gen, image: genImage, area: genArea, cleared };
    terrain.beginStroke('heights');
    for (const c of terrain.grid.all()) terrain.history.save(c);
  }
  gen = { ...draft };
  genImage = draftImage;
  genArea = areaOf(terrain.grid);
  generate(terrain.grid, reliefAt());
  genDirty = false;
}

function isPainted(): boolean {
  for (const c of terrain.grid.all()) if (c.splat[0].some((v) => v) || c.splat[1].some((v) => v)) return true;
  return false;
}

/** Finishes a live generation: what is on the terrain becomes one undo step. */
function settleGen(): void {
  if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
  if (genDirty && genLive.checked) applyDraft();
  genDirty = false;
  if (genStroke) { genStroke = null; terrain.endStroke(); }
}

/** The numbers changed: the preview at once, the terrain as often as it can keep up. */
/**
 * The numbers changed. While a slider moves nothing heavy runs: the preview
 * waits for the finger to rest, the terrain for it to let go (`released`).
 */
function draftChanged(released = true): void {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(queuePreview, released ? 0 : PREVIEW_IDLE);
  if (!genLive.checked) return;
  genDirty = true;
  clearTimeout(liveTimer);
  liveTimer = released ? window.setTimeout(() => { liveTimer = 0; if (genDirty) applyDraft(); }, LIVE_DELAY) : 0;
}

function queuePreview(): void {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const area = areaOf(terrain.grid);
    const t = performance.now();
    const p = preview(heightField(draft, area, draftImage), area, PREVIEW, genGrey.checked, water.on ? water.level : null);
    genPixels = new ImageData(p.rgba as unknown as Uint8ClampedArray<ArrayBuffer>, PREVIEW, PREVIEW);
    $('genInfo').textContent = `${Math.round(p.min)} a ${Math.round(p.max)} m · ${Math.round(area.x1 - area.x0)} × ${Math.round(area.z1 - area.z0)} m${draftImage ? ' · da imagem' : ''} · ${Math.round(performance.now() - t)} ms`;
  });
}

/** The preview, with the camera's place and the way it looks. */
function drawGenView(): void {
  if (!genPixels) return;
  genCtx.putImageData(genPixels, 0, 0);
  const a = areaOf(terrain.grid);
  const k = PREVIEW / (a.x1 - a.x0);
  const x = (orbit.target[0] - TERRAIN_ORIGIN[0] - a.x0) * k, y = (orbit.target[2] - TERRAIN_ORIGIN[1] - a.z0) * ((PREVIEW) / (a.z1 - a.z0));
  genCtx.strokeStyle = 'rgba(255,255,255,.35)';
  genCtx.lineWidth = 1;
  const size = terrain.grid.settings.size * k;
  for (let gx = size; gx < PREVIEW - 1; gx += size) { genCtx.beginPath(); genCtx.moveTo(gx, 0); genCtx.lineTo(gx, PREVIEW); genCtx.stroke(); }
  for (let gy = size; gy < PREVIEW - 1; gy += size) { genCtx.beginPath(); genCtx.moveTo(0, gy); genCtx.lineTo(PREVIEW, gy); genCtx.stroke(); }
  genCtx.strokeStyle = '#2de2ff';
  genCtx.lineWidth = 2;
  genCtx.beginPath();
  genCtx.moveTo(x, y);
  genCtx.lineTo(x - Math.sin(orbit.yaw) * 14, y - Math.cos(orbit.yaw) * 14);
  genCtx.stroke();
  genCtx.fillStyle = '#2de2ff';
  genCtx.beginPath();
  genCtx.arc(x, y, 3.5, 0, Math.PI * 2);
  genCtx.fill();
}

function syncGenInputs(): void {
  genSeed.value = String(draft.seed);
  for (const [key] of SLIDERS) {
    const input = $(`gen-${key}`) as HTMLInputElement;
    input.value = String(draft[key]);
    input.disabled = !!draftImage && NOISE_ONLY.includes(key);
    showValue(key);
  }
  $('genNoImg').hidden = !draftImage;
}

function showValue(key: keyof GenSettings): void {
  const v = draft[key];
  const unit = key === 'scale' || key === 'amplitude' || key === 'base' ? ' m' : '';
  $(`gen-${key}-v`).textContent = (Number.isInteger(v) ? String(v) : v.toFixed(2)) + unit;
}

function buildGenPanel(): void {
  const box = $('genSliders');
  for (const [key, label, min, max, stepBy] of SLIDERS) {
    const row = document.createElement('label');
    row.innerHTML = `<span>${label}</span><input id="gen-${key}" type="range" min="${min}" max="${max}" step="${stepBy}"><output id="gen-${key}-v"></output>`;
    box.appendChild(row);
    const input = row.querySelector('input')!;
    input.oninput = () => { draft = { ...draft, [key]: Number(input.value) }; showValue(key); draftChanged(false); };
    input.onchange = () => draftChanged(true);
  }
  const presets = $('genPresets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.className = 'gbtn';
    b.textContent = p.name;
    b.onclick = () => {
      draft = { ...draft, ...p.settings, seed: draft.seed };
      draftImage = null;
      if (p.water && !water.on) setWater(true, 0);
      syncGenInputs();
      draftChanged();
    };
    presets.appendChild(b);
  }
  genSeed.oninput = () => { draft = { ...draft, seed: Math.max(0, Math.floor(Number(genSeed.value) || 0)) }; draftChanged(false); };
  genSeed.onchange = () => draftChanged(true);
  $('genDice').onclick = () => { draft = { ...draft, seed: Math.floor(Math.random() * 100000) }; syncGenInputs(); draftChanged(); };
  genGrey.onchange = () => queuePreview();
  genLive.onchange = () => { $('genApply').textContent = genLive.checked ? '✓ Feito' : '✓ Aplicar'; if (genLive.checked) draftChanged(); };
  $('genApply').onclick = () => {
    if (!genLive.checked || genDirty || !genStroke) applyDraft();
    settleGen();
    hint('Relevo no terreno · ↶ Anular volta ao de antes');
  };
  $('genReset').onclick = () => {
    if (liveTimer) { clearTimeout(liveTimer); liveTimer = 0; }
    genDirty = false;
    if (genStroke) {
      const before = genStroke;
      genStroke = null;
      terrain.endStroke();
      terrain.undo();
      if (before.cleared) terrain.undo();
      gen = before.gen; genImage = before.image; genArea = before.area;
    }
    draft = { ...gen };
    draftImage = genImage;
    syncGenInputs();
    queuePreview();
  };
  $('genClose').onclick = () => closeGen();
  // A tap on the preview takes the camera there.
  genView.onclick = (e) => {
    const r = genView.getBoundingClientRect(), a = areaOf(terrain.grid);
    glide = {
      x: TERRAIN_ORIGIN[0] + a.x0 + ((e.clientX - r.left) / r.width) * (a.x1 - a.x0),
      z: TERRAIN_ORIGIN[1] + a.z0 + ((e.clientY - r.top) / r.height) * (a.z1 - a.z0),
    };
  };
  $('genPng').onclick = () => { void exportHeightImage(); };
  $('genRaw').onclick = () => {
    const map = exportHeightmap(terrain.grid);
    if (map) download(new Blob([heightmapToRaw(map) as BlobPart]), `relevo-${map.width}x${map.height}.r16`);
  };
  $('genOpenImg').onclick = () => ($('genFile') as HTMLInputElement).click();
  $('genFile').onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) void openHeightImage(f);
  };
  $('genNoImg').onclick = () => { draftImage = null; draft = { ...draft, amplitude: GEN_DEFAULT.amplitude, base: GEN_DEFAULT.base }; syncGenInputs(); draftChanged(); };
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** The terrain as it is (sculpting included) as a grey PNG: black −64 m, white 192 m, a pixel per vertex. */
async function exportHeightImage(): Promise<void> {
  const map = exportHeightmap(terrain.grid);
  if (!map) return;
  const c = document.createElement('canvas');
  c.width = map.width; c.height = map.height;
  c.getContext('2d')!.putImageData(new ImageData(heightmapToRgba(map) as unknown as Uint8ClampedArray<ArrayBuffer>, map.width, map.height), 0, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  if (blob) download(blob, `relevo-${map.width}x${map.height}.png`);
}

/** A grey image (or a square .r16) as the relief's source, with the numbers set so the demo's own PNG comes back as it was. */
async function openHeightImage(f: File): Promise<void> {
  try {
    let map: Heightmap;
    if (/\.(r16|raw)$/i.test(f.name)) {
      map = rawToHeightmap(new Uint8Array(await f.arrayBuffer()));
    } else {
      const bitmap = await createImageBitmap(f);
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      map = smoothHeightmap(rgbaToHeightmap(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height));
    }
    const [lo, hi] = terrain.grid.settings.heightRange;
    draftImage = map;
    draft = { ...draft, amplitude: hi - lo, base: (hi + lo) / 2, warp: 0, island: 0 };
    syncGenInputs();
    draftChanged();
    hint(`${f.name}: preto ${lo} m, branco ${hi} m · Altura e Base mudam isso`);
  } catch (err) {
    hint(`Não abriu ${f.name}`);
    report(`[aviso] imagem: ${String(err)}`);
  }
}

// ---- Trees: scattered per chunk by the rules (or the painting), one merged mesh per material ----

const trees = { on: true, density: TREE_RULES.density };
interface ChunkTrees { key: string; list: Tree[]; entities: SceneEntity[] }
const treesByChunk = new Map<string, ChunkTrees>();
let treeMats: LitMaterial[] | null = null;

function treeMaterials(): LitMaterial[] {
  if (treeMats) return treeMats;
  const make = (r: number, g: number, b: number) => {
    const m = new LitMaterial();
    m.color = new Color(r, g, b, 1);
    m.specularStrength = 0.04;
    m.roughness = 0.95;
    return m;
  };
  // Trunks, pines, and two greens of broadleaf.
  treeMats = [make(0.36, 0.25, 0.16), make(0.11, 0.27, 0.15), make(0.24, 0.44, 0.15), make(0.33, 0.5, 0.17)];
  return treeMats;
}

function setTrees(on: boolean, density: number): void {
  trees.on = on;
  trees.density = density;
  $('treesBtn').classList.toggle('on', on);
  $('treeBox').style.display = on ? 'flex' : 'none';
  ($('density') as HTMLInputElement).value = String(Math.round(density * 100));
}

const treeCount = () => { let n = 0; for (const t of treesByChunk.values()) n += t.list.length; return n; };

/**
 * Builds the trees again on the chunks whose ground, painting, water or tree
 * numbers changed: not during a stroke (once it ends), one chunk a frame
 * (about 15 ms each on a desktop: scattering and merging).
 */
function updateTrees(): void {
  if (terrain.history.isOpen && !genStroke) return;
  const rules = { ...TREE_RULES, seed: gen.seed, density: trees.on ? trees.density : 0, water: water.on ? water.level : null };
  const present = new Set<string>();
  let built = 0;
  for (const c of terrain.grid.all()) {
    const id = `${c.cx},${c.cz}`;
    present.add(id);
    const key = `${c.heightVersion}:${c.splatVersion}:${rules.density}:${rules.water}:${rules.seed}`;
    const old = treesByChunk.get(id);
    if (old?.key === key || built >= 1) continue;
    built++;
    old?.entities.forEach((e) => scene.removeEntity(e));
    const list = scatterTrees(terrain.grid, c, rules);
    const entities: SceneEntity[] = [];
    if (list.length) {
      const m = treeMeshes(list), mats = treeMaterials();
      [m.trunks, m.pines, m.crowns[0], m.crowns[1]].forEach((data, k) => {
        if (!data.indices.length) return;
        const e = new SceneEntity(`Trees ${id}`);
        e.transform.setLocalPosition(TERRAIN_ORIGIN[0], 0, TERRAIN_ORIGIN[1]);
        const r = new MeshRendererBehaviour(gl);
        r.mesh = new Mesh();
        r.mesh.meshData = data;
        r.shader = new LitShader(gl, mats[k]);
        e.addBehaviour(r);
        scene.addEntity(e);
        entities.push(e);
      });
    }
    treesByChunk.set(id, { key, list, entities });
  }
  for (const [id, t] of treesByChunk) {
    if (present.has(id)) continue;
    t.entities.forEach((e) => scene.removeEntity(e));
    treesByChunk.delete(id);
  }
}

/** On foot, trunks are solid: pushes a world point out of any trunk it is in. */
function bumpTrunks(p: vec3): void {
  if (!trees.on) return;
  const x = p[0] - TERRAIN_ORIGIN[0], z = p[2] - TERRAIN_ORIGIN[1];
  const size = terrain.grid.settings.size;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const t = treesByChunk.get(`${Math.floor(x / size) + dx},${Math.floor(z / size) + dz}`);
      if (!t) continue;
      for (const tree of t.list) {
        const ox = x - tree.x, oz = z - tree.z, min = trunkRadius(tree) + 0.35;
        const d = Math.hypot(ox, oz);
        if (d >= min || d === 0) continue;
        p[0] += (ox / d) * (min - d);
        p[2] += (oz / d) * (min - d);
      }
    }
  }
}

buildGenPanel();
setTrees(trees.on, trees.density);
setTool('view');
void start();
