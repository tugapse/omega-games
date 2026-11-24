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

const $ = (id: string) => document.getElementById(id)!;
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
const orbit = { yaw: 0.8, pitch: 0.42, distance: 340, target: vec3.fromValues(0, 0, 0) };
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
  entity.transform.setLocalPosition(-192, 0, -192);
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
  (window as any).terrainDemo = { scene, terrain, orbit, camera, brushAt, dropBalls, balls };
  requestAnimationFrame(frame);
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
type Tool = 'view' | SculptTool | 'paint' | 'erase';
let tool: Tool = 'view';
let layer = 0;
const brush: BrushSettings = { radius: 14, strength: 0.5, hardness: 0.35 };

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  ($('layers') as HTMLElement).style.display = t === 'paint' ? 'flex' : 'none';
  hint(t === 'view' ? 'Arrasta para rodar a câmara · dois dedos para aproximar'
    : t === 'paint' ? 'Escolhe a camada e pinta · dois dedos movem a câmara'
    : 'Arrasta no terreno · dois dedos movem a câmara');
  if (t === 'view') terrain?.showBrush(null);
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
$('undo').onclick = () => terrain.undo();
$('redo').onclick = () => terrain.redo();
$('bake').onclick = () => { terrain.bakeRules(); hint('As regras estão agora na pintura: retoca-as à mão'); };
$('clear').onclick = () => { terrain.clearPainting(); hint('Sem pintura: só as regras'); };
$('regen').onclick = () => { seed++; makeRelief(); terrain.clearPainting(); terrain.history.clear(); };
$('balls').onclick = () => dropBalls();
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) terrain.redo(); else terrain.undo(); }
});

// ---- Pointer: one finger works the tool (or orbits), two move the camera ----
const pointers = new Map<number, { x: number; y: number }>();
let stroke: { x: number; y: number; target?: number } | null = null;
let pinch: { d: number; a: number; mid: [number, number]; distance: number; yaw: number; pitch: number } | null = null;
let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;

/** The ground point under a canvas point, if any. */
function brushAt(x: number, y: number): vec3 | undefined {
  const { origin, dir } = rayAt(x, y);
  return terrain.raycast(origin, dir, 3000);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    endStroke();
    drag = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], distance: orbit.distance, yaw: orbit.yaw, pitch: orbit.pitch };
    return;
  }
  if (pointers.size > 2) return;
  if (tool === 'view' || e.button === 2) {
    drag = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch };
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
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    orbit.distance = clamp(pinch.distance * (pinch.d / Math.max(d, 1)), 25, 900);
    orbit.yaw = pinch.yaw - (ang - pinch.a);
    orbit.pitch = clamp(pinch.pitch + (mid[1] - pinch.mid[1]) * 0.005, 0.08, 1.45);
    return;
  }
  if (drag) {
    orbit.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
    orbit.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.005, 0.08, 1.45);
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
const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) { drag = null; endStroke(); if (e.pointerType !== 'mouse') terrain.showBrush(null); }
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); orbit.distance = clamp(orbit.distance * Math.exp(e.deltaY * 0.001), 25, 900); }, { passive: false });

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The tool at work while a finger is down. */
function applyTool(dt: number): void {
  if (!stroke) return;
  const p = brushAt(stroke.x, stroke.y);
  terrain.showBrush(p ?? null, brush.radius);
  if (!p) return;
  if (tool === 'paint') terrain.paintAt(layer, p, brush, dt);
  else if (tool === 'erase') terrain.paintAt(0, p, brush, dt, true);
  else if (tool !== 'view') terrain.sculptAt(tool, p, brush, dt, stroke.target);
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
  followGround(dt);
  placeCamera();
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
