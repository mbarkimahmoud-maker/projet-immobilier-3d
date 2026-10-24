import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh'; // NOUVEAU
import BaseState from './BaseState.js';

export default class InteriorState extends BaseState {
  constructor(app, houseData = {}) {
    super(app);
    this.houseData = houseData;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.05,
      100
    );

    this.controls = null;
    this.model = null;
    this.isReady = false;

    this.keys = { forward: false, backward: false, left: false, right: false, run: false };
    this.walkSpeed = 2.5;
    this.runSpeed = 5;

    // NOUVEAU : collisions
    this.collider = null;        // version simplifiée du modèle, utilisée seulement pour les collisions
    this.playerRadius = 0.25;    // rayon de la capsule du joueur (en mètres)
    this.kneeHeight = 0.35;      // bas de la capsule (en dessous, on passe par-dessus)
    this.eyeHeight = 1.6;        // hauteur de la caméra
    // Objets réutilisés à chaque image (évite d'en créer des milliers)
    this.tempSegment = new THREE.Line3();
    this.tempBox = new THREE.Box3();
    this.tempTriPoint = new THREE.Vector3();
    this.tempCapsulePoint = new THREE.Vector3();

    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.resetKeys = this.resetKeys.bind(this);
  }

  async enter() {
    this.scene.background = new THREE.Color(0xdde3ea);

    const ambient = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, 3);
    this.scene.add(sun);

    const path = this.houseData.interiorModel ?? '/models/interior_1.glb';
    try {
      const gltf = await new GLTFLoader().loadAsync(path);
      this.model = gltf.scene;
      this.prepareModel(this.model);
      this.scene.add(this.model);
    } catch (error) {
      console.error('Impossible de charger le modèle intérieur :', path, error);
      return;
    }

    this.buildCollider(); // NOUVEAU

    this.camera.position.set(0.9, this.eyeHeight, -5.2);
    this.camera.lookAt(0.9, this.eyeHeight, 0);

    this.controls = new PointerLockControls(this.camera, this.app.canvas);
    this.app.canvas.addEventListener('click', this.onClick);

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    this.controls.addEventListener('unlock', this.resetKeys);

    this.isReady = true;
  }

  prepareModel(model) {
    model.scale.setScalar(0.002);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    model.traverse((child) => {
      if (child.isMesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((m) => { m.side = THREE.DoubleSide; });
      }
    });
  }

  // NOUVEAU : fusionne tous les objets du modèle en une seule géométrie
  // et construit une structure de recherche rapide (BVH) dessus
  buildCollider() {
    this.model.updateMatrixWorld(true); // applique l'échelle et le recentrage

    const generator = new StaticGeometryGenerator(this.model);
    generator.attributes = ['position']; // seule la forme compte pour les collisions

    const geometry = generator.generate();
    geometry.boundsTree = new MeshBVH(geometry);

    this.collider = new THREE.Mesh(geometry); // jamais ajouté à la scène : invisible
  }

  // NOUVEAU : repousse le joueur hors des murs et des meubles
  resolveCollisions() {
    const position = this.camera.position;
    const radius = this.playerRadius;
    const segment = this.tempSegment;

    // Axe de la capsule : des genoux jusqu'au-dessus de la tête
    const floorY = position.y - this.eyeHeight;
    segment.start.set(position.x, floorY + this.kneeHeight, position.z);
    segment.end.set(position.x, position.y + 0.1, position.z);

    // Zone autour du joueur : on ne teste que les triangles proches
    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(segment.start);
    this.tempBox.expandByPoint(segment.end);
    this.tempBox.min.addScalar(-radius);
    this.tempBox.max.addScalar(radius);

    this.collider.geometry.boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.tempBox),

      intersectsTriangle: (triangle) => {
        const triPoint = this.tempTriPoint;
        const capsulePoint = this.tempCapsulePoint;
        const distance = triangle.closestPointToSegment(segment, triPoint, capsulePoint);

        if (distance < radius) {
          // Le triangle est trop près : on repousse la capsule de la différence
          const depth = radius - distance;
          const direction = capsulePoint.sub(triPoint).normalize();
          direction.y = 0; // on repousse seulement à l'horizontale

          segment.start.addScaledVector(direction, depth);
          segment.end.addScaledVector(direction, depth);
        }
      }
    });

    // On applique la correction à la caméra
    position.x = segment.start.x;
    position.z = segment.start.z;
  }

  onClick() {
    if (this.controls) this.controls.lock();
  }

  onKeyDown(event) {
    this.setKey(event.code, true);
  }

  onKeyUp(event) {
    this.setKey(event.code, false);
  }

  setKey(code, isPressed) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = isPressed; break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = isPressed; break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = isPressed; break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = isPressed; break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.run = isPressed; break;
    }
  }

  resetKeys() {
    for (const key in this.keys) this.keys[key] = false;
  }

  update(deltaTime) {
    this.app.renderer.render(this.scene, this.camera);

    if (!this.isReady) return;
    if (!this.controls.isLocked) return;

    const dt = Math.min(deltaTime, 0.05); // NOUVEAU : 0.05 au lieu de 0.1, pour ne jamais traverser un mur fin d'un coup

    const direction = new THREE.Vector2(
      Number(this.keys.right) - Number(this.keys.left),
      Number(this.keys.forward) - Number(this.keys.backward)
    );
    if (direction.lengthSq() === 0) return;

    direction.normalize();

    const speed = this.keys.run ? this.runSpeed : this.walkSpeed;
    const distance = speed * dt;

    this.controls.moveForward(direction.y * distance);
    this.controls.moveRight(direction.x * distance);

    this.resolveCollisions(); // NOUVEAU
  }

  exit() {
    if (this.controls) {
      this.controls.removeEventListener('unlock', this.resetKeys);
      this.controls.unlock();
      this.controls.dispose();
    }
    this.app.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);

    // NOUVEAU : libère aussi la géométrie de collision
    if (this.collider) this.collider.geometry.dispose();

    this.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((m) => {
          for (const key in m) {
            if (m[key] && m[key].isTexture) m[key].dispose();
          }
          m.dispose();
        });
      }
    });
  }
}