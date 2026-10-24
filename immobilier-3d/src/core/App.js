import * as THREE from 'three';
import StateManager from './StateManager.js';
import LandingState from '../states/LandingState.js';

export default class App {
    constructor() {
        this.canvas = document.querySelector('#webgl-canvas');
        
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor('#2c3e50');

        this.stateManager = new StateManager();
        
        this.clock = new THREE.Clock(); 

        window.addEventListener('resize', this.onResize.bind(this));
    }

    async init() {
        console.log("App initialisée avec succès !");
        
        const landing = new LandingState(this);
        await this.stateManager.switchState(landing);
        
        this.tick(); 
    }

    onResize() {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.stateManager.currentState && this.stateManager.currentState.camera) {
            this.stateManager.currentState.camera.aspect = window.innerWidth / window.innerHeight;
            this.stateManager.currentState.camera.updateProjectionMatrix();
        }
    }

    tick() {
        // On utilise getDelta() sur le clock
        const deltaTime = this.clock.getDelta();
        
        this.stateManager.update(deltaTime);
        requestAnimationFrame(this.tick.bind(this));
    }
}