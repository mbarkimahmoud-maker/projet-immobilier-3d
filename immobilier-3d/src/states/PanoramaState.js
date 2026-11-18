import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import BaseState from './BaseState.js';
import LandingState from './LandingState.js';

export default class PanoramaState extends BaseState {
    constructor(app, houseData) {
        super(app);
        this.houseData = houseData;
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
        this.camera.position.set(0, 0, 0.1);

        this.controls = new OrbitControls(this.camera, this.app.canvas);
        this.controls.enableZoom = false;
        this.controls.enablePan = false;
        this.controls.rotateSpeed = -0.5;
        this.controls.enableDamping = true;

        this.textureLoader = new THREE.TextureLoader();
        this.sphereMesh = null;
        this.hotspotObjects = [];
        this.uiContainer = null;
        this.styleTag = null;
        this.isTransitioning = false;

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
        this.labelRenderer.domElement.style.position = 'fixed';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.left = '0';
        this.labelRenderer.domElement.style.zIndex = '10';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        document.body.appendChild(this.labelRenderer.domElement);

        this.onResize = this.onResize.bind(this);
        window.addEventListener('resize', this.onResize);
    }

    async enter() {
        this.injectStyles();

        const geometry = new THREE.SphereGeometry(10, 60, 40);
        geometry.scale(-1, 1, 1);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1
        });
        this.sphereMesh = new THREE.Mesh(geometry, material);
        this.scene.add(this.sphereMesh);

        this.createUI();

        if (this.houseData.rooms && this.houseData.rooms.length > 0) {
            this.loadRoom(this.houseData.rooms[0].id, false);
        }
    }

    injectStyles() {
        this.styleTag = document.createElement('style');
        this.styleTag.textContent = `
            @keyframes panoPulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(240, 164, 119, 0.85); }
                50% { box-shadow: 0 0 0 12px rgba(240, 164, 119, 0); }
            }
            .pano-hotspot {
                pointer-events: auto !important;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 18px;
                border-radius: 999px;
                border: 2px solid #f0a477;
                background: rgba(15, 23, 42, 0.9);
                backdrop-filter: blur(6px);
                color: #ffffff;
                font-family: inherit;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                animation: panoPulse 2s infinite ease-in-out;
                transition: background 0.2s, color 0.2s, border-color 0.2s;
            }
            .pano-hotspot:hover {
                background: #f0a477;
                color: #0f172a;
                border-color: #ffffff;
            }
            .pano-hotspot-arrow {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background: #f0a477;
                color: #0f172a;
                font-size: 13px;
                font-weight: 900;
            }
            .pano-hotspot:hover .pano-hotspot-arrow {
                background: #0f172a;
                color: #ffffff;
            }
        `;
        document.head.appendChild(this.styleTag);
    }

    // Animation de déplacement vers la porte + fondu entre les deux pièces
    transitionToRoom(targetRoomId, hotspotPosition) {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        this.controls.enabled = false;

        // Masquer les boutons pendant le mouvement
        this.hotspotObjects.forEach(obj => (obj.element.style.opacity = '0'));

        const targetVec = new THREE.Vector3(...hotspotPosition).normalize();
        // OrbitControls regarde vers -camera.position (car caméra à 0.1 de l'origine)
        const endCamPos = targetVec.clone().multiplyScalar(-0.1);
        const startCamPos = this.camera.position.clone();

        const duration = 550; // ms pour avancer vers la porte
        const startTime = performance.now();

        const animateIn = (now) => {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / duration, 1);
            // Courbe d'accélération fluide (easeInOutCubic)
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // 1. La caméra pivote doucement vers la porte cliquée
            this.camera.position.lerpVectors(startCamPos, endCamPos, ease);
            this.controls.update();

            // 2. Effet d'avancée dans la pièce (réduction du FOV = zoom caméra)
            this.camera.fov = THREE.MathUtils.lerp(75, 42, ease);
            this.camera.updateProjectionMatrix();

            // 3. Fondu vers la fin du mouvement
            this.sphereMesh.material.opacity = 1 - ease * 0.85;

            if (t < 1) {
                requestAnimationFrame(animateIn);
            } else {
                this.loadRoom(targetRoomId, true);
            }
        };

        requestAnimationFrame(animateIn);
    }

    loadRoom(roomId, withEntranceAnim = false) {
        const room = this.houseData.rooms.find(r => r.id === roomId);
        if (!room) {
            this.isTransitioning = false;
            this.controls.enabled = true;
            return;
        }

        this.hotspotObjects.forEach(obj => this.scene.remove(obj));
        this.hotspotObjects = [];

        this.textureLoader.load(room.panorama, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            if (this.sphereMesh.material.map) this.sphereMesh.material.map.dispose();
            this.sphereMesh.material.map = texture;
            this.sphereMesh.material.needsUpdate = true;

            const titleEl = document.getElementById('pano-room-title');
            if (titleEl) titleEl.textContent = `${this.houseData.name} — ${room.title}`;

            const createHotspots = () => {
                (room.hotspots || []).forEach(hs => {
                    const btn = document.createElement('button');
                    btn.className = 'pano-hotspot';
                    btn.innerHTML = `<span class="pano-hotspot-arrow">➜</span><span>${hs.label}</span>`;
                    btn.onclick = () => this.transitionToRoom(hs.targetRoom, hs.position);

                    const label = new CSS2DObject(btn);
                    label.position.set(hs.position[0], hs.position[1], hs.position[2]);
                    this.scene.add(label);
                    this.hotspotObjects.push(label);
                });
            };

            if (!withEntranceAnim) {
                this.sphereMesh.material.opacity = 1;
                this.camera.fov = 75;
                this.camera.updateProjectionMatrix();
                createHotspots();
                this.isTransitioning = false;
                this.controls.enabled = true;
                return;
            }

            // Animation d'arrivée dans la nouvelle pièce (apparition + stabilisation FOV)
            const duration = 450;
            const startTime = performance.now();

            const animateOut = (now) => {
                const elapsed = now - startTime;
                const t = Math.min(elapsed / duration, 1);
                const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic

                this.camera.fov = THREE.MathUtils.lerp(52, 75, ease);
                this.camera.updateProjectionMatrix();
                this.sphereMesh.material.opacity = THREE.MathUtils.lerp(0.15, 1, ease);

                if (t < 1) {
                    requestAnimationFrame(animateOut);
                } else {
                    createHotspots();
                    this.isTransitioning = false;
                    this.controls.enabled = true;
                }
            };

            requestAnimationFrame(animateOut);
        });
    }

    createUI() {
        this.uiContainer = document.createElement('div');
        this.uiContainer.style.cssText = 'position:fixed; top:20px; left:20px; z-index:20; display:flex; gap:12px; align-items:center;';

        const backBtn = document.createElement('button');
        backBtn.textContent = '← Retour au quartier';
        backBtn.style.cssText = 'padding:10px 16px; border-radius:8px; border:none; background:#fff; color:#111; font-weight:bold; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.2);';
        backBtn.onclick = () => this.app.stateManager.switchState(new LandingState(this.app));

        const roomTitle = document.createElement('span');
        roomTitle.id = 'pano-room-title';
        roomTitle.style.cssText = 'padding:10px 16px; border-radius:8px; background:rgba(0,0,0,0.65); color:#fff; font-weight:600;';

        this.uiContainer.append(backBtn, roomTitle);
        document.body.appendChild(this.uiContainer);
    }

    onResize() {
        this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    update() {
        this.controls.update();
        this.app.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);
    }

    exit() {
        window.removeEventListener('resize', this.onResize);
        if (this.uiContainer) this.uiContainer.remove();
        if (this.styleTag) this.styleTag.remove();
        if (this.labelRenderer) this.labelRenderer.domElement.remove();
        this.controls.dispose();
        if (this.sphereMesh) {
            this.sphereMesh.geometry.dispose();
            if (this.sphereMesh.material.map) this.sphereMesh.material.map.dispose();
            this.sphereMesh.material.dispose();
        }
    }
}