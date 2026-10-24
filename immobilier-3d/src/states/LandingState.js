import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import BaseState from './BaseState.js';

export default class LandingState extends BaseState {
    constructor(app) {
        super(app);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#87CEEB');

        // NOUVEAU : On permet à la caméra de voir de très près (0.01) à très très loin (50000)
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 50000);
        this.camera.position.set(0, 5, 10);

        this.controls = new OrbitControls(this.camera, this.app.canvas);
        this.controls.enableDamping = true;

        const ambientLight = new THREE.AmbientLight(0xffffff, 1);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(10, 20, 10);
        this.scene.add(directionalLight);

        // --- NOUVEAU : Outils de débogage ---
        // Une grille au sol de 50x50 pour se repérer
        const gridHelper = new THREE.GridHelper(50, 50);
        this.scene.add(gridHelper);
        
        // Des axes (Rouge = X, Vert = Y, Bleu = Z) au centre de la scène
        const axesHelper = new THREE.AxesHelper(10);
        this.scene.add(axesHelper);
    }

    async enter() {
        console.log("Chargement de la maison...");
        const loader = new GLTFLoader();

        try {
            const gltf = await loader.loadAsync('/models/exterior_1.glb');
            this.houseModel = gltf.scene;
            
            // NOUVEAU : On compte le nombre d'objets 3D dans le fichier
            let meshCount = 0;
            this.houseModel.traverse((child) => {
                if (child.isMesh) meshCount++;
            });
            console.log(`Nombre d'objets (meshes) trouvés dans le fichier : ${meshCount}`);

            // Diagnostic Box3
            const box = new THREE.Box3().setFromObject(this.houseModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            
            console.log("Taille du modèle :", size);
            console.log("Centre d'origine :", center);

            this.houseModel.position.x = -center.x;
            this.houseModel.position.y = -box.min.y;
            this.houseModel.position.z = -center.z;

            this.scene.add(this.houseModel);
            
            const maxDim = Math.max(size.x, size.y, size.z);
            // On s'assure de reculer assez, mais pas trop non plus
            this.camera.position.set(0, maxDim, maxDim * 1.5);
            this.camera.lookAt(0, 0, 0);
            this.controls.update();

        } catch (error) {
            console.error("Erreur lors du chargement :", error);
        }
    }

    update(deltaTime) {
        this.controls.update(); 
        this.app.renderer.render(this.scene, this.camera);
    }

    exit() {}
}