import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { DesignResult } from './pipeline/types';

export type LightMode = 'backlit' | 'room';

/**
 * 3D preview. The model is built mirrored for face-down printing, so by default the
 * viewer looks at the bed side (z = 0), which is how the panel is seen when it hangs.
 */
export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group();
  private meshes = new Map<string, THREE.Mesh>();
  private lightBox: THREE.Mesh;
  private ambient = new THREE.HemisphereLight(0xffffff, 0x404050, 1.4);
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private mode: LightMode = 'backlit';
  private size = { w: 100, h: 100 };
  private needsRender = true;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));

    this.scene.add(this.group, this.ambient, this.sun);
    this.sun.position.set(-150, 200, 300);

    // A soft white "window" behind the panel for the backlit mode.
    this.lightBox = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff8ec, side: THREE.DoubleSide }),
    );
    this.scene.add(this.lightBox);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this.needsRender) { this.renderer.render(this.scene, this.camera); this.needsRender = false; }
    };
    loop();
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
      this.group.add(mesh);
      this.meshes.set(part.name, mesh);
    }

    // Center the panel and turn it so the viewing (bed) side faces the camera.
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    const inner = new THREE.Group();
    for (const m of [...this.group.children]) inner.add(m);
    inner.position.set(-result.widthMm / 2, -result.heightMm / 2, 0);
    this.group.add(inner);
    if (mirrored) this.group.rotation.y = Math.PI; // look at z=0 face; undoes the X mirror

    this.lightBox.scale.set(result.widthMm * 8, result.heightMm * 8, 1);
    this.resetView();
    this.applyMode();
  }

  private material(kind: string, color: string): THREE.Material {
    if (kind === 'came') {
      return new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.55, metalness: 0.35 });
    }
    if (this.mode === 'backlit') {
      // Light passing through tinted glass: the color itself is what you see.
      return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.93 });
    }
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.8 });
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
    this.scene.background = new THREE.Color(backlit ? 0x101114 : 0xe9e6df);
    this.ambient.intensity = backlit ? 0.35 : 1.4;
    this.sun.intensity = backlit ? 0.5 : 1.6;
    this.lightBox.visible = backlit;
    // keep the light box behind the panel, relative to the viewing side
    // Viewing side faces +z when the model is rotated (mirrored build), -z otherwise.
    const viewSign = this.camera.position.z >= 0 ? 1 : -1;
    this.lightBox.position.set(0, 0, -viewSign * 40);
    this.needsRender = true;
  }

  setVisible(name: string, visible: boolean) {
    const m = this.meshes.get(name);
    if (m) { m.visible = visible; this.needsRender = true; }
  }

  resetView() {
    const d = Math.max(this.size.w, this.size.h) * 1.9;
    const front = this.group.rotation.y === Math.PI ? 1 : -1;
    this.camera.position.set(d * 0.18, -d * 0.12, front * d);
    this.camera.up.set(0, 1, 0);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.needsRender = true;
  }

  /** Flip between the viewing side and the print (came) side. */
  flipSide() {
    this.camera.position.z *= -1;
    this.camera.position.x *= -1;
    const behind = this.lightBox.position.z;
    this.lightBox.position.z = -behind;
    this.controls.update();
    this.needsRender = true;
  }
}
