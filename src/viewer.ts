import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DesignResult } from './pipeline/types';

export type LightMode = 'backlit' | 'room';

const BG_TOP = '#3b3b3b';
const BG_BOTTOM = '#262626';
const TILE_MM = 10;

/**
 * 3D preview in the style of a desktop 3D modelling app: a dark gray gradient backdrop,
 * a checkered floor with millimetre labels, and soft lighting. The panel stands upright
 * on the floor. The model is built mirrored for face-down printing, so by default the
 * viewer looks at the bed side (z = 0), which is the front of the finished panel.
 */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private floor = new THREE.Group();
  private hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.6);
  private key = new THREE.DirectionalLight(0xffffff, 1.4);
  private fill = new THREE.DirectionalLight(0xffffff, 0.6);
  private glow = new THREE.PointLight(0xfff2dc, 0, 0, 0);
  private mode: LightMode = 'backlit';
  private size = { w: 100, h: 100 };
  private needsRender = true;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = gradientTexture();
    this.scene.fog = new THREE.Fog(BG_BOTTOM, 400, 1200);

    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 8000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Never look from under the floor.
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.key.position.set(-200, 300, 400);
    this.fill.position.set(250, 120, -300);
    this.scene.add(this.group, this.floor, this.hemi, this.key, this.fill, this.glow);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.needsRender) { this.renderer.render(this.scene, this.camera); this.needsRender = false; }
    };
    loop();
    this.buildFloor(100, 100);
    this.applyMode();
  }

  private resize() {
    const w = this.container.clientWidth || 300, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  show(result: DesignResult, mirrored: boolean) {
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.group.clear();
    this.meshes.clear();
    this.size = { w: result.widthMm, h: result.heightMm };

    const inner = new THREE.Group();
    for (const part of result.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      g.setIndex(new THREE.BufferAttribute(part.indices, 1));
      const flat = g.toNonIndexed();
      g.dispose();
      flat.computeVertexNormals();
      const mesh = new THREE.Mesh(flat, this.material(part.kind, part.color));
      mesh.userData = { kind: part.kind, color: part.color };
      mesh.name = part.name;
      inner.add(mesh);
      this.meshes.set(part.name, mesh);
    }
    // Center horizontally, stand the bottom edge on the floor (y = 0).
    inner.position.set(-result.widthMm / 2, 0, 0);
    this.group.add(inner);
    // Mirrored build: turn it so the bed side (the front) faces +z, which also undoes the mirror.
    this.group.rotation.set(0, mirrored ? Math.PI : 0, 0);

    this.buildFloor(result.widthMm, result.heightMm);
    this.resetView();
    this.applyMode();
  }

  /** Checkered floor (10 mm tiles) with mm labels along the front edge of the panel. */
  private buildFloor(w: number, h: number) {
    for (const o of [...this.floor.children]) {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      mat?.map?.dispose();
      mat?.dispose();
    }
    this.floor.clear();

    const extent = Math.ceil((Math.max(w, h) * 24) / 100) * 100;
    const tex = checkerTexture();
    tex.repeat.set(extent / (TILE_MM * 2), extent / (TILE_MM * 2));
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(extent, extent),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.05;
    this.floor.add(plane);

    // Labels every 50 mm across the panel's width, from its left edge.
    const step = w > 400 ? 100 : 50;
    const s = Math.max(w, h) / 150; // label size scales with the panel
    for (let mm = 0; mm <= w + 0.01; mm += step) this.floor.add(label(`${mm} mm`, -w / 2 + mm, 30 * s, s));
    this.needsRender = true;
  }

  private material(kind: string, color: string): THREE.Material {
    if (kind === 'came') {
      return new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.5, metalness: 0.3 });
    }
    const c = new THREE.Color(color);
    if (this.mode === 'backlit') {
      // Glass lit from behind: the panes glow in their own color.
      return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0 });
    }
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0 });
  }

  setMode(mode: LightMode) {
    this.mode = mode;
    for (const m of this.meshes.values()) {
      (m.material as THREE.Material).dispose();
      m.material = this.material(m.userData.kind, m.userData.color);
    }
    this.applyMode();
  }

  private applyMode() {
    const backlit = this.mode === 'backlit';
    this.hemi.intensity = backlit ? 0.8 : 2.4;
    this.key.intensity = backlit ? 0.6 : 1.6;
    this.fill.intensity = backlit ? 0.4 : 1.0;
    // A warm glow behind the panel lights the floor and edges a little in backlit mode.
    this.glow.intensity = backlit ? 2.5 : 0;
    const behind = this.group.rotation.y === Math.PI ? -1 : 1;
    this.glow.position.set(0, this.size.h * 0.6, behind * 40);
    this.needsRender = true;
  }

  setVisible(name: string, visible: boolean) {
    const m = this.meshes.get(name);
    if (m) { m.visible = visible; this.needsRender = true; }
  }

  resetView() {
    const d = Math.max(this.size.w, this.size.h * 1.15) * 2.1;
    const front = this.group.rotation.y === Math.PI ? 1 : -1;
    const cy = this.size.h * 0.45;
    this.camera.position.set(d * 0.22, cy + d * 0.25, front * d);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, cy, 0);
    this.controls.minDistance = Math.max(this.size.w, this.size.h) * 0.3;
    this.controls.maxDistance = Math.max(this.size.w, this.size.h) * 6;
    // Fade the floor into the backdrop well beyond the panel, never on it.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = d * 1.6;
    fog.far = d * 4.5;
    this.controls.update();
    this.needsRender = true;
  }

  /** Swing the camera around to the other side (front glass ↔ back with raised lead lines). */
  flipSide() {
    const t = this.controls.target;
    this.camera.position.x = 2 * t.x - this.camera.position.x;
    this.camera.position.z = 2 * t.z - this.camera.position.z;
    this.controls.update();
    this.needsRender = true;
  }
}

function gradientTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOTTOM);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function checkerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4d4d4d'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#5c5c5c'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function label(text: string, x: number, z: number, scale: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '600 46px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(240,240,240,0.95)';
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(48 * scale, 12 * scale),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.05, z);
  return m;
}
