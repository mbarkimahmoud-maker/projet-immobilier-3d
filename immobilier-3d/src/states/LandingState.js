import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BaseState from './BaseState.js';

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
        
        // NOUVEAU : Un tableau pour stocker TOUTES les maisons du quartier
        this.houses = [];

        this.onMouseMove = this.onMouseMove.bind(this);
        this.onClick = this.onClick.bind(this);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('click', this.onClick);
        // Pour le cycle jour/nuit
        this.sunAngle = 0;
    }

    async enter() {
        console.log("Construction du quartier...");
        const loader = new GLTFLoader();

        try {
            const response = await fetch('/data/houses.json');
            const housesData = await response.json();

            // 2. --- CRÉATION DE LA ROUTE RÉALISTE (Inspirée de ton image) ---
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

            // C. Ligne centrale discontinue (tous les 4 mètres)
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

            // E. Ajout du passage piéton (zébras) au milieu de la rue
            for (let zPos = -3; zPos <= 3; zPos += 2) {
                const stripeGeo = new THREE.PlaneGeometry(10, 0.8);
                const stripe = new THREE.Mesh(stripeGeo, edgeLineMat);
                stripe.rotation.x = -Math.PI / 2;
                stripe.position.set(0, -0.007, zPos);
                roadGroup.add(stripe);
            }

            // F. Ajout d'un Vrai Feu Tricolore au bord de la route
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5 });
            
            // Le mât vertical
            const poleGeo = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.set(6.5, 2.5, -5);
            roadGroup.add(pole);

            // Le boîtier du feu (bloc noir)
            const boxGeo = new THREE.BoxGeometry(0.6, 1.5, 0.5);
            const boxMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const trafficBox = new THREE.Mesh(boxGeo, boxMat);
            trafficBox.position.set(6.5, 4.2, -5);
            roadGroup.add(trafficBox);

            // Les lumières du feu (Rouge allumé, Orange éteint, Vert éteint)
            const redLightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Rouge vif
            const offLightMat = new THREE.MeshBasicMaterial({ color: 0x440000 }); // Éteint sombre
            
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

            // On ajoute toute la route structurée à la scène
            this.scene.add(roadGroup);


            // --- CRÉATION D'UNE ALLÉE D'ARBRES LE LONG DE LA ROUTE ---
            
            // Fonction utilitaire pour fabriquer un arbre rapidement
            // Fonction améliorée pour fabriquer un bel arbre en 3D
            const createTree = (x, z) => {
                const treeGroup = new THREE.Group();

                // 1. Le tronc (un peu plus texturé et effilé)
                const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8);
                const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                trunk.position.y = 1.1;
                treeGroup.add(trunk);

                // 2. Le feuillage multi-couches (empilement de sphères pour un effet dense)
                const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.8 });

                // Couche inférieure (la plus large)
                const leaves1 = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 8), leavesMat);
                leaves1.position.y = 2.5;
                treeGroup.add(leaves1);

                // Couche intermédiaire
                const leaves2 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 8), leavesMat);
                leaves2.position.y = 3.5;
                treeGroup.add(leaves2);

                // Couche supérieure (la pointe)
                const leaves3 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), leavesMat);
                leaves3.position.y = 4.3;
                treeGroup.add(leaves3);

                // Position globale de l'arbre dans le quartier
                treeGroup.position.set(x, 0, z);
                return treeGroup;
            };
            // Boucle pour aligner des arbres tout le long de la route (à gauche et à droite)
            for (let z = -45; z <= 45; z += 10) {
                // On évite de placer un arbre exactement là où il y a le feu tricolore ou le passage piéton si on veut
                if (Math.abs(z) > 6) { 
                    // Arbre côté gauche (derrière les rails)
                    const leftTree = createTree(-8, z);
                    this.scene.add(leftTree);

                    // Arbre côté droit (derrière les rails)
                    const rightTree = createTree(8, z);
                    this.scene.add(rightTree);
                }
            }

            // --- CRÉATION DU SOL VERT (TERRAIN) ---
            const groundGeometry = new THREE.PlaneGeometry(200, 200); // Un grand carré de 200x200 unités
            const groundMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x3b5323, // Un vert olive / terre plus profond
                roughness: 1.0   // 1.0 = totalement mat (ne brille pas comme du plastique)
            });
            
            const ground = new THREE.Mesh(groundGeometry, groundMaterial);
            ground.rotation.x = -Math.PI / 2; // On le met à plat sur le sol
            ground.position.y = -0.02; // Juste en dessous de la route (-0.01) pour éviter les conflits d'affichage
            this.scene.add(ground);

            // 2. --- BOUCLE DES MAISONS ---
            // 2. --- BOUCLE DES MAISONS ---
            for (const data of housesData) {
                const gltf = await loader.loadAsync(data.exteriorModel);
                const houseMesh = gltf.scene;

                // CORRECTION 1 : Le problème des textures grises/noires
                // On désactive l'effet miroir/métal de tous les matériaux
                houseMesh.traverse((child) => {
                    if (child.isMesh && child.material) {
                        child.material.metalness = 0; // Ne reflète plus le vide noir
                        child.material.roughness = 0.8; // Matériau mat qui accroche bien la lumière
                    }
                });

                // CORRECTION 2 : Le problème des tailles
                // On utilise l'échelle définie dans le JSON (ou 1 par défaut)
                const s = data.scale || 1;
                houseMesh.scale.set(s, s, s);

                // On centre parfaitement la maison APRÈS l'avoir redimensionnée
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
            }
            
            console.log("Quartier chargé avec", this.houses.length, "maison(s) et une route !");

        } catch (error) {
            console.error("Erreur lors de la création du quartier :", error);
        }
    }

    onMouseMove(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    onClick() {
        if (this.hoveredHouse) {
            // On peut maintenant lire les données de la maison cliquée !
            const data = this.hoveredHouse.userData;
            console.log(`Maison cliquée : ${data.name} - Prix : ${data.price}`);
            
            // Prochaine étape : this.app.stateManager.switchState(new InteriorState(this.app, data));
        }
    }

    update(deltaTime) {
        this.controls.update(); 
        
        
        // --- CYCLE JOUR / NUIT ANIMÉ ---
        this.sunAngle += deltaTime * 0.1; // Ajuste la vitesse (plus c'est haut, plus le temps passe vite)
        
        const radius = 50;
        const sunX = Math.cos(this.sunAngle) * radius;
        const sunY = Math.sin(this.sunAngle) * radius; // Hauteur du soleil (-50 à +50)

        // On déplace la lumière directionnelle (le soleil/la lune)
        if (this.directionalLight) {
            this.directionalLight.position.set(sunX, sunY, 20);

            // Si le soleil est au-dessus de l'horizon (Jour)
            if (sunY > 0) {
                this.scene.background.set('#87CEEB'); // Ciel bleu clair
                this.directionalLight.intensity = 1.5;
                this.directionalLight.color.set('#ffffff');
            } 
            // Si le soleil est sous l'horizon (Nuit)
            else {
                this.scene.background.set('#0b1d3a'); // Bleu nuit profond
                this.directionalLight.intensity = 0.3; // Lumière de lune tamisée
                this.directionalLight.color.set('#7a9cc6'); // Teinte bleutée lunaire
            }
        }

        
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // NOUVEAU : On vérifie les collisions avec TOUTES les maisons du tableau
        const intersects = this.raycaster.intersectObjects(this.houses, true);

        if (intersects.length > 0) {
            // On remonte l'arborescence pour trouver le "Group" principal
            let object = intersects[0].object;
            while (object.parent && !object.userData.id) {
                object = object.parent;
            }

            if (this.hoveredHouse !== object) {
                // On abaisse l'ancienne maison si on passe direct de l'une à l'autre
                if (this.hoveredHouse) this.hoveredHouse.position.y -= 0.5; 
                
                this.hoveredHouse = object;
                this.hoveredHouse.position.y += 0.5; // On soulève la nouvelle
                document.body.style.cursor = 'pointer';
            }
        } else {
            if (this.hoveredHouse) {
                this.hoveredHouse.position.y -= 0.5;
                this.hoveredHouse = null;
                document.body.style.cursor = 'default';
            }
        }

        this.app.renderer.render(this.scene, this.camera);
    }

    exit() {
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('click', this.onClick);
        
        // NOUVEAU : Nettoyage de la mémoire quand on quitte le quartier
        this.houses.forEach(house => {
            this.scene.remove(house);
            house.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material.dispose) child.material.dispose();
                }
            });
        });
        this.houses = [];
    }
}