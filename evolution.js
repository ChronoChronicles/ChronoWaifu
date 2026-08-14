/**
 * ============================================================
 * EVOLUTION.JS — Animation d'évolution plein écran
 *
 * Déclenché par l'événement 'evolved' émis par CWGameState.
 * Affiche une séquence cinématique en overlay :
 *   1. Flash blanc d'entrée
 *   2. Dissolution du portrait actuel (silhouette → blanc)
 *   3. Révélation du nouveau portrait (blanc → couleurs)
 *   4. Particules d'énergie tout au long
 *   5. Affichage du nom et bouton de confirmation
 *
 * L'animation met l'UI en pause via une Promise résolue à la
 * fermeture, afin que le callback d'appel puisse enchaîner.
 * ============================================================
 */

'use strict';

const CWEvolutionAnimator = (() => {

  // ─── ÉTAT INTERNE ─────────────────────────────────────────────────────────────
  let _overlay  = null;   // Élément DOM de l'overlay
  let _resolve  = null;   // Résout la Promise d'attente
  let _timers   = [];     // setTimeout en attente, à purger si l'animation est interrompue

  // ─── CONSTANTES ───────────────────────────────────────────────────────────────
  const PARTICLE_COUNT   = 60;
  const ANIM_DISSOLVE_MS = 1200;   // Durée de la dissolution du portrait "avant"
  const ANIM_REVEAL_MS   = 1400;   // Durée de l'apparition du portrait "après"
  const ANIM_HOLD_MS     = 600;    // Pause entre dissolution et révélation

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  /**
   * Lance l'animation d'évolution plein écran.
   *
   * @param {object} prevDef   - Définition du personnage AVANT évolution
   * @param {object} nextDef   - Définition du personnage APRÈS évolution
   * @param {{index:number,total:number}|null} [stepInfo] - Affiche "X / Y" en cas
   *   d'évolutions multiples enchaînées (ex: plusieurs personnages évoluant lors
   *   du même combat). Omis ou total ≤ 1 : aucun compteur affiché.
   * @returns {Promise<void>}  Résolue quand le joueur ferme l'animation
   */
  function play(prevDef, nextDef, stepInfo = null) {
    return new Promise(resolve => {
      _resolve = resolve;
      _buildOverlay(prevDef, nextDef, stepInfo);
      _runSequence(prevDef, nextDef);
    });
  }

  // ─── CONSTRUCTION DE L'OVERLAY ────────────────────────────────────────────────

  function _buildOverlay(prevDef, nextDef, stepInfo) {
    // Retirer un overlay résiduel si existant
    document.getElementById('evo-overlay')?.remove();

    _overlay = document.createElement('div');
    _overlay.id = 'evo-overlay';
    _overlay.innerHTML = `
      <div class="evo-bg"></div>
      <canvas id="evo-canvas"></canvas>

      <div class="evo-stage" id="evo-stage">

        <!-- Halo d'énergie derrière le portrait -->
        <div class="evo-halo" id="evo-halo"></div>

        <!-- Portrait AVANT (sera dissous) -->
        <div class="evo-portrait-wrap" id="evo-prev-wrap">
          ${prevDef.portrait
            ? `<img class="evo-portrait" id="evo-prev-img" src="${prevDef.portrait}" alt="${prevDef.name}">`
            : `<div class="evo-portrait evo-portrait-ph" id="evo-prev-img">${prevDef.name.charAt(0)}</div>`}
          <div class="evo-silhouette" id="evo-silhouette"></div>
        </div>

        <!-- Portrait APRÈS (caché au départ) -->
        <div class="evo-portrait-wrap evo-hidden" id="evo-next-wrap">
          ${nextDef.portrait
            ? `<img class="evo-portrait" id="evo-next-img" src="${nextDef.portrait}" alt="${nextDef.name}">`
            : `<div class="evo-portrait evo-portrait-ph" id="evo-next-img">${nextDef.name.charAt(0)}</div>`}
        </div>

        <!-- Texte -->
        <div class="evo-text-block" id="evo-text-block">
          ${stepInfo && stepInfo.total > 1 ? `<div class="evo-step">${stepInfo.index} / ${stepInfo.total}</div>` : ''}
          <div class="evo-label" id="evo-label">Évolution !</div>
        </div>

      </div>

      <!-- Bouton de confirmation (apparaît à la fin) -->
      <button class="evo-confirm" id="evo-confirm" style="display:none">
        ✦ Continuer
      </button>

      <!-- Flash blanc initial -->
      <div class="evo-flash" id="evo-flash"></div>
    `;

    document.body.appendChild(_overlay);

    // Injecter les styles si pas encore présents
    if (!document.getElementById('evo-styles')) {
      document.head.appendChild(_buildStyles());
    }

    // Initialiser le canvas de particules
    _initCanvas();

    // Bouton de confirmation
    document.getElementById('evo-confirm').addEventListener('click', _close);
  }

  // ─── SÉQUENCE D'ANIMATION ─────────────────────────────────────────────────────

  function _runSequence(prevDef, nextDef) {
    const rarityDef = (typeof CWGameDatabase !== 'undefined' && CWGameDatabase.RARITIES)
      ? CWGameDatabase.RARITIES[nextDef.rarity] || {}
      : {};
    const accentColor = rarityDef.color || '#f4c267';

    // Mettre à jour la couleur du halo dynamiquement
    const halo = document.getElementById('evo-halo');
    if (halo) halo.style.setProperty('--halo-color', accentColor);

    // ── Étape 0 : flash d'entrée ──────────────────────────────────────────────
    const flash = document.getElementById('evo-flash');
    flash.classList.add('evo-flash-in');

    _timers.push(setTimeout(() => {
      flash.classList.remove('evo-flash-in');
      // Démarrer les particules
      _startParticles(accentColor);
      // Faire apparaître l'overlay
      _overlay.classList.add('evo-visible');

    }, 80));

    // ── Étape 1 : le halo pulse, le portrait "avant" est visible ────────────
    _timers.push(setTimeout(() => {
      document.getElementById('evo-halo')?.classList.add('evo-halo-pulse');
      document.getElementById('evo-prev-wrap')?.classList.add('evo-prev-shake');
    }, 400));

    // ── Étape 2 : dissolution du portrait "avant" ─────────────────────────
    _timers.push(setTimeout(() => {
      const prevWrap = document.getElementById('evo-prev-wrap');
      prevWrap?.classList.add('evo-dissolve');
      document.getElementById('evo-silhouette')?.classList.add('evo-silhouette-fill');
    }, 900));

    // ── Étape 3 : flash blanc au pic de la dissolution ────────────────────
    _timers.push(setTimeout(() => {
      flash.classList.add('evo-flash-peak');
      _timers.push(setTimeout(() => flash.classList.remove('evo-flash-peak'), 400));
    }, 900 + ANIM_DISSOLVE_MS * 0.7));

    // ── Étape 4 : révélation du portrait "après" ──────────────────────────
    const revealStart = 900 + ANIM_DISSOLVE_MS + ANIM_HOLD_MS;
    _timers.push(setTimeout(() => {
      // Masquer l'ancien
      document.getElementById('evo-prev-wrap')?.classList.add('evo-hidden');

      // Montrer le nouveau avec effet de révélation
      const nextWrap = document.getElementById('evo-next-wrap');
      if (nextWrap) {
        nextWrap.classList.remove('evo-hidden');
        nextWrap.classList.add('evo-reveal');
      }

      // Halo change de couleur progressivement
      document.getElementById('evo-halo')?.classList.add('evo-halo-burst');

    }, revealStart));

    // ── Étape 5 : afficher le bandeau "Évolution !" ────────────────────────
    _timers.push(setTimeout(() => {
      document.getElementById('evo-text-block')?.classList.add('evo-text-visible');
    }, revealStart + ANIM_REVEAL_MS * 0.5));

    // ── Étape 6 : afficher le bouton ─────────────────────────────────────
    _timers.push(setTimeout(() => {
      const btn = document.getElementById('evo-confirm');
      if (btn) { btn.style.display = 'block'; btn.classList.add('evo-btn-in'); }
    }, revealStart + ANIM_REVEAL_MS + 400));
  }

  // ─── PARTICULES CANVAS ────────────────────────────────────────────────────────

  let _animFrame = null;
  let _particles = [];
  let _ctx       = null;
  let _cw = 0, _ch = 0;

  function _initCanvas() {
    const canvas = document.getElementById('evo-canvas');
    if (!canvas) return;
    _cw = canvas.width  = window.innerWidth;
    _ch = canvas.height = window.innerHeight;
    _ctx = canvas.getContext('2d');
  }

  function _startParticles(color) {
    _particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      _spawnParticle(color, true);
    }
    _animFrame = requestAnimationFrame(() => _tickParticles(color));
  }

  function _spawnParticle(color, randomAge = false) {
    const cx = _cw / 2;
    const cy = _ch * 0.42;
    const angle  = Math.random() * Math.PI * 2;
    const radius = 20 + Math.random() * 180;
    const speed  = 0.4 + Math.random() * 1.2;
    const size   = 2 + Math.random() * 5;

    _particles.push({
      x:     cx + Math.cos(angle) * radius * 0.3,
      y:     cy + Math.sin(angle) * radius * 0.3,
      vx:    Math.cos(angle) * speed,
      vy:    Math.sin(angle) * speed - 0.5,
      size,
      color,
      alpha: randomAge ? Math.random() : 1,
      life:  randomAge ? Math.random() : 1,
      decay: 0.005 + Math.random() * 0.012,
      pulse: Math.random() * Math.PI * 2,
    });
  }

  function _tickParticles(color) {
    if (!_ctx || !_overlay?.isConnected) return;
    _ctx.clearRect(0, 0, _cw, _ch);

    for (let i = _particles.length - 1; i >= 0; i--) {
      const p = _particles[i];
      p.x    += p.vx;
      p.y    += p.vy;
      p.life -= p.decay;
      p.pulse += 0.08;
      p.alpha = Math.max(0, p.life);

      if (p.life <= 0) {
        _particles.splice(i, 1);
        _spawnParticle(color);
        continue;
      }

      // Dessin : cercle lumineux
      const radius = p.size * (0.8 + 0.2 * Math.sin(p.pulse));
      const grad = _ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.5);
      grad.addColorStop(0,   _hexAlpha(color, p.alpha));
      grad.addColorStop(0.4, _hexAlpha(color, p.alpha * 0.6));
      grad.addColorStop(1,   _hexAlpha(color, 0));

      _ctx.beginPath();
      _ctx.arc(p.x, p.y, radius * 2.5, 0, Math.PI * 2);
      _ctx.fillStyle = grad;
      _ctx.fill();
    }

    _animFrame = requestAnimationFrame(() => _tickParticles(color));
  }

  function _hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16) || 200;
    const g = parseInt(hex.slice(3,5), 16) || 180;
    const b = parseInt(hex.slice(5,7), 16) || 80;
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  // ─── FERMETURE ────────────────────────────────────────────────────────────────

  function _close() {
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
    // Purger tout setTimeout encore en attente (fermeture anticipée par le joueur,
    // avant la fin naturelle de la séquence) : évite qu'une étape différée vienne
    // modifier un overlay déjà retiré ou remplacé par l'évolution suivante en file.
    _timers.forEach(clearTimeout);
    _timers = [];
    // Capturer une référence LOCALE et figée de l'overlay à retirer : si une
    // nouvelle animation démarre avant l'expiration de ce délai (la file
    // d'animations enchaîne immédiatement la suivante), la variable partagée
    // _overlay aura déjà été réassignée à ce nouvel overlay — on ne doit donc
    // jamais la relire "à chaud" ici, sous peine de supprimer/nuller le mauvais.
    const overlayToRemove = _overlay;
    if (overlayToRemove) {
      overlayToRemove.classList.add('evo-closing');
      setTimeout(() => {
        overlayToRemove.remove();
        if (_overlay === overlayToRemove) _overlay = null;
      }, 400);
    }
    if (_resolve) { _resolve(); _resolve = null; }
  }

  // ─── STYLES INJECTÉS ─────────────────────────────────────────────────────────

  function _buildStyles() {
    const style = document.createElement('style');
    style.id = 'evo-styles';
    style.textContent = `

/* ── Overlay principal ── */
#evo-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;
}
#evo-overlay.evo-visible  { opacity: 1; pointer-events: all; }
#evo-overlay.evo-closing  { opacity: 0; pointer-events: none; }

/* ── Fond dégradé animé ── */
.evo-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 40%, #1a0e38 0%, #08040f 70%);
  animation: evoBgBreath 3s ease-in-out infinite alternate;
}
@keyframes evoBgBreath {
  from { background: radial-gradient(ellipse at 50% 40%, #1a0e38 0%, #08040f 70%); }
  to   { background: radial-gradient(ellipse at 50% 40%, #2a1455 0%, #0c0820 70%); }
}

/* ── Canvas particules ── */
#evo-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* ── Scène centrale ── */
.evo-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  z-index: 2;
}

/* ── Halo d'énergie ── */
.evo-halo {
  --halo-color: #f4c267;
  position: absolute;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--halo-color) 30%, transparent) 0%, transparent 70%);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -54%);
  opacity: 0;
  transition: opacity 0.6s ease;
  pointer-events: none;
}
.evo-halo.evo-halo-pulse {
  opacity: 1;
  animation: eHaloPulse 1.1s ease-in-out infinite alternate;
}
.evo-halo.evo-halo-burst {
  animation: eHaloBurst 0.8s ease-out forwards, eHaloPulse 1.1s 0.8s ease-in-out infinite alternate;
}
@keyframes eHaloPulse {
  from { transform: translate(-50%,-54%) scale(1);   opacity: 0.7; }
  to   { transform: translate(-50%,-54%) scale(1.12); opacity: 1;  }
}
@keyframes eHaloBurst {
  0%   { transform: translate(-50%,-54%) scale(1);   opacity: 1; }
  40%  { transform: translate(-50%,-54%) scale(1.8); opacity: 0.5; }
  100% { transform: translate(-50%,-54%) scale(1.1); opacity: 0.9; }
}

/* ── Portait wrapper ── */
.evo-portrait-wrap {
  position: relative;
  width: 220px;
  height: 275px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 0 40px rgba(244,194,103,0.25), 0 8px 32px rgba(0,0,0,0.6);
  background: #12082a;
}
.evo-portrait {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.evo-portrait-ph {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 5rem;
  font-weight: 700;
  color: #f4c267;
  background: #1c1030;
}

/* ── Silhouette blanche (dissolution) ── */
.evo-silhouette {
  position: absolute;
  inset: 0;
  background: white;
  opacity: 0;
  pointer-events: none;
}
.evo-silhouette.evo-silhouette-fill {
  animation: eSilhouetteFill 1.2s ease-in forwards;
}
@keyframes eSilhouetteFill {
  0%   { opacity: 0; }
  60%  { opacity: 0.85; }
  100% { opacity: 1; }
}

/* ── Dissolution portrait "avant" ── */
.evo-prev-shake {
  animation: ePrevShake 0.5s ease-in-out;
}
@keyframes ePrevShake {
  0%,100% { transform: translateX(0); }
  20%     { transform: translateX(-6px); }
  40%     { transform: translateX(8px); }
  60%     { transform: translateX(-5px); }
  80%     { transform: translateX(4px); }
}
.evo-dissolve {
  animation: eDissolve 1.2s ease-in forwards;
}
@keyframes eDissolve {
  0%   { opacity: 1; filter: brightness(1); }
  50%  { opacity: 0.7; filter: brightness(3) saturate(0); }
  100% { opacity: 0; filter: brightness(8) saturate(0); }
}

/* ── Révélation portrait "après" ── */
.evo-hidden { display: none !important; }

.evo-reveal {
  display: block !important;
  animation: eReveal 1.4s ease-out forwards;
}
@keyframes eReveal {
  0%   { opacity: 0; filter: brightness(8) saturate(0); transform: scale(1.08); }
  30%  { opacity: 0.6; filter: brightness(3) saturate(0.3); }
  70%  { opacity: 1; filter: brightness(1.4) saturate(1.2); transform: scale(1.02); }
  100% { opacity: 1; filter: brightness(1) saturate(1);    transform: scale(1); }
}

/* ── Bloc de texte ── */
.evo-text-block {
  margin-top: 28px;
  text-align: center;
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.evo-text-block.evo-text-visible {
  opacity: 1;
  transform: translateY(0);
}
.evo-label {
  font-family: 'Cinzel', serif;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #a99cd1;
  margin-bottom: 8px;
}
.evo-step {
  font-family: 'Courier New', monospace;
  font-size: 0.78rem;
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.1em;
  margin-bottom: 10px;
}

/* ── Bouton confirmer ── */
.evo-confirm {
  position: relative;
  z-index: 3;
  margin-top: 36px;
  padding: 14px 48px;
  font-family: 'Cinzel', serif;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #0c0a16;
  background: linear-gradient(135deg, #f4c267, #c9913c);
  border: none;
  border-radius: 50px;
  cursor: pointer;
  box-shadow: 0 0 24px rgba(244,194,103,0.5);
  opacity: 0;
  transform: translateY(16px);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  pointer-events: none;
}
.evo-confirm.evo-btn-in {
  animation: eBtnIn 0.45s ease forwards;
  pointer-events: all;
}
@keyframes eBtnIn {
  to { opacity: 1; transform: translateY(0); }
}
.evo-confirm:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 36px rgba(244,194,103,0.75);
}
.evo-confirm:active {
  transform: translateY(0);
}

/* ── Flash entrée/pic ── */
.evo-flash {
  position: absolute;
  inset: 0;
  background: white;
  opacity: 0;
  pointer-events: none;
  z-index: 10;
}
.evo-flash.evo-flash-in {
  animation: eFlashIn 0.35s ease-out forwards;
}
.evo-flash.evo-flash-peak {
  animation: eFlashPeak 0.4s ease-out forwards;
}
@keyframes eFlashIn {
  0%   { opacity: 0.9; }
  100% { opacity: 0; }
}
@keyframes eFlashPeak {
  0%   { opacity: 0; }
  30%  { opacity: 0.95; }
  100% { opacity: 0; }
}
    `;
    return style;
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return { play };
})();
