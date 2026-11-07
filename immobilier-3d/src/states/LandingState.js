import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';  // SURVOL
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';          // SURVOL
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';        // SURVOL
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';          // SURVOL
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'; // SURVOL
import BaseState from './BaseState.js';
import InteriorState from './InteriorState.js';

export default class LandingState extends BaseState {
    constructor(app) {
        super(app);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#87CEEB');

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 15); // On recule un peu pour voir tout le quartier

        this.controls = new OrbitControls(this.camera, this.app.canvas);
        this.controls.enableDamping = true;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.1;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(10, 20, 10);
        this.scene.add(directionalLight);

        // --- RAYCASTING ---
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2(1, 1);
        this.hoveredHouse = null;
        
        // Toutes les maisons du quartier (parc compris), et seulement celles qu'on peut visiter
        this.houses = [];
        this.clickableHouses = [];

        // Pour distinguer un clic d'un glisser de caméra
        this.pointerDownPosition = new THREE.Vector2();
        this.isLeaving = false;

        this.header = null; // en-tête avec le nom de l'agence

        // SURVOL : contour lumineux et fiche flottante
        this.composer = null;
        this.outlinePass = null;
        this.labelRenderer = null;
        this.houseCard = null;        // la fiche (un seul objet, déplacé d'une maison à l'autre)
        this.houseTops = new Map();   // hauteur du toit de chaque maison, pour placer la fiche au-dessus

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onClick = this.onClick.bind(this);
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onResize = this.onResize.bind(this); // SURVOL
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('click', this.onClick);
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('resize', this.onResize); // SURVOL
        // Pour le cycle jour/nuit
        this.sunAngle = 0;
    }

    async enter() {
        console.log("Construction du quartier...");
        this.createHeader();
        this.setupComposer();     // SURVOL
        this.setupHouseCard();    // SURVOL

        const loader = new GLTFLoader();

        try {
            const response = await fetch('/data/houses.json');
            const housesData = await response.json();

            // 2. --- CRÉATION DE LA ROUTE RÉALISTE ---
            const roadGroup = new THREE.Group();

            // A. L'asphalte principal (Gris très foncé, mat)
            const roadGeo = new THREE.PlaneGeometry(12, 100);
            const roadMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
            const roadMesh = new THREE.Mesh(roadGeo, roadMat);
            roadMesh.rotation.x = -Math.PI / 2;
            roadMesh.position.y = -0.01;
            roadGroup.add(roadMesh);

            // B. Lignes blanches continues sur les côtés (Lignes de rive)
            const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
            
            const leftEdgeGeo = new THREE.PlaneGeometry(0.3, 100);
            const leftEdge = new THREE.Mesh(leftEdgeGeo, edgeLineMat);
            leftEdge.rotation.x = -Math.PI / 2;
            leftEdge.position.set(-5.2, -0.008, 0);
            roadGroup.add(leftEdge);

            const rightEdge = leftEdge.clone();
            rightEdge.position.set(5.2, -0.008, 0);
            roadGroup.add(rightEdge);

            // C. Ligne centrale discontinue
            for (let z = -45; z <= 45; z += 6) {
                const centerDashGeo = new THREE.PlaneGeometry(0.3, 3);
                const centerDash = new THREE.Mesh(centerDashGeo, edgeLineMat);
                centerDash.rotation.x = -Math.PI / 2;
                centerDash.position.set(0, -0.008, z);
                roadGroup.add(centerDash);
            }

            // D. Rails de sécurité latéraux (effet métallique gris clair)
            const railMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
            const railGeo = new THREE.BoxGeometry(0.2, 0.8, 100);
            
            const leftRail = new THREE.Mesh(railGeo, railMat);
            leftRail.position.set(-6.2, 0.4, 0);
            roadGroup.add(leftRail);

            const rightRail = new THREE.Mesh(railGeo, railMat);
            rightRail.position.set(6.2, 0.4, 0);
            roadGroup.add(rightRail);

            // E. Passage piéton (zébras) au milieu de la rue
            for (let zPos = -3; zPos <= 3; zPos += 2) {
                const stripeGeo = new THREE.PlaneGeometry(10, 0.8);
                const stripe = new THREE.Mesh(stripeGeo, edgeLineMat);
                stripe.rotation.x = -Math.PI / 2;
                stripe.position.set(0, -0.007, zPos);
                roadGroup.add(stripe);
            }

            // F. Feu tricolore au bord de la route
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 });
            
            const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(6.5, 2.5, -5);
            roadGroup.add(pole);

            const boxGeo = new THREE.BoxGeometry(0.6, 1.5, 0.5);
            const boxMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const trafficBox = new THREE.Mesh(boxGeo, boxMat);
            trafficBox.position.set(6.5, 4.2, -5);
            roadGroup.add(trafficBox);

            const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const offLightMat = new THREE.MeshBasicMaterial({ color: 0x440000 });
            
            const lightGeo = new THREE.SphereGeometry(0.2, 16, 16);
            
            const redLight = new THREE.Mesh(lightGeo, redLightMat);
            redLight.position.set(6.5, 4.6, -4.72);
            roadGroup.add(redLight);

            const orangeLight = new THREE.Mesh(lightGeo, offLightMat);
            orangeLight.position.set(6.5, 4.2, -4.72);
            roadGroup.add(orangeLight);

            const greenLight = new THREE.Mesh(lightGeo, offLightMat);
            greenLight.position.set(6.5, 3.8, -4.72);
            roadGroup.add(greenLight);

            this.scene.add(roadGroup);

            // --- ALLÉE D'ARBRES LE LONG DE LA ROUTE ---
            const createTree = (x, z) => {
                const treeGroup = new THREE.Group();

                const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
                const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                trunk.position.y = 1.1;
                treeGroup.add(trunk);

                const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.8 });

                const leaves1 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), leavesMat);
                leaves1.position.y = 2.5;
                treeGroup.add(leaves1);

                const leaves2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), leavesMat);
                leaves2.position.y = 3.5;
                treeGroup.add(leaves2);

                const leaves3 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), leavesMat);
                leaves3.position.y = 4.3;
                treeGroup.add(leaves3);

                treeGroup.position.set(x, 0, z);
                return treeGroup;
            };
            for (let z = -45; z <= 45; z += 10) {
                if (Math.abs(z) > 6) { 
                    this.scene.add(createTree(-8, z));
                    this.scene.add(createTree(8, z));
                }
            }

            // --- SOL VERT (TERRAIN) ---
            const groundGeometry = new THREE.PlaneGeometry(200, 200);
            const groundMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x3b5323,
                roughness: 1.0
            });
            
            const ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = -0.02;
            this.scene.add(ground);

            // --- BOUCLE DES MAISONS ---
            for (const data of housesData) {
                const gltf = await loader.loadAsync(data.exteriorModel);

                // Si on est déjà entré dans une maison pendant le chargement, on arrête de construire le quartier
                if (this.isLeaving) return;

                const houseMesh = gltf.scene;

                // On désactive l'effet miroir/métal de tous les matériaux
                houseMesh.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.metalness = 0;
                        child.material.roughness = 0.8;
                    }
                });

                // Échelle définie dans le JSON (ou 1 par défaut)
                const s = data.scale || 1;
                houseMesh.scale.set(s, s, s);

                // On centre la maison APRÈS l'avoir redimensionnée
                const box = new THREE.Box3().setFromObject(houseMesh);
                const center = box.getCenter(new THREE.Vector3());
                houseMesh.position.set(-center.x, -box.min.y, -center.z);

                const houseGroup = new THREE.Group();
                houseGroup.add(houseMesh);
                houseGroup.position.set(data.position[0], data.position[1], data.position[2]);
                
                if (data.rotationY) houseGroup.rotation.y = data.rotationY;
                
                houseGroup.userData = data;

                this.scene.add(houseGroup);
                this.houses.push(houseGroup);

                // Le parc est affiché mais n'est pas cliquable
                if (data.type !== 'park') {
                    this.clickableHouses.push(houseGroup);

                    // SURVOL : on mémorise la hauteur du toit pour y placer la fiche
                    const top = new THREE.Box3().setFromObject(houseGroup).max.y;
                    this.houseTops.set(houseGroup, top);
                }
            }
            
            console.log("Quartier chargé avec", this.houses.length, "élément(s) et une route !");

        } catch (error) {
            console.error("Erreur lors de la création du quartier :", error);
        }
    }

    // En-tête : nom de l'agence et aide, par-dessus le quartier
    createHeader() {
        this.header = document.createElement('header');
        this.header.className = 'site-header';
        this.header.innerHTML = `
            <div class="brand">
                <span class="brand-logo">⌂</span>
                <div>
                    <h1 class="brand-name">Domus 3D</h1>
                    <p class="brand-tagline">Visitez nos maisons comme si vous y étiez</p>
                </div>
            </div>
            <p class="site-hint">Glissez pour explorer le quartier · Cliquez sur une maison pour la visiter</p>
        `;
        document.body.appendChild(this.header);
    }

    // SURVOL : chaîne de post-traitement (rendu normal → contour → couleurs finales)
    setupComposer() {
        const size = new THREE.Vector2(window.innerWidth, window.innerHeight);

        this.composer = new EffectComposer(this.app.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        this.outlinePass = new OutlinePass(size, this.scene, this.camera);
        this.outlinePass.edgeStrength = 5;       // intensité du contour
        this.outlinePass.edgeGlow = 0.6;         // halo lumineux autour du contour
        this.outlinePass.edgeThickness = 2;      // épaisseur
        this.outlinePass.pulsePeriod = 2;        // le contour "respire" toutes les 2 secondes
        this.outlinePass.visibleEdgeColor.set('#f0a477'); // terracotta clair
        this.outlinePass.hiddenEdgeColor.set('#7a3a1c');  // partie cachée derrière d'autres objets
        this.composer.addPass(this.outlinePass);

        // Applique le tone mapping et les couleurs finales (sinon l'image serait plus terne)
        this.composer.addPass(new OutputPass());
    }

    // SURVOL : calque HTML et fiche flottante (une seule, déplacée de maison en maison)
    setupHouseCard() {
        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.className = 'landing-label-layer';
        document.body.appendChild(this.labelRenderer.domElement);

        const element = document.createElement('div');
        element.className = 'house-card';

        this.houseCard = new CSS2DObject(element);
        this.houseCard.center.set(0.5, 1); // la fiche est posée par son bas (sa pointe) sur le point 3D
        this.houseCard.visible = false;
        this.scene.add(this.houseCard);
    }

    // SURVOL : remplit la fiche avec les infos de la maison et la place au-dessus de son toit
    showHouseCard(house) {
        const data = house.userData;
        const meta = [data.surface, data.levels].filter(Boolean).join(' · ');

        const element = this.houseCard.element;
        element.innerHTML = `
            <h3>${data.name}</h3>
            <p class="house-card-price">${data.price ?? ''}</p>
            ${meta ? `<p class="house-card-meta">${meta}</p>` : ''}
            <p class="house-card-cta">Cliquer pour visiter →</p>
        `;
        // Relance l'animation d'apparition à chaque nouvelle maison
        element.style.animation = 'none';
        void element.offsetWidth;
        element.style.animation = '';

        const top = this.houseTops.get(house) ?? 5;
        this.houseCard.position.set(house.position.x, top + 1, house.position.z);
        this.houseCard.visible = true;
    }

    hideHouseCard() {
        if (this.houseCard) this.houseCard.visible = false;
    }

    onResize() {
        // App.js redimensionne le renderer et la caméra, mais pas le post-traitement ni le calque HTML
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
        if (this.labelRenderer) this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    // On retient où le bouton de la souris a été enfoncé
    onPointerDown(event) {
        this.pointerDownPosition.set(event.clientX, event.clientY);
    }

    onClick(event) {
        // Si la souris a bougé entre l'appui et le relâchement, c'était un glisser de caméra
        const moved = this.pointerDownPosition.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
        if (moved > 5) return;

        if (this.hoveredHouse && !this.isLeaving) {
            const data = this.hoveredHouse.userData;
            console.log(`Maison cliquée : ${data.name} - Prix : ${data.price}`);

            // Passage à la visite intérieure
            if (data.interiorModel) {
                this.isLeaving = true;
                this.app.stateManager.switchState(new InteriorState(this.app, data));
            }
        }
    }

    update(deltaTime) {
        this.controls.update(); 
        
        // --- CYCLE JOUR / NUIT ANIMÉ ---
        this.sunAngle += deltaTime * 0.1;
        
        const radius = 50;
        const sunX = Math.cos(this.sunAngle) * radius;
        const sunY = Math.sin(this.sunAngle) * radius;

        if (this.directionalLight) {
            this.directionalLight.position.set(sunX, sunY, 20);

            if (sunY > 0) {
                this.scene.background.set('#87CEEB');
                this.directionalLight.intensity = 1.5;
                this.directionalLight.color.set('#ffffff');
            } else {
                this.scene.background.set('#0b1d3a');
                this.directionalLight.intensity = 0.3;
                this.directionalLight.color.set('#7a9cc6');
            }
        }

        // --- SURVOL DES MAISONS ---
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.clickableHouses, true);

        if (intersects.length > 0) {
            // On remonte l'arborescence pour trouver le "Group" principal de la maison
            let object = intersects[0].object;
            while (object.parent && !object.userData.id) {
                object = object.parent;
            }

            if (this.hoveredHouse !== object) {
                this.hoveredHouse = object;
                this.outlinePass.selectedObjects = [object]; // SURVOL : contour lumineux
                this.showHouseCard(object);                  // SURVOL : fiche flottante
                document.body.style.cursor = 'pointer';
            }
        } else if (this.hoveredHouse) {
            this.hoveredHouse = null;
            this.outlinePass.selectedObjects = [];
            this.hideHouseCard();
            document.body.style.cursor = 'default';
        }

        // SURVOL : rendu via le post-traitement (au lieu de renderer.render), puis le calque HTML
        if (this.composer) this.composer.render(deltaTime);
        if (this.labelRenderer) this.labelRenderer.render(this.scene, this.camera);
    }

    exit() {
        if (this.header) this.header.remove();
        if (this.labelRenderer) this.labelRenderer.domElement.remove(); // SURVOL

        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('click', this.onClick);
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('resize', this.onResize); // SURVOL

        document.body.style.cursor = 'default';
        this.controls.dispose();

        // SURVOL : libère les images intermédiaires du post-traitement
        if (this.outlinePass) this.outlinePass.dispose();
        if (this.composer) this.composer.dispose();

        // Libère la mémoire de toute la scène (maisons, route, arbres, sol, textures)
        this.scene.traverse((child) => {
            if (child.isMesh) {
                child.geometry.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((m) => {
                    for (const key in m) {
                        if (m[key] && m[key].isTexture) m[key].dispose();
                    }
                    m.dispose();
                });
            }
        });
        this.houses = [];
        this.clickableHouses = [];
        this.houseTops.clear();
    }
}