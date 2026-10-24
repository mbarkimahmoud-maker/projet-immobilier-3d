import * as THREE from 'three';
import { Timer } from 'three/addons/misc/Timer.js'; // On importe le nouveau Timer
import StateManager from './StateManager.js';

export default class App {
    constructor() {
        this.canvas = document.querySelector('#webgl-canvas');
        
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor('#2c3e50');

        this.stateManager = new StateManager();
        
        // On utilise le Timer moderne
        this.timer = new Timer();

        window.addEventListener('resize', this.onResize.bind(this));
    }

    async init() {
        console.log("App initialisée avec succès !");
        this.tick(); 
    }

    onResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    tick() {
        // Mise à jour du chronomètre
        this.timer.update();
        const deltaTime = this.timer.getDelta();
        
        // Transmission du temps au StateManager
        this.stateManager.update(deltaTime);

        // Boucle infinie d'animation
        requestAnimationFrame(this.tick.bind(this));
    }
}