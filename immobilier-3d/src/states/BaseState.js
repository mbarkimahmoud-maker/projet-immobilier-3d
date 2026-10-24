export default class BaseState {
    constructor(app) {
        this.app = app; // Référence à App.js pour accéder au moteur
    }
    // Appelée quand on entre dans l'état (ex: charger les modèles)
    async enter() {} 
    
    // Appelée 60 fois par seconde (ex: bouger la caméra)
    update(deltaTime) {} 
    
    // Appelée quand on quitte l'état (ex: vider la mémoire)
    exit() {} 
}