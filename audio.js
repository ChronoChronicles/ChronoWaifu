/**
 * ============================================================
 * AUDIO.JS — Musique de fond (interface globale + combats)
 * Fichiers audio importés par l'admin, hébergés sur Supabase Storage
 * (partagés avec TOUS les joueurs — l'URL publique est stockée dans
 * config.audio et se synchronise via game_data comme le reste de la
 * config). Lecture via un lecteur <audio> natif : lecture automatique,
 * boucle continue, bascule globale/combat.
 * ============================================================
 */

'use strict';

const CWAudioSystem = (() => {

  const BUCKET = 'game-audio';

  let _audioEl     = null;
  let _currentKind = null;   // 'global' | 'combat' | null
  let _muted       = true;   // Doit démarrer coupé : obligation des navigateurs pour l'autoplay
                              // (voir enableSoundOnFirstInteraction ci-dessous, qui l'active dès
                              // la première interaction du joueur avec la page, à 10% de volume)
  let _baseVolume   = 0.10;  // Volume de la musique de fond hors bruitages (ducking)
  let _globalSavedTime = 0;  // Position (s) où reprendre la musique globale après un combat

  // Correspondance clé de piste (utilisée en interne et par l'admin) → champ
  // de config.audio où est stockée son URL publique Supabase Storage.
  const FIELD_MAP = {
    global:         'globalMusicName',
    combat:         'combatMusicName',
    sfx_hit_normal: 'sfxHitNormalName',
    sfx_hit_resist: 'sfxHitResistName',
    sfx_hit_weak:   'sfxHitWeakName',
    sfx_victory:    'sfxVictoryName',
    sfx_defeat:     'sfxDefeatName',
    sfx_levelup:    'sfxLevelUpName',
    sfx_evolution:  'sfxEvolutionName',
    sfx_gacha_pull: 'sfxGachaPullName',
    sfx_defile_reveal:     'sfxDefileRevealName',
    sfx_defile_score_tick: 'sfxDefileScoreTickName',
    sfx_defile_type_good:  'sfxDefileTypeGoodName',
    sfx_defile_type_bad:   'sfxDefileTypeBadName',
    sfx_defile_endurance:  'sfxDefileEnduranceName',
    sfx_defile_talent:     'sfxDefileTalentName',
    sfx_defile_round_win:  'sfxDefileRoundWinName',
    sfx_defile_round_lose: 'sfxDefileRoundLoseName',
    sfx_defile_victory:    'sfxDefileVictoryName',
    sfx_defile_defeat:     'sfxDefileDefeatName',
  };

  function _storageClient() {
    // CWBackend expose le client Supabase déjà connecté (cf. backend.js)
    return CWBackend.storageClient();
  }

  // ─── STOCKAGE (Supabase Storage) ────────────────────────────────────────────

  /**
   * Importe (ou remplace) le fichier audio d'un type donné sur Supabase Storage.
   * Chemin fixe par type ("kind/track") : un nouvel import écrase simplement
   * l'ancien fichier, pas de fichiers orphelins à nettoyer.
   * @returns {Promise<string>} l'URL publique (avec paramètre anti-cache)
   */
  async function saveTrack(kind, file) {
    if (!file) throw new Error('Aucun fichier fourni');
    const path = `${kind}/track`;
    const { error } = await _storageClient()
      .from(BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || 'audio/mpeg' });
    if (error) throw error;
    const { data } = _storageClient().from(BUCKET).getPublicUrl(path);
    // Paramètre anti-cache : garantit que tous les joueurs rechargent bien le
    // nouveau fichier plutôt qu'une version mise en cache par leur navigateur.
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  /** Supprime le fichier audio d'un type donné sur Supabase Storage */
  async function removeTrack(kind) {
    const path = `${kind}/track`;
    const { error } = await _storageClient().from(BUCKET).remove([path]);
    if (error) throw error;
  }

  /** @returns {boolean} true si une URL est enregistrée pour ce type dans la config */
  function hasTrack(kind) {
    const cfg = CWGameState.get() ? CWGameState.getConfig() : null;
    const fieldName = FIELD_MAP[kind];
    return !!(fieldName && cfg?.audio?.[fieldName]);
  }

  // ─── INITIALISATION ────────────────────────────────────────────────────────

  function init() {
    _audioEl = document.getElementById('bg-audio-player');
    if (_audioEl) {
      _audioEl.loop = false; // on gère nous-mêmes la boucle (plus fiable sur certains navigateurs)
      _audioEl.muted = _muted;
      _audioEl.volume = _baseVolume;
      _audioEl.addEventListener('ended', () => {
        // Boucle continue : on relance depuis le début, quelle que soit la piste en cours.
        _audioEl.currentTime = 0;
        _audioEl.play().catch(() => { /* lecture bloquée, attend une interaction */ });
      });
    }
    return Promise.resolve();
  }

  // ─── LECTURE ──────────────────────────────────────────────────────────────

  /**
   * Joue la musique de fond globale (interface, hors combat).
   * Si elle avait été interrompue par un combat, reprend exactement où elle
   * s'était arrêtée plutôt que de repartir de zéro.
   * @param {boolean} [force=false] - Recharge depuis le début même si déjà en cours
   *                                   (utilisé après import d'un nouveau fichier en admin)
   */
  async function playGlobal(force = false) {
    const cfg = CWGameState.get() ? CWGameState.getConfig() : null;
    if (cfg?.audio?.enabled === false) return;
    if (!_audioEl) return;
    if (_currentKind === 'global' && !force) return; // déjà en cours : on ne touche à rien

    const url = cfg?.audio?.[FIELD_MAP.global] || null;
    if (!url) { _audioEl.pause(); _currentKind = null; return; }

    if (force) _globalSavedTime = 0; // nouveau fichier : on ne reprend pas une ancienne position

    _audioEl.src = url;
    _audioEl.currentTime = _globalSavedTime; // reprend exactement où elle s'était arrêtée
    _currentKind = 'global';
    _audioEl.muted = _muted;
    _audioEl.play().catch(() => { /* autoplay bloqué tant que le joueur n'a pas interagi */ });
  }

  /**
   * Joue la musique de combat. Repart TOUJOURS de zéro (exigence du jeu),
   * et met en pause la musique globale en mémorisant sa position exacte
   * pour la reprendre plus tard sans la faire repartir de zéro.
   * Repli automatique sur la musique globale si aucune musique de combat n'est définie.
   */
  async function playCombat() {
    const cfg = CWGameState.get() ? CWGameState.getConfig() : null;
    console.log('[AUDIO DIAG] playCombat() appelée. audio.enabled=', cfg?.audio?.enabled, '| _audioEl existe=', !!_audioEl, '| _muted=', _muted);
    if (cfg?.audio?.enabled === false) { console.log('[AUDIO DIAG] STOP : audio désactivé dans la config.'); return; }
    if (!_audioEl) { console.log('[AUDIO DIAG] STOP : élément <audio> introuvable dans le DOM.'); return; }

    // Mémoriser la position de la musique globale avant de l'interrompre
    if (_currentKind === 'global') {
      _globalSavedTime = _audioEl.currentTime || 0;
    }

    const url = cfg?.audio?.[FIELD_MAP.combat] || null;
    console.log('[AUDIO DIAG] URL de la musique de combat trouvée dans la config:', url);
    if (!url) { console.log('[AUDIO DIAG] STOP : aucune URL — repli sur la musique globale.'); await playGlobal(); return; } // pas de musique de combat définie : on reste sur la globale

    _audioEl.src = url;
    _audioEl.currentTime = 0; // la musique de combat repart toujours de zéro
    _currentKind = 'combat';
    _audioEl.muted = _muted;
    console.log('[AUDIO DIAG] Tentative de lecture... muted=', _audioEl.muted, 'volume=', _audioEl.volume);
    _audioEl.play()
      .then(() => console.log('[AUDIO DIAG] ✅ play() a réussi, la musique devrait jouer.'))
      .catch((err) => console.log('[AUDIO DIAG] ❌ play() a échoué :', err.name, err.message));
  }

  function stop() {
    _currentKind = null;
    _globalSavedTime = 0;
    _audioEl?.pause();
  }

  // ─── BRUITAGES DE COMBAT (effets sonores ponctuels) ─────────────────────────
  // Contrairement à la musique de fond, chaque bruitage utilise un nouvel objet
  // Audio() à la volée : ça permet à plusieurs sons de se chevaucher (plusieurs
  // coups rapprochés) sans interrompre la musique de fond qui continue de jouer.

  const SFX_KEYS = {
    hitNormal: 'sfx_hit_normal',
    hitResist: 'sfx_hit_resist',
    hitWeak:   'sfx_hit_weak',
    victory:   'sfx_victory',
    defeat:    'sfx_defeat',
    levelUp:   'sfx_levelup',
    evolution: 'sfx_evolution',
    gachaPull: 'sfx_gacha_pull',
    // ── Mode Défilé ──────────────────────────────────────────────────────
    defileReveal:    'sfx_defile_reveal',     // présentation d'une participante
    defileScoreTick: 'sfx_defile_score_tick', // apparition d'un chiffre de score
    defileTypeGood:  'sfx_defile_type_good',  // bonus de type favorable
    defileTypeBad:   'sfx_defile_type_bad',   // malus de type défavorable
    defileEndurance: 'sfx_defile_endurance',  // bonus de Forme révélé
    defileTalent:    'sfx_defile_talent',     // activation d'un Talent
    defileRoundWin:  'sfx_defile_round_win',  // tournage remporté
    defileRoundLose: 'sfx_defile_round_lose', // tournage perdu
    defileVictory:   'sfx_defile_victory',    // défilé remporté (applaudissements)
    defileDefeat:    'sfx_defile_defeat',     // défilé perdu (déception)
  };

  // Bruitages "de coup" exclus de l'atténuation (ils sont volontairement courts et
  // déjà nombreux ; ce sont les autres — victoire/défaite, level up, évolution,
  // tirage Gacha — qui doivent clairement ressortir par-dessus la musique).
  const NON_DUCKING_KEYS = new Set([SFX_KEYS.hitNormal, SFX_KEYS.hitResist, SFX_KEYS.hitWeak]);

  const DUCK_RATIO = 0.25; // -75% du volume courant pendant un bruitage (fourchette demandée -70 à -80%)
  let _duckCount = 0;

  /** Baisse le volume de la musique de fond (compteur pour gérer les sons qui se chevauchent) */
  function _duck() {
    _duckCount++;
    if (_audioEl) _audioEl.volume = _baseVolume * DUCK_RATIO;
  }

  /** Restaure le volume normal une fois que tous les bruitages "ducking" en cours sont terminés */
  function _unduck() {
    _duckCount = Math.max(0, _duckCount - 1);
    if (_duckCount === 0 && _audioEl) _audioEl.volume = _baseVolume;
  }

  /** Joue un bruitage ponctuel par sa clé de stockage (cf. SFX_KEYS) */
  async function playSfx(key) {
    const cfg = CWGameState.get() ? CWGameState.getConfig() : null;
    if (cfg?.audio?.enabled === false) return;
    if (!key) return;

    const fieldName = FIELD_MAP[key];
    const url = fieldName ? cfg?.audio?.[fieldName] : null;
    if (!url) return; // aucun bruitage importé pour cette clé : silence

    const shouldDuck = !NON_DUCKING_KEYS.has(key);
    if (shouldDuck) _duck();

    const sfxEl = new Audio(url);
    sfxEl.muted = _muted;
    const cleanup = () => { if (shouldDuck) _unduck(); };
    sfxEl.addEventListener('ended', cleanup);
    sfxEl.play().catch(cleanup); // lecture bloquée : on libère/restaure immédiatement
  }

  /**
   * Comme playSfx, mais renvoie une Promise résolue quand le son est
   * RÉELLEMENT terminé (utile pour caler une animation dessus). Se résout
   * immédiatement si aucun bruitage n'est configuré pour cette clé.
   */
  function playSfxAwait(key) {
    return new Promise(resolve => {
      const cfg = CWGameState.get() ? CWGameState.getConfig() : null;
      if (cfg?.audio?.enabled === false) { resolve(); return; }
      if (!key) { resolve(); return; }
      const fieldName = FIELD_MAP[key];
      const url = fieldName ? cfg?.audio?.[fieldName] : null;
      if (!url) { resolve(); return; }

      const shouldDuck = !NON_DUCKING_KEYS.has(key);
      if (shouldDuck) _duck();

      const sfxEl = new Audio(url);
      sfxEl.muted = _muted;
      const finish = () => { if (shouldDuck) _unduck(); resolve(); };
      sfxEl.addEventListener('ended', finish);
      sfxEl.addEventListener('error', finish);
      sfxEl.play().catch(finish);
    });
  }

  /**
   * Joue le bruitage de coup adapté au multiplicateur d'efficacité de type
   * (normal / résistance-immunité / faiblesse), selon les mêmes seuils que
   * l'indicateur visuel déjà affiché en combat.
   * @param {number} multiplier
   */
  function playHitSfx(multiplier) {
    let key;
    if (multiplier >= 2.0) key = SFX_KEYS.hitWeak;
    else if (multiplier <= 0.5) key = SFX_KEYS.hitResist; // couvre aussi l'immunité (0)
    else key = SFX_KEYS.hitNormal;
    playSfx(key);
  }

  /** Joue le bruitage de fin de combat (victoire ou défaite) */
  function playResultSfx(result) {
    playSfx(result === 'victory' ? SFX_KEYS.victory : SFX_KEYS.defeat);
  }

  // ─── VOLUME / MUTE ────────────────────────────────────────────────────────

  /**
   * Active le son (à _baseVolume, 10% par défaut) — sans rien faire si déjà activé.
   * Prévu pour être appelé automatiquement à la toute première interaction du
   * joueur avec la page (cf. index.html), seul moment où les navigateurs
   * autorisent la lecture audio non coupée.
   */
  function enableSound() {
    if (!_muted) return;
    _muted = false;
    if (_audioEl) {
      _audioEl.muted = false;
      _audioEl.volume = _baseVolume;
      _audioEl.play().catch(() => {});
    }
  }

  /** Coupe/active le son. Renvoie le nouvel état (true = coupé). */
  function toggleMute() {
    _muted = !_muted;
    if (_audioEl) {
      _audioEl.muted = _muted;
      if (!_muted) _audioEl.play().catch(() => {});
    }
    return _muted;
  }

  const isMuted = () => _muted;

  /** Règle le volume (0 à 1). Si vol > 0 et son coupé, ne pas couper à nouveau. */
  function setVolume(vol) {
    _baseVolume = Math.max(0, Math.min(1, vol));
    if (_audioEl && _duckCount === 0) _audioEl.volume = _baseVolume;
    if (vol === 0 && !_muted) { _muted = true; if (_audioEl) _audioEl.muted = true; }
    else if (vol > 0 && _muted) { /* laisser le toggle mute gérer */ }
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────

  return {
    init, saveTrack, removeTrack, hasTrack, playGlobal, playCombat, stop, toggleMute, isMuted, setVolume,
    playSfx, playSfxAwait, playHitSfx, playResultSfx, SFX_KEYS, enableSound,
  };
})();
