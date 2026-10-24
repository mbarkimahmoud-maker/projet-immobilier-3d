import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import BaseState from './BaseState.js';

export default class InteriorState extends BaseState {
  constructor(app, houseData = {}) {
    super(app);
    this.houseData = houseData;

    this.scene = new THREE.Scene();
    // App.js met automatiquement à jour cette caméra quand la fenêtre change de taille
    this.camera = new THREE.PerspectiveCamera(
      70,                                      // champ de vision (en degrés)
      window.innerWidth / window.innerHeight,  // proportions de l'écran
      0.05,                                    // distance minimale d'affichage
      100                                      // distance maximale d'affichage
    );

    this.controls = null;
    this.model = null;
    this.isReady = false; // passe à true quand le modèle est chargé

    this.onClick = this.onClick.bind(this);
  }

  async enter() {
    this.scene.background = new THREE.Color(0xdde3ea);

    // Lumières
    const ambient = new THREE.HemisphereLight(0xffffff, 0x8d8d8d, 2);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(5, 10, 3);
    this.scene.add(sun);

    // Chargement du modèle
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

    // Position de départ : au bout du couloir d'entrée, à hauteur d'yeux, regard vers le salon
    this.camera.position.set(0.9, 1.6, -5.2);
    this.camera.lookAt(0.9, 1.6, 0);

    // Contrôles première personne
    this.controls = new PointerLockControls(this.camera, this.app.canvas);
    this.app.canvas.addEventListener('click', this.onClick);

    this.isReady = true;
  }

  prepareModel(model) {
    // 1. Mise à l'échelle : le modèle utilise environ 2 mm par unité, Three.js travaille en mètres
    model.scale.setScalar(0.002);

    // 2. Recentrage : centre du modèle en x/z = 0, sol posé à y = 0
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    // 3. Double face : évite les murs invisibles typiques des modèles SketchUp
    model.traverse((child) => {
      if (child.isMesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((m) => { m.side = THREE.DoubleSide; });
      }
    });
  }

  onClick() {
    if (this.controls) this.controls.lock(); // verrouille la souris dans la page
  }

  update(deltaTime) {
    // App.js ne dessine pas : c'est l'état actif qui fait le rendu
    this.app.renderer.render(this.scene, this.camera);

    if (!this.isReady) return; // modèle pas encore chargé
    // Les déplacements ZQSD viendront ici
  }

  exit() {
    if (this.controls) {
      this.controls.unlock();
      this.controls.dispose();
    }
    this.app.canvas.removeEventListener('click', this.onClick);

    // Libère la mémoire GPU (géométries, matériaux, textures)
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