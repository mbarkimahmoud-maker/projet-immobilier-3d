import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
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

    // NOUVEAU : état des touches de déplacement
    this.keys = { forward: false, backward: false, left: false, right: false, run: false };
    this.walkSpeed = 2.5; // mètres par seconde
    this.runSpeed = 5;    // avec Maj enfoncée

    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this); // NOUVEAU
    this.onKeyUp = this.onKeyUp.bind(this);     // NOUVEAU
    this.resetKeys = this.resetKeys.bind(this); // NOUVEAU
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

    this.camera.position.set(0.9, 1.6, -5.2);
    this.camera.lookAt(0.9, 1.6, 0);

    this.controls = new PointerLockControls(this.camera, this.app.canvas);
    this.app.canvas.addEventListener('click', this.onClick);

    // NOUVEAU : écoute du clavier
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    // NOUVEAU : quand la souris est libérée (Échap), on arrête de marcher
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

  onClick() {
    if (this.controls) this.controls.lock();
  }

  // NOUVEAU : une touche est enfoncée
  onKeyDown(event) {
    this.setKey(event.code, true);
  }

  // NOUVEAU : une touche est relâchée
  onKeyUp(event) {
    this.setKey(event.code, false);
  }

  // NOUVEAU : associe chaque touche physique à une direction
  setKey(code, isPressed) {
    switch (code) {
      case 'KeyW':      // Z sur un clavier AZERTY
      case 'ArrowUp':
        this.keys.forward = isPressed; break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = isPressed; break;
      case 'KeyA':      // Q sur un clavier AZERTY
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

  // NOUVEAU
  resetKeys() {
    for (const key in this.keys) this.keys[key] = false;
  }

  update(deltaTime) {
    this.app.renderer.render(this.scene, this.camera);

    if (!this.isReady) return;
    if (!this.controls.isLocked) return; // on ne marche que quand la souris est verrouillée

    // NOUVEAU : déplacement
    const dt = Math.min(deltaTime, 0.1); // évite un grand saut si l'onglet était en pause

    // Direction voulue : z = avant/arrière, x = gauche/droite
    const direction = new THREE.Vector2(
      Number(this.keys.right) - Number(this.keys.left),
      Number(this.keys.forward) - Number(this.keys.backward)
    );
    if (direction.lengthSq() === 0) return; // aucune touche enfoncée

    direction.normalize(); // même vitesse en diagonale qu'en ligne droite

    const speed = this.keys.run ? this.runSpeed : this.walkSpeed;
    const distance = speed * dt;

    this.controls.moveForward(direction.y * distance);
    this.controls.moveRight(direction.x * distance);
  }

  exit() {
    if (this.controls) {
      this.controls.removeEventListener('unlock', this.resetKeys); // NOUVEAU
      this.controls.unlock();
      this.controls.dispose();
    }
    this.app.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKeyDown); // NOUVEAU
    document.removeEventListener('keyup', this.onKeyUp);     // NOUVEAU

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