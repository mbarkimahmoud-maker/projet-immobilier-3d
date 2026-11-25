// Écran de chargement unique, partagé par tout le site (quartier et intérieurs)
class LoadingScreen {
  constructor() {
    this.element = null;
  }

  // Crée l'écran la première fois qu'on en a besoin
  create() {
    if (this.element) return;

    this.element = document.createElement('div');
    this.element.className = 'loading-screen hidden';
    this.element.innerHTML = `
      <div class="loading-content">
        <span class="brand-logo">⌂</span>
        <h2 class="loading-title"></h2>
        <p class="loading-subtitle"></p>
        <div class="loading-bar"><div class="loading-bar-fill"></div></div>
        <p class="loading-percent">0 %</p>
      </div>
    `;
    document.body.appendChild(this.element);

    this.titleElement = this.element.querySelector('.loading-title');
    this.subtitleElement = this.element.querySelector('.loading-subtitle');
    this.fillElement = this.element.querySelector('.loading-bar-fill');
    this.percentElement = this.element.querySelector('.loading-percent');
  }

  show(title, subtitle = '') {
    this.create();
    this.titleElement.textContent = title;
    this.subtitleElement.textContent = subtitle;
    this.setProgress(0);
    this.element.classList.remove('hidden');
  }

  setSubtitle(subtitle) {
    if (this.subtitleElement) this.subtitleElement.textContent = subtitle;
  }

  // progress : un nombre entre 0 et 1
  setProgress(progress) {
    if (!this.element) return;
    const value = Math.min(Math.max(progress, 0), 1);
    this.fillElement.style.width = `${value * 100}%`;
    this.percentElement.textContent = `${Math.round(value * 100)} %`;
  }

  hide() {
    if (this.element) this.element.classList.add('hidden');
  }
}

// On exporte une seule instance : tout le site partage le même écran
export default new LoadingScreen();