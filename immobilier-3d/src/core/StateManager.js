export default class StateManager {
    constructor() {
        this.currentState = null;
    }

    async switchState(newState) {
        if (this.currentState) {
            this.currentState.exit(); // On nettoie l'ancien avant d'avancer
        }
        this.currentState = newState;
        await this.currentState.enter(); // On lance le nouveau
    }

    update(deltaTime) {
        if (this.currentState) {
            this.currentState.update(deltaTime);
        }
    }
}