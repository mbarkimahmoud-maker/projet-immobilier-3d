import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
import BaseState from './BaseState.js';
import '../ui/interior.css';

export default class InteriorState extends BaseState {
  constructor(app, houseData = {}) {
    super(app);
    this.houseData = houseData;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,                                      // champ de vision (en degrés)
      window.innerWidth / window.innerHeight,  // proportions de l'écran
      0.05,                                    // distance minimale d'affichage
      100                                      // distance maximale d'affichage
    );

    this.controls = null;
    this.model = null;
    this.isReady = false; // passe à true quand tout est chargé

    // Déplacements
    this.keys = { forward: false, backward: false, left: false, right: false, run: false };
    this.walkSpeed = 2.5; // mètres par seconde
    this.runSpeed = 5;    // avec Maj enfoncée

    // Collisions
    this.collider = null;        // version simplifiée du modèle, utilisée seulement pour les collisions
    this.playerRadius = 0.25;    // rayon de la capsule du joueur (en mètres)
    this.kneeHeight = 0.35;      // bas de la capsule (en dessous, on passe par-dessus)
    this.eyeHeight = 1.6;        // hauteur de la caméra
    this.tempSegment = new THREE.Line3();
    this.tempBox = new THREE.Box3();
    this.tempTriPoint = new THREE.Vector3();
    this.tempCapsulePoint = new THREE.Vector3();

    // Points d'intérêt
    this.labelRenderer = null;
    this.infoPanel = null;

    // On "attache" les fonctions à this pour pouvoir retirer les écouteurs dans exit()
    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.resetKeys = this.resetKeys.bind(this);
    this.onResize = this.onResize.bind(this);
    this.hideInfo = this.hideInfo.bind(this);
  }

  async enter() {
    // Si on arrive sans données (test avec ?start=interior), on prend la première maison du JSON
    if (!this.houseData.hotspots) {
      try {
        const response = await fetch('/data/houses.json');
        const houses = await response.json();
        this.houseData = houses[0];
      } catch (error) {
        console.error('Impossible de lire houses.json :', error);
      }
    }

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

    this.buildCollider();

    // Position de départ : au bout du couloir d'entrée, à hauteur d'yeux, regard vers le salon
    this.camera.position.set(0.9, this.eyeHeight, -5.2);
    this.camera.lookAt(0.9, this.eyeHeight, 0);

    // Contrôles première personne
    this.controls = new PointerLockControls(this.camera, this.app.canvas);
    this.app.canvas.addEventListener('click', this.onClick);
    this.controls.addEventListener('unlock', this.resetKeys); // Échap : on arrête de marcher
    this.controls.addEventListener('lock', this.hideInfo);    // reprendre la visite ferme le panneau

    // Clavier
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);

    // Points d'intérêt
    this.createLabelRenderer();
    this.createHotspots();
    this.createInfoPanel();
    window.addEventListener('resize', this.onResize);

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

  // ---------- Collisions ----------

  // Fusionne tous les objets du modèle en une seule géométrie
  // et construit une structure de recherche rapide (BVH) dessus
  buildCollider() {
    this.model.updateMatrixWorld(true);

    const generator = new StaticGeometryGenerator(this.model);
    generator.attributes = ['position'];

    const geometry = generator.generate();
    geometry.boundsTree = new MeshBVH(geometry);

    this.collider = new THREE.Mesh(geometry); // jamais ajouté à la scène : invisible
  }

  // Repousse le joueur hors des murs et des meubles
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
          const depth = radius - distance;
          const direction = capsulePoint.sub(triPoint).normalize();
          direction.y = 0; // on repousse seulement à l'horizontale

          segment.start.addScaledVector(direction, depth);
          segment.end.addScaledVector(direction, depth);
        }
      }
    });

    position.x = segment.start.x;
    position.z = segment.start.z;
  }

  // ---------- Points d'intérêt ----------

  // Calque HTML qui affiche les étiquettes par-dessus la 3D
  createLabelRenderer() {
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.className = 'label-layer';
    document.body.appendChild(this.labelRenderer.domElement);
  }

  // Une étiquette cliquable par point d'intérêt du JSON
  createHotspots() {
    const hotspots = this.houseData.hotspots ?? [];

    hotspots.forEach((hotspot) => {
      const element = document.createElement('button');
      element.className = 'hotspot';
      element.textContent = hotspot.title;
      element.addEventListener('click', () => this.showInfo(hotspot));

      const label = new CSS2DObject(element);
      label.position.fromArray(hotspot.position);
      this.scene.add(label);
    });
  }

  // Panneau d'information (caché au départ)
  createInfoPanel() {
    this.infoPanel = document.createElement('div');
    this.infoPanel.className = 'info-panel hidden';
    document.body.appendChild(this.infoPanel);
  }

  showInfo(hotspot) {
    this.infoPanel.innerHTML = `
      <button class="info-close">×</button>
      <h2>${hotspot.title}</h2>
      ${hotspot.area ? `<p class="info-area">${hotspot.area}</p>` : ''}
      <p>${hotspot.description ?? ''}</p>
    `;
    this.infoPanel.querySelector('.info-close').addEventListener('click', this.hideInfo);
    this.infoPanel.classList.remove('hidden');
  }

  hideInfo() {
    if (this.infoPanel) this.infoPanel.classList.add('hidden');
  }

  onResize() {
    if (this.labelRenderer) this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  // Outil de développement : affiche la position actuelle pour placer une étiquette
  logPosition() {
    const p = this.camera.position;
    console.log(`"position": [${p.x.toFixed(2)}, 1.2, ${p.z.toFixed(2)}]`);
  }

  // ---------- Contrôles ----------

  onClick() {
    if (this.controls) this.controls.lock(); // verrouille la souris dans la page
  }

  onKeyDown(event) {
    if (event.code === 'KeyP') this.logPosition();
    this.setKey(event.code, true);
  }

  onKeyUp(event) {
    this.setKey(event.code, false);
  }

  // Associe chaque touche physique à une direction (marche en AZERTY et en QWERTY)
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

  resetKeys() {
    for (const key in this.keys) this.keys[key] = false;
  }

  // ---------- Boucle ----------

  update(deltaTime) {
    // App.js ne dessine pas : c'est l'état actif qui fait le rendu
    this.app.renderer.render(this.scene, this.camera);
    if (this.labelRenderer) this.labelRenderer.render(this.scene, this.camera);

    if (!this.isReady) return;
    if (!this.controls.isLocked) return; // on ne marche que quand la souris est verrouillée

    const dt = Math.min(deltaTime, 0.05); // évite de traverser un mur fin en un seul pas

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

    this.resolveCollisions();
  }

  // ---------- Nettoyage ----------

  exit() {
    window.removeEventListener('resize', this.onResize);
    if (this.labelRenderer) this.labelRenderer.domElement.remove();
    if (this.infoPanel) this.infoPanel.remove();

    if (this.controls) {
      this.controls.removeEventListener('unlock', this.resetKeys);
      this.controls.removeEventListener('lock', this.hideInfo);
      this.controls.unlock();
      this.controls.dispose();
    }
    this.app.canvas.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);

    if (this.collider) this.collider.geometry.dispose();

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