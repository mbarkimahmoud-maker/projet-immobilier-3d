import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';
import BaseState from './BaseState.js';
import LandingState from './LandingState.js';
import '../ui/interior.css';

const DOWN = new THREE.Vector3(0, -1, 0);

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
    this.isReady = false;   // passe à true quand tout est chargé
    this.isLeaving = false; // évite un double clic sur le bouton de retour

    // Déplacements
    this.keys = { forward: false, backward: false, left: false, right: false };
    this.walkSpeed = 2.5;     // mètres par seconde
    this.maxStepUp = 0.2;     // hauteur de marche maximale qu'on peut monter (en mètres)
    this.maxStepDown = 0.4;   // au-delà, c'est un vide : on ne descend pas
    this.previousPosition = new THREE.Vector3(); // pour annuler un pas impossible

    // Collisions
    this.collider = null;        // version simplifiée du modèle, utilisée seulement pour les collisions
    this.playerRadius = 0.25;    // rayon de la capsule du joueur (en mètres)
    this.kneeHeight = 0.35;      // bas de la capsule (en dessous, c'est le sol qui décide)
    this.eyeHeight = 1.6;        // hauteur des yeux au-dessus du sol
    this.tempSegment = new THREE.Line3();
    this.tempBox = new THREE.Box3();
    this.tempTriPoint = new THREE.Vector3();
    this.tempCapsulePoint = new THREE.Vector3();
    this.downRay = new THREE.Ray();

    // Points d'intérêt
    this.labelRenderer = null;
    this.infoPanel = null;
    this.hotspotLabels = []; // { label, hotspot } pour gérer leur visibilité par étage

    // Mode 360°
    this.isPanorama = false;
    this.panoScene = null;
    this.panoCamera = null;
    this.panoControls = null;
    this.cubeRenderTarget = null;

    // Barre d'aide
    this.toolbar = null;
    this.backButton = null;
    this.panoButton = null;
    this.hint = null;

    // On "attache" les fonctions à this pour pouvoir retirer les écouteurs dans exit()
    this.onClick = this.onClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onLock = this.onLock.bind(this);
    this.onUnlock = this.onUnlock.bind(this);
    this.onResize = this.onResize.bind(this);
    this.hideInfo = this.hideInfo.bind(this);
  }

  async enter() {
    // Si on arrive sans données (test direct), on prend la maison indiquée dans l'URL (?house=house-2),
    // ou la première du JSON
    if (!this.houseData.id) {
      try {
        const response = await fetch('/data/houses.json');
        const houses = await response.json();
        const wantedId = new URLSearchParams(window.location.search).get('house');
        this.houseData = houses.find((h) => h.id === wantedId) ?? houses[0];
      } catch (error) {
        console.error('Impossible de lire houses.json :', error);
      }
    }
        // Hauteur de marche maximale propre à chaque maison (escaliers plus raides)
    this.maxStepUp = this.houseData.maxStepUp ?? 0.2;

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
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder); // nécessaire pour les modèles compressés avec meshopt
      const gltf = await loader.loadAsync(path);
      this.model = gltf.scene;
      this.prepareModel(this.model);
      this.scene.add(this.model);
    } catch (error) {
      console.error('Impossible de charger le modèle intérieur :', path, error);
      return;
    }

    this.buildCollider();

    // Position de départ et direction du regard, propres à chaque maison
    const [startX, startZ] = this.houseData.spawnPosition ?? [0, 0];
    const [lookX, lookZ] = this.houseData.spawnLookAt ?? [startX, startZ + 1];
    this.camera.position.set(startX, this.eyeHeight, startZ);
    this.camera.lookAt(lookX, this.eyeHeight, lookZ);

    // Contrôles première personne
    this.controls = new PointerLockControls(this.camera, this.app.canvas);
    this.app.canvas.addEventListener('click', this.onClick);
    this.controls.addEventListener('lock', this.onLock);
    this.controls.addEventListener('unlock', this.onUnlock);

    // Clavier
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);

    // Interface
    this.createLabelRenderer();
    this.createHotspots();
    this.createInfoPanel();
    this.createToolbar();
    window.addEventListener('resize', this.onResize);

    this.isReady = true;
    this.updateUI();
  }

  prepareModel(model) {
    // 1. Mise à l'échelle, propre à chaque modèle (1 = le modèle est déjà en mètres)
    model.scale.setScalar(this.houseData.interiorScale ?? 1);

    // 2. Recentrage : centre du modèle en x/z = 0, sol posé à y = 0.
    //    interiorFloorOffset sert si le sol n'est pas le point le plus bas du modèle
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y + (this.houseData.interiorFloorOffset ?? 0);

    // 3. Double face : évite les murs invisibles (fréquent avec les modèles SketchUp)
    model.traverse((child) => {
      if (child.isMesh) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((m) => { m.side = THREE.DoubleSide; });
      }
    });
  }

  // ---------- Collisions, sol et étages ----------

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
    // + radius : le bas de la capsule (une demi-sphère) arrive ainsi exactement à hauteur des genoux
    segment.start.set(position.x, floorY + this.kneeHeight + radius, position.z);    segment.end.set(position.x, position.y + 0.1, position.z);

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

  // Lance un rayon vers le bas depuis les yeux et renvoie la hauteur du sol touché (ou null s'il n'y a rien)
  findFloorBelow() {
    this.downRay.set(this.camera.position, DOWN);
    const hit = this.collider.geometry.boundsTree.raycastFirst(this.downRay, THREE.DoubleSide);
    return hit ? hit.point.y : null;
  }

  // Étage actuel = hauteur du sol sous les pieds
  getCurrentFloor() {
    return this.camera.position.y - this.eyeHeight;
  }

  // Transporte le joueur à un autre endroit (par exemple un autre étage)
  teleportTo(target) {
    const [x, floorY, z] = target.position;
    this.camera.position.set(x, floorY + this.eyeHeight, z);
    if (target.lookAt) {
      this.camera.lookAt(target.lookAt[0], floorY + this.eyeHeight, target.lookAt[1]);
    }
    this.hideInfo();
    this.updateHotspotVisibility();
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
      this.hotspotLabels.push({ label, hotspot });
    });

    this.updateHotspotVisibility();
  }

  // On n'affiche que les étiquettes de l'étage où se trouve le joueur
  updateHotspotVisibility() {
    const currentFloor = this.getCurrentFloor();
    this.hotspotLabels.forEach(({ label, hotspot }) => {
      const hotspotFloor = hotspot.floor ?? 0;
      label.visible = Math.abs(hotspotFloor - currentFloor) < 1;
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
      ${hotspot.teleport ? `<button class="toolbar-button info-teleport">${hotspot.teleport.label ?? 'Y aller'}</button>` : ''}
    `;
    this.infoPanel.querySelector('.info-close').addEventListener('click', this.hideInfo);

    const teleportButton = this.infoPanel.querySelector('.info-teleport');
    if (teleportButton) {
      teleportButton.addEventListener('click', () => this.teleportTo(hotspot.teleport));
    }

    this.infoPanel.classList.remove('hidden');
  }

  hideInfo() {
    if (this.infoPanel) this.infoPanel.classList.add('hidden');
  }

  // Outil de développement : affiche la position actuelle pour placer une étiquette ou le point de départ
  logPosition() {
    const p = this.camera.position;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const floor = this.getCurrentFloor();
    console.log(`Étiquette → "floor": ${floor.toFixed(2)}, "position": [${p.x.toFixed(2)}, ${(floor + 1.2).toFixed(2)}, ${p.z.toFixed(2)}]`);
    console.log(
      `Départ → "spawnPosition": [${p.x.toFixed(2)}, ${p.z.toFixed(2)}], ` +
      `"spawnLookAt": [${(p.x + dir.x).toFixed(2)}, ${(p.z + dir.z).toFixed(2)}]`
    );
  }

  // ---------- Mode 360° ----------

  togglePanorama() {
    if (this.isPanorama) this.exitPanorama();
    else this.enterPanorama();
  }

  enterPanorama() {
    if (!this.isReady || this.isPanorama) return;

    this.controls.unlock(); // libère la souris pour pouvoir glisser
    this.resetKeys();
    this.hideInfo();

    // 1. Capture : 6 caméras à 90° prennent l'intérieur dans toutes les directions
    this.cubeRenderTarget = new THREE.WebGLCubeRenderTarget(1024);
    const cubeCamera = new THREE.CubeCamera(0.05, 100, this.cubeRenderTarget);
    cubeCamera.position.copy(this.camera.position);
    cubeCamera.update(this.app.renderer, this.scene);

    // 2. Une scène vide dont le fond est la photo 360°
    this.panoScene = new THREE.Scene();
    this.panoScene.background = this.cubeRenderTarget.texture;

    // 3. Une caméra au centre, qui regarde au départ dans la même direction que le joueur
    this.panoCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 10);
    const lookDirection = this.camera.getWorldDirection(new THREE.Vector3());
    this.panoCamera.position.copy(lookDirection).multiplyScalar(-0.01);

    // 4. OrbitControls : la caméra tourne autour d'un point juste devant elle = tourner la tête
    this.panoControls = new OrbitControls(this.panoCamera, this.app.canvas);
    this.panoControls.target.set(0, 0, 0);
    this.panoControls.enableZoom = false;
    this.panoControls.enablePan = false;
    this.panoControls.enableDamping = true; // mouvement fluide qui ralentit doucement
    this.panoControls.rotateSpeed = -0.4;   // négatif : on "tire" l'image avec la souris
    this.panoControls.update();

    this.isPanorama = true;
    this.labelRenderer.domElement.style.display = 'none'; // pas d'étiquettes en mode photo
    this.updateUI();
  }

  exitPanorama() {
    if (!this.isPanorama) return;

    this.panoControls.dispose();
    this.cubeRenderTarget.dispose();
    this.panoControls = null;
    this.cubeRenderTarget = null;
    this.panoScene = null;
    this.panoCamera = null;

    this.isPanorama = false;
    this.labelRenderer.domElement.style.display = '';
    this.updateUI();
  }

  // ---------- Barre d'aide ----------

  createToolbar() {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'interior-toolbar';

    this.backButton = document.createElement('button');
    this.backButton.className = 'toolbar-button toolbar-back';
    this.backButton.textContent = '← Retour au quartier';
    this.backButton.addEventListener('click', () => this.goBack());

    this.panoButton = document.createElement('button');
    this.panoButton.className = 'toolbar-button';
    this.panoButton.addEventListener('click', () => {
      this.panoButton.blur(); // évite que les touches du clavier "cliquent" sur le bouton
      this.togglePanorama();
    });

    this.hint = document.createElement('span');
    this.hint.className = 'toolbar-hint';

    this.toolbar.append(this.backButton, this.panoButton, this.hint);
    document.body.appendChild(this.toolbar);
  }

  // Met à jour le bouton et le texte d'aide selon la situation
  updateUI() {
    if (!this.toolbar) return;

    this.panoButton.textContent = this.isPanorama ? 'Quitter la vue 360°' : 'Vue 360°';

    if (this.isPanorama) {
      this.hint.textContent = 'Glissez pour regarder autour · V ou Échap : quitter';
    } else if (this.controls && this.controls.isLocked) {
      this.hint.textContent = 'ZQSD : marcher · V : vue 360° · Échap : libérer la souris';
    } else {
      this.hint.textContent = 'Cliquez dans la scène pour visiter · Cliquez sur une étiquette pour les détails';
    }
  }

  // Retour à la page d'accueil : exit() de cet état nettoiera tout automatiquement
  goBack() {
    if (this.isLeaving) return;
    this.isLeaving = true;
    this.app.stateManager.switchState(new LandingState(this.app));
  }

  // ---------- Contrôles ----------

  onClick() {
    if (this.isPanorama) return; // en mode 360°, cliquer sert à glisser, pas à verrouiller
    if (this.controls) this.controls.lock();
  }

  onLock() {
    this.hideInfo(); // reprendre la visite ferme le panneau
    this.updateUI();
  }

  onUnlock() {
    this.resetKeys(); // Échap en marchant : on s'arrête
    this.updateUI();
  }

  onKeyDown(event) {
    if (event.code === 'KeyP') this.logPosition();
    if (event.code === 'KeyV') this.togglePanorama();
    if (event.code === 'Escape' && this.isPanorama) this.exitPanorama();
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
    }
  }

  resetKeys() {
    for (const key in this.keys) this.keys[key] = false;
  }

  onResize() {
    if (this.labelRenderer) this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    // App.js met à jour this.camera, mais pas la caméra du mode 360°
    if (this.panoCamera) {
      this.panoCamera.aspect = window.innerWidth / window.innerHeight;
      this.panoCamera.updateProjectionMatrix();
    }
  }

  // ---------- Boucle ----------

  update(deltaTime) {
    // Mode 360° : on affiche seulement la photo
    if (this.isPanorama) {
      this.panoControls.update();
      this.app.renderer.render(this.panoScene, this.panoCamera);
      return;
    }

    // Mode visite : App.js ne dessine pas, c'est l'état actif qui fait le rendu
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

    this.previousPosition.copy(this.camera.position);

    const distance = this.walkSpeed * dt;
    this.controls.moveForward(direction.y * distance);
    this.controls.moveRight(direction.x * distance);

    this.resolveCollisions();

    // Suivi du sol : marches, escaliers, et protection contre le vide
    const floorY = this.findFloorBelow();
    const currentFloor = this.getCurrentFloor();

    const noFloor = floorY === null;
    const tooHigh = !noFloor && floorY - currentFloor > this.maxStepUp;    // obstacle bas (pouf, rebord...)
    const tooLow = !noFloor && currentFloor - floorY > this.maxStepDown;   // bord d'un étage

    if (noFloor || tooHigh || tooLow) {
      this.camera.position.copy(this.previousPosition); // on annule le pas
    } else {
      // On monte ou descend doucement vers la nouvelle hauteur (effet de glissement sur les marches)
      const targetY = floorY + this.eyeHeight;
      const smoothing = 1 - Math.exp(-20 * dt);
      this.camera.position.y += (targetY - this.camera.position.y) * smoothing;
    }

    this.updateHotspotVisibility(); // les étiquettes changent quand on change d'étage
  }

  // ---------- Nettoyage ----------

  exit() {
    this.exitPanorama();

    window.removeEventListener('resize', this.onResize);
    if (this.labelRenderer) this.labelRenderer.domElement.remove();
    if (this.infoPanel) this.infoPanel.remove();
    if (this.toolbar) this.toolbar.remove();

    if (this.controls) {
      this.controls.removeEventListener('lock', this.onLock);
      this.controls.removeEventListener('unlock', this.onUnlock);
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