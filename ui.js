/**
 * ============================================================
 * UI.JS — Interface utilisateur du jeu
 * Gère tous les écrans : Collection, Équipe, Gacha, Combat, Catalogue
 * ============================================================
 */

'use strict';

const CWGameUI = (() => {

  // ─── ÉTAT UI ──────────────────────────────────────────────────────────────────
  let _currentScreen = 'collection';
  let _battle        = null;
  let _combatMode    = 'story';   // 'story' | 'line' | 'fullRandom' | 'arena'
  let _selectedLine  = null;       // ID de la lignée évolutive choisie en mode 'line'
  let _selectedArenaType = null;   // ID du type choisi en mode 'arena'
  let _gachaTab      = 'chars';   // 'chars' | 'equip'
  let _equipCharId   = null;       // instanceId du perso sélectionné dans l'écran équip

  // Tri des listes de personnages (mémorisé indépendamment par écran)
  let _collectionSort   = 'name';
  let _collectionFilters = { search: '', rarity: '', type: '', statKey: 'level', statMin: '' };
  let _teamSort          = 'name';
  let _teamFilters       = { search: '', rarity: '', type: '', statKey: 'level', statMin: '' };
  let _equipSort         = 'name';   // tri du sélecteur de personnage (écran Équiper)
  let _equipSlotOpen     = null;     // slot actuellement ouvert dans le panneau inline (0/1/2 ou null)
  let _equipSlotSearch   = '';       // recherche texte dans le panneau inline de sélection de slot
  let _autoEquipResult   = null;     // résumé du dernier "Équipement auto" (affiché puis auto-effacé)
  let _autoEquipResultTimer = null;

  // Onglet d'équipement actif dans l'écran Équiper, et tri/filtre par onglet
  let _equipInvTab = 'weapon';
  let _equipInvSort = { weapon: 'name', armor: 'name', accessory: 'name' };
  let _equipInvFilters = {
    weapon:    { search: '', rarity: '', statKey: 'atk', statMin: '' },
    armor:     { search: '', rarity: '', statKey: 'def', statMin: '' },
    accessory: { search: '', rarity: '', statKey: 'hp',  statMin: '' },
  };
  let _equipUnequippedFilter = { weapon: false, armor: false, accessory: false }; // filtres "sans équipement" indépendants par catégorie

  const RARITY_ORDER  = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const STAT_OPTIONS  = [
    { key: 'level', label: 'Niveau' },
    { key: 'hp',    label: 'PV' },
    { key: 'atk',   label: 'Charisme' },
    { key: 'def',   label: 'Prestance' },
    { key: 'spd',   label: 'Grace' },
  ];

  // Slots d'équipement : 3 emplacements fixes, dans l'ordre des index 0/1/2
  const EQUIP_SLOT_ORDER  = CWGameDatabase.EQUIP_SLOTS || ['weapon', 'armor', 'accessory'];
  const EQUIP_SLOT_LABELS = { weapon: '⚔️ Arme', armor: '👗 Tenue', accessory: '💍 Bijou' };
  // Icône seule par catégorie d'équipement — alignée sur les catégories de l'admin
  // (épées croisées / bouclier / bague), utilisée partout où un équipement doit
  // afficher un symbole automatique (ex: vignette dans le Shop).
  const EQUIP_SLOT_ICON = { weapon: '⚔️', armor: '🛡️', accessory: '💍' };

  // ─── TRI & FILTRES DES PERSONNAGES ───────────────────────────────────────────────

  /**
   * Décore une liste d'instances avec leur définition et leurs stats calculées.
   * @param {Array<object>} instances
   * @param {object} state
   * @returns {Array<{inst:object, def:object, stats:object}>}
   */
  function _decorateInstances(instances, state) {
    return instances.map(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return null;
      const stats = _computeFullStats(inst, def).total;
      const aura  = CWGameDatabase.computeAuraScore(stats, state.config.combat);
      return { inst, def, stats, aura };
    }).filter(Boolean);
  }

  /**
   * Filtre une liste décorée de personnages selon une recherche par nom, une rareté,
   * un type (principal ou secondaire), et un seuil minimum sur une stat au choix.
   * @param {Array<{inst,def,stats}>} decorated
   * @param {{search:string, rarity:string, type:string, statKey:string, statMin:string}} filters
   */
  function _applyCharFilters(decorated, filters) {
    if (!filters) return decorated;
    return decorated.filter(({ inst, def, stats }) => {
      if (filters.search && !def.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.rarity && def.rarity !== filters.rarity) return false;
      if (filters.type && def.type1 !== filters.type && def.type2 !== filters.type) return false;
      if (filters.statKey && filters.statMin !== '' && filters.statMin != null) {
        const val = filters.statKey === 'level' ? inst.level : stats[filters.statKey];
        if (val < Number(filters.statMin)) return false;
      }
      return true;
    });
  }

  /**
   * Trie une liste décorée de personnages.
   * @param {Array<{inst,def,stats}>} decorated
   * @param {'name'|'level'|'rarity'|'type'|'hp'|'atk'|'def'|'spd'} sortKey
   * @param {object} state
   */
  function _sortDecoratedChars(decorated, sortKey, state) {
    const types = state.types;
    const typeIndex   = (id) => { const idx = types.findIndex(t => t.id === id); return idx === -1 ? 999 : idx; };
    const rarityIndex = (r)  => { const idx = RARITY_ORDER.indexOf(r); return idx === -1 ? 0 : idx; };
    const sorted = [...decorated];
    switch (sortKey) {
      case 'level':  sorted.sort((a, b) => b.inst.level - a.inst.level || a.def.name.localeCompare(b.def.name)); break;
      case 'rarity':  sorted.sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name)); break;
      case 'type':    sorted.sort((a, b) => typeIndex(a.def.type1) - typeIndex(b.def.type1) || a.def.name.localeCompare(b.def.name)); break;
      case 'hp':      sorted.sort((a, b) => b.stats.hp  - a.stats.hp); break;
      case 'atk':     sorted.sort((a, b) => b.stats.atk - a.stats.atk); break;
      case 'def':     sorted.sort((a, b) => b.stats.def - a.stats.def); break;
      case 'spd':     sorted.sort((a, b) => b.stats.spd - a.stats.spd); break;
      case 'aura':    sorted.sort((a, b) => b.aura - a.aura); break;
      case 'name':
      default:        sorted.sort((a, b) => a.def.name.localeCompare(b.def.name)); break;
    }
    return sorted;
  }

  /** Pipeline complet : décore, filtre puis trie une liste de personnages */
  function _decorateFilterSortChars(instances, sortKey, filters, state) {
    return _sortDecoratedChars(_applyCharFilters(_decorateInstances(instances, state), filters), sortKey, state);
  }

  /** Génère un menu déroulant de tri (personnages) couvrant tous les critères demandés */
  function _renderSortSelect(id, current) {
    return `
      <select class="sort-select" id="${id}">
        <option value="name"   ${current === 'name'   ? 'selected' : ''}>Trier : Nom (A-Z)</option>
        <option value="level"  ${current === 'level'  ? 'selected' : ''}>Trier : Niveau</option>
        <option value="rarity" ${current === 'rarity' ? 'selected' : ''}>Trier : Rareté</option>
        <option value="type"   ${current === 'type'   ? 'selected' : ''}>Trier : Type</option>
        <option value="hp"     ${current === 'hp'     ? 'selected' : ''}>Trier : PV</option>
        <option value="atk"    ${current === 'atk'    ? 'selected' : ''}>Trier : Charisme</option>
        <option value="def"    ${current === 'def'    ? 'selected' : ''}>Trier : Prestance</option>
        <option value="spd"    ${current === 'spd'    ? 'selected' : ''}>Trier : Grace</option>
        <option value="aura"   ${current === 'aura'   ? 'selected' : ''}>Trier : ✨ Aura</option>
      </select>
    `;
  }

  /**
   * Génère la barre de filtres réutilisable pour les écrans de personnages
   * (recherche par nom, rareté, type, seuil minimum sur une stat au choix).
   */
  function _renderCharFilterBar(prefix, filters, state) {
    return `
      <div class="filter-bar">
        <input type="text" class="search-input" id="${prefix}-search" placeholder="Rechercher un nom..." value="${filters.search || ''}">
        <select class="sort-select" id="${prefix}-filter-rarity">
          <option value="">Toutes raretés</option>
          ${RARITY_ORDER.map(r => `<option value="${r}" ${filters.rarity === r ? 'selected' : ''}>${RARITY_LABELS_FR[r]}</option>`).join('')}
        </select>
        <select class="sort-select" id="${prefix}-filter-type">
          <option value="">Tous types</option>
          ${state.types.map(t => `<option value="${t.id}" ${filters.type === t.id ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
        </select>
        <div class="stat-filter-group">
          <select class="sort-select" id="${prefix}-filter-statkey">
            ${STAT_OPTIONS.map(s => `<option value="${s.key}" ${filters.statKey === s.key ? 'selected' : ''}>${s.label} ≥</option>`).join('')}
          </select>
          <input type="number" class="search-input stat-filter-input" id="${prefix}-filter-statmin" placeholder="min." value="${filters.statMin || ''}">
        </div>
      </div>
    `;
  }

  /** Lie les contrôles de la barre de filtres aux champs de l'objet filters fourni, et appelle onChange à chaque modification */
  function _bindCharFilterBar(prefix, filters, onChange) {
    document.getElementById(`${prefix}-search`)?.addEventListener('input', e => { filters.search = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-rarity`)?.addEventListener('change', e => { filters.rarity = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-type`)?.addEventListener('change', e => { filters.type = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statkey`)?.addEventListener('change', e => { filters.statKey = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statmin`)?.addEventListener('input', e => { filters.statMin = e.target.value; onChange(); });
  }

  const RARITY_LABELS_FR = {
    common: 'Commune', uncommon: 'Peu commune', rare: 'Rare',
    epic: 'Épique', legendary: 'Légendaire', mythic: 'Mythique',
  };

  // ─── INITIALISATION ──────────────────────────────────────────────────────────

  function init() {
    _renderNav();
    _bindNav();
    CWAudioSystem.init().then(() => CWAudioSystem.playGlobal());
    _bindMusicToggle();
    // Les navigateurs bloquent le son tant qu'il n'y a pas eu d'interaction :
    // on active donc le son (à 10%) dès le tout premier clic/touche/tap du joueur,
    // sans qu'il ait besoin de cliquer explicitement sur le bouton 🔊.
    const _autoEnableSound = (e) => {
      // Ne pas interférer si le joueur clique justement sur le bouton son / sa popup
      // de volume : son propre gestionnaire de clic sait déjà activer le son correctement.
      if (e.target.closest && e.target.closest('#music-toggle, #volume-popup')) return;
      CWAudioSystem.enableSound();
      _updateMusicToggle();
    };
    document.addEventListener('pointerdown', _autoEnableSound, { once: true });
    document.addEventListener('keydown',     _autoEnableSound, { once: true });
    showScreen('hub');
    _startResourceTicker();
    _initPlayerMenu();
    _refreshAvatarDisplays(); // affiche l'avatar sauvegardé dès le démarrage (pas seulement à l'ouverture du menu)

    CWGameState.checkDailyQuests();

    const player = CWGameState.getPlayer();
    const tutorialDone = player.tutorialDone;

    if (!tutorialDone) {
      // Première ouverture : écran titre → tutoriel → récompenses connexion
      _showTitleScreen(() => {
        _runTutorial(() => {
          _launchDailyRewards();
        });
      });
    } else {
      // Joueur connu : récompenses de connexion directement
      _launchDailyRewards();
    }

    CWGameState.subscribe((event, data) => {
      _onStateChange(event, data);
    });
  }

  function _launchDailyRewards() {
    const claimableCycles = CWGameState.getDailyLoginClaimable?.() || [];
    if (claimableCycles.length > 0) {
      setTimeout(() => {
        claimableCycles.forEach(info => {
          _enqueueAnimation(() => new Promise(resolve => _showDailyLoginClaimPopup(info, resolve)));
        });
      }, 400);
    }
  }

  // ─── ÉCRAN TITRE ─────────────────────────────────────────────────────────────

  function _showTitleScreen(onStart) {
    const state  = CWGameState.get();
    const tplMsg = state.config.tutorial?.welcomeMessage || 'Le Nexus Glamour vous attend...';

    const el = document.getElementById('title-screen');
    const tagEl = document.getElementById('title-tagline');
    const btn = document.getElementById('title-start-btn');
    if (!el) { onStart?.(); return; }

    if (tagEl) tagEl.textContent = tplMsg;
    el.style.display = 'flex';

    btn?.addEventListener('click', () => {
      el.style.transition = 'opacity 400ms';
      el.style.opacity    = '0';
      setTimeout(() => { el.style.display = 'none'; onStart?.(); }, 400);
    }, { once: true });
  }

  // ─── TUTORIEL ────────────────────────────────────────────────────────────────

  function _runTutorial(onComplete) {
    const state  = CWGameState.get();
    const tpl    = state.config.tutorial;
    const steps  = tpl?.steps?.length ? tpl.steps : _getTutorialDefaultSteps();

    const overlay   = document.getElementById('tutorial-overlay');
    const titleEl   = document.getElementById('tuto-title');
    const textEl    = document.getElementById('tuto-text');
    const nameWrap  = document.getElementById('tuto-name-input-wrap');
    const nameInput = document.getElementById('tuto-name-input');
    const rewWrap   = document.getElementById('tuto-reward-wrap');
    const nextBtn   = document.getElementById('tuto-btn-next');
    const progEl    = document.getElementById('tuto-progress');
    const speakerName = document.getElementById('tuto-speaker-name');
    const portraitEl  = document.getElementById('tuto-portrait');

    if (!overlay) { onComplete?.(); return; }
    overlay.style.display = 'flex';
    _combatInProgress = false;

    let stepIdx        = 0;
    let waitingForClic = false;
    let pendingCombatDone = null;

    const sub = (txt) => {
      const n = CWGameState.getPlayer().name || 'Directrice';
      return (txt || '').replace(/\{nom\}/gi, n);
    };

    const renderProgress = () => {
      if (!progEl) return;
      progEl.innerHTML = steps.map((_, i) =>
        `<div class="tuto-dot ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}"></div>`
      ).join('');
    };

    const showStep = (idx) => {
      const s = steps[idx];
      if (!s) return;
      if (titleEl) titleEl.textContent = sub(s.title || '');
      if (textEl)  textEl.textContent  = sub(s.text  || '');
      if (speakerName) speakerName.textContent = tpl?.narratorName || 'La Directrice';
      const charImg = document.getElementById('tuto-char-img');
      const portrait = tpl?.narratorPortrait || '';
      if (charImg) {
        if (portrait) { charImg.src = portrait; charImg.style.display = 'block'; charImg.classList.remove('entering'); void charImg.offsetWidth; charImg.classList.add('entering'); }
        else charImg.style.display = 'none';
      }
      if (portraitEl) portraitEl.style.display = 'none';
      if (nameWrap) nameWrap.style.display = s.type === 'name' ? 'block' : 'none';
      if (rewWrap)  { rewWrap.style.display = 'none'; rewWrap.innerHTML = ''; }
      if (s.type === 'currency') {
        const cr = s.crystals ?? 500, go = s.gold ?? 500;
        if (rewWrap) { rewWrap.style.display = 'block'; rewWrap.innerHTML =
          (cr > 0 ? `<div class="tuto-reward-card"><span class="tuto-reward-icon">💎</span><div><div class="tuto-reward-label">+${cr} Diamants</div></div></div>` : '') +
          (go > 0 ? `<div class="tuto-reward-card"><span class="tuto-reward-icon">💵</span><div><div class="tuto-reward-label">+${go} Dollars</div></div></div>` : ''); }
      }
      if (s.type === 'reward') {
        const chars = _pickTutorialChars();
        if (rewWrap && chars.length) {
          rewWrap.style.display = 'block';
          rewWrap.innerHTML = chars.map((def, i) => {
            const rd = CWGameDatabase.RARITIES[def.rarity] || {};
            return `<div class="tuto-reward-card" style="animation-delay:${i*.1}s">
              <span class="tuto-reward-icon">${def.portrait ? `<img src="${def.portrait}" style="width:38px;height:38px;border-radius:50%;object-fit:cover">` : '🎭'}</span>
              <div><div class="tuto-reward-label" style="color:${rd.color||'#e2d9f3'}">${def.name}</div><div class="tuto-reward-sub">${rd.name||def.rarity}</div></div></div>`;
          }).join('');
        }
      }
      if (nextBtn) nextBtn.textContent = idx === steps.length - 1 ? 'Commencer !' : 'Continuer ›';
      renderProgress();
      waitingForClic = true;

      // Mesurer la hauteur de .tuto-box et mettre à jour la variable CSS
      requestAnimationFrame(() => {
        const box = document.querySelector('.tuto-box');
        const overlay = document.getElementById('tutorial-overlay');
        if (box && overlay) {
          const h = box.getBoundingClientRect().height;
          overlay.style.setProperty('--tuto-box-h', h + 'px');
        }
      });
    };

    const goNext = (idx) => {
      const next = idx + 1;
      if (next >= steps.length) { endTutorial(); return; }
      stepIdx = next;
      const box = document.querySelector('.tuto-box');
      if (box) { box.style.opacity = '0'; box.style.transform = 'translateY(10px)'; }
      setTimeout(() => {
        showStep(next);
        if (box) { box.style.transition = 'opacity 250ms,transform 250ms'; box.style.opacity = '1'; box.style.transform = ''; setTimeout(() => { box.style.transition = ''; }, 300); }
      }, 180);
    };

    const endTutorial = () => {
      CWGameState.updatePlayer({ tutorialDone: true });
      overlay.style.transition = 'opacity 350ms';
      overlay.style.opacity    = '0';
      setTimeout(() => { overlay.style.display = 'none'; overlay.style.opacity = ''; _updateHUD(); _showToast('Bienvenue dans le Nexus Glamour !', 'success'); onComplete?.(); }, 350);
    };

    // UN seul listener sur nextBtn pour tout le tutoriel
    const onNextClick = () => {
      if (!waitingForClic) return;
      waitingForClic = false;

      if (pendingCombatDone) {
        // Fin du combat : aller à l'étape suivante
        const cb = pendingCombatDone;
        pendingCombatDone = null;
        cb();
      } else {
        const s = steps[stepIdx];
        if (s.type === 'name') { const n = (nameInput?.value||'').trim(); if(n) CWGameState.updatePlayer({name:n}); goNext(stepIdx); }
        else if (s.type === 'currency') { CWGameState.modifyResources({crystals:s.crystals??500,gold:s.gold??500}); _updateHUD(); goNext(stepIdx); }
        else if (s.type === 'reward')   { _grantTutorialChars(); goNext(stepIdx); }
        else if (s.type === 'combat')   { launchTutorialCombat(s, stepIdx); }
        else goNext(stepIdx);
      }
    };

    nextBtn?.addEventListener('click', onNextClick);

    const launchTutorialCombat = (s, idx) => {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none'; overlay.style.opacity = '';
        showScreen('combat');
        const battleArea = document.getElementById('battle-area');
        const lobby      = document.querySelector('.combat-lobby');
        if (!battleArea || !lobby) { _showToast('Erreur : écran combat introuvable.', 'error'); return; }
        _battle = CWCombatEngine.start(_onBattleEvent, { mode: 'tutorial' });
        if (!_battle) { _showToast('Impossible de lancer le combat du tutoriel.', 'error'); return; }
        _combatInProgress = true;
        lobby.style.display      = 'none';
        battleArea.style.display = 'block';
        CWAudioSystem.playCombat?.();
        _renderBattle();
        const preTxt = s.preCombatText || 'Voici votre premier combat !';
        setTimeout(() => _showTutoCombatDialogue(preTxt, tpl, () => {}), 400);
        // Le callback sera appelé par _onBattleEvent
        _tutorialCombatEndCb = (evt) => {
          _combatInProgress = false;
          const ba = document.getElementById('battle-area');
          if (ba) ba.style.display = 'none';
          overlay.style.display = 'flex';
          overlay.style.opacity = '0'; overlay.style.transition = 'opacity 300ms';
          requestAnimationFrame(() => { overlay.style.opacity = '1'; });
          setTimeout(() => { overlay.style.transition = ''; }, 320);
          if (titleEl)  titleEl.textContent = evt === 'victory' ? '✨ Bravo !' : 'Courage !';
          if (textEl)   textEl.textContent  = sub(s.postCombatText || '');
          if (nameWrap) nameWrap.style.display = 'none';
          if (rewWrap)  rewWrap.style.display  = 'none';
          if (nextBtn)  nextBtn.textContent = 'Continuer ›';
          renderProgress();
          // Quand le joueur cliquera "Continuer", pendingCombatDone appellera goNext
          pendingCombatDone = () => goNext(idx);
          waitingForClic = true;
        };
      }, 300);
    };

    showStep(0);
  }

  /**
   * Affiche un overlay de dialogue par-dessus le combat, bloquant les interactions
   * jusqu'à ce que le joueur clique "Continuer".
   */
  function _showTutoCombatDialogue(text, tpl, onClose) {
    const existing = document.getElementById('tuto-combat-dialogue');
    existing?.remove();

    const dlg = document.createElement('div');
    dlg.id = 'tuto-combat-dialogue';
    dlg.style.cssText = `
      position:absolute; inset:0; z-index:3000;
      background:rgba(5,2,14,.75); backdrop-filter:blur(2px);
      display:flex; align-items:flex-end; justify-content:center;
      pointer-events:all;
    `;

    const narratorName    = tpl?.narratorName    || 'La Directrice';
    const narratorPortrait= tpl?.narratorPortrait|| '';

    dlg.innerHTML = `
      ${narratorPortrait ? `<img src="${narratorPortrait}" alt="${narratorName}"
        style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);
               height:100%;max-width:60%;object-fit:contain;object-position:bottom;
               pointer-events:none;z-index:0;
               mask-image:linear-gradient(to top,rgba(0,0,0,1) 40%,rgba(0,0,0,.6) 70%,rgba(0,0,0,0) 100%);
               -webkit-mask-image:linear-gradient(to top,rgba(0,0,0,1) 40%,rgba(0,0,0,.6) 70%,rgba(0,0,0,0) 100%)">` : ''}
      <div style="position:relative;z-index:1;width:100%;
                  background:linear-gradient(180deg,rgba(10,5,24,.93),rgba(8,3,18,.98));
                  border-top:1px solid rgba(167,139,250,.25);padding:14px 18px 24px">
        <div style="font-family:var(--font-display);font-size:.75rem;font-weight:800;
                    color:rgba(167,139,250,.8);letter-spacing:.08em;text-transform:uppercase;
                    margin-bottom:6px">${narratorName}</div>
        <div style="font-size:.84rem;color:var(--text-dim);line-height:1.65;margin-bottom:14px">${text}</div>
        <div style="display:flex;justify-content:flex-end">
          <button id="tuto-combat-dlg-close" style="padding:10px 28px;
            background:linear-gradient(135deg,rgba(124,58,237,.5),rgba(167,139,250,.35));
            border:1.5px solid rgba(167,139,250,.5);border-radius:999px;
            color:#e2d9f3;font-family:var(--font-display);font-size:.85rem;font-weight:800;
            letter-spacing:.05em;cursor:pointer">Au combat ! ›</button>
        </div>
      </div>`;

    const shell = document.querySelector('.app-shell') || document.body;
    shell.appendChild(dlg);

    document.getElementById('tuto-combat-dlg-close')?.addEventListener('click', () => {
      dlg.style.opacity = '0';
      dlg.style.transition = 'opacity 250ms';
      setTimeout(() => { dlg.remove(); onClose?.(); }, 250);
    }, { once: true });
  }
  let _tutorialCharDefs = null;
  function _pickTutorialChars() {
    if (_tutorialCharDefs) return _tutorialCharDefs;
    const chars = CWGameState.get().characters.filter(c => c.evolutionStage === 0);
    const commons = chars.filter(c => c.rarity === 'common').sort(() => Math.random() - .5).slice(0, 2);
    const rares   = chars.filter(c => c.rarity === 'rare')  .sort(() => Math.random() - .5).slice(0, 1);
    _tutorialCharDefs = [...commons, ...rares];
    return _tutorialCharDefs;
  }

  function _grantTutorialChars() {
    const defs = _pickTutorialChars();
    defs.forEach(def => CWGameState.addCharacterToCollection?.(def.id, 'tutorial'));
    _tutorialCharDefs = null;

    // Intégrer immédiatement (synchrone) dans l'équipe
    const player  = CWGameState.getPlayer();
    const cfg     = CWGameState.getConfig();
    const maxTeam = cfg.game?.maxTeamSize || 3;
    const collection = player.collection || [];
    const instIds = collection
      .filter(inst => defs.some(d => d.id === inst.charId))
      .slice(-defs.length)
      .map(inst => inst.instanceId)
      .slice(0, maxTeam);
    if (instIds.length > 0) {
      CWGameState.setTeam(instIds);
    }
    setTimeout(() => renderCollection?.(), 100);
  }

  function _getTutorialDefaultSteps() {
    return [
      { type:'lore',     title:'Le Nexus Glamour',      text:"Une faille temporelle a brisé les frontières entre les époques. Des actrices, idoles et personnalités de tous les temps se retrouvent désormais dans le même espace : le Nexus Glamour." },
      { type:'name',     title:'Qui êtes-vous ?',        text:"Avant de commencer, comment souhaitez-vous être appelée ?" },
      { type:'currency', title:'Ressources de démarrage', text:"Pour vous lancer dans l'aventure, le Nexus vous offre quelques ressources.", crystals:500, gold:500 },
      { type:'reward',   title:'Vos premières actrices', text:"Trois actrices ont répondu à votre appel. Elles seront vos compagnes pour débuter cette aventure." },
      { type:'free',     title:"L'aventure commence",    text:"Le Nexus Glamour est vaste. Des dizaines d'actrices n'attendent que vous. Bonne chance, Directrice." },
    ];
  }

  /** Branche le bouton flottant de musique (présent une seule fois dans le DOM, jamais recréé) */
  function _bindMusicToggle() {
    const btn    = document.getElementById('music-toggle');
    const popup  = document.getElementById('volume-popup');
    const slider = document.getElementById('volume-slider');
    const valEl  = document.getElementById('volume-value');
    if (!btn) return;
    _updateMusicToggle();

    // Clic sur le bouton : mute/unmute + afficher/masquer la popup volume
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      CWAudioSystem.toggleMute();
      _updateMusicToggle();
      if (popup) popup.classList.toggle('open');
    });

    // Slider de volume
    if (slider) {
      slider.addEventListener('input', () => {
        const vol = parseInt(slider.value) / 100;
        CWAudioSystem.setVolume(vol);
        if (valEl) valEl.textContent = `${slider.value}%`;
        // Si on monte le volume et qu'on était muet, réactiver
        if (vol > 0 && CWAudioSystem.isMuted()) {
          CWAudioSystem.toggleMute();
          _updateMusicToggle();
        }
      });
    }

    // Fermer la popup si on clique ailleurs
    document.addEventListener('click', (e) => {
      if (popup && popup.classList.contains('open') && !popup.contains(e.target) && e.target !== btn) {
        popup.classList.remove('open');
      }
    });
  }

  /** Met à jour l'icône et l'état visuel du bouton musique selon l'état coupé/actif */
  function _updateMusicToggle() {
    const btn = document.getElementById('music-toggle');
    if (!btn) return;
    const muted = CWAudioSystem.isMuted();
    btn.textContent = muted ? '🔇' : '🔊';
    btn.classList.toggle('is-on', !muted);
  }

  function _onStateChange(event, data) {
    if (event === 'configChanged') {
      _refreshAllScreenBackgrounds();
    }

    // ── Évolution : l'affichage est entièrement géré par les appelants (combat,
    // utilisation d'objet) via _showEvolutionShowcase, qui passe par la file
    // d'animations commune. On ne déclenche plus rien ici directement, pour
    // éviter un double affichage et toute superposition.
    if (event === 'evolved') {
      return;
    }

    // ── Montée de niveau du JOUEUR : grosse animation plein écran, mise en file
    // pour ne jamais se superposer à une autre animation (évolution, etc.) ──────
    if (event === 'playerLevelUp') {
      _enqueueAnimation(() => new Promise(resolve => _showPlayerLevelUpShowcase(data, resolve)));
    }

    _updateHUD();
    if (_currentScreen === 'collection') renderCollection();
    if (_currentScreen === 'team') renderTeam();
    if (_currentScreen === 'catalogue') renderCatalogue();
    if (_currentScreen === 'quests' && (event === 'questProgress' || event === 'questClaimed' || event === 'dailyQuestsRefreshed')) {
      renderQuests();
    }
  }

  // ─── FILE D'ANIMATIONS PLEIN ÉCRAN (séquencées) ──────────────────────────────
  // Toute "grosse" animation plein écran (évolution, montée de niveau joueur, et
  // toute autre à venir) passe par cette file commune : elles se jouent une par
  // une, jamais simultanément, même si plusieurs évènements arrivent au même
  // moment (ex: un combat qui fait évoluer 2 créatures ET monter le joueur de
  // niveau au même instant).

  let _animQueue = [];
  let _animBusy  = false;

  // ── Queue spécifique aux animations de combat ──────────────────────────────
  // Distincte de la queue principale pour ne pas bloquer les popups de niveau/évolution.
  // Chaque animation de combat appelle _combatAnimDone() quand elle est terminée.
  let _combatAnimQueue = [];
  let _combatAnimBusy  = false;

  function _queueCombatAnim(fn) {
    _combatAnimQueue.push(fn);
    _drainCombatAnimQueue();
  }
  function _drainCombatAnimQueue() {
    if (_combatAnimBusy || _combatAnimQueue.length === 0) return;
    _combatAnimBusy = true;
    _combatAnimQueue.shift()();
  }
  function _combatAnimDone() {
    _combatAnimBusy = false;
    _drainCombatAnimQueue();
  }
  function _resetCombatAnimQueue() {
    _combatAnimQueue = [];
    _combatAnimBusy = false;
    // Débloquer les boutons si besoin
    document.querySelectorAll('.btn-target').forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }

  /**
   * Ajoute une animation plein écran à la file d'attente commune.
   * @param {Function} taskFn - () => Promise<void> ; doit se résoudre une fois
   *   l'animation entièrement fermée (clic ou délai automatique).
   */
  function _enqueueAnimation(taskFn) {
    _animQueue.push(taskFn);
    _runAnimQueue();
  }

  function _runAnimQueue() {
    if (_animBusy || _animQueue.length === 0) return;
    _animBusy = true;
    const taskFn = _animQueue.shift();
    Promise.resolve(taskFn()).then(() => {
      _animBusy = false;
      _runAnimQueue();
    });
  }

  // ─── FONDS D'ÉCRAN PERSONNALISÉS ─────────────────────────────────────────────
  // Une image hébergée (URL) par écran, définie depuis l'admin (config.backgrounds).
  // Appliquée en fond de l'écran concerné avec un léger voile sombre pour
  // conserver la lisibilité du contenu par-dessus.

  function _screenElForBg(screenId) {
    if (screenId === 'hub') return document.getElementById('screen-hub');
    if (screenId === 'combat-select') return document.getElementById('screen-combat-select');
    return document.getElementById(`screen-${screenId}`);
  }

  function _applyScreenBackground(screenId) {
    const el = _screenElForBg(screenId);
    if (!el) return;
    const bgCfg = CWGameState.get().config.backgrounds || {};
    const url = bgCfg[screenId];
    if (url) {
      el.style.backgroundImage = `linear-gradient(180deg, rgba(9,4,15,.6), rgba(9,4,15,.8)), url("${url}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.backgroundRepeat = 'no-repeat';
    } else {
      el.style.backgroundImage = '';
      el.style.backgroundSize = '';
      el.style.backgroundPosition = '';
      el.style.backgroundRepeat = '';
    }
  }

  /** Réapplique le fond d'écran courant (et celui de la sélection combat) — utilisé après une modification en admin */
  function _refreshAllScreenBackgrounds() {
    const bgCfg = CWGameState.get().config.backgrounds || {};
    Object.keys(bgCfg).forEach(screenId => _applyScreenBackground(screenId));
  }

  // ─── NAVIGATION ──────────────────────────────────────────────────────────────

  /** Vrai si un combat est en cours (hors écran de résultat victoire/défaite) */
  function _isBattleActive() {
    return !!_battle && _battle.phase !== 'end';
  }

  function _renderNav() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;
    nav.className = 'app-nav-new';
    nav.innerHTML = `
      <div class="nav-new-btn active" data-screen="hub">
        <span class="nav-ico">🏢</span><span class="nav-lbl">BUREAU</span>
      </div>
      <div class="nav-new-btn" data-screen="collection">
        <span class="nav-ico">✨</span><span class="nav-lbl">COLLECTION</span>
      </div>
      <div class="nav-new-btn" data-screen="team-hub">
        <span class="nav-ico">👥</span><span class="nav-lbl">ÉQUIPE</span>
      </div>
      <div class="nav-combat-btn" id="nav-combat-btn">
        <span class="nav-badge" id="nav-combat-badge" style="display:none">!</span>
        <span class="nav-ico">⚔️</span>
        <span class="nav-lbl">COMBAT</span>
      </div>
      <div class="nav-new-btn" id="nav-gacha-btn" data-screen="affinity">
        <span class="nav-ico">💞</span><span class="nav-lbl">AFFINITÉS</span>
      </div>
      <div class="nav-new-btn" id="nav-shop-btn" data-screen="shop">
        <span class="nav-ico">🛍️</span><span class="nav-lbl">SHOP</span>
      </div>
      <div class="nav-new-btn" id="nav-plus-btn">
        <span class="nav-ico">≡</span><span class="nav-lbl">PLUS</span>
      </div>
    `;

    // Bouton Affinités — remplace le Contrat (Gacha), même condition de déblocage
    const gachaBtn = document.getElementById('nav-gacha-btn');
    const gachaUnlocked = CWGameState.isFeatureUnlocked?.('gacha') ?? true;
    if (!gachaUnlocked && gachaBtn) {
      gachaBtn.style.opacity = '.45';
      gachaBtn.title = 'Disponible au Chapitre 2, Stage 5';
    }
    gachaBtn?.addEventListener('click', () => {
      if (!CWGameState.isFeatureUnlocked?.('gacha')) {
        _showToast('🔒 Affinités disponibles au Chapitre 2, Stage 5', 'info');
        return;
      }
      showScreen('affinity');
      _setNavActive('affinity');
    });

    // Afficher/masquer le badge verrou sur la zone gacha du hub
    const lockBadge = document.getElementById('hub-gacha-lock');
    if (lockBadge) lockBadge.style.display = gachaUnlocked ? 'none' : 'flex';

    // Bouton Shop — verrouillé selon la même condition que le Gacha
    const shopBtn = document.getElementById('nav-shop-btn');
    const shopUnlocked = CWGameState.isFeatureUnlocked?.('shop') ?? true;
    if (!shopUnlocked && shopBtn) {
      shopBtn.style.opacity = '.45';
      shopBtn.title = 'Disponible au Chapitre 2, Stage 5';
    }

    // Hub zones
    document.querySelectorAll('.hub-zone').forEach(z => {
      z.addEventListener('click', () => {
        const t = z.dataset.target;
        if (t === 'gacha' && !CWGameState.isFeatureUnlocked?.('gacha')) {
          _showToast('🔒 Le Gacha se déverrouille au Chapitre 2, Stage 5', 'info');
          return;
        }
        showScreen(t);
      });
    });

    // Boutons nav
    nav.querySelectorAll('.nav-new-btn[data-screen]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.screen;
        if (s === 'hub')       { showScreen('hub');        _setNavActive('hub');        return; }
        if (s === 'collection'){ showScreen('collection'); _setNavActive('collection'); return; }
        if (s === 'team-hub')  { showScreen('team-hub');  _setNavActive('team-hub');  return; }
        if (s === 'shop') {
          if (!CWGameState.isFeatureUnlocked?.('shop')) {
            _showToast('🔒 Shop disponible au Chapitre 2, Stage 5', 'info');
            return;
          }
          showScreen('shop'); _setNavActive('shop'); return;
        }
      });
    });

    // Bouton combat
    document.getElementById('nav-combat-btn')?.addEventListener('click', _showCombatSelect);

    // Bouton Plus
    document.getElementById('nav-plus-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = document.getElementById('plus-menu');
      if (m) m.classList.toggle('open');
    });
    document.querySelectorAll('#plus-menu .plus-item').forEach(item => {
      item.addEventListener('click', () => {
        const t = item.dataset.target;
        document.getElementById('plus-menu')?.classList.remove('open');
        showScreen(t); _setNavActive(t);
      });
    });
    document.addEventListener('click', () => {
      document.getElementById('plus-menu')?.classList.remove('open');
    });

    // Bouton retour écran combat-select
    document.getElementById('cs-back-btn')?.addEventListener('click', () => {
      showScreen('hub');
    });
  }

  function _setNavActive(screenId) {
    document.querySelectorAll('.nav-new-btn').forEach(b => b.classList.remove('active'));
    const map = { hub:'hub', team:'team-hub', 'team-hub':'team-hub', shop:'shop' };
    const target = map[screenId];
    if (target) {
      document.querySelector(`.nav-new-btn[data-screen="${target}"]`)?.classList.add('active');
    }
  }

  function _showCombatSelect() {
    if (_isBattleActive()) return; // combat en cours : on ne peut pas revenir à la sélection
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-hub')?.classList.remove('active');
    const el = document.getElementById('screen-combat-select');
    if (!el) return;
    el.classList.add('active');
    _applyScreenBackground('combat-select');

    const state = CWGameState.get();
    const ev    = CWGameState.getActiveEvent();
    const cfg   = state.config?.combat?.costs || {};

    const modes = [
      // Retiré temporairement pour les tests : tous les autres modes de combat
      // (Histoire, Caprice, Tournée, Saga, Grand Gala, Performance...) — le
      // code reste intact, il suffit de les remettre dans ce tableau.
      { id:'defile',       icon:'💃', name:'Défilé',           desc:'Duel de popularité en 9 passages',                    featured:true, unlocked:true, lockedDesc:'' },
      { id:'casting',      icon:'🎬', name:'Grand Casting',    desc:'Recrute de nouvelles actrices par enchères',          featured:false, unlocked:true, lockedDesc:'' },
    ];

    const grid = document.getElementById('cs-grid');
    if (grid) grid.innerHTML = modes.map(m => {
      let cls = 'cs-card';
      if (m.featured)      cls += ' featured';
      if (m.eventFeatured) cls += ' event-featured';
      if (m.eventSub)      cls += ' event-sub';
      if (!m.unlocked)     cls += ' locked';
      if (m.unlocked)      cls += ' unlocked';
      return `<div class="${cls}" data-mode="${m.id}"
        style="${!m.unlocked ? 'opacity:.45;cursor:not-allowed' : ''}">
        <div class="cs-card-icon">${m.icon}${!m.unlocked ? ' 🔒' : ''}</div>
        <div class="cs-card-name">${m.name}</div>
        <div class="cs-card-desc">${m.unlocked ? m.desc : m.lockedDesc}</div>
      </div>`;
    }).join('');

    grid?.querySelectorAll('.cs-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        el.classList.remove('active');
        if (mode === 'storyMode') { showScreen('story-chapters'); return; }
        if (mode === 'story' || mode === 'byLine') { showScreen('combat'); return; }
        if (mode === 'record') { showScreen('record'); return; }
        if (mode === 'defile') { showScreen('defile-planning'); CWAudioSystem.playCombat(); return; }
        if (mode === 'casting') { showScreen('casting'); return; }
        showScreen('combat');
        setTimeout(() => _launchCombat({ mode: mode === 'fullRandom' ? 'fullRandom' : mode }), 100);
      });
    });
  }

  function _bindNav() {
    document.getElementById('main-nav')?.addEventListener('click', e => {
      const btn = e.target.closest('.nav-btn');
      if (btn) showScreen(btn.dataset.screen);
    });
  }

  function showScreen(screenId) {
    // Combat en cours : impossible de changer d'écran tant qu'il n'est pas terminé
    if (_isBattleActive() && screenId !== 'combat') {
      _showToast('Impossible de quitter le combat en cours !', 'error');
      return;
    }

    _currentScreen = screenId;

    // Restaurer la navigation (peut avoir été masquée par un combat précédent)
    const navEl = document.getElementById('main-nav');
    if (navEl) navEl.style.display = '';
    document.getElementById('plus-menu')?.classList.remove('open');

    // Masquer TOUS les écrans
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-hub')?.classList.remove('active');
    document.getElementById('screen-combat-select')?.classList.remove('active');

    if (screenId === 'hub') {
      document.getElementById('screen-hub')?.classList.add('active');
      _setNavActive('hub');
      _updateHUD();
      _applyScreenBackground('hub');
      return;
    }

    if (screenId === 'combat-select') {
      _showCombatSelect();
      return;
    }

    const el = document.getElementById(`screen-${screenId}`);
    if (el) el.classList.add('active');
    _applyScreenBackground(screenId);

    // Les écrans du Défilé gèrent eux-mêmes la musique de combat — ne jamais
    // la couper ici en relançant la musique globale par défaut.
    const DEFILE_SCREENS = ['defile-planning', 'defile-playback', 'defile-result', 'defile-rewards', 'casting'];
    if (!DEFILE_SCREENS.includes(screenId)) {
      CWAudioSystem.playGlobal();
    }

    const renderers = {
      collection:       renderCollection,
      team:             renderTeam,
      'team-hub':       renderTeamHub,
      combat:           renderCombatLobby,
      gacha:            renderGacha,
      equip:            renderEquip,
      inventory:        renderInventory,
      shop:             renderShop,
      quests:           renderQuests,
      catalogue:        renderCatalogue,
      'story-chapters': renderStoryChapters,
      'story-chapter':  () => renderStoryChapter(_storyCurrentChapter),
      leaderboard:      renderLeaderboard,
      record:           renderRecordHome,
      'record-rewards': renderRecordRewards,
      'defile-planning': renderDefilePlanning,
      'defile-playback': renderDefilePlayback,
      affinity: renderAffinity,
      casting: renderCasting,
      'defile-rewards': renderDefileRewards,
      'defile-result':   renderDefileResult,
    };
    renderers[screenId]?.();
    _setNavActive(screenId);
    _updateHUD();
  }

  // ─── HUD (RESSOURCES) ─────────────────────────────────────────────────────────

  function _updateHUD() {
    CWGameState.regenEnergy();
    const player = CWGameState.getPlayer();
    const cfg    = CWGameState.getConfig();
    const hud    = document.getElementById('hud');
    const infoBar = document.getElementById('player-info-bar');
    if (!hud) return;
    const energyPct = cfg.energy.enabled ? Math.round((player.energy.current / player.energy.max) * 100) : 100;

    if (infoBar) {
      const xpCurrent = Math.floor(player.experience || 0);
      const xpNeeded  = CWGameDatabase.xpForPlayerLevel(player.level + 1, cfg.playerLevel);
      const xpPct     = xpNeeded > 0 ? Math.min(100, Math.round((xpCurrent / xpNeeded) * 100)) : 0;
      infoBar.innerHTML = `
        <span class="player-info-name" title="${player.name}">${player.name}</span>
        <span class="player-info-level">Niv. ${player.level}</span>
        <div class="player-xp-bar-wrap" title="${xpCurrent} / ${xpNeeded} XP">
          <div class="player-xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
      `;
    }

    hud.innerHTML = `
      <div class="hud-item">
        <span class="hud-icon">💎</span>
        <span class="hud-val">${player.currency.crystals.toLocaleString()}</span>
      </div>
      <div class="hud-item">
        <span class="hud-icon">💵</span>
        <span class="hud-val">${(player.currency.gold || 0).toLocaleString()}</span>
      </div>
      <div class="hud-item" title="Désir">
        <span class="hud-icon">⚡</span>
        <span class="hud-val">${cfg.energy.enabled ? `${player.energy.current}/${player.energy.max}` : '∞'}</span>
        ${cfg.energy.enabled ? `<div class="hud-bar"><div class="hud-bar-fill" style="width:${energyPct}%"></div></div>` : ''}
      </div>
      <div class="hud-item">
        <span class="hud-icon">🏆</span>
        <span class="hud-val">${player.stats.totalVictories}V</span>
      </div>
    `;
    _updateNavDots();
  }

  function _updateNavDots() {
    const player = CWGameState.getPlayer();
    const state  = CWGameState.get();
    const dq = player.dailyQuestState || {};
    const hasClaimable = (dq.activeQuestIds || []).some(qid => {
      const def = (state.dailyQuests || []).find(q => q.id === qid);
      return def && (dq.progress?.[qid] || 0) >= def.target && !dq.claimed?.[qid];
    });
    const ev = player.event?.current;
    const hasEventQuest = ev?.active && (ev.questConfig?.quests || []).some((q, i) =>
      (ev.questProgress?.[i] || 0) >= q.target && !ev.questClaimed?.[i]
    );
    const badge = document.getElementById('nav-combat-badge');
    if (badge) badge.style.display = ev?.active ? 'block' : 'none';
  }

  function _startResourceTicker() {
    setInterval(_updateHUD, 15000);
  }

  // ─── MODE HISTOIRE ───────────────────────────────────────────────────────────

  const NARRATIVE_STAGES = [1, 5, 8, 10];

  const STAGE_NARRATIVE_LABELS = {
    1:  { icon: '🌅', label: 'Découverte'    },
    5:  { icon: '🌀', label: 'Questionnement' },
    8:  { icon: '⚡', label: 'Compréhension'  },
    10: { icon: '🏁', label: 'Résolution'     },
  };

  let _storyCurrentChapter = 0; // index du chapitre affiché

  function renderStoryChapters() {
    const el = document.getElementById('screen-story-chapters');
    if (!el) return;
    const state    = CWGameState.get();
    const chapters = state.config.storyMode?.chapters || [];

    el.innerHTML = `
      <div class="story-header-banner">
        <h2>📖 Mode Histoire</h2>
        <p>Suivez la trame narrative du Nexus Glamour</p>
      </div>
      <div class="story-chapters-grid">
        ${chapters.length ? chapters.map((ch, ci) => {
          const prog         = CWGameState.getStoryChapterProgress(ci);
          const completed    = prog.completedStages.length;
          const pct          = Math.round(completed / 10 * 100);
          const isCompleted  = completed >= 10;
          const isLocked     = ci > 0 && (CWGameState.getStoryChapterProgress(ci-1).completedStages.length < 10);
          const statusIcon   = isCompleted ? '✅' : isLocked ? '🔒' : '✨';
          return `
            <div class="story-chapter-card${isLocked?' locked':''}${isCompleted?' completed':''}"
                 data-chapter="${ci}" ${isLocked?'':'style="cursor:pointer"'}>
              <div class="story-chapter-card-header">
                <span class="story-chapter-num">Chapitre ${ci + 1}</span>
                <span class="story-chapter-status">${statusIcon}</span>
              </div>
              <div class="story-chapter-title">${ch.title || `Chapitre ${ci+1}`}</div>
              ${ch.difficultyNote ? `<div class="story-chapter-diff">${ch.difficultyNote}</div>` : ''}
              <div class="story-chapter-progress">
                <div class="story-chapter-bar">
                  <div class="story-chapter-bar-fill" style="width:${pct}%"></div>
                </div>
                <span class="story-chapter-progress-label">${completed}/10</span>
              </div>
            </div>`;
        }).join('') : '<p style="color:#888;padding:20px;text-align:center">Aucun chapitre configuré.<br><small>Ajoutez des chapitres dans l\'admin → 📖 Mode Histoire</small></p>'}
      </div>`;

    el.querySelectorAll('.story-chapter-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _storyCurrentChapter = parseInt(card.dataset.chapter);
        renderStoryChapter(_storyCurrentChapter);
        showScreen('story-chapter');
      });
    });
  }

  function renderStoryChapter(ci) {
    const el = document.getElementById('screen-story-chapter');
    if (!el) return;
    const state  = CWGameState.get();
    const ch     = state.config.storyMode?.chapters?.[ci];
    const prog   = CWGameState.getStoryChapterProgress(ci);
    const done   = prog.completedStages || [];
    const next   = (done.length === 0) ? 1 : Math.max(...done) + 1;

    const cells = Array.from({ length: 10 }, (_, i) => {
      const stage      = i + 1;
      const isNarr     = NARRATIVE_STAGES.includes(stage);
      const isDone     = done.includes(stage);
      const isActive   = stage === next || (isDone && stage <= next);
      const isLocked   = !isDone && stage > next;
      const nl         = STAGE_NARRATIVE_LABELS[stage];

      let cls = 'story-stage-cell';
      if (isDone)     cls += ' completed';
      if (isNarr)     cls += ' narrative';
      if (isActive && !isDone) cls += ' active';
      if (isLocked)   cls += ' locked';

      return `<div class="${cls}" data-stage="${stage}">
        ${isDone ? '<span class="story-stage-check">✓</span>' : ''}
        ${isNarr && !isDone ? `<span class="story-stage-icon">${nl.icon}</span>` : ''}
        <span class="story-stage-num">${stage}</span>
        ${isNarr ? `<span style="font-size:.55rem;color:#a78bfa;text-align:center;line-height:1.1">${nl.label}</span>` : ''}
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="story-chapter-detail-header">
        <button class="story-back-btn" id="story-back-chapters">‹</button>
        <span class="story-chapter-detail-title">${ch?.title || `Chapitre ${ci+1}`}</span>
      </div>
      ${ch?.synopsis ? `<p class="story-chapter-synopsis">${ch.synopsis}</p>` : ''}
      <div class="story-stages-grid">${cells}</div>`;

    document.getElementById('story-back-chapters')?.addEventListener('click', () => {
      renderStoryChapters();
      showScreen('story-chapters');
    });

    el.querySelectorAll('.story-stage-cell:not(.locked)').forEach(cell => {
      cell.addEventListener('click', () => {
        const stage = parseInt(cell.dataset.stage);
        _launchStoryStage(ci, stage, ch);
      });
    });
  }

  function _launchStoryStage(ci, stage, ch) {
    const isNarr = NARRATIVE_STAGES.includes(stage);
    const dlg    = ch?.dialogues?.[stage];

    if (isNarr && dlg?.text) {
      // Afficher le dialogue narratif avant le combat
      _showStoryDialogue(dlg, () => _startStoryBattle(ci, stage));
    } else {
      _startStoryBattle(ci, stage);
    }
  }

  function _showStoryDialogue(dlg, onDone) {
    const overlay  = document.getElementById('story-dialogue-overlay');
    const speaker  = document.getElementById('story-dlg-speaker');
    const textEl   = document.getElementById('story-dlg-text');
    const btn      = document.getElementById('story-dlg-btn');
    const charImg  = document.getElementById('story-dlg-char-img');
    if (!overlay) { onDone?.(); return; }

    if (speaker) speaker.textContent = dlg.speaker || 'La Directrice';
    if (textEl)  textEl.textContent  = dlg.text    || '';

    // Portrait si défini
    if (charImg) {
      if (dlg.portrait) {
        charImg.src           = dlg.portrait;
        charImg.style.display = 'block';
      } else {
        charImg.style.display = 'none';
      }
    }

    overlay.classList.add('open');

    // Texte secondaire : si text2, afficher en deux temps
    let phase = 1;
    const advance = () => {
      if (phase === 1 && dlg.text2) {
        if (textEl) textEl.textContent = dlg.text2;
        phase = 2;
      } else {
        overlay.classList.remove('open');
        btn?.removeEventListener('click', advance);
        onDone?.();
      }
    };

    btn?.removeEventListener('click', advance); // éviter accumulation
    btn?.addEventListener('click', advance);
  }

  function _startStoryBattle(ci, stage) {
    // Difficulté : +5% stats ennemies par stage
    const difficulty = 1 + (stage - 1) * 0.05;
    showScreen('combat');
    setTimeout(() => {
      _launchCombat({ mode: 'storyMode', storyChapter: ci, storyStage: stage, difficulty });
      // Après victoire : marquer le stage complété
      _storyPendingStage = { ci, stage };
    }, 100);
  }

  let _storyPendingStage = null;

  let _playerMenuOpen = false;
  let _tutorialCombatEndCb = null;
  let _combatInProgress    = false;
  let _storyPostDialogue   = null;

  // ─── ÉCRAN HUB ÉQUIPE ────────────────────────────────────────────────────────

  function renderTeamHub() {
    const el = document.getElementById('screen-team-hub');
    if (!el) return;
    const items = [
      { icon:'🎬', name:'Casting',           desc:"Compose ton équipe d'actrices pour partir au combat",                                    target:'team',  inactive:false },
      { icon:'💍', name:'Parures',            desc:'Équipe tes actrices avec les meilleures tenues et accessoires',                          target:'equip', inactive:false },
      { icon:'🧵', name:'Atelier de Couture', desc:'Fusionne des équipements pour en créer de plus puissants',                              target:null,    inactive:true  },
      { icon:'✒️', name:'Signature',          desc:'Fusionne des équipements Mythiques identiques pour les élever au rang absolu',          target:null,    inactive:true  },
    ];
    el.innerHTML = `<div class="team-hub-screen">
      <div class="team-hub-title">👥 Gestion de l'Équipe</div>
      <div class="team-hub-subtitle">Constitue ta troupe et habille-la pour la gloire</div>
      ${items.map(item => `
        <div class="team-hub-card${item.inactive?' inactive':''}" ${item.target?`data-target="${item.target}"`:''}>
          <div class="team-hub-card-icon">${item.icon}</div>
          <div class="team-hub-card-body">
            <div class="team-hub-card-name">${item.name}</div>
            <div class="team-hub-card-desc">${item.desc}</div>
          </div>
          ${item.inactive ? '<span class="team-hub-card-soon">Bientôt</span>' : '<span class="team-hub-card-arrow">›</span>'}
        </div>`).join('')}
    </div>`;
    el.querySelectorAll('.team-hub-card:not(.inactive)').forEach(card => {
      card.addEventListener('click', () => { const t = card.dataset.target; if (t) showScreen(t); });
    });
  }

  function _initPlayerMenu() {
    document.getElementById('player-avatar-btn')?.addEventListener('click', _openPlayerMenu);
    document.getElementById('pm-close-btn')?.addEventListener('click', _closePlayerMenu);
    document.getElementById('player-menu-backdrop')?.addEventListener('click', _closePlayerMenu);
    document.getElementById('pm-edit-name-btn')?.addEventListener('click', _editPlayerName);
    // Clic avatar large → aller sur l'onglet avatar
    document.getElementById('pm-avatar-wrap')?.addEventListener('click', () => _pmSwitchTab('avatar'));
    // Onglets
    document.querySelectorAll('.pm-tab').forEach(btn => {
      btn.addEventListener('click', () => _pmSwitchTab(btn.dataset.tab));
    });
  }

  function _pmSwitchTab(tabId) {
    document.querySelectorAll('.pm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.pm-tab-content').forEach(c => c.classList.toggle('active', c.id === `pm-tab-${tabId}`));
    if (tabId === 'avatar') _renderAvatarGrid();
  }

  function _openPlayerMenu() {
    _playerMenuOpen = true;
    document.getElementById('player-menu')?.classList.add('open');
    document.getElementById('player-menu-backdrop')?.classList.add('open');
    _renderPlayerMenu();
  }

  function _closePlayerMenu() {
    _playerMenuOpen = false;
    document.getElementById('player-menu')?.classList.remove('open');
    document.getElementById('player-menu-backdrop')?.classList.remove('open');
  }

  function _renderPlayerMenu() {
    const state  = CWGameState.get();
    const player = state.player;
    const stats  = player.stats || {};
    const cfg    = state.config;

    // Nom & niveau
    document.getElementById('pm-player-name').textContent = player.name || 'Joueuse';
    document.getElementById('pm-player-level').textContent = `Niveau ${player.level || 1}`;

    // Avatar
    _refreshAvatarDisplays();

    // ── Stats ────────────────────────────────────────────────────────────────
    const winRate = stats.totalBattles > 0
      ? Math.round((stats.totalVictories / stats.totalBattles) * 100) : 0;
    const ownedCount   = (player.collection || []).length;
    const galleryEntries = Object.keys(player.catalogue || {}).length;
    const catalogueTotal = (state.characters||[]).length; // toutes formes confondues, comme la Galerie
    const tourneeWorld    = player.story?.world    || 1;
    const tourneeSubLevel = player.story?.subLevel || 0;
    const tourneePerWorld = cfg.combat?.story?.subLevelsPerWorld || 25;

    // Bonus joueur total
    const bonusInfo = CWGameState.getPlayerStatBonus?.() || { bonus: 0, detail: [] };
    // Détail par clé de compteur, pour retrouver rapidement la progression de chacun
    const bonusByKey = {};
    (bonusInfo.detail || []).forEach(d => { bonusByKey[d.key] = d; });

    // Construit la barre de progression HTML vers le prochain palier de bonus de
    // stat, ET le nombre de points déjà gagnés grâce à CET item précis.
    const _progressBarHtml = (bonusKey) => {
      const d = bonusByKey[bonusKey];
      if (!d || !d.every) return '';
      const progress   = d.count % d.every;
      const pct        = Math.round((progress / d.every) * 100);
      const remaining  = d.every - progress;
      return `
        <div class="pm-stat-progress">
          <div class="pm-stat-progress-bar"><div class="pm-stat-progress-fill" style="width:${pct}%"></div></div>
          <div class="pm-stat-progress-label">${remaining} avant +1 aux stats — <strong>+${d.points}</strong> gagnés au total</div>
        </div>`;
    };

    // Carte dédiée au bonus par niveau joueur (jauge = XP vers le prochain niveau)
    const _levelBonusHtml = () => {
      const d = bonusByKey['playerLevel'];
      if (!d) return '';
      const pct = d.xpForNext ? Math.round((d.xpCurrent / d.xpForNext) * 100) : 0;
      return `
        <div class="pm-stat-progress">
          <div class="pm-stat-progress-bar"><div class="pm-stat-progress-fill" style="width:${pct}%"></div></div>
          <div class="pm-stat-progress-label">${d.xpRemaining.toLocaleString('fr-FR')} XP avant le niveau ${d.count + 1} — <strong>+${d.points}</strong> gagnés au total</div>
        </div>`;
    };

    const statCards = [
      // Carte bonus en pleine largeur en tête
      { label: '✨ Bonus stats (toutes)', value: `+${bonusInfo.bonus}`, highlight: true, full: true },
      { label: '👑 Niveau joueur',        value: `Niv. ${player.level || 1}`, highlight: true, progress: _levelBonusHtml() },
      { label: '🎭 Recrutées',            value: (stats.totalCaptures||0).toLocaleString('fr-FR'),    highlight: false, progress: _progressBarHtml('captures') },
      { label: '✨ Évolutions',           value: (stats.totalEvolutions||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('evolutions') },
      { label: '⭐ Sublimation',          value: (stats.totalAwakenings||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('awakenings') },
      { label: '🌸 Galerie',              value: `${galleryEntries} / ${catalogueTotal}`,             highlight: galleryEntries===catalogueTotal, progress: _progressBarHtml('galleryEntries') },
      { label: '💵 $ gagnés',             value: (stats.totalGoldEarned||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('goldEarned') },
      { label: '🎬 Réputation gagnée',    value: (stats.totalReputationEarned||0).toLocaleString('fr-FR'), highlight: false, progress: _progressBarHtml('reputationEarned') },
      { label: '💫 Aura totale',          value: (CWGameState.getPlayerAuraScoreTotal?.()||0).toLocaleString('fr-FR'), highlight: true, progress: _progressBarHtml('scoreTotal') },
      { label: '💃 Défilés',              value: (stats.totalDefiles||0).toLocaleString('fr-FR'), highlight: false },
      { label: '🏆 Défilés Remportés',    value: (stats.totalDefilesWon||0).toLocaleString('fr-FR'), highlight: false },
      { label: '🎬 Tournages Remportés',  value: (stats.totalPassagesWon||0).toLocaleString('fr-FR'), highlight: false },
      { label: '🌟 Popularité',           value: (stats.totalPopularity||0).toLocaleString('fr-FR'), highlight: true },
    ];
    const statsEl = document.getElementById('pm-stats-grid');
    if (statsEl) statsEl.innerHTML = statCards.map(s => `
      <div class="pm-stat-card${s.highlight?' highlight':''}${s.full?' pm-stat-full':''}">
        <div class="pm-stat-label">${s.label}</div>
        <div class="pm-stat-value">${s.value}</div>
        ${s.progress || ''}
      </div>`).join('');

    // ── Son ──────────────────────────────────────────────────────────────────
    const audioCfg = cfg.audio || {};
    const isMuted  = CWAudioSystem.isMuted?.() ?? false;
    const soundEl  = document.getElementById('pm-sound-controls');
    if (soundEl) soundEl.innerHTML = `
      <div class="pm-sound-row">
        <span class="pm-sound-label">🎵 Musique de fond</span>
        <button class="pm-toggle-btn${!isMuted?' active':''}" id="pm-btn-music" onclick="CWGameUI._pmToggleMusic()">
          ${!isMuted ? '🔊 Activée' : '🔇 Désactivée'}
        </button>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">Volume musique</span>
        <input type="range" class="pm-sound-slider" id="pm-vol-music" min="0" max="100"
          value="${Math.round((audioCfg.musicVolume ?? 0.7)*100)}"
          oninput="CWGameUI._pmSetMusicVol(this.value)">
        <span id="pm-vol-music-lbl" style="font-size:.72rem;color:#888;min-width:32px">${Math.round((audioCfg.musicVolume??0.7)*100)}%</span>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">🔔 Effets sonores</span>
        <button class="pm-toggle-btn${audioCfg.sfxEnabled!==false?' active':''}" id="pm-btn-sfx" onclick="CWGameUI._pmToggleSfx()">
          ${audioCfg.sfxEnabled!==false ? '🔊 Activés' : '🔇 Désactivés'}
        </button>
      </div>
      <div class="pm-sound-row">
        <span class="pm-sound-label">Volume effets</span>
        <input type="range" class="pm-sound-slider" id="pm-vol-sfx" min="0" max="100"
          value="${Math.round((audioCfg.sfxVolume ?? 0.8)*100)}"
          oninput="CWGameUI._pmSetSfxVol(this.value)">
        <span id="pm-vol-sfx-lbl" style="font-size:.72rem;color:#888;min-width:32px">${Math.round((audioCfg.sfxVolume??0.8)*100)}%</span>
      </div>
    `;

    // ── Préférences ───────────────────────────────────────────────────────────
    const prefsEl = document.getElementById('pm-prefs');
    if (prefsEl) prefsEl.innerHTML = `
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">🌙 Mode économie d'énergie</div>
          <div class="pm-pref-sub">Réduit les animations pour économiser la batterie</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-perf" ${player.prefs?.reducedMotion?'checked':''}
            onchange="CWGameUI._pmTogglePref('reducedMotion',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">⚡ Afficher les coûts d'énergie</div>
          <div class="pm-pref-sub">Montre le coût en énergie sur chaque bouton de combat</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-energy" ${player.prefs?.showEnergyCost!==false?'checked':''}
            onchange="CWGameUI._pmTogglePref('showEnergyCost',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
      <div class="pm-pref-row">
        <div>
          <div class="pm-pref-label">🔔 Notifications de quêtes</div>
          <div class="pm-pref-sub">Pastille rouge quand une quête est prête à réclamer</div>
        </div>
        <label class="pm-switch">
          <input type="checkbox" id="pm-pref-notif" ${player.prefs?.questNotifications!==false?'checked':''}
            onchange="CWGameUI._pmTogglePref('questNotifications',this.checked)">
          <span class="pm-switch-slider"></span>
        </label>
      </div>
    `;

    // ── Avatars disponibles ───────────────────────────────────────────────────
    _renderAvatarGrid();
  }

  function _refreshAvatarDisplays() {
    const player = CWGameState.getPlayer();
    const def    = player.avatarCharId ? CWGameState.getCharDef(player.avatarCharId) : null;

    const applyCombatCrop = (ringId, innerId) => {
      const ring = document.getElementById(ringId);
      if (!ring) return;
      if (def?.portrait) {
        const crop = def.combatCrop || CWGameDatabase.defaultCombatCrop();
        const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
        const w  = +(5000 / r).toFixed(2);
        const l  = +(50 - cx * 50 / r).toFixed(2);
        const t  = +(50 - cy * 50 / r).toFixed(2);
        ring.innerHTML = `<img src="${def.portrait}" alt="${def.name}"
          style="position:absolute;width:${w}%;height:${w}%;
                 left:${l}%;top:${t}%;max-width:none;max-height:none;
                 object-fit:cover;object-position:50% 0%;display:block">`;
      } else {
        ring.innerHTML = `<span class="${ringId==='player-avatar-ring'?'player-avatar-placeholder':'pm-avatar-inner'}" id="${innerId}">${def ? def.name.charAt(0) : '?'}</span>`;
      }
    };
    applyCombatCrop('player-avatar-ring', 'player-avatar-inner');
    applyCombatCrop('pm-avatar-large',    'pm-avatar-inner');
  }

  function _renderAvatarGrid() {
    const state   = CWGameState.get();
    const player  = state.player;
    const current = player.avatarCharId;
    const catalogue = player.catalogue || {};

    // Tous les personnages découverts dans la galerie (toutes évolutions),
    // triés comme le catalogue : par lignée puis par stade d'évolution
    const discovered = (state.characters || []).filter(def => catalogue[def.id]?.discovered);

    const el = document.getElementById('pm-avatar-grid');
    if (!el) return;
    if (!discovered.length) {
      el.innerHTML = '<p style="font-size:.78rem;color:#888;grid-column:1/-1;padding:12px 0">Invoque des personnages pour débloquer des avatars.</p>';
      return;
    }

    el.innerHTML = discovered.map(def => {
      const sel = def.id === current;
      let imgHtml;
      if (def.portrait) {
        const crop = def.combatCrop || CWGameDatabase.defaultCombatCrop();
        const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
        const w  = +(5000 / r).toFixed(2);
        const l  = +(50 - cx * 50 / r).toFixed(2);
        const t  = +(50 - cy * 50 / r).toFixed(2);
        imgHtml = `<img src="${def.portrait}" alt="${def.name}"
          style="position:absolute;width:${w}%;height:${w}%;
                 left:${l}%;top:${t}%;max-width:none;max-height:none;
                 object-fit:cover;object-position:50% 0%;display:block">`;
      } else {
        imgHtml = `<span class="pm-av-ph">${def.name.charAt(0)}</span>`;
      }
      return `<div class="pm-avatar-option${sel?' selected':''}"
                   onclick="CWGameUI._pmSelectAvatar('${def.id}')"
                   title="${def.name}">${imgHtml}</div>`;
    }).join('');
  }

  function _pmSelectAvatar(charId) {
    CWGameState.updatePlayer({ avatarCharId: charId });
    _refreshAvatarDisplays();
    _renderAvatarGrid();
  }

  function _editPlayerName() {
    const current = CWGameState.getPlayer().name || '';
    const input   = document.createElement('input');
    input.type    = 'text';
    input.value   = current;
    input.maxLength = 20;
    input.style.cssText = `
      font-family:var(--font-display); font-size:1.05rem; font-weight:800;
      background:rgba(167,139,250,.1); border:1px solid rgba(167,139,250,.4);
      border-radius:8px; padding:4px 10px; color:#e2d9f3;
      text-align:center; width:150px;
    `;
    const nameEl = document.getElementById('pm-player-name');
    if (!nameEl) return;
    nameEl.replaceWith(input);
    input.id = 'pm-player-name-input';
    input.focus(); input.select();
    const save = () => {
      const newName = input.value.trim() || current;
      CWGameState.updatePlayer({ name: newName });
      input.replaceWith(Object.assign(document.createElement('span'), {
        id: 'pm-player-name', className: 'pm-player-name', textContent: newName
      }));
      document.getElementById('pm-edit-name-btn')?.addEventListener('click', _editPlayerName);
    };
    input.addEventListener('blur', save);
    input.addEventListener('keydown', e => { if (e.key==='Enter') input.blur(); if (e.key==='Escape') { input.value=current; input.blur(); } });
  }

  function _pmToggleMusic() {
    CWAudioSystem.toggleMute?.();
    _renderPlayerMenu();
  }

  function _pmSetMusicVol(val) {
    const v = parseInt(val) / 100;
    CWAudioSystem.setMusicVolume?.(v);
    const lbl = document.getElementById('pm-vol-music-lbl');
    if (lbl) lbl.textContent = `${val}%`;
    const bgPlayer = document.getElementById('bg-audio-player');
    if (bgPlayer) bgPlayer.volume = v;
    CWGameState.updateConfig({ audio: { ...CWGameState.getConfig().audio, musicVolume: v } });
  }

  function _pmSetSfxVol(val) {
    const v = parseInt(val) / 100;
    CWAudioSystem.setSfxVolume?.(v);
    const lbl = document.getElementById('pm-vol-sfx-lbl');
    if (lbl) lbl.textContent = `${val}%`;
    CWGameState.updateConfig({ audio: { ...CWGameState.getConfig().audio, sfxVolume: v } });
  }

  function _pmToggleSfx() {
    const cfg = CWGameState.getConfig();
    const cur = cfg.audio?.sfxEnabled !== false;
    CWGameState.updateConfig({ audio: { ...cfg.audio, sfxEnabled: !cur } });
    _renderPlayerMenu();
  }

  function _pmTogglePref(key, value) {
    const player = CWGameState.getPlayer();
    CWGameState.updatePlayer({ prefs: { ...(player.prefs||{}), [key]: value } });
  }

  // ─── SYSTÈME DE BULLES D'AIDE CONTEXTUELLES ──────────────────────────────────

  const HELP_CONTENT = {
    collection: {
      title: '🎭 Ma Collection',
      text: `Toutes les actrices que tu as obtenues par invocations ou captures en combat.
Clique sur une carte pour voir sa fiche complète : stats, passif, affinités de types, historique.
Utilise les filtres et le tri en haut pour retrouver rapidement une actrice.
Les chiffres en surimpression indiquent le niveau d'Éveil (★) et le niveau actuel.`,
    },
    team: {
      title: '👥 Mon Casting',
      text: `Compose ton équipe de combat.<br>
Le casting est utilisé dans tous les modes sauf Caprice (équipe aléatoire) et Combat Event (actrices du Tag uniquement).<br>
L'ordre n'a pas d'importance — l'initiative dépend de la <b>Grace</b> de chaque actrice.<br><br>
<b>Conseil</b> : équilibre Endurance (tank), Charisme (dégâts) et Grace (vitesse d'action).`,
    },
    combat: {
      title: '⚔️ Modes de Combat',
      text: `<b>🌍 Tournée</b> — Progression par monde. Clé pour la montée en niveau.<br>
<b>🎬 Saga</b> — Affronte toute la lignée d'une actrice (toutes ses évolutions).<br>
<b>🎲 Caprice</b> — Équipe aléatoire tirée de ta collection.<br>
<b>🏛️ Arène</b> — Mode compétitif avec règles spéciales.<br>
<b>✨ Caprice de Star</b> — Équipe aléatoire, ennemies du Tag Event uniquement.<br>
<b>✨ Combat [Tag]</b> — Alliées ET ennemies du Tag Event uniquement. Récompenses bonifiées.`,
    },
    gacha: {
      title: '💎 Conquêtes — Invocations',
      text: `Dépense des Diamants pour rencontrer de nouvelles actrices.<br>
<b>×1</b> = 100 💎 &nbsp;|&nbsp; <b>×10</b> = 900 💎 (10% de réduction).<br><br>
<b>Pitié</b> : Rare garantie toutes les 10, Épique toutes les 50, Légendaire toutes les 100 invocations.<br><br>
La <b>Bannière Event</b> (si un Event est actif) propose uniquement des actrices du Tag avec des taux de rareté uniformes.`,
    },
    equip: {
      title: '💍 Parures — Équipements',
      text: `Équipe tes actrices avec 3 emplacements : <b>Arme</b>, <b>Armure</b> et <b>Accessoire</b>.<br>
Chaque parure booste Endurance, Charisme, Prestance et/ou Grace.<br>
Les parures mythiques ont les meilleurs bonus.<br><br>
Pour équiper : va dans <b>Ma Collection</b> → fiche d'une actrice → onglet Parures.`,
    },
    inventory: {
      title: '🎒 Inventaire',
      text: `Tes objets consommables et parures non équipées.<br><br>
<b>💊 Pilule de Prestige</b> — Permet à une actrice au niveau max de continuer à progresser (Éveil).<br>
<b>🧪 Nectar du Désir</b> — Restaure de l'Énergie immédiatement.<br><br>
Les objets s'utilisent depuis la fiche de l'actrice ou directement ici.`,
    },
    shop: {
      title: '🛍️ Shopping',
      text: `La boutique est organisée en 3 lignes :<br><br>
<b>Ligne 1 — Permanents</b> : Pilule de Prestige et Nectar du Désir, toujours disponibles.<br>
<b>Ligne 2 — Event</b> : Actrices du Tag Event en cours avec <b>-20%</b> (prix barré). Disponible uniquement pendant un Event.<br>
<b>Ligne 3 — Sélection du moment</b> : 9 articles renouvelés automatiquement chaque jour.`,
    },
    quests: {
      title: '📅 Escapades',
      text: `<b>✨ Missions Event</b> (bloc violet) — Quêtes liées au Tag Event. Remises à zéro à chaque nouvel Event. Récompenses en Diamants.<br><br>
<b>🗓️ Rituels Event</b> — Connexion quotidienne sur 10 jours. Le Jour 10 offre une actrice <b>Épique</b> du Tag !<br><br>
<b>📅 Rendez-vous du jour</b> — Quêtes quotidiennes classiques : vaincre, capturer, invoquer...`,
    },
    catalogue: {
      title: '📖 Catalogue',
      text: `Encyclopédie de toutes les actrices du jeu, découvertes ou non.<br>
Les silhouettes grises représentent des actrices non encore rencontrées.<br>
Une actrice est découverte quand tu l'as invoquée ou capturée au moins une fois.<br><br>
Le Catalogue affiche aussi les <b>lignées d'évolution</b> — une actrice peut évoluer en progressant en niveau.`,
    },
  };

  function _helpBtn(key) {
    return `<button class="help-btn" onclick="CWGameUI.showHelp('${key}')" aria-label="Aide">❓</button>`;
  }

  function showHelp(key) {
    document.getElementById('help-bubble')?.remove();
    const content = HELP_CONTENT[key];
    if (!content) return;

    const bubble = document.createElement('div');
    bubble.id = 'help-bubble';
    bubble.className = 'help-bubble';
    bubble.innerHTML = `
      <div class="help-bubble-header">
        <span class="help-bubble-title">${content.title}</span>
        <button class="help-bubble-close" onclick="document.getElementById('help-bubble')?.remove()" aria-label="Fermer">✕</button>
      </div>
      <div class="help-bubble-body">${content.text}</div>
    `;

    const shell = document.querySelector('.app-shell') || document.body;
    shell.appendChild(bubble);

    // Fermer en cliquant en dehors
    setTimeout(() => {
      const close = (e) => {
        if (!bubble.contains(e.target) && !e.target.classList.contains('help-btn')) {
          bubble.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }

  // ─── COLLECTION ───────────────────────────────────────────────────────────────

  function renderCollection() {
    const el = document.getElementById('screen-collection');
    if (!el) return;
    const player = CWGameState.getPlayer();
    const state  = CWGameState.get();

    el.innerHTML = `
      <div class="screen-header">
        <h2>Collection <span class="badge">${player.collection.length}</span></h2>
        ${_helpBtn('collection')}
      </div>
      <div class="screen-controls">
        ${_renderSortSelect('col-sort', _collectionSort)}
      </div>
      ${_renderCharFilterBar('col', _collectionFilters, state)}
      <div class="card-grid" id="collection-grid"></div>
    `;

    _refreshCollectionGrid();

    document.getElementById('col-sort')?.addEventListener('change', e => {
      _collectionSort = e.target.value;
      _refreshCollectionGrid();
    });
    _bindCharFilterBar('col', _collectionFilters, _refreshCollectionGrid);
  }

  function _refreshCollectionGrid() {
    const state  = CWGameState.get();
    const player = CWGameState.getPlayer();
    _renderCollectionGrid(_decorateFilterSortChars(player.collection, _collectionSort, _collectionFilters, state));
  }

  function _renderCollectionGrid(decorated) {
    const grid = document.getElementById('collection-grid');
    if (!grid) return;

    if (decorated.length === 0) {
      const hasAny = CWGameState.getPlayer().collection.length > 0;
      grid.innerHTML = `<p class="empty-msg">${hasAny ? 'Aucun personnage ne correspond aux filtres.' : 'Aucun personnage dans la collection.'}</p>`;
      return;
    }

    const state = CWGameState.get();
    const types = state.types;
    grid.innerHTML = decorated.map(({ inst, def, stats, aura }) => {
      const t1 = types.find(t => t.id === def.type1);
      const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
      const equipBonus = CWGameDatabase.computeEquipBonus(inst.equipment, state.player.equipInventory, state.equipment);
      return _buildCharCard(def, inst, stats, t1, t2, { equipBonus, aura });
    }).join('');

    grid.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => _openCharDetail(card.dataset.instanceId));
    });
  }

  function _buildCharCard(def, inst, stats, t1, t2, opts = {}) {
    const rarityDef = CWGameDatabase.RARITIES[def.rarity] || {};
    const maxAwk    = CWGameState.getConfig().awakening.maxLevel;
    const awakStars = '★'.repeat(inst.awakening || 0) + '☆'.repeat(Math.max(0, maxAwk - (inst.awakening || 0)));
    const xpNeeded  = CWGameDatabase.xpForLevel(inst.level + 1, CWGameState.getConfig().level);
    const xpPct     = Math.min(100, Math.round((inst.xp / xpNeeded) * 100));
    const inTeamClass = opts.inTeam ? 'in-team' : '';
    const awkMaxClass = (inst.awakening || 0) >= maxAwk ? 'awakening-max' : '';
    const eb = opts.equipBonus || { hp: 0, atk: 0, def: 0, spd: 0 };

    return `
    <div class="char-card rarity-${def.rarity} ${inTeamClass} ${awkMaxClass}" data-instance-id="${inst.instanceId}" ${opts.inTeam ? 'style="opacity:.6"' : ''}>
      <div class="card-portrait">
        ${_portraitImgHtml(def)}
        <div class="card-rarity-badge" style="background:${rarityDef.color || '#888'}">${rarityDef.name || def.rarity}</div>
        ${opts.aura != null ? `<div class="card-aura-badge">💫 ${opts.aura.toLocaleString('fr-FR')}</div>` : ''}
        ${opts.inTeam ? '<div class="in-team-badge">ÉQUIPE</div>' : ''}
      </div>
      <div class="card-info">
        <div class="card-name">${def.name}</div>
        <div class="card-level">Niv. <strong>${inst.level}</strong></div>
        <div class="card-types">
          ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
          ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
        </div>
        <div class="card-awakening">${awakStars}</div>
        <div class="xp-bar" title="XP ${inst.xp} / ${xpNeeded}">
          <div class="xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
        <div class="card-stats-mini">
          <span title="Endurance">💗 ${stats.hp}</span>
          <span title="Charisme">✨ ${stats.atk}</span>
          <span title="Prestance">🌹 ${stats.def}</span>
          <span title="Grace">🕊️ ${stats.spd}</span>
        </div>
      </div>
    </div>`;
  }

  // ─── DÉTAIL PERSONNAGE ────────────────────────────────────────────────────────

  /**
   * Calcule les affinités de type d'un personnage (ou combattant) contre TOUS
   * les types du jeu : multiplicateur de dégâts infligés (en tant qu'attaquant,
   * type1+type2 cumulés) et reçus (en tant que cible, type1+type2 cumulés).
   * Ne retient que les multiplicateurs ≠ 1 (neutre, non affiché).
   * @param {string} type1 @param {string|null} type2
   * @returns {{dealt:Array<{type,mult}>, received:Array<{type,mult}>}}
   */
  function _computeTypeAffinities(type1, type2) {
    const state  = CWGameState.get();
    const matrix = state.typeMatrix;
    const dealt = [], received = [];
    state.types.forEach(t => {
      const dealtMult    = CWGameDatabase.getBestTypeEffectiveness(type1, type2, t.id, null, matrix);
      const receivedMult = CWGameDatabase.getBestTypeEffectiveness(t.id, null, type1, type2, matrix);
      if (dealtMult !== 1)    dealt.push({ type: t, mult: dealtMult });
      if (receivedMult !== 1) received.push({ type: t, mult: receivedMult });
    });
    return { dealt, received };
  }

  /** Regroupe une liste d'affinités par valeur de multiplicateur, du plus fort au plus faible */
  function _groupAffinitiesByMult(list) {
    const groups = {};
    list.forEach(({ type, mult }) => {
      (groups[mult] = groups[mult] || []).push(type);
    });
    return Object.entries(groups)
      .map(([mult, types]) => ({ mult: parseFloat(mult), types }))
      .sort((a, b) => b.mult - a.mult);
  }

  /** Style + libellé associés à un multiplicateur d'affinité */
  function _affinityMeta(mult) {
    if (mult >= 4)    return { cls: 'affinity-super',  label: 'Très efficace' };
    if (mult >= 2)    return { cls: 'affinity-good',   label: 'Efficace' };
    if (mult === 0)   return { cls: 'affinity-immune', label: 'Immunité' };
    if (mult <= 0.25) return { cls: 'affinity-vbad',   label: 'Très peu efficace' };
    return { cls: 'affinity-bad', label: 'Peu efficace' };
  }

  /** Formate un multiplicateur pour l'affichage (×2, ×0.5, ×4, ×0.25...) */
  function _formatAffinityMult(m) {
    if (m % 1 === 0) return `×${m}`;
    return `×${m}`.replace('0.', ',');
  }

  /**
   * Construit la section "Affinités de type" (dégâts infligés / reçus) pour la
   * fiche détaillée d'un personnage, partagée entre Collection et Combat.
   * @param {string} type1 @param {string|null} type2
   */
  /** Version ultra-compacte des affinités (icônes seules, sans libellé) — pour les cartes étroites */
  function _buildCompactAffinitiesHtml(type1, type2) {
    const { dealt } = _computeTypeAffinities(type1, type2);
    if (dealt.length === 0) return '';
    const strong = dealt.filter(d => d.mult >= 2).map(d => d.type);
    const weak   = dealt.filter(d => d.mult <= 0.5).map(d => d.type);
    const badge = (t, cls) => `<span class="defile-affinity-dot ${cls}" style="background:${t.color}" title="${t.name}">${t.icon}</span>`;
    return `
      <div class="defile-compact-affinities">
        ${strong.length ? `<div class="defile-affinity-row"><span class="defile-affinity-sign good">✚</span>${strong.map(t => badge(t, 'good')).join('')}</div>` : ''}
        ${weak.length ? `<div class="defile-affinity-row"><span class="defile-affinity-sign bad">−</span>${weak.map(t => badge(t, 'bad')).join('')}</div>` : ''}
      </div>
    `;
  }

  function _buildTypeAffinitiesHtml(type1, type2) {
    const { dealt } = _computeTypeAffinities(type1, type2);
    if (dealt.length === 0) return '';

    const renderGroups = (groups) => groups.map(({ mult, types }) => {
      const meta = _affinityMeta(mult);
      return `
        <div class="affinity-row ${meta.cls}">
          <span class="affinity-mult">${_formatAffinityMult(mult)}</span>
          <span class="affinity-types">
            ${types.map(t => `<span class="type-badge-mini" style="background:${t.color}" title="${t.name}">${t.icon} ${t.name}</span>`).join('')}
          </span>
        </div>
      `;
    }).join('');

    return `
      <div class="detail-affinities">
        <div class="affinity-section">
          <div class="affinity-section-title">⚔️ Dégâts infligés</div>
          ${renderGroups(_groupAffinitiesByMult(dealt))}
        </div>
      </div>
    `;
  }

  function _openCharDetail(instanceId) {
    const inst  = CWGameState.getPlayerChar(instanceId);
    if (!inst) return;
    const def   = CWGameState.getCharDef(inst.charId);
    const state = CWGameState.get();
    const _fs   = _computeFullStats(inst, def);
    const stats  = _fs.total;

    const modal = document.getElementById('modal');
    if (!modal) return;

    const rarityDef = CWGameDatabase.RARITIES[def.rarity] || {};
    const types     = CWGameState.getTypes();
    const t1 = types.find(t => t.id === def.type1);
    const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
    const xpNeeded = CWGameDatabase.xpForLevel(inst.level + 1, state.config.level);
    const passives = CWGameState.getPassivesForCharacter(def);
    const auraScore = CWGameDatabase.computeAuraScore(_fs.total, state.config.combat);

    // Barres de progression de stats — plafonnées visuellement à 100%, mais le
    // chiffre affiché reste la vraie valeur même au-delà du plafond.
    const STAT_BAR_DEFS = [
      { key: 'hp',  icon: '💗', label: 'Endurance', cap: 20000, color: 'linear-gradient(90deg,#d4547e,#ec4899)' },
      { key: 'atk', icon: '✨', label: 'Charisme',  cap: 2500,  color: 'linear-gradient(90deg,#d4a574,#fbbf24)' },
      { key: 'def', icon: '🌹', label: 'Prestance', cap: 2500,  color: 'linear-gradient(90deg,#5b8ac2,#60a5fa)' },
      { key: 'spd', icon: '🕊️', label: 'Grace',     cap: 1000,  color: 'linear-gradient(90deg,#1fa090,#2dd4bf)' },
    ];
    const statBarsHtml = STAT_BAR_DEFS.map(s => {
      const value = stats[s.key];
      const pct = Math.max(0, Math.min(100, (value / s.cap) * 100));
      return `
        <div class="detail-stat-bar-row" onclick="CWGameUI._showStatDetail('${instanceId}','${s.key}',event)">
          <div class="detail-stat-bar-label-row">
            <span>${s.icon} ${s.label}</span>
            <strong>${value.toLocaleString('fr-FR')} <span class="stat-detail-hint">ℹ</span></strong>
          </div>
          <div class="detail-stat-bar-track">
            <div class="detail-stat-bar-fill" style="width:${pct}%;background:${s.color}"></div>
          </div>
        </div>`;
    }).join('');

    // Onglet Galerie : grille de cartes (une par forme d'évolution de la
    // lignée), plus raffinée que l'ancienne bande à flèches. Le stade actuel
    // du personnage est mis en valeur, les formes débloquées s'agrandissent
    // au clic, les non débloquées restent de simples cartes verrouillées.
    const lineChars = state.characters
      .filter(c => c.evolutionLine === def.evolutionLine)
      .sort((a, b) => a.evolutionStage - b.evolutionStage);
    const catalogue = state.player.catalogue;
    const galerieHtml = `
      <div class="char-gallery-grid">
        ${lineChars.map(char => {
          const entry = catalogue[char.id];
          const isCurrent = char.id === def.id;
          const unlocked  = !!entry;
          return `
          <div class="char-gallery-card ${unlocked ? 'is-unlocked' : ''}"
               ${unlocked && char.portrait ? `data-portrait="${char.portrait}" data-name="${char.name}"` : ''}>
            <div class="char-gallery-thumb ${isCurrent ? 'is-current' : ''}">
              ${unlocked && char.portrait
                ? `<img src="${char.portrait}" alt="${char.name}">`
                : unlocked
                  ? `<span style="font-family:'Playfair Display',serif;font-size:1.1rem;opacity:.4">${char.name.charAt(0)}</span>`
                  : `<span class="char-gallery-lock">🔒</span>`}
            </div>
            <div class="char-gallery-label ${unlocked ? 'is-unlocked' : 'is-locked'}">
              ${unlocked ? `Stade ${char.evolutionStage + 1}` : '???'}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box modal-char-detail">
          <div class="char-detail-layout">
            <div class="char-detail-portrait-col">
              <div class="char-detail-portrait ${(inst.awakening || 0) >= state.config.awakening.maxLevel ? 'awakening-max' : ''}">
                ${_detailPortraitImgHtml(def)}
                <div class="char-detail-rarity-ribbon" style="background:${rarityDef.color}">${rarityDef.name}</div>
              </div>
            </div>
            <div class="char-detail-right">
              <div class="char-detail-header">
                <button class="modal-close" id="modal-close">✕</button>
                <div class="char-detail-name-row">
                  <h3 class="char-detail-name">${def.name}</h3>
                </div>
                <div class="char-detail-name-underline"></div>
                <div class="char-detail-types">
                  ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                  ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                </div>
                <div class="char-detail-aura-row">
                  <span>Aura</span>
                  <strong>${auraScore.toLocaleString('fr-FR')}</strong>
                </div>
              </div>
              <div class="char-detail-tabs">
                <button class="char-detail-tab active" data-tab="stats">Stats</button>
                <button class="char-detail-tab" data-tab="parures">Parures</button>
                <button class="char-detail-tab" data-tab="galerie">Galerie</button>
                <button class="char-detail-tab" data-tab="historique">Historique</button>
              </div>

              <div class="char-detail-tab-panel active" data-panel="stats">
                <div class="detail-level">Niveau <strong>${inst.level}</strong> — XP : ${inst.xp} / ${xpNeeded}</div>
                <div class="detail-awakening" style="margin-bottom:12px;">Sublimation : ${'★'.repeat(inst.awakening || 0)}</div>
                ${statBarsHtml}
                ${passives.length > 0 ? `
                  <div class="detail-passives" style="margin-top:14px;">
                    ${passives.map(p => `
                      <div class="detail-passive-item">
                        <span class="detail-passive-name">✨ ${p.name}</span>
                        <span class="detail-passive-desc">${p.description}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
                ${_buildTypeAffinitiesHtml(def.type1, def.type2)}
              </div>

              <div class="char-detail-tab-panel" data-panel="parures">
                <div class="equip-slots">
                  ${EQUIP_SLOT_ORDER.map((slotKey, slot) => {
                    const invId = inst.equipment[slot];
                    const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
                    const eq = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
                    return `<div class="equip-slot" data-slot="${slot}" data-instance="${instanceId}">
                      ${eq ? `<strong>${eq.name}</strong><br><small>${_formatEquipBonuses(eq.bonuses)}</small>` : `<span class="empty-slot">Vide</span>`}
                    </div>`;
                  }).join('')}
                </div>
                ${def.evolvesTo ? `<div class="detail-evo" style="margin-top:12px;">Évolue au niveau <strong>${def.evolutionCondition?.value || '?'}</strong></div>` : ''}
              </div>

              <div class="char-detail-tab-panel" data-panel="galerie">
                ${galerieHtml}
              </div>

              <div class="char-detail-tab-panel" data-panel="historique">
                <div class="detail-char-history">
                  <div class="detail-history-row">
                    <span>📅 Obtenue le</span>
                    <strong>${inst.obtainedAt ? new Date(inst.obtainedAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' }) : '—'}</strong>
                  </div>
                  ${(() => {
                    const charBonus = CWGameState.getCharacterStatBonus(inst);
                    const byKey = {};
                    charBonus.detail.forEach(d => { byKey[d.key] = d; });
                    const gaugeRow = (icon, label, count, key) => {
                      const d = byKey[key];
                      const gauge = d ? `
                        <div class="pm-stat-progress">
                          <div class="pm-stat-progress-bar"><div class="pm-stat-progress-fill" style="width:${Math.round(((count % d.every) / d.every) * 100)}%"></div></div>
                          <div class="pm-stat-progress-label">${d.every - (count % d.every)} avant +1 (réparti sur Charisme/Prestance/Grâce) — <strong>+${d.points}</strong> gagnés</div>
                        </div>` : '';
                      return `
                        <div class="detail-history-row" style="flex-direction:column;align-items:stretch;gap:4px;">
                          <div style="display:flex;justify-content:space-between;">
                            <span>${icon} ${label}</span>
                            <strong>${count.toLocaleString('fr-FR')}</strong>
                          </div>
                          ${gauge}
                        </div>`;
                    };
                    return `
                      ${gaugeRow('🏆', 'Défilés gagnés', inst.defilesWon || 0, 'defilesWon')}
                      ${gaugeRow('🎬', 'Tournages Remportés', inst.passagesWon || 0, 'passagesWon')}
                      ${gaugeRow('🌟', 'Popularité', inst.popularityEarned || 0, 'popularityEarned')}
                      <div class="detail-history-row" style="border-top:1px solid rgba(255,255,255,.1);margin-top:4px;padding-top:8px;">
                        <span>✨ Bonus stats individuel (Charisme/Prestance/Grâce)</span>
                        <strong style="color:#a78bfa;">+${Math.round(charBonus.bonus/3)} chacune</strong>
                      </div>`;
                  })()}
                </div>

                <div class="detail-affection-section">
                  ${(() => {
                    const tier = CWGameState.getCharacterAffectionTier(inst);
                    const gifts = state.config.affection?.gifts || CWGameDatabase.DEFAULT_CONFIG.affection.gifts;
                    const pct = tier.nextThreshold != null
                      ? Math.round(((tier.points - tier.prevThreshold) / (tier.nextThreshold - tier.prevThreshold)) * 100)
                      : 100;
                    return `
                      <div class="detail-affection-header">
                        <span>💞 Affection — Niveau ${tier.level}</span>
                        <strong style="color:#f472b6;">+${tier.bonus} chacune (Charisme/Prestance/Grâce)</strong>
                      </div>
                      <div class="pm-stat-progress">
                        <div class="pm-stat-progress-bar"><div class="pm-stat-progress-fill" style="width:${pct}%;background:linear-gradient(90deg,#f472b6,#f9a8d4);"></div></div>
                        <div class="pm-stat-progress-label">
                          ${tier.nextThreshold != null
                            ? `${(tier.nextThreshold - tier.points).toLocaleString('fr-FR')} avant le Niveau ${tier.level + 1}`
                            : `Niveau maximum atteint pour l'instant`}
                        </div>
                      </div>
                      <div class="detail-affection-gifts">
                        ${gifts.map(g => `
                          <button class="btn-gift" data-gift="${g.id}" data-instance="${inst.instanceId}">
                            🎁 ${g.label}<br><span style="font-size:.68rem;color:var(--text-dim);">${g.cost.toLocaleString('fr-FR')} $ — +${g.affectionGiven} Affection</span>
                          </button>
                        `).join('')}
                      </div>`;
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
    modal.querySelectorAll('.char-detail-tab').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        modal.querySelectorAll('.char-detail-tab').forEach(b => b.classList.remove('active'));
        modal.querySelectorAll('.char-detail-tab-panel').forEach(p => p.classList.remove('active'));
        tabBtn.classList.add('active');
        modal.querySelector(`.char-detail-tab-panel[data-panel="${tabBtn.dataset.tab}"]`)?.classList.add('active');
      });
    });
    modal.querySelectorAll('.char-gallery-card.is-unlocked').forEach(card => {
      card.addEventListener('click', () => {
        if (card.dataset.portrait) _openImageLightbox(card.dataset.portrait, card.dataset.name);
      });
    });
    modal.querySelectorAll('.btn-gift').forEach(btn => {
      btn.addEventListener('click', () => {
        const result = CWGameState.giveGiftToCharacter(btn.dataset.instance, btn.dataset.gift);
        if (result?.error === 'insufficient') {
          _showToast('⚠️ Pas assez de $ pour ce cadeau.', 'error');
          return;
        }
        if (result?.gift) {
          _showToast(`🎁 ${result.gift.label} offert — +${result.gift.affectionGiven} Affection !`, 'success');
          _openCharDetail(inst.instanceId); // re-rendu pour voir la jauge mise à jour
        }
      });
    });
  }

  /** Affiche une image en plein écran, par-dessus la fiche personnage (galerie) */
  function _openImageLightbox(src, name) {
    const box = document.createElement('div');
    box.className = 'char-gallery-lightbox';
    box.innerHTML = `
      <button class="char-gallery-lightbox-close">✕</button>
      <img src="${src}" alt="${name || ''}">
    `;
    document.body.appendChild(box);
    const close = () => box.remove();
    box.querySelector('.char-gallery-lightbox-close').addEventListener('click', close);
    box.addEventListener('click', e => { if (e.target === box) close(); });
  }

  /**
   * Ouvre la fiche détaillée complète d'un combattant EN COMBAT (allié ou
   * ennemi) : mêmes informations que la fiche Collection (portrait, rareté,
   * types, passifs, affinités de type, stats), plus l'état propre au combat
   * (PV actuels, altérations en cours). L'équipement détaillé n'est pas
   * disponible ici (seul le total déjà appliqué aux stats l'est).
   * @param {string} instanceId
   */
  function _openCombatantDetail(instanceId) {
    const battle = CWCombatEngine.getBattle();
    if (!battle) return;
    const combatant = [...battle.playerTeam, ...battle.enemyTeam].find(c => c.instanceId === instanceId);
    if (!combatant) return;

    const modal = document.getElementById('modal');
    if (!modal) return;

    const state = CWGameState.get();
    const rarityDef = CWGameDatabase.RARITIES[combatant.rarity] || {};
    const types = state.types;
    const t1 = types.find(t => t.id === combatant.type1);
    const t2 = combatant.type2 ? types.find(t => t.id === combatant.type2) : null;
    const passives = _getCombatantAllPassives(combatant, state);
    const statusEntries = combatant.statusEffects || [];
    const auraScore = CWGameDatabase.computeAuraScore(
      { hp: combatant.maxHp, atk: combatant.atk, def: combatant.def, spd: combatant.spd },
      state.config.combat
    );

    const STATUS_LABELS = { poison: '☠ Empoisonné(e)', paralysis: '⚡ Paralysé(e)', charm: '💞 Charmé(e)' };

    // Mêmes barres que la fiche Collection, sauf les PV : ici on affiche les PV
    // ACTUELS restants (information vitale en plein combat), pas seulement le
    // total théorique — le reste (ATK/DEF/VIT) garde les mêmes plafonds.
    const STAT_BAR_DEFS = [
      { key: 'hp',  icon: '💗', label: 'Endurance', value: combatant.currentHp, cap: combatant.maxHp, text: `${combatant.currentHp} / ${combatant.maxHp}`, color: 'linear-gradient(90deg,#d4547e,#ec4899)' },
      { key: 'atk', icon: '✨', label: 'Charisme',  value: combatant.atk, cap: 2500, color: 'linear-gradient(90deg,#d4a574,#fbbf24)' },
      { key: 'def', icon: '🌹', label: 'Prestance', value: combatant.def, cap: 2500, color: 'linear-gradient(90deg,#5b8ac2,#60a5fa)' },
      { key: 'spd', icon: '🕊️', label: 'Grace',     value: combatant.spd, cap: 1000, color: 'linear-gradient(90deg,#1fa090,#2dd4bf)' },
    ];
    const statBarsHtml = STAT_BAR_DEFS.map(s => {
      const pct = Math.max(0, Math.min(100, (s.value / s.cap) * 100));
      return `
        <div class="detail-stat-bar-row" style="cursor:default;">
          <div class="detail-stat-bar-label-row">
            <span>${s.icon} ${s.label}</span>
            <strong>${s.text || s.value.toLocaleString('fr-FR')}</strong>
          </div>
          <div class="detail-stat-bar-track">
            <div class="detail-stat-bar-fill" style="width:${pct}%;background:${s.color}"></div>
          </div>
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box modal-char-detail">
          <div class="char-detail-layout">
            <div class="char-detail-portrait-col">
              <div class="char-detail-portrait ${(combatant.awakening || 0) >= state.config.awakening.maxLevel ? 'awakening-max' : ''} ${!combatant.alive ? 'defeated' : ''}">
                ${_detailPortraitImgHtml(CWGameState.getCharDef(combatant.charId) || combatant)}
                <div class="char-detail-rarity-ribbon" style="background:${rarityDef.color}">${rarityDef.name}</div>
              </div>
            </div>
            <div class="char-detail-right">
              <div class="char-detail-header">
                <button class="modal-close" id="modal-close">✕</button>
                <div class="char-detail-name-row">
                  <h3 class="char-detail-name">${combatant.name}</h3>
                  <span class="detail-side-tag ${combatant.isEnemy ? 'detail-side-enemy' : 'detail-side-ally'}">${combatant.isEnemy ? 'Ennemi' : 'Allié'}</span>
                </div>
                <div class="char-detail-name-underline"></div>
                <div class="char-detail-types">
                  ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                  ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                </div>
                <div class="char-detail-aura-row">
                  <span>Aura</span>
                  <strong>${auraScore.toLocaleString('fr-FR')}</strong>
                </div>
              </div>
              <div class="char-detail-tab-panel active" style="padding:14px;">
                <div class="detail-level">Niveau <strong>${combatant.level}</strong>${!combatant.alive ? ' — <strong style="color:var(--danger)">K.O.</strong>' : ''}</div>
                <div class="detail-awakening" style="margin-bottom:8px;">Sublimation : ${'★'.repeat(combatant.awakening || 0)}</div>
                ${statusEntries.length > 0 ? `
                  <div class="detail-status-effects" style="margin-bottom:10px;">
                    ${statusEntries.map(s => `<span class="status-badge-detail">${STATUS_LABELS[s.type] || s.type}</span>`).join('')}
                  </div>
                ` : ''}
                ${statBarsHtml}
                ${passives.length > 0 ? `
                  <div class="detail-passives" style="margin-top:14px;">
                    ${passives.map(p => `
                      <div class="detail-passive-item">
                        <span class="detail-passive-name">✨ ${p.name}</span>
                        <span class="detail-passive-desc">${p.description}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
                ${_buildTypeAffinitiesHtml(combatant.type1, combatant.type2)}
              </div>
            </div>
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  /** Renvoie tous les passifs actifs d'un combattant (natifs + acquis en combat, ex: Mystère) */
  function _getCombatantAllPassives(combatant, state) {
    const extra = (combatant.extraPassiveIds || []).map(id => state.passives.find(p => p.id === id)).filter(Boolean);
    return [...(combatant.passives || []), ...extra];
  }

  // ─── HELPERS DE RENDU DES PORTRAITS (avec recadrage et zoom) ─────────────────
  // Zoom correct : l'IMAGE grossit à l'intérieur d'un cadre fixe (overflow:hidden).
  // Le conteneur parent doit avoir position:relative + overflow:hidden.
  // Formule de positionnement : left = crop.x*(1-zoom)%, top = crop.y*(1-zoom)%
  // Ce calcul maintient le point focal à sa position dans le cadre quel que soit le zoom.

  function _cropImgHtml(src, name, crop) {
    if (!src) return null;
    const zoom = Math.max(1, Math.min(5, crop.zoom ?? 1));
    const x = crop.x ?? 50, y = crop.y ?? 20;
    return `<img src="${src}" alt="${name||''}"
      style="position:absolute;width:${zoom*100}%;height:${zoom*100}%;
             max-width:none;max-height:none;object-fit:cover;
             object-position:${x}% ${y}%;display:block;
             left:${(1-zoom)*x}%;top:${(1-zoom)*y}%">`;
  }

  function _combatCropImgHtml(src, name, crop) {
    if (!src) return null;
    const cx = crop.cx ?? 50, cy = crop.cy ?? 38, r = Math.max(1, crop.r ?? 38);
    // Formule géométrique : montre la même zone que le cercle de l'éditeur,
    // indépendante de la taille du conteneur (carré).
    // w = 5000/r %  |  l = 50 - cx*50/r %  |  t = 50 - cy*50/r %
    const w = +(5000 / r).toFixed(2);
    const l = +(50 - cx * 50 / r).toFixed(2);
    const t = +(50 - cy * 50 / r).toFixed(2);
    return `<img src="${src}" alt="${name||''}"
      style="position:absolute;
             width:${w}%;height:${w}%;
             left:${l}%;top:${t}%;
             max-width:none;max-height:none;
             object-fit:cover;object-position:50% 0%;
             display:block">`;
  }

  /** Portrait de la vignette Collection (petit carré). */
  function _portraitImgHtml(def) {
    const crop = def?.portraitCrop || CWGameDatabase.defaultPortraitCrop();
    return _cropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="card-portrait-placeholder">${(def?.name||'?').charAt(0)}</div>`;
  }

  /** Portrait de la fiche personnage (grand rectangle vertical dans la modale). */
  function _detailPortraitImgHtml(def) {
    const crop = def?.detailCrop || CWGameDatabase.defaultDetailCrop();
    return _cropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="detail-portrait-placeholder">${(def?.name||'?').charAt(0)}</div>`;
  }

  /** Portrait de combat (petit cercle). */
  function _combatPortraitImgHtml(def) {
    const crop = def?.combatCrop || CWGameDatabase.defaultCombatCrop();
    return _combatCropImgHtml(def?.portrait, def?.name, crop)
      || `<div class="portrait-ph">${(def?.name||'?').charAt(0)}</div>`;
  }

  function _formatEquipBonuses(bonuses) {
    return Object.entries(bonuses)
      .filter(([,v]) => v !== 0)
      .map(([k,v]) => `${k.toUpperCase()}+${v}`)
      .join(' ');
  }

  /**
   * Formate une valeur de stat totale avec le delta apporté par l'équipement,
   * affiché en vert (+XX) si positif ou en rouge (-WW) si négatif. Sans delta,
   * retourne simplement la valeur.
   */
  function _formatStatWithBonus(total, bonus) {
    if (!bonus) return `${total}`;
    const cls  = bonus > 0 ? 'stat-bonus-pos' : 'stat-bonus-neg';
    const sign = bonus > 0 ? '+' : '';
    return `${total} <span class="${cls}">${sign}${bonus}</span>`;
  }

  /**
   * Calcule les stats complètes d'une instance avec TOUS les bonus :
   * base, croissance niveau, awakening, équipement, bonus joueur.
   * Retourne le détail par source pour l'affichage dans la fiche.
   */
  function _computeFullStats(inst, def) {
    const _zero = { hp:0, atk:0, def:0, spd:0 };
    try {
      const state  = CWGameState.get();
      const cfg    = state.config || {};
      const lc     = cfg.level   || {};
      const ac     = cfg.awakening || {};

      // Stats de base avec croissance de niveau
      const bs   = def?.baseStats || _zero;
      const grow = (base, stat) => {
        const rate = lc.statGrowthPerLevel?.[stat] || 0;
        return Math.floor(base * (1 + rate * ((inst.level || 1) - 1)));
      };
      const base = {
        hp:  grow(bs.hp  || 0, 'hp'),
        atk: grow(bs.atk || 0, 'atk'),
        def: grow(bs.def || 0, 'def'),
        spd: grow(bs.spd || 0, 'spd'),
      };

      // Bonus awakening
      const awk  = ac.bonusPerLevel?.[def?.rarity] || _zero;
      const awLv = inst?.awakening || 0;
      const awBonus = {
        hp:  Math.floor((base.hp  || 0) * ((awk.hp  || 0) / 100) * awLv),
        atk: Math.floor((base.atk || 0) * ((awk.atk || 0) / 100) * awLv),
        def: Math.floor((base.def || 0) * ((awk.def || 0) / 100) * awLv),
        spd: Math.floor((base.spd || 0) * ((awk.spd || 0) / 100) * awLv),
      };

      // Bonus équipement
      let eqBonus = _zero;
      try {
        eqBonus = CWGameDatabase.computeEquipBonus(
          inst?.equipment, state.player?.equipInventory, state.equipment
        ) || _zero;
      } catch (_) {}

      // Bonus joueur
      let playerBonusVal = 0;
      try {
        playerBonusVal = CWGameState.getPlayerStatBonus?.()?.bonus ?? 0;
      } catch (_) {}

      const total = {
        hp:  Math.min(999999, (base.hp  + awBonus.hp  + eqBonus.hp  + playerBonusVal)),
        atk: Math.min(99999,  (base.atk + awBonus.atk + eqBonus.atk + playerBonusVal)),
        def: Math.min(99999,  (base.def + awBonus.def + eqBonus.def + playerBonusVal)),
        spd: Math.min(99999,  (base.spd + awBonus.spd + eqBonus.spd + playerBonusVal)),
      };

      return { base, awBonus, eqBonus, playerBonus: playerBonusVal, total };
    } catch (e) {
      // Fallback absolu : stats brutes sans bonus
      const bs = def?.baseStats || _zero;
      return {
        base: { ...bs }, awBonus: { ..._zero }, eqBonus: { ..._zero }, playerBonus: 0,
        total: { hp: bs.hp||0, atk: bs.atk||0, def: bs.def||0, spd: bs.spd||0 },
      };
    }
  }

  function _showStatDetail(instanceId, statKey, event) {
    // Fermer un panel existant
    document.getElementById('stat-detail-panel')?.remove();

    const state   = CWGameState.get();
    const inst    = state.player.collection.find(c => c.instanceId === instanceId);
    const def     = inst ? CWGameState.getCharDef(inst.charId) : null;
    if (!inst || !def) return;

    const _fs = _computeFullStats(inst, def);
    const labels = { hp: '💗 Endurance', atk: '✨ Charisme', def: '🌹 Prestance', spd: '🕊️ Grace' };

    const base0         = def.baseStats[statKey];
    const baseWithLevel = _fs.base[statKey];
    const levelBonus    = baseWithLevel - base0;
    const awBonus       = _fs.awBonus[statKey];
    const eqBonus       = _fs.eqBonus[statKey];
    const pb            = _fs.playerBonus;
    const total         = _fs.total[statKey];

    const panel = document.createElement('div');
    panel.id    = 'stat-detail-panel';
    panel.className = 'stat-detail-panel';
    panel.innerHTML = `
      <div class="sdb-header">
        <span class="sdb-title">${labels[statKey]}</span>
        <button class="sdb-close" onclick="document.getElementById('stat-detail-panel')?.remove()">✕</button>
      </div>
      <div class="sdb-rows">
        <div class="sdb-row sdb-base">
          <span class="sdb-icon">📊</span>
          <span class="sdb-label">Stat de base (Niv.1)</span>
          <span class="sdb-value">${base0}</span>
        </div>
        ${levelBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">📈</span>
          <span class="sdb-label">Croissance (Niv.${inst.level})</span>
          <span class="sdb-value">+${levelBonus}</span>
        </div>` : ''}
        ${awBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">⭐</span>
          <span class="sdb-label">Sublimation ×${inst.awakening || 0}</span>
          <span class="sdb-value">+${awBonus}</span>
        </div>` : ''}
        ${eqBonus > 0 ? `<div class="sdb-row">
          <span class="sdb-icon">💍</span>
          <span class="sdb-label">Parures équipées</span>
          <span class="sdb-value">+${eqBonus}</span>
        </div>` : ''}
        ${pb > 0 ? `<div class="sdb-row sdb-player">
          <span class="sdb-icon">🌟</span>
          <span class="sdb-label">Bonus joueur</span>
          <span class="sdb-value">+${pb}</span>
        </div>` : ''}
        <div class="sdb-row sdb-total">
          <span class="sdb-icon">∑</span>
          <span class="sdb-label">Total</span>
          <span class="sdb-value">${total}</span>
        </div>
      </div>
    `;

    // Position : utiliser les coordonnées de l'élément cliqué
    const trigger = (event?.currentTarget) || (event?.target);
    const rect    = trigger?.getBoundingClientRect?.();
    const shell   = document.querySelector('.app-shell');
    const shellRect = shell?.getBoundingClientRect() || { left: 0, top: 0, right: window.innerWidth };

    panel.style.position = 'fixed';
    panel.style.zIndex   = '9999';
    const panelW = 250;
    let left = rect ? rect.left : window.innerWidth / 2 - panelW / 2;
    let top  = rect ? rect.bottom + 4 : window.innerHeight / 2;
    // Ne pas dépasser à droite
    if (left + panelW > shellRect.right - 8) left = shellRect.right - panelW - 8;
    if (left < shellRect.left + 8)           left = shellRect.left + 8;
    panel.style.left  = `${left}px`;
    panel.style.top   = `${top}px`;
    panel.style.width = `${panelW}px`;

    document.body.appendChild(panel);

    // Fermer en cliquant ailleurs
    setTimeout(() => {
      const close = e => {
        if (!panel.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }
  function _describeEquippedBy(equippedByInstanceId) {
    if (!equippedByInstanceId) return null;
    const holderInst = CWGameState.getPlayerChar(equippedByInstanceId);
    const holderDef  = holderInst ? CWGameState.getCharDef(holderInst.charId) : null;
    if (!holderDef) return null;
    return { name: holderDef.name, portrait: holderDef.portrait };
  }

  function _closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.style.display = 'none';
  }

  // ─── ÉQUIPE ───────────────────────────────────────────────────────────────────

  function renderTeam() {
    const el = document.getElementById('screen-team');
    if (!el) return;
    const player = CWGameState.getPlayer();
    const cfg    = CWGameState.getConfig();
    const state  = CWGameState.get();
    const types  = state.types;

    el.innerHTML = `
      <div class="screen-header"><h2>Mon Équipe <small>(${CWGameState.getTeam().length}/${cfg.game.maxTeamSize})</small></h2>${_helpBtn('team')}</div>
      <div class="team-slots" id="team-slots">
        ${Array.from({length: cfg.game.maxTeamSize}, (_, i) => {
          const member = player.team[i] ? player.collection.find(c => c.instanceId === player.team[i]) : null;
          const def    = member ? CWGameState.getCharDef(member.charId) : null;
          const _mfs   = (member && def) ? _computeFullStats(member, def) : null;
          const stats  = _mfs?.total || null;
          const eb     = { hp:0, atk:0, def:0, spd:0 };
          const t1 = def ? types.find(t => t.id === def.type1) : null;
          const t2 = def?.type2 ? types.find(t => t.id === def.type2) : null;
          const isAwkMax = member ? (member.awakening || 0) >= state.config.awakening.maxLevel : false;
          return `
          <div class="team-slot ${member ? 'filled' : 'empty'}" data-slot="${i}">
            ${member && def ? `
              <div class="team-member-card ${isAwkMax ? 'awakening-max' : ''}" data-instance-id="${member.instanceId}">
                <div class="team-portrait">
                  ${_portraitImgHtml(def)}
                </div>
                <div class="team-info">
                  <div class="team-name">${def.name}</div>
                  <div class="team-level">Niv. ${member.level}</div>
                  <div class="team-types">
                    ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                    ${t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                  </div>
                  <div class="team-stats-mini">
                    <span title="Endurance">💗 ${stats.hp}</span>
                    <span title="Charisme">✨ ${stats.atk}</span>
                    <span title="Prestance">🌹 ${stats.def}</span>
                    <span title="Grace">🕊️ ${stats.spd}</span>
                  </div>
                </div>
                <button class="btn-remove-team" data-instance-id="${member.instanceId}">✕</button>
              </div>` :
              `<div class="empty-slot-label">+ Ajouter</div>`}
          </div>`;
        }).join('')}
      </div>
      <div class="screen-header" style="margin-top:2rem">
        <h2>Collection</h2>
      </div>
      <div class="screen-controls">
        ${_renderSortSelect('team-sort', _teamSort)}
      </div>
      ${_renderCharFilterBar('team', _teamFilters, state)}
      <div class="card-grid" id="team-collection-grid"></div>
    `;

    _refreshTeamCollectionGrid();

    document.getElementById('team-sort')?.addEventListener('change', e => {
      _teamSort = e.target.value;
      _refreshTeamCollectionGrid();
    });
    _bindCharFilterBar('team', _teamFilters, _refreshTeamCollectionGrid);

    // Boutons retrait de l'équipe
    el.querySelectorAll('.btn-remove-team').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const iid = btn.dataset.instanceId;
        CWGameState.setTeam(CWGameState.getPlayer().team.filter(id => id !== iid));
      });
    });
  }

  /** Rafraîchit la grille de sélection de personnages dans l'écran Équipe (triée + filtrée) */
  function _refreshTeamCollectionGrid() {
    const state  = CWGameState.get();
    const player = CWGameState.getPlayer();
    const cfg    = state.config;
    const grid   = document.getElementById('team-collection-grid');
    if (!grid) return;

    const inTeam = new Set(player.team.filter(Boolean));
    const types  = state.types;
    const decorated = _decorateFilterSortChars(player.collection, _teamSort, _teamFilters, state);

    if (decorated.length === 0) {
      const hasAny = player.collection.length > 0;
      grid.innerHTML = `<p class="empty-msg">${hasAny ? 'Aucun personnage ne correspond aux filtres.' : 'Aucun personnage dans la collection.'}</p>`;
      return;
    }

    grid.innerHTML = decorated.map(({ inst, def, stats, aura }) => {
      const t1 = types.find(t => t.id === def.type1);
      const t2 = def.type2 ? types.find(t => t.id === def.type2) : null;
      const equipBonus = CWGameDatabase.computeEquipBonus(inst.equipment, player.equipInventory, state.equipment);
      return _buildCharCard(def, inst, stats, t1, t2, { inTeam: inTeam.has(inst.instanceId), equipBonus, aura });
    }).join('');

    grid.querySelectorAll('.char-card').forEach(card => {
      card.addEventListener('click', () => {
        const iid = card.dataset.instanceId;
        const currentTeam = CWGameState.getPlayer().team.filter(Boolean);
        if (inTeam.has(iid)) {
          CWGameState.setTeam(currentTeam.filter(id => id !== iid));
        } else if (currentTeam.length < cfg.game.maxTeamSize) {
          CWGameState.setTeam([...currentTeam, iid]);
        } else {
          _showToast(`Équipe pleine ! (max ${cfg.game.maxTeamSize})`);
        }
      });
    });
  }

  // ─── COMBAT ───────────────────────────────────────────────────────────────────

  function renderCombatLobby() {
    const el = document.getElementById('screen-combat');
    if (!el) return;
    const team  = CWGameState.getTeam();
    const costs = CWGameState.getConfig().energy.costs || {};
    const ev    = CWGameState.getActiveEvent();

    // Onglets de base
    let tabsHtml = `
      <button class="combat-mode-btn ${_combatMode === 'story' ? 'active' : ''}" data-mode="story">
        🌍 Tournée <span class="energy-cost-badge">⚡${costs.story ?? 10}</span>
      </button>
      <button class="combat-mode-btn ${_combatMode === 'line' ? 'active' : ''}" data-mode="line">
        🎬 Saga <span class="energy-cost-badge">⚡${costs.line ?? 20}</span>
      </button>
      <button class="combat-mode-btn ${_combatMode === 'fullRandom' ? 'active' : ''}" data-mode="fullRandom">
        🎲 Caprice <span class="energy-cost-badge">⚡${costs.fullRandom ?? 10}</span>
      </button>
      <button class="combat-mode-btn ${_combatMode === 'arena' ? 'active' : ''}" data-mode="arena">
        🏛️ Arène <span class="energy-cost-badge">⚡${costs.arena ?? 15}</span>
      </button>`;

    // Onglets event — mis en avant si un event est actif
    if (ev) {
      const tag = CWGameState.get().tags?.find(t => t.id === ev.tagId);
      const tagLabel = tag ? `${tag.icon || '✨'} ${tag.name}` : '✨ Event';
      const capCost  = ev.combatConfig?.capriceDeEtoile?.energyCost ?? 10;
      const tagCost  = ev.combatConfig?.combatTag?.energyCost ?? 15;
      tabsHtml += `
        <button class="combat-mode-btn combat-mode-event ${_combatMode === 'capriceEtoile' ? 'active' : ''}" data-mode="capriceEtoile">
          🌟 Caprice de Star <span class="energy-cost-badge">⚡${capCost}</span>
        </button>
        <button class="combat-mode-btn combat-mode-event ${_combatMode === 'fullEvent' ? 'active' : ''}" data-mode="fullEvent">
          ${tagLabel} <span class="energy-cost-badge">⚡${tagCost}</span>
        </button>`;
    } else if (_combatMode === 'capriceEtoile' || _combatMode === 'fullEvent') {
      _combatMode = 'story'; // reset si l'event est terminé
    }

    el.innerHTML = `
      <div class="screen-header"><h2>⚔ Combat</h2>${_helpBtn('combat')}</div>
      ${ev ? `<div class="event-combat-banner">✨ Event en cours — ${CWGameState.get().tags?.find(t=>t.id===ev.tagId)?.name || ev.tagId}</div>` : ''}
      <div class="combat-mode-tabs">${tabsHtml}</div>
      <div class="combat-lobby">
        <div id="combat-mode-content-top"></div>
        <div class="team-preview">
          <h3>Votre casting</h3>
          ${_combatMode === 'fullRandom' ? `<p class="combat-mode-note">🎲 Une équipe sera tirée au sort dans votre collection pour ce Caprice. Votre casting actuel sera restauré juste après.</p>` : ''}
          ${_combatMode === 'capriceEtoile' ? `<p class="combat-mode-note">🌟 Caprice de Star : équipe aléatoire contre des adversaires ${CWGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} uniquement.</p>` : ''}
          ${_combatMode === 'fullEvent' ? `<p class="combat-mode-note">✨ Combat ${CWGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} : alliées ET adversaires sont du tag ${CWGameState.get().tags?.find(t=>t.id===ev?.tagId)?.name || 'Event'} uniquement.</p>` : ''}
          <div class="lobby-team">
            ${team.length === 0
              ? '<p class="empty-msg">Composez votre casting dans l\'onglet Équipe.</p>'
              : team.map(inst => {
                  const def   = CWGameState.getCharDef(inst.charId);
                  const stats = _computeFullStats(inst, def).total;
                  return `<div class="lobby-member">
                    <div class="lobby-portrait">${def.portrait ? _portraitImgHtml(def) : def.name.charAt(0)}</div>
                    <div><strong>${def.name}</strong> Niv.${inst.level}</div>
                    <div style="font-size:0.75rem;color:#aaa">💗${stats.hp} ✨${stats.atk} 🌹${stats.def} 🕊️${stats.spd}</div>
                  </div>`;
                }).join('')}
          </div>
        </div>
        <div id="combat-mode-content"></div>
      </div>
      <div id="battle-area" style="display:none"></div>
    `;

    el.querySelectorAll('.combat-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_combatMode === btn.dataset.mode) return;
        _combatMode = btn.dataset.mode;
        _selectedLine = null;
        _selectedArenaType = null;
        renderCombatLobby();
      });
    });

    _renderCombatModeContent();
  }

  /** Affiche le contenu adapté au mode de combat sélectionné */
  function _renderCombatModeContent() {
    if (_combatMode === 'line') { renderCombatByLine(); return; }
    if (_combatMode === 'arena') { renderCombatArena(); return; }
    if (_combatMode === 'story') { renderCombatStory(); return; }

    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!top) return;

    if (_combatMode === 'fullRandom') {
      const player = CWGameState.getPlayer();
      top.innerHTML = player.collection.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch" style="width:100%;margin-bottom:8px">🎲 Lancer le Caprice</button>`
        : '';
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'fullRandom' }));
      return;
    }

    if (_combatMode === 'capriceEtoile') {
      const ev = CWGameState.getActiveEvent();
      top.innerHTML = ev
        ? `<button class="btn-primary btn-launch-combat btn-event-combat" id="btn-launch" style="width:100%;margin-bottom:8px">🌟 Lancer le Caprice de Star</button>`
        : `<p class="empty-msg">Aucun Event actif pour le moment.</p>`;
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'capriceEtoile' }));
      return;
    }

    if (_combatMode === 'fullEvent') {
      const ev = CWGameState.getActiveEvent();
      const state = CWGameState.get();
      const tag = state.tags?.find(t => t.id === ev?.tagId);
      const player = CWGameState.getPlayer();
      const tagChars = ev ? player.collection.filter(inst => {
        const def = CWGameState.getCharDef(inst.charId);
        return def?.tags?.includes(ev.tagId);
      }) : [];
      top.innerHTML = ev
        ? (tagChars.length > 0
          ? `<button class="btn-primary btn-launch-combat btn-event-combat" id="btn-launch" style="width:100%;margin-bottom:8px">✨ Lancer Combat ${tag?.name || 'Event'}</button>`
          : `<p class="empty-msg">Vous n'avez aucun personnage ${tag?.name || 'Event'} dans votre collection.</p>`)
        : `<p class="empty-msg">Aucun Event actif pour le moment.</p>`;
      if (content) content.innerHTML = '';
      document.getElementById('btn-launch')?.addEventListener('click', () => _launchCombat({ mode: 'fullEvent' }));
      return;
    }
  }

  /**
   * Affiche la sélection d'arène : le joueur choisit un type, et affronte 6 ennemis
   * partageant tous ce type (en principal ou secondaire).
   */
  function renderCombatArena() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;
    const state   = CWGameState.get();
    const team    = CWGameState.getTeam();
    const catalogue = state.player.catalogue || {};

    // Bouton en haut
    if (top) {
      top.innerHTML = _selectedArenaType && team.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch-arena" style="width:100%;margin-bottom:8px">🏛️ Entrer dans l'arène</button>`
        : '';
      document.getElementById('btn-launch-arena')?.addEventListener('click', () => _launchCombat({ mode: 'arena', arenaType: _selectedArenaType }));
    }

    // Pour chaque type, calculer combien de lignées DISTINCTES le joueur a débloquées
    // (au moins 1 personnage de la lignée dans le catalogue, ayant ce type en type1 ou type2)
    const ARENA_REQUIRED_LINES = 6;

    const typeUnlockData = state.types.map(t => {
      // Trouver toutes les lignées qui ont au moins un membre avec ce type
      const linesWithType = new Set();
      state.characters.forEach(c => {
        if (c.type1 === t.id || c.type2 === t.id) {
          linesWithType.add(c.evolutionLine);
        }
      });
      // Parmi ces lignées, combien ont leur forme de base dans le catalogue du joueur ?
      let unlockedLines = 0;
      linesWithType.forEach(lineId => {
        const baseForm = state.characters
          .filter(c => c.evolutionLine === lineId)
          .sort((a, b) => a.evolutionStage - b.evolutionStage)[0];
        if (baseForm && catalogue[baseForm.id]) unlockedLines++;
      });
      return {
        type:          t,
        totalLines:    linesWithType.size,
        unlockedLines,
        isUnlocked:    unlockedLines >= ARENA_REQUIRED_LINES,
      };
    });

    const unlockedArenas = typeUnlockData.filter(d => d.isUnlocked).length;
    const totalArenas    = typeUnlockData.length;

    content.innerHTML = `
      <h3 class="combat-line-title">Choisissez une arène</h3>
      <p class="combat-line-subtitle">
        ${unlockedArenas}/${totalArenas} arène${unlockedArenas > 1 ? 's' : ''} débloquée${unlockedArenas > 1 ? 's' : ''}
        — Débloquez ${ARENA_REQUIRED_LINES} lignées d'un même type pour accéder à son arène.
      </p>
      <div class="evo-line-grid">
        ${typeUnlockData.map(({ type: t, totalLines, unlockedLines, isUnlocked }) => {
          if (isUnlocked) {
            return `
            <div class="evo-line-card arena-card ${_selectedArenaType === t.id ? 'selected' : ''}" data-arena-type="${t.id}" title="Arène ${t.name}">
              <div class="arena-type-icon" style="background:${t.color}">${t.icon}</div>
              <div class="evo-line-name" style="color:${t.color}">Arène ${t.name}</div>
              <div class="evo-line-meta">
                <span class="evo-line-count">6 ennemis ${t.name}</span>
              </div>
            </div>`;
          } else {
            // Verrouillée : afficher la progression
            const progress = Math.min(unlockedLines, ARENA_REQUIRED_LINES);
            const pct      = Math.round((progress / ARENA_REQUIRED_LINES) * 100);
            return `
            <div class="evo-line-card arena-card locked" title="Débloquez ${ARENA_REQUIRED_LINES - unlockedLines} lignée(s) ${t.name} de plus">
              <div class="arena-type-icon" style="background:#333;opacity:0.6">${t.icon}</div>
              <div class="evo-line-name" style="color:#666">Arène ${t.name}</div>
              <div class="evo-line-meta">
                <span class="evo-line-count" style="color:#555">${progress}/${ARENA_REQUIRED_LINES} lignées</span>
              </div>
              <div class="arena-progress-bar">
                <div class="arena-progress-fill" style="width:${pct}%;background:${t.color}"></div>
              </div>
              <div class="lock-badge">🔒</div>
            </div>`;
          }
        }).join('')}
      </div>
      ${_selectedArenaType && team.length > 0 ? `` : ''}
    `;

    // Seules les arènes débloquées sont cliquables
    content.querySelectorAll('.arena-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _selectedArenaType = card.dataset.arenaType;
        renderCombatArena();
      });
    });
  }

  /**
   * Affiche la sélection de lignée évolutive pour un combat thématique :
   * le joueur choisit une lignée et affronte tous ses stades d'évolution
   */
  /**
   * ── MODE ODYSSÉE ──
   * Affiche la progression par Sanctuaire/Épreuve. Chaque épreuve est soit normale,
   * soit élite (x10 et x20 de chaque sanctuaire, en violet), soit boss (x25, en rouge).
   * Une épreuve ne peut être rejouée une fois accomplie (en cas de défaite, la même
   * équipe ennemie est conservée pour les réessais).
   */
  function renderCombatStory() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;

    const state    = CWGameState.get();
    const player   = CWGameState.getPlayer();
    const storyCfg = state.config.combat.story || {};
    const perWorld = storyCfg.subLevelsPerWorld || 25;
    const eliteSubs = storyCfg.eliteSubLevels   || [10, 20];
    const bossSub   = storyCfg.bossSubLevel      || 25;

    // Progression actuelle
    const progress = player.story || { world: 1, subLevel: 0 };
    const { world } = progress;
    const completedSub = progress.subLevel;    // dernier sous-niveau COMPLÉTÉ dans ce monde
    const nextSub = completedSub + 1;          // prochain à jouer (ou 26 si monde fini, géré par _endBattle)
    const worldComplete = completedSub >= perWorld;

    // Bonus monde visible au joueur
    const worldBoost = (world - 1) * (storyCfg.worldStatBoost ?? 0.10);

    // Bouton de lancement en haut
    const team = CWGameState.getTeam();
    if (top) {
      if (team.length > 0 && !worldComplete) {
        const sub = nextSub;
        const isElite = eliteSubs.includes(sub);
        const isBoss  = sub === bossSub;
        const typeLabel = isBoss ? '💀 Boss' : isElite ? '⚔ Élite' : '▶';
        top.innerHTML = `
          <button class="btn-primary btn-launch-combat story-launch-btn ${isBoss ? 'story-boss-btn' : isElite ? 'story-elite-btn' : ''}"
                  id="btn-launch" style="width:100%;margin-bottom:8px">
            ${typeLabel} Lancer Sanctuaire ${world} — Rendez-vous ${sub}
          </button>
        `;
        document.getElementById('btn-launch')?.addEventListener('click', () =>
          _launchCombat({ mode: 'story', storyWorld: world, storySubLevel: sub })
        );
      } else {
        top.innerHTML = worldComplete
          ? `<p class="combat-mode-note">🎉 Sanctuaire ${world} accompli ! Le prochain s'ouvre devant toi…</p>`
          : '';
      }
    }

    const rewardElite = storyCfg.rewardEliteGold    ?? 100;
    const rewardBoss  = storyCfg.rewardBossDiamonds ?? 100;

    // Grille des 25 épreuves du sanctuaire courant
    const cells = Array.from({ length: perWorld }, (_, i) => {
      const sub = i + 1;
      const done   = sub <= completedSub;
      const active = sub === nextSub && !worldComplete;
      const isElite = eliteSubs.includes(sub);
      const isBoss  = sub === bossSub;

      let cls  = 'story-sub-cell';
      let label = '';
      if (isBoss)  { cls += ' story-boss-cell';  label = '💀 BOSS'; }
      else if (isElite) { cls += ' story-elite-cell'; label = '⚔ ÉLITE'; }
      if (done)   cls += ' story-done';
      if (active) cls += ' story-active';
      if (!done && !active) cls += ' story-locked';

      const rewardBadge = isBoss
        ? `<div class="story-sub-reward story-sub-reward-boss">+${rewardBoss} 💎</div>`
        : isElite
          ? `<div class="story-sub-reward story-sub-reward-elite">+${rewardElite} 💵</div>`
          : '';

      return `
        <div class="${cls}" title="Sanctuaire ${world} — Rendez-vous ${sub}${isElite ? ` (+${rewardElite} 💵)` : ''}${isBoss ? ` (+${rewardBoss} 💎)` : ''}">
          <div class="story-sub-number">${world}-${sub}</div>
          ${label ? `<div class="story-sub-badge">${label}</div>` : ''}
          ${rewardBadge}
          ${done ? '<div class="story-sub-done">✓</div>' : ''}
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="story-header">
        <div class="story-world-title">🌸 Sanctuaire ${world}</div>
        ${worldBoost > 0 ? `<div class="story-world-bonus">+${Math.round(worldBoost * 100)}% stats ennemies</div>` : ''}
        <div class="story-progress-bar-wrap">
          <div class="story-progress-bar" style="width:${Math.min(100, (completedSub / perWorld) * 100)}%"></div>
        </div>
        <div class="story-progress-label">${completedSub} / ${perWorld} Rendez-vous</div>
      </div>
      <div class="story-sub-grid">${cells}</div>
    `;
  }

  function renderCombatByLine() {
    const top     = document.getElementById('combat-mode-content-top');
    const content = document.getElementById('combat-mode-content');
    if (!content) return;
    const state   = CWGameState.get();
    const team    = CWGameState.getTeam();
    const catalogue = state.player.catalogue || {};

    // Bouton en haut
    if (top) {
      top.innerHTML = _selectedLine && team.length > 0
        ? `<button class="btn-primary btn-launch-combat" id="btn-launch-line" style="width:100%;margin-bottom:8px">⚔ Affronter cette lignée</button>`
        : '';
      document.getElementById('btn-launch-line')?.addEventListener('click', () => _launchCombat({ mode: 'line', lineId: _selectedLine }));
    }

    // Regrouper par lignée, récupérer la forme de base (stade 0)
    const lines = {};
    state.characters.forEach(c => {
      if (!lines[c.evolutionLine]) lines[c.evolutionLine] = [];
      lines[c.evolutionLine].push(c);
    });

    // Construire les entrées : disponibles (admin ON + catalogue débloqué) et verrouillées (admin ON + pas encore vu)
    // Les lignées désactivées en admin (availableInLineCombat === false) sont complètement masquées.
    const lineEntries = Object.entries(lines)
      .map(([lineId, chars]) => {
        const sorted   = chars.slice().sort((a, b) => a.evolutionStage - b.evolutionStage);
        const baseForm = sorted[0];
        return { lineId, baseForm };
      })
      .filter(({ baseForm }) => baseForm.availableInLineCombat !== false)  // masquer si désactivé en admin
      .map(({ lineId, baseForm }) => ({
        lineId,
        baseForm,
        unlocked: !!catalogue[baseForm.id],   // débloqué = forme de base présente dans le catalogue
      }))
      .sort((a, b) => {
        // Débloquées en premier, puis par nom
        if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
        return a.baseForm.name.localeCompare(b.baseForm.name);
      });

    const unlockedCount = lineEntries.filter(e => e.unlocked).length;
    const totalCount    = lineEntries.length;

    content.innerHTML = `
      <h3 class="combat-line-title">Choisissez une lignée à affronter</h3>
      <p class="combat-line-subtitle">
        ${unlockedCount}/${totalCount} lignée${unlockedCount > 1 ? 's' : ''} débloquée${unlockedCount > 1 ? 's' : ''}
        — Débloquez une forme de base dans le Catalogue pour affronter sa lignée.
      </p>
      <div class="evo-line-grid">
        ${lineEntries.map(({ lineId, baseForm, unlocked }) => {
          const t1        = state.types.find(t => t.id === baseForm.type1);
          const rarityDef = CWGameDatabase.RARITIES[baseForm.rarity] || {};
          if (unlocked) {
            return `
            <div class="evo-line-card ${_selectedLine === lineId ? 'selected' : ''}" data-line="${lineId}" title="Affronter la lignée de ${baseForm.name}">
              <div class="evo-line-portrait">
                ${baseForm.portrait ? `<img src="${baseForm.portrait}" alt="${baseForm.name}">` : `<span>${baseForm.name.charAt(0)}</span>`}
              </div>
              <div class="evo-line-name" style="color:${rarityDef.color}">${baseForm.name}</div>
              <div class="evo-line-meta">
                ${t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
              </div>
            </div>`;
          } else {
            // Verrouillée : portrait flouté, cadenas, pas cliquable
            return `
            <div class="evo-line-card locked" title="Débloquée en obtenant ${baseForm.name} via le Gacha ou un combat">
              <div class="evo-line-portrait locked-portrait">
                ${baseForm.portrait
                  ? `<img src="${baseForm.portrait}" alt="???" style="filter:blur(6px) brightness(0.4)">`
                  : `<span style="opacity:0.2">${baseForm.name.charAt(0)}</span>`}
                <div class="lock-overlay">🔒</div>
              </div>
              <div class="evo-line-name" style="color:#666">???</div>
              <div class="evo-line-meta">
                <span class="evo-line-count" style="color:#555">Non débloquée</span>
              </div>
            </div>`;
          }
        }).join('')}
      </div>
      ${_selectedLine && team.length > 0 ? `` : ''}
    `;

    // Seules les cartes débloquées sont cliquables
    content.querySelectorAll('.evo-line-card:not(.locked)').forEach(card => {
      card.addEventListener('click', () => {
        _selectedLine = card.dataset.line;
        renderCombatByLine();
      });
    });
  }

  function _launchCombat(options) {
    const battleArea = document.getElementById('battle-area');
    const lobby = document.querySelector('.combat-lobby');
    if (!battleArea || !lobby) return;

    _battle = CWCombatEngine.start(_onBattleEvent, options);
    if (!_battle) {
      // L'erreur a déjà été émise via _onBattleEvent, mais on double sécurise
      const player = CWGameState.getPlayer();
      const cfg = CWGameState.getConfig();
      const energyCost = cfg.energy.costs?.[options.mode] ?? cfg.energy.combatCost;
      if (options.mode !== 'fullRandom' && player.team.length === 0) {
        _showToast("Composez d'abord votre équipe !", 'error');
      } else if (cfg.energy.enabled && player.energy.current < energyCost) {
        _showToast("Désir insuffisant !", 'error');
      }
      return;
    }

    lobby.style.display = 'none';
    battleArea.style.display = 'block';

    // Pendant le combat : masquer les onglets de mode (Tournée/Saga/Caprice/Arène/...)
    // et le menu de navigation du bas, pour ne pas pouvoir quitter le combat.
    const tabsEl = document.querySelector('.combat-mode-tabs');
    if (tabsEl) tabsEl.style.display = 'none';
    const eventBannerEl = document.querySelector('.event-combat-banner');
    if (eventBannerEl) eventBannerEl.style.display = 'none';
    const navEl = document.getElementById('main-nav');
    if (navEl) navEl.style.display = 'none';
    document.getElementById('plus-menu')?.classList.remove('open');

    CWAudioSystem.playCombat();
    _renderBattle();
  }

  function _renderBattle() {
    const area = document.getElementById('battle-area');
    if (!area || !_battle) return;

    const b = _battle;
    area.innerHTML = `
      <div class="battle-scene">
        <div class="battle-side battle-enemy">
          <h3>Ennemis</h3>
          <div class="battle-fighters" id="enemy-fighters">
            ${b.enemyTeam.map((e, i) => _renderFighter(e, i)).join('')}
          </div>
        </div>
        <div class="battle-vs">⚔</div>
        <div class="battle-side battle-player">
          <h3>Votre casting</h3>
          <div class="battle-fighters" id="player-fighters">
            ${b.playerTeam.map((p, i) => _renderFighter(p, i)).join('')}
          </div>
        </div>
      </div>
      <div class="turn-order-bar" id="turn-order-bar"></div>
      <div class="battle-controls" id="battle-controls">
        <div class="battle-actions" id="battle-actions"></div>
      </div>
      <div class="battle-log" id="battle-log"></div>
    `;

    // Clic sur une carte de combattant (alliée ou ennemie) → ouvre sa fiche
    // détaillée complète. Délégation sur le conteneur : reste valide même si
    // les cartes ne sont jamais reconstruites pendant le combat.
    area.onclick = (e) => {
      const card = e.target.closest('.fighter-card');
      if (card) _openCombatantDetail(card.id.replace('fighter-', ''));
    };

    _renderTurnOrderBar();
    _renderBattleControls();
  }

  /**
   * Affiche la frise de l'ordre d'action de la manche en cours (vitesse décroissante),
   * avec l'acteur actif mis en évidence — alliés et ennemis confondus.
   */
  function _renderTurnOrderBar() {
    const bar = document.getElementById('turn-order-bar');
    if (!bar || !_battle) return;

    const upcoming = _battle.turnOrder.slice(_battle.turnIndex, _battle.turnIndex + 8);
    if (upcoming.length === 0) { bar.innerHTML = ''; return; }

    bar.innerHTML = `
      <span class="turn-order-label">Ordre :</span>
      <div class="turn-order-chips">
        ${upcoming.map((entry, i) => {
          const team = entry.isEnemy ? _battle.enemyTeam : _battle.playerTeam;
          const c = team.find(x => x.instanceId === entry.instanceId);
          if (!c) return '';
          return `<div class="turn-chip ${i === 0 ? 'active' : ''} ${entry.isEnemy ? 'is-enemy' : 'is-ally'}" title="${c.name}">
            ${c.portrait ? `<img src="${c.portrait}" alt="${c.name}">` : c.name.charAt(0)}
          </div>`;
        }).join('')}
      </div>
    `;
  }

  function _renderFighter(combatant, index = 0) {
    const hpPct = Math.round((combatant.currentHp / combatant.maxHp) * 100);
    const hpColor = hpPct > 60 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#f87171';
    const state = CWGameState.get();
    const t1 = state.types.find(t => t.id === combatant.type1);
    const t2 = combatant.type2 ? state.types.find(t => t.id === combatant.type2) : null;
    const maxAwk = state.config.awakening.maxLevel;
    const isAwkMax = (combatant.awakening || 0) >= maxAwk;
    return `
    <div class="fighter-card rarity-${combatant.rarity} ${combatant.alive ? '' : 'defeated'}" id="fighter-${combatant.instanceId}" style="--enter-delay:${index * 80}ms">
      <div class="fighter-portrait ${isAwkMax ? 'awakening-max' : ''}" style="--breathe-delay:${(index % 4) * 420}ms">
        ${_combatPortraitImgHtml(CWGameState.getCharDef(combatant.charId) || combatant)}
      </div>
      <div class="status-icons" id="status-icons-${combatant.instanceId}">${_renderStatusIcons(combatant)}</div>
      <div class="fighter-types">
        ${t1 ? `<span class="type-chip" style="background:${t1.color}" title="${t1.name}">${t1.icon}</span>` : ''}
        ${t2 ? `<span class="type-chip" style="background:${t2.color}" title="${t2.name}">${t2.icon}</span>` : ''}
      </div>
      <div class="fighter-info">
        <div class="fighter-name">${combatant.name} <small>Niv.${combatant.level}</small></div>
        <div class="hp-bar">
          <div class="hp-bar-fill" style="width:${hpPct}%;background:${hpColor}"></div>
        </div>
        <div class="hp-text">${combatant.alive ? `${combatant.currentHp} / ${combatant.maxHp}` : 'KO'}</div>
      </div>
    </div>`;
  }

  /**
   * Génère les icônes d'altérations persistantes pour un combattant.
   * Affiche une icône par altération active, chacune avec un tooltip.
   * Les buff temporaires (Atk Up) ont une couleur verte, les debuffs une couleur rouge/orange.
   */
  function _renderStatusIcons(combatant) {
    const icons = [];

    // Altérations d'état (statusEffects)
    const STATUS_META = {
      poison:    { icon: '☠', label: 'Poison',     color: '#a855f7', pulse: false },
      paralysis: { icon: '⚡', label: 'Paralysie',  color: '#facc15', pulse: true  },
      charm:     { icon: '💞', label: 'Charme',     color: '#f472b6', pulse: false },
    };
    (combatant.statusEffects || []).forEach(s => {
      const meta = STATUS_META[s.type];
      if (!meta) return;
      const turns = s.turnsLeft != null ? ` (${s.turnsLeft}t)` : '';
      icons.push(`<span class="status-icon ${meta.pulse ? 'status-pulse' : ''}"
        style="background:${meta.color}" title="${meta.label}${turns}">${meta.icon}</span>`);
    });

    // Buff ATK temporaire (Ardente)
    if ((combatant.tempAtkBuffPercent || 0) > 0) {
      icons.push(`<span class="status-icon status-buff" title="Charisme Up +${combatant.tempAtkBuffPercent}%">✨↑</span>`);
    }

    return icons.join('');
  }

  /**
   * Mode Performance : transition de remplacement d'un ennemi vaincu — simple
   * fondu (disparition de l'ancien, apparition du nouveau), sans le moindre
   * déplacement de portrait à l'écran. Le nœud DOM entier est remplacé (le
   * nouvel ennemi a un instanceId différent), pas seulement son contenu.
   */
  function _playRecordEnemyReplace(index, newEnemy, oldInstanceId) {
    const oldCard = document.getElementById(`fighter-${oldInstanceId}`);
    if (!oldCard || !newEnemy) { _combatAnimDone(); return; }

    // Phase 1 — fondu de disparition sur l'ancien ennemi vaincu (320ms)
    oldCard.style.transition = 'opacity 300ms ease, transform 300ms ease';
    oldCard.style.opacity = '0';
    oldCard.style.transform = 'scale(.85)';

    setTimeout(() => {
      // Remplace le nœud DOM entier : le nouvel ennemi a un id différent
      const wrapper = document.createElement('div');
      wrapper.innerHTML = _renderFighter(newEnemy, index).trim();
      const newCard = wrapper.firstElementChild;
      if (!newCard) { _combatAnimDone(); return; }
      newCard.style.opacity = '0';
      newCard.style.transform = 'scale(.85)';
      oldCard.replaceWith(newCard);

      // Phase 2 — fondu d'apparition du nouvel ennemi (300ms)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        newCard.style.transition = 'opacity 300ms ease, transform 300ms cubic-bezier(.22,.68,0,1.2)';
        newCard.style.opacity = '1';
        newCard.style.transform = 'scale(1)';
      }));

      setTimeout(() => {
        newCard.style.transition = '';
        _renderTurnOrderBar();
        _combatAnimDone();
      }, 350);
    }, 320);
  }

  function _renderBattleControls() {
    const actionsEl = document.getElementById('battle-actions');
    if (!actionsEl || !_battle) return;

    _highlightActiveFighter();

    if (_battle.phase === 'end') return;

    const state  = CWGameState.get();
    const typeOf = (id) => state.types.find(t => t.id === id);

    if (_battle.phase === 'enemy') {
      const enemy = _battle.enemyTeam.find(c => c.instanceId === _battle.currentActor);
      actionsEl.innerHTML = `<p class="turn-waiting">👹 ${enemy ? enemy.name : "L'ennemi"} agit...</p>`;
      return;
    }

    // phase === 'player' : c'est au tour du personnage allié _battle.currentActor
    const actor = _battle.playerTeam.find(c => c.instanceId === _battle.currentActor && c.alive);
    const enemies = _battle.enemyTeam.filter(c => c.alive);

    if (!actor) {
      actionsEl.innerHTML = '';
      return;
    }

    const t1 = typeOf(actor.type1);

    actionsEl.innerHTML = `
      <p class="turn-actor">${t1 ? t1.icon : ''} C'est le tour de <strong>${actor.name}</strong> !</p>
      <div class="target-select">
        <label>Cible :</label>
        <div class="fighter-btns">
          ${enemies.map(e => {
            let multBadge = '';
            // Utiliser getBestTypeEffectiveness — identique à l'engine
            const mult = CWGameDatabase.getBestTypeEffectiveness(actor.type1, actor.type2, e.type1, e.type2, state.typeMatrix);
            if (mult !== 1) {
              const cls = mult >= 2 ? 'mult-super' : mult === 0 ? 'mult-immune' : mult <= 0.5 ? 'mult-low' : 'mult-mid';
              multBadge = `<span class="target-mult ${cls}">×${_formatMult(mult)}</span>`;
            }
            return `<button class="btn-target" data-iid="${e.instanceId}">${e.name} (${e.currentHp}💗)${multBadge}</button>`;
          }).join('')}
        </div>
      </div>
    `;

    actionsEl.querySelectorAll('.btn-target').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_combatAnimBusy) return; // bloquer si animation en cours
        actionsEl.querySelectorAll('.btn-target').forEach(b => b.disabled = true);
        CWCombatEngine.playerAttack(actor.instanceId, btn.dataset.iid);
      });
    });
  }

  /** Met en évidence la carte du combattant dont c'est actuellement le tour */
  function _highlightActiveFighter() {
    if (!_battle) return;
    document.querySelectorAll('.fighter-card.active-turn').forEach(el => el.classList.remove('active-turn'));
    if (_battle.phase === 'player' || _battle.phase === 'enemy') {
      const card = document.getElementById(`fighter-${_battle.currentActor}`);
      card?.classList.add('active-turn');
    }
  }

  function _onBattleEvent(event, data) {
    _battle = CWCombatEngine.getBattle();
    const log = document.getElementById('battle-log');

    if (['playerAttack', 'enemyAttack'].includes(event)) {
      _renderTurnOrderBar();
      _highlightActiveFighter();
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // Capture SYNCHRONE du PV de l'attaquant ET de la cible maintenant (avant
      // mise en file) : si une Contre-Attaque touche l'attaquant juste après
      // (résolue immédiatement côté moteur), ou si le coup est esquivé (pas de
      // hpAfter fourni dans ce cas), on ne veut pas que le rafraîchissement de
      // la carte, plus tard dans l'animation, affiche par erreur un PV déjà
      // périmé par une action ultérieure.
      const attackerHpSnapshot = data.attacker.currentHp;
      const targetHpSnapshot   = data.target.currentHp;
      // Passer l'animation par la queue pour qu'elle attende la précédente
      _queueCombatAnim(() => _playAttackAnimation(data.attacker, data.target, data.result, attackerHpSnapshot, targetHpSnapshot));
    }

    // Mode Performance : un ennemi vaincu est immédiatement remplacé. Cette
    // transition est un simple fondu (disparition → nouvel ennemi qui apparaît),
    // JAMAIS une animation de portrait qui se déplace — donc aucun risque de
    // sortir de l'écran, contrairement à l'animation d'attaque classique.
    // Mise en file comme les attaques, pour ne jamais jouer en même temps
    // qu'une autre animation sur la même carte.
    if (event === 'recordEnemyReplaced') {
      _queueCombatAnim(() => _playRecordEnemyReplace(data.index, data.newEnemy, data.oldInstanceId));
    }

    if (event === 'playerTurn') {
      _renderTurnOrderBar();
      _renderBattleControls();
    }

    if (event === 'victory') {
      _resetCombatAnimQueue();
      if (_tutorialCombatEndCb) {
        const cb = _tutorialCombatEndCb;
        _tutorialCombatEndCb = null;
        _combatInProgress = false;
        cb('victory');
      } else {
        // Mode histoire : marquer le stage complété
        if (_storyPendingStage) {
          const { ci, stage } = _storyPendingStage;
          _storyPendingStage = null;
          CWGameState.completeStoryStage(ci, stage);
          // Afficher dialogue post si stage narratif avec text2
          const ch  = CWGameState.get().config.storyMode?.chapters?.[ci];
          const dlg = ch?.dialogues?.[stage];
          if (dlg?.text2) {
            _playLevelUpAnimations(data.rewards?.levelUps);
            _showBattleResult('victory', data);
            // Après retour au lobby → dialogue post
            _storyPostDialogue = { ci, stage, dlg };
          } else {
            _playLevelUpAnimations(data.rewards?.levelUps);
            _showBattleResult('victory', data);
          }
        } else {
          _playLevelUpAnimations(data.rewards?.levelUps);
          _showBattleResult('victory', data);
        }
      }
    }
    if (event === 'defeat') {
      _resetCombatAnimQueue();
      if (_tutorialCombatEndCb) {
        const cb = _tutorialCombatEndCb;
        _tutorialCombatEndCb = null;
        _combatInProgress = false;
        cb('defeat');
      } else {
        _showBattleResult('defeat', data);
      }
    }
    if (event === 'record') {
      _resetCombatAnimQueue();
      _showBattleResult('record', data);
    }

    if (event === 'error') {
      _showToast(data.message, 'error');
    }

    if (event === 'passiveTriggered') {
      _queueCombatAnim(() => _onPassiveTriggered(data));
    }
    if (event === 'statusTriggered') {
      _queueCombatAnim(() => _onStatusTriggered(data));
    }
  }

  /**
   * Réagit au déclenchement d'un passif en combat.
   * Sons : réutilise les bruitages existants (pas de son dédié par passif).
   * Chiffres flottants colorés pour tout changement de PV (dégâts ou soins).
   */
  function _onPassiveTriggered(data) {
    const state = CWGameState.get();
    const passive = state.passives.find(p => p.id === data.passiveId);
    const effectType = passive?.effectType;
    const sourceCard = document.getElementById(`fighter-${data.combatantId}`);

    // ── Capture SYNCHRONE de tout ce dont l'affichage différé aura besoin ──────
    // Important : on lit l'état "en direct" ICI, tout de suite (avant qu'aucun
    // autre tour n'ait pu s'exécuter), jamais depuis l'intérieur d'un setTimeout.
    // Comme le moteur peut déjà avoir résolu les tours suivants pendant qu'on
    // attend pour l'affichage, relire l'état "en direct" plus tard montrerait
    // un PV/statut déjà périmé (celui d'un tour ultérieur). On fige donc ici
    // exactement ce qu'il faut montrer, et on se contente de l'injecter tel
    // quel dans le DOM une fois le délai écoulé.
    let onRetreat = null;
    let subtitle  = null; // "→ Cible : effet", affiché sous le nom du passif pour plus de clarté

    if (effectType === 'end_turn_aoe_damage') {
      const targetIds = data.extra?.targetIds || [];
      const damageMap = data.extra?.damageMap || {};
      targetIds.forEach(id => {
        const targetCard = document.getElementById(`fighter-${id}`);
        _spawnPassiveFx(targetCard, 'wave');
        const dmg = damageMap[id];
        if (dmg != null) _spawnFloatText(targetCard, `-${dmg}`, 'float-passive-dmg', 0);
      });
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitNormal);
      subtitle = `→ ${targetIds.length} ennemi${targetIds.length > 1 ? 's' : ''} touché${targetIds.length > 1 ? 's' : ''}`;
      // Snapshot des PV actuels (déjà appliqués par le moteur) de chaque cible
      const hpSnapshot = {};
      targetIds.forEach(id => { const c = _findCombatantById(id); if (c) hpSnapshot[id] = c.currentHp; });
      onRetreat = () => {
        targetIds.forEach(id => {
          const c = _findCombatantById(id);
          if (!c || hpSnapshot[id] === undefined) return;
          const saved = c.currentHp;
          c.currentHp = hpSnapshot[id];
          _updateFighterCard(c);
          c.currentHp = saved; // restaurer pour les calculs suivants du moteur
        });
        _renderTurnOrderBar();
      };

    } else if (effectType === 'end_turn_heal_lowest_ally') {
      const healedCard = document.getElementById(`fighter-${data.extra?.healedId}`);
      _spawnPassiveFx(healedCard, 'heal');
      const amount = data.extra?.amount;
      if (amount != null) _spawnFloatText(healedCard, `+${amount}`, 'float-passive-heal', 0);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      // hpAfter est déjà un instantané figé fourni par le moteur : sûr à utiliser tel quel
      const healedId = data.extra?.healedId;
      const hpAfter  = data.extra?.hpAfter;
      const healedName = _findCombatantById(healedId)?.name || 'Allié·e';
      subtitle = `→ ${healedName} : +${amount ?? '?'} PV`;
      onRetreat = () => {
        const healed = _findCombatantById(healedId);
        if (healed && hpAfter !== undefined) {
          const saved = healed.currentHp;
          healed.currentHp = hpAfter;
          _updateFighterCard(healed);
          healed.currentHp = saved;
        } else if (healed) {
          _updateFighterCard(healed);
        }
        _renderTurnOrderBar();
      };

    } else if (effectType === 'buff_ally_atk_once') {
      const buffedCard = document.getElementById(`fighter-${data.extra?.buffedId}`);
      _spawnPassiveFx(buffedCard, 'buff');
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.gachaPull);
      // Icônes de statut figées maintenant (le buff est déjà appliqué côté moteur)
      const buffedId = data.extra?.buffedId;
      const buffedName = _findCombatantById(buffedId)?.name || 'Allié·e';
      subtitle = `→ ${buffedName} : Charisme renforcé`;
      const buffedIconsHtml = (() => {
        const c = _findCombatantById(buffedId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onRetreat = () => {
        if (buffedIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${buffedId}`);
        if (ic) ic.innerHTML = buffedIconsHtml;
      };

    } else if (effectType === 'pre_attack_cleanse_self') {
      _spawnPassiveFx(sourceCard, 'cleanse');
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitResist);
      subtitle = '→ Soi-même : Statuts nettoyés';
      const srcId = data.combatantId;
      const srcIconsHtml = (() => {
        const c = _findCombatantById(srcId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onRetreat = () => {
        if (srcIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${srcId}`);
        if (ic) ic.innerHTML = srcIconsHtml;
      };

    } else if (effectType === 'on_damaged_counter') {
      // Contre-Attaque : riposte rapide — mini-bannière courte au-dessus du portrait
      // plutôt que la grande bannière centrale, mais on respecte le même principe :
      // le PV ne change qu'une fois la mini-bannière disparue (+1s).
      const targetCard = document.getElementById(`fighter-${data.extra?.targetId}`);
      const targetId   = data.extra?.targetId;
      const dmg = data.extra?.damage;
      const counterTargetName = _findCombatantById(targetId)?.name || '';
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitWeak);

      // Flash éclair sur le riposteur
      _spawnPassiveFx(sourceCard, 'counter');
      const log = document.getElementById('battle-log');
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // Mini-bannière rapide positionnée sur le riposteur
      const srcPortrait2 = sourceCard?.querySelector('.fighter-portrait');
      if (srcPortrait2) {
        const r = srcPortrait2.getBoundingClientRect();
        const miniB = document.createElement('div');
        miniB.style.cssText = `
          position:fixed; left:${r.left + r.width/2}px; top:${r.top - 36}px;
          transform:translateX(-50%) scale(.85);
          z-index:9998; pointer-events:none;
          background:linear-gradient(90deg,rgba(244,63,94,.2),rgba(244,63,94,.4),rgba(244,63,94,.2));
          border:1px solid rgba(244,63,94,.8); border-radius:16px;
          padding:5px 14px; font-family:var(--font-display); font-size:.82rem;
          font-weight:800; color:#fff; white-space:nowrap;
          text-shadow:0 0 12px rgba(244,63,94,1);
          opacity:0; transition:opacity 150ms ease;
        `;
        miniB.textContent = counterTargetName ? `⚡ Contre-Attaque ! → ${counterTargetName}` : '⚡ Contre-Attaque !';
        document.body.appendChild(miniB);
        requestAnimationFrame(() => requestAnimationFrame(() => { miniB.style.opacity = '1'; }));
        setTimeout(() => { miniB.style.opacity = '0'; setTimeout(() => miniB.remove(), 200); }, 700);
      }
      // Chiffre de dégâts sur la cible (feedback immédiat, comme l'impact d'un coup normal)
      if (dmg != null && targetCard) _spawnFloatText(targetCard, `-${dmg}`, 'float-passive-dmg', 0);
      // Snapshot du PV cible (déjà appliqué par le moteur)
      const hpAfterCounter = (() => { const c = _findCombatantById(targetId); return c ? c.currentHp : undefined; })();
      // Mini-bannière disparue vers ~900ms → +1s → PV visible à ~1900ms, libération peu après
      setTimeout(() => {
        const c = _findCombatantById(targetId);
        if (c && hpAfterCounter !== undefined) {
          const saved = c.currentHp;
          c.currentHp = hpAfterCounter;
          _updateFighterCard(c);
          c.currentHp = saved;
        } else if (c) {
          _updateFighterCard(c);
        }
        _renderTurnOrderBar();
        _combatAnimDone();
      }, 1900);
      return; // ce cas gère sa propre file, pas de bannière centrale ni de onRetreat

    } else if (effectType === 'random_passive_steal') {
      _spawnPassiveFx(sourceCard, 'steal');
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.evolution);
      // La bannière Mystère affiche le passif Mystère puis swape vers le passif copié —
      // aucun PV/statut à afficher pour ce déclenchement précis (le passif copié
      // s'affichera correctement de lui-même à son propre déclenchement futur).

    } else if (effectType === 'stat_boost_evasion') {
      _spawnPassiveFx(sourceCard, 'adorable');
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitResist);
      subtitle = '→ Soi-même : Esquive renforcée';

    } else if (effectType === 'stat_boost_crit_damage') {
      _spawnPassiveFx(sourceCard, 'scenique');
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitWeak);
      subtitle = '→ Soi-même : Critique renforcé';

    } else if (['on_hit_paralyze', 'on_hit_poison', 'on_hit_charm'].includes(effectType)) {
      const statusVariant = effectType === 'on_hit_paralyze' ? 'paralysis'
                          : effectType === 'on_hit_poison'   ? 'poison'
                          :                                    'charm';
      const statusLabel = effectType === 'on_hit_paralyze' ? 'Paralysie'
                         : effectType === 'on_hit_poison'   ? 'Poison'
                         :                                    'Charme';
      const targetId = data.extra?.targetId;
      const targetName = _findCombatantById(targetId)?.name || 'Cible';
      subtitle = `→ ${targetName} : ${statusLabel}`;
      _spawnPassiveFx(document.getElementById(`fighter-${targetId}`), statusVariant);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitWeak);
      const targetIconsHtml = (() => {
        const c = _findCombatantById(targetId);
        return c ? _renderStatusIcons(c) : null;
      })();
      onRetreat = () => {
        if (targetIconsHtml === null) return;
        const ic = document.getElementById(`status-icons-${targetId}`);
        if (ic) ic.innerHTML = targetIconsHtml;
      };
    }

    // La grande bannière centrale dure ~2.46s ; si onRetreat est fourni, elle
    // attend encore 1s après sa disparition avant de l'appeler puis de libérer
    // la file (cf. _spawnPassiveBanner). Sinon elle libère la file directement.
    _spawnPassiveBanner(sourceCard, data.passiveName, data.extra?.copiedPassiveName || null, { onRetreat, subtitle });
  }
  /** Réagit à un effet de statut qui tique tout seul (poison) ou bloque un tour (paralysie/charme) */
  function _onStatusTriggered(data) {
    const card = document.getElementById(`fighter-${data.combatantId}`);
    if (!card) { _combatAnimDone(); return; }

    const combatant = _findCombatantById(data.combatantId);

    if (data.statusType === 'poison') {
      // Tick de poison : petite animation sur la victime, SANS portrait au centre
      const portrait = card.querySelector('.fighter-portrait');
      // Chiffre flottant
      if (data.amount != null) _spawnFloatText(card, `-${data.amount}`, 'float-passive-poison', 0);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.hitNormal);
      // Petite animation poison sur la carte (teinte violette pulsante)
      if (portrait) {
        portrait.classList.add('poison-tick-flash');
        setTimeout(() => portrait.classList.remove('poison-tick-flash'), 600);
      }
      // Chiffre flottant dans le log
      const log = document.getElementById('battle-log');
      if (log && _battle?.log?.length) {
        log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
      }
      // HP mis à jour avec snapshot hpAfter quand le chiffre est visible (~150ms)
      setTimeout(() => {
        if (combatant) {
          if (data.hpAfter !== undefined) {
            const saved = combatant.currentHp;
            combatant.currentHp = data.hpAfter;
            _updateFighterCard(combatant);
            combatant.currentHp = saved;
          } else {
            _updateFighterCard(combatant);
          }
        }
        _renderTurnOrderBar();
      }, 150);
      // Libérer la queue après la petite animation (800ms total, bien plus court qu'une bannière)
      setTimeout(_combatAnimDone, 624);

    } else if (data.statusType === 'paralysis') {
      _spawnPassiveFx(card, 'paralysis');
      // Icônes figées maintenant (le statut est déjà consommé côté moteur)
      const iconsHtml = combatant ? _renderStatusIcons(combatant) : null;
      _spawnPassiveBanner(card, 'Paralysé(e) !', null, {
        onRetreat: () => {
          if (iconsHtml === null) return;
          const ic = document.getElementById(`status-icons-${data.combatantId}`);
          if (ic) ic.innerHTML = iconsHtml;
        },
      });

    } else if (data.statusType === 'charm') {
      _spawnPassiveFx(card, 'charm');
      const iconsHtml = combatant ? _renderStatusIcons(combatant) : null;
      _spawnPassiveBanner(card, 'Charmé(e) !', null, {
        onRetreat: () => {
          if (iconsHtml === null) return;
          const ic = document.getElementById(`status-icons-${data.combatantId}`);
          if (ic) ic.innerHTML = iconsHtml;
        },
      });

    } else {
      if (combatant) _updateFighterCard(combatant);
      _combatAnimDone();
    }
  }
  /** Cherche un combattant (joueur ou ennemi) par son instanceId dans le combat en cours */
  function _findCombatantById(instanceId) {
    if (!_battle || !instanceId) return null;
    return [..._battle.playerTeam, ..._battle.enemyTeam].find(c => c.instanceId === instanceId) || null;
  }

  /** Fait apparaître une bannière flottante avec le nom du passif au-dessus du portrait */
  /**
   * Affiche le déclenchement d'un passif : un petit repère sur le portrait
   * concerné (qui a activé le passif) ET une grande bannière centrale, bien
   * plus visible, mise en file pour ne jamais se superposer à une autre.
   */
  /**
   * @param {HTMLElement} card - carte du combattant source du passif
   * @param {string} text - nom du passif affiché dans la bannière
   * @param {string} [secondaryText] - nom du passif copié (Mystère), affiché en swap
   * @param {object} [opts]
   * @param {Function} [opts.onRetreat] - callback exécuté 1s APRÈS que la bannière ait
   *        totalement disparu, juste avant de libérer la file d'animation. C'est ici
   *        (et seulement ici) que les changements de PV/icônes de statut liés à ce
   *        passif doivent être appliqués, pour ne jamais les montrer en même temps que
   *        le nom du passif à l'écran.
   */
  function _spawnPassiveBanner(card, text, secondaryText, opts = {}) {
    // Log mis à jour immédiatement
    const log = document.getElementById('battle-log');
    if (log && _battle?.log?.length) {
      log.innerHTML = [..._battle.log].reverse().slice(0, 8).map(l => `<div class="log-line">${l}</div>`).join('');
    }

    const srcPortrait = card?.querySelector('.fighter-portrait');
    if (!srcPortrait) {
      _queuePassiveBigBanner(text);
      // Même sans portrait à animer, on respecte le même délai après le retrait
      // (la petite bannière centrale reste affichée ~1500ms, cf. _runPassiveBigBannerQueue)
      setTimeout(() => {
        if (opts.onRetreat) {
          setTimeout(() => { opts.onRetreat(); _combatAnimDone(); }, 1000);
        } else {
          _combatAnimDone();
        }
      }, 1500);
      return;
    }

    const srcRect = srcPortrait.getBoundingClientRect();
    const SCALE   = 2.8;
    const scaledW = srcRect.width  * SCALE;
    const scaledH = srcRect.height * SCALE;
    const centerX = window.innerWidth  / 2 - scaledW / 2;
    const centerY = window.innerHeight / 2 - scaledH / 2 - 40;
    const bannerTop = `${centerY + scaledH + 14}px`;

    const clone = srcPortrait.cloneNode(true);
    clone.classList.remove('lunge-up','lunge-down','fighter-breathe','hit-flash',
                           'shake-hit','shake-big','level-up-flash');
    clone.style.cssText = `
      position:fixed; left:${srcRect.left}px; top:${srcRect.top}px;
      width:${srcRect.width}px; height:${srcRect.height}px;
      z-index:9999; pointer-events:none; border-radius:50%;
      box-shadow:0 0 16px rgba(150,100,255,.4); transition:none;
    `;
    document.body.appendChild(clone);

    // Bannière principale (nom du passif + sous-titre cible/effet, si fourni)
    const banner = document.createElement('div');
    banner.style.cssText = `
      position:fixed; left:50%; transform:translateX(-50%);
      top:${bannerTop}; z-index:10000; pointer-events:none;
      display:flex; flex-direction:column; align-items:center; gap:3px;
      background:linear-gradient(90deg,rgba(150,100,255,.1),rgba(150,100,255,.3),rgba(150,100,255,.1));
      border:1px solid rgba(150,100,255,.6); border-radius:24px;
      padding:8px 24px; font-family:var(--font-display);
      white-space:nowrap; opacity:0; transition:opacity 280ms ease;
    `;
    const bannerMain = document.createElement('div');
    bannerMain.style.cssText = `
      font-size:1rem; font-weight:800; color:#fff; letter-spacing:.08em;
      text-shadow:0 0 18px rgba(150,100,255,1);
    `;
    bannerMain.textContent = `✨ ${text}`;
    banner.appendChild(bannerMain);
    if (opts.subtitle) {
      const bannerSub = document.createElement('div');
      bannerSub.style.cssText = `
        font-size:.74rem; font-weight:700; color:#e9d8ff; letter-spacing:.03em;
        text-shadow:0 0 10px rgba(150,100,255,.8);
      `;
      bannerSub.textContent = opts.subtitle;
      banner.appendChild(bannerSub);
    }
    document.body.appendChild(banner);

    // Bannière secondaire (passif copié) — même position, style rose/or
    let banner2 = null;
    if (secondaryText) {
      banner2 = document.createElement('div');
      banner2.style.cssText = `
        position:fixed; left:50%; transform:translateX(-50%);
        top:${bannerTop}; z-index:10001; pointer-events:none;
        background:linear-gradient(90deg,rgba(244,63,94,.12),rgba(244,180,50,.25),rgba(244,63,94,.12));
        border:1px solid rgba(244,180,50,.8); border-radius:24px;
        padding:8px 24px; font-family:var(--font-display); font-size:1rem;
        font-weight:800; color:#fff; letter-spacing:.08em; white-space:nowrap;
        text-shadow:0 0 18px rgba(244,180,50,1); opacity:0; transition:opacity 280ms ease;
      `;
      banner2.textContent = `✦ Copie : ${secondaryText}`;
      document.body.appendChild(banner2);
    }

    srcPortrait.style.opacity = '0';

    // Phase 1 — portrait vers le centre ×2.8 (800ms)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clone.style.transition = [
        'left 624ms cubic-bezier(.22,.68,0,1.25)',
        'top 624ms cubic-bezier(.22,.68,0,1.25)',
        'width 624ms cubic-bezier(.22,.68,0,1.25)',
        'height 624ms cubic-bezier(.22,.68,0,1.25)',
        'box-shadow 624ms ease',
      ].join(',');
      clone.style.left      = `${centerX}px`;
      clone.style.top       = `${centerY}px`;
      clone.style.width     = `${scaledW}px`;
      clone.style.height    = `${scaledH}px`;
      clone.style.boxShadow = '0 0 70px rgba(150,100,255,1), 0 0 130px rgba(240,60,90,.45)';
    }));

    // Phase 2 — bannière Mystère apparaît (900ms)
    setTimeout(() => { banner.style.opacity = '1'; }, 702);

    // Phase 2b — si passif copié : swap des bannières (1600ms)
    if (banner2) {
      setTimeout(() => {
        banner.style.opacity  = '0';  // Mystère disparaît
        banner2.style.opacity = '1';  // passif copié apparaît
      }, 1248);
    }

    // Phase 3 — retour (600ms) à 2500ms
    setTimeout(() => {
      banner.style.opacity  = '0';
      if (banner2) banner2.style.opacity = '0';
      clone.style.transition = [
        'left 468ms cubic-bezier(.55,0,1,.45)',
        'top 468ms cubic-bezier(.55,0,1,.45)',
        'width 468ms ease',
        'height 468ms ease',
        'box-shadow 312ms ease',
      ].join(',');
      clone.style.left      = `${srcRect.left}px`;
      clone.style.top       = `${srcRect.top}px`;
      clone.style.width     = `${srcRect.width}px`;
      clone.style.height    = `${srcRect.height}px`;
      clone.style.boxShadow = 'none';
    }, 1950);

    // Phase 4 — nettoyage (~2.5s total)
    setTimeout(() => {
      clone.remove();
      banner.remove();
      banner2?.remove();
      srcPortrait.style.opacity = '';
      if (opts.onRetreat) {
        // La bannière a totalement disparu : on attend encore 1s avant d'appliquer
        // le changement de PV/statut, puis on libère la file d'animation.
        setTimeout(() => { opts.onRetreat(); _combatAnimDone(); }, 1000);
      } else {
        _combatAnimDone();
      }
    }, 2457);
  }

  let _passiveBigBannerQueue = [];
  let _passiveBigBannerBusy  = false;

  function _queuePassiveBigBanner(text) {
    _passiveBigBannerQueue.push(text);
    _runPassiveBigBannerQueue();
  }

  function _runPassiveBigBannerQueue() {
    if (_passiveBigBannerBusy || _passiveBigBannerQueue.length === 0) return;
    const scene = document.querySelector('.battle-scene');
    if (!scene) { _passiveBigBannerQueue = []; return; }

    _passiveBigBannerBusy = true;
    const text = _passiveBigBannerQueue.shift();

    const big = document.createElement('div');
    big.className = 'passive-banner-big';
    big.innerHTML = `<span class="passive-banner-big-icon">✨</span>${text}`;
    scene.appendChild(big);

    setTimeout(() => {
      big.remove();
      _passiveBigBannerBusy = false;
      _runPassiveBigBannerQueue();
    }, 1500);
  }

  /** Fait apparaître une petite animation visuelle adaptée à l'effet sur le portrait ciblé */
  function _spawnPassiveFx(card, variant) {
    const portrait = card?.querySelector('.fighter-portrait');
    if (!portrait) return;
    const fx = document.createElement('div');
    fx.className = `passive-fx passive-fx-${variant}`;
    portrait.appendChild(fx);
    setTimeout(() => fx.remove(), 1000);
  }

  /**
   * Joue l'animation complète d'une attaque : élan de l'attaquant vers la cible,
   * puis impact (flash, tremblement, nombres flottants) une fois le coup "porté".
   */
  function _playAttackAnimation(attacker, target, result, attackerHpSnapshot, targetHpSnapshot) {
    // Applique un PV figé (snapshot) à un combattant le temps de rafraîchir sa
    // carte, puis restaure sa valeur "live" pour les calculs suivants du moteur.
    const applySnapshotAndUpdate = (combatant, hpSnapshot) => {
      if (hpSnapshot !== undefined) {
        const saved = combatant.currentHp;
        combatant.currentHp = hpSnapshot;
        _updateFighterCard(combatant);
        combatant.currentHp = saved;
      } else {
        _updateFighterCard(combatant);
      }
    };
    // Le PV cible à afficher : hpAfter si le coup a touché, sinon le snapshot
    // pris avant l'attaque (cas d'une esquive, où hpAfter n'est pas fourni).
    const targetHpToShow = result.hpAfter !== undefined ? result.hpAfter : targetHpSnapshot;

    const attackerCard = document.getElementById(`fighter-${attacker.instanceId}`);
    const targetCard   = document.getElementById(`fighter-${target.instanceId}`);

    if (!attackerCard || !targetCard) {
      applySnapshotAndUpdate(target, targetHpToShow);
      _combatAnimDone(); return;
    }

    const srcPortrait = attackerCard.querySelector('.fighter-portrait');
    const tgtPortrait = targetCard.querySelector('.fighter-portrait');

    if (!srcPortrait) {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      _combatAnimDone(); return;
    }

    // Positions AVANT animation
    const srcRect = srcPortrait.getBoundingClientRect();
    const tgtRect = (tgtPortrait || targetCard).getBoundingClientRect();

    if (srcRect.width === 0) {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      applySnapshotAndUpdate(attacker, attackerHpSnapshot);
      setTimeout(_combatAnimDone, 100); return;
    }

    // Filet de sécurité : si la cible a une taille nulle (pas encore mise en
    // page, carte tout juste remplacée par une vague suivante...), impossible
    // de calculer une trajectoire fiable — on va directement à l'impact plutôt
    // que de risquer d'envoyer le portrait n'importe où sur l'écran.
    if (tgtRect.width === 0) {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      applySnapshotAndUpdate(attacker, attackerHpSnapshot);
      setTimeout(_combatAnimDone, 100); return;
    }

    // Déplacement en coordonnées écran → converti en unités locales
    // Le portrait est déjà en position normale, on anime via transform.
    // Le point d'arrivée est bridé pour rester dans l'écran (avec une marge),
    // afin que le portrait ne puisse jamais visuellement sortir du cadre —
    // même en cas de mise en page inhabituelle ou de mesure imprécise.
    const EDGE_MARGIN = 40;
    const srcCenterX = srcRect.left + srcRect.width  / 2;
    const srcCenterY = srcRect.top  + srcRect.height / 2;
    const tgtCenterX = Math.max(EDGE_MARGIN, Math.min(window.innerWidth  - EDGE_MARGIN, tgtRect.left + tgtRect.width  / 2));
    const tgtCenterY = Math.max(EDGE_MARGIN, Math.min(window.innerHeight - EDGE_MARGIN, tgtRect.top  + tgtRect.height / 2));
    const dx = tgtCenterX - srcCenterX;
    const dy = tgtCenterY - srcCenterY;

    // Stopper l'animation breathe pendant notre animation
    srcPortrait.style.animation = 'none';
    srcPortrait.style.transformOrigin = 'center center';
    srcPortrait.style.zIndex = '10';
    // Élever la CARTE entière pour que le portrait passe au-dessus des cartes voisines
    attackerCard.style.zIndex = '20';
    attackerCard.style.position = 'relative';

    // Phase 1 — zoom ×2 sur place (600ms)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      srcPortrait.style.transition = 'transform 468ms cubic-bezier(.22,.68,0,1.3), box-shadow 468ms ease';
      srcPortrait.style.transform  = 'scale(2)';
      srcPortrait.style.boxShadow  = '0 0 50px rgba(255,140,200,.9), 0 0 100px rgba(180,90,255,.5)';
    }));

    // Phase 2 — charge vers la cible (500ms)
    setTimeout(() => {
      srcPortrait.style.transition = 'transform 390ms cubic-bezier(.6,0,1,.4), box-shadow 234ms ease';
      srcPortrait.style.transform  = `translate(${dx}px, ${dy}px) scale(0.5)`;
      srcPortrait.style.boxShadow  = '0 0 6px rgba(255,140,200,.2)';
    }, 507);

    // Phase 3 — impact ET barre de vie strictement au même instant : c'est le
    // moment exact où le portrait "tape" la cible, ni avant, ni après.
    setTimeout(() => {
      _resolveImpact(targetCard, target, result);
      applySnapshotAndUpdate(target, targetHpToShow);
      _renderTurnOrderBar();
    }, 913);

    // Phase 4 — retour à la place et taille initiales (500ms), pendant que le
    // chiffre de dégâts/l'impact restent visibles sur la cible
    setTimeout(() => {
      srcPortrait.style.transition = 'transform 390ms cubic-bezier(.22,.68,0,1.2), box-shadow 312ms ease';
      srcPortrait.style.transform  = 'translate(0,0) scale(1)';
      srcPortrait.style.boxShadow  = '';
    }, 1030);

    // Phase 4b — nettoyage du portrait attaquant (déjà revenu à sa place), et
    // libération de la file d'animation (fin de la séquence complète)
    setTimeout(() => {
      srcPortrait.style.transition  = '';
      srcPortrait.style.transform   = '';
      srcPortrait.style.boxShadow   = '';
      srcPortrait.style.zIndex      = '';
      srcPortrait.style.animation   = '';
      srcPortrait.style.transformOrigin = '';
      attackerCard.style.zIndex = '';  // remettre la carte à son z-index normal
      applySnapshotAndUpdate(attacker, attackerHpSnapshot);
      _combatAnimDone();
    }, 1466);
  }

  /** Formate un multiplicateur de dégâts pour l'affichage (×2, ×0.5, ×2.25...) */
  function _formatMult(m) {
    if (m % 1 === 0) return String(m);
    return m.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function _resolveImpact(targetCard, target, result) {
    const targetPortrait = targetCard.querySelector('.fighter-portrait');

    if (result.evaded) {
      _spawnFloatText(targetCard, '💨 Esquive !', 'float-evade');
      return;
    }

    CWAudioSystem.playHitSfx(result.multiplier);

    targetPortrait?.classList.add('hit-flash', result.critical ? 'shake-big' : 'shake-hit');
    setTimeout(() => targetPortrait?.classList.remove('hit-flash', 'shake-big', 'shake-hit'), 480);

    _spawnFloatText(targetCard, `-${result.damage}`, result.critical ? 'float-dmg float-crit-dmg' : 'float-dmg', 0);

    if (result.critical) {
      _spawnFloatText(targetCard, 'CRITIQUE !', 'float-crit-label', 1);
    }

    if (result.multiplier >= 2.0) {
      _spawnFloatText(targetCard, `×${_formatMult(result.multiplier)} Super efficace !`, 'float-mult float-mult-super', result.critical ? 2 : 1);
    } else if (result.multiplier > 0 && result.multiplier <= 0.5) {
      _spawnFloatText(targetCard, `×${_formatMult(result.multiplier)} Peu efficace...`, 'float-mult float-mult-low', result.critical ? 2 : 1);
    } else if (result.multiplier === 0) {
      _spawnFloatText(targetCard, 'Aucun effet !', 'float-mult float-mult-immune', result.critical ? 2 : 1);
    }
  }

  /** Affiche un texte flottant temporaire au-dessus d'une carte de combattant */
  function _spawnFloatText(card, text, cls, stack = 0) {
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.style.setProperty('--stack', stack);
    el.textContent = text;
    card.appendChild(el);
    setTimeout(() => el.remove(), 1800); // +50% par rapport à l'ancienne durée (1200ms)
  }

  /**
   * Joue une animation de montée de niveau sur les cartes de combattants encore
   * affichées sur l'écran de combat (flash doré + texte flottant), à partir des
   * infos de level-up renvoyées par le moteur dans les récompenses de victoire.
   * @param {Object<string,{levelUps:number[], evolved:object|null}>} levelUpInfo
   */
  function _playLevelUpAnimations(levelUpInfo) {
    // L'affichage des level ups est dans _showBattleResult
    // Cette fonction gère uniquement les évolutions
    if (!levelUpInfo) return;
    const evolutionQueue = [];
    Object.values(levelUpInfo).forEach(info => {
      if (info.evolved) evolutionQueue.push(info.evolved);
    });
    if (evolutionQueue.length > 0) {
      setTimeout(() => _showEvolutionShowcase(evolutionQueue), 400);
    }
  }

  /**
   * Affiche un écran de révélation plein écran pour chaque évolution survenue,
   * enchaînées une par une (portrait agrandi, animation "punchy" du mot ÉVOLUTION).
   * Avance automatiquement après quelques secondes, ou au clic/tap.
   * @param {Array<object>} queue - Définitions des personnages après évolution
   */
  /**
   * Met en file une animation plein écran pour chaque évolution survenue,
   * enchaînées une par une (jamais simultanées, même si plusieurs créatures
   * évoluent lors du même combat) via la file d'animations commune.
   * @param {Array<object>} queue - Définitions des personnages après évolution
   */
  function _showEvolutionShowcase(queue) {
    if (!queue || queue.length === 0) return;
    const total = queue.length;

    queue.forEach((nextDef, i) => {
      _enqueueAnimation(() => {
        const state = CWGameState.get();
        const prevDef = state.characters.find(c => c.evolvesTo === nextDef.id) || nextDef;
        const stepInfo = total > 1 ? { index: i + 1, total } : null;

        return CWEvolutionAnimator.play(prevDef, nextDef, stepInfo).then(() => {
          _updateHUD();
          if (_currentScreen === 'collection') renderCollection();
          if (_currentScreen === 'team') renderTeam();
          if (_currentScreen === 'catalogue') renderCatalogue();
        });
      });
    });
  }

  /**
   * Affiche un écran de révélation plein écran lors d'une montée de niveau du
   * JOUEUR (distinct du niveau des créatures) : nom du joueur, mention "LVL UP",
   * gain d'énergie maximale, et confirmation du plein regain d'énergie.
   * Se ferme automatiquement après quelques secondes, ou au clic/tap.
   * @param {{levelUps:number[], newLevel:number, newMaxEnergy:number, energyGained:number}} data
   * @param {Function} [onDone] - Appelé une fois l'overlay refermé (clic ou délai)
   */
  function _showPlayerLevelUpShowcase(data, onDone) {
    if (!data || !data.levelUps || data.levelUps.length === 0) { onDone?.(); return; }

    let overlay = document.getElementById('player-levelup-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'player-levelup-overlay';
      overlay.className = 'player-levelup-overlay';
      document.body.appendChild(overlay);
    }

    const player = CWGameState.getPlayer();
    const plCfg = CWGameState.getConfig().playerLevel;
    const energyGained = data.energyGained ?? (data.levelUps.length * (plCfg?.energyPerLevel || 0));

    // Forcer le redémarrage de l'animation même si l'overlay existait déjà
    overlay.classList.remove('visible');
    overlay.innerHTML = `
      <div class="lvlup-burst"></div>
      <div class="lvlup-badge-wrap">
        <div class="lvlup-badge-level">${data.newLevel}</div>
      </div>
      <div class="lvlup-title">⭐ LVL UP ! ⭐</div>
      <div class="lvlup-name">${player.name}</div>
      <div class="lvlup-energy-line">⚡ Désir maximum +${energyGained}</div>
      <div class="lvlup-energy-line lvlup-energy-regen">🔋 Désir totalement restauré : ${data.newMaxEnergy}/${data.newMaxEnergy}</div>
      <div class="lvlup-hint">Touchez pour continuer</div>
    `;

    requestAnimationFrame(() => overlay.classList.add('visible'));
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);

    const close = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 300);
      overlay.onclick = null;
      onDone?.();
    };
    clearTimeout(overlay._lvlupCloseTimer);
    overlay._lvlupCloseTimer = setTimeout(close, 3500);
    overlay.onclick = () => { clearTimeout(overlay._lvlupCloseTimer); close(); };
  }

  function _updateFighterCard(combatant) {
    const card = document.getElementById(`fighter-${combatant.instanceId}`);
    if (!card) return;
    const hpPct = Math.round((combatant.currentHp / combatant.maxHp) * 100);
    const hpColor = hpPct > 60 ? '#4ade80' : hpPct > 25 ? '#facc15' : '#f87171';
    const fill = card.querySelector('.hp-bar-fill');
    const txt  = card.querySelector('.hp-text');
    if (fill) { fill.style.width = hpPct + '%'; fill.style.background = hpColor; }
    if (txt)  txt.textContent = combatant.alive ? `${combatant.currentHp} / ${combatant.maxHp}` : 'KO';
    if (!combatant.alive) {
      card.classList.add('defeated');
      card.style.animation = 'shake 0.4s ease';
    }
    // Rafraîchir les icônes d'altérations (statuts actifs + buff ATK)
    const iconsEl = document.getElementById(`status-icons-${combatant.instanceId}`);
    if (iconsEl) iconsEl.innerHTML = _renderStatusIcons(combatant);
  }

  function _showBattleResult(result, data) {
    const isVictory = result === 'victory';
    const battle    = CWCombatEngine.getBattle();

    CWAudioSystem.playResultSfx(result);
    document.getElementById('battle-result-overlay')?.remove();

    const capturable = isVictory ? (battle?.capturable?.filter(c => !c.captured) || []) : [];
    const captureHtml = capturable.length ? `
      <div class="bro-capture">
        <h4 class="bro-capture-title">💋 Tentatives de séduction</h4>
        <div class="bro-capture-btns">
          ${capturable.map(c => `
            <button class="btn-capture" data-iid="${c.instanceId}" data-char-id="${c.charId}">
              Séduire ${c.name}${c.mergedCount > 1 ? ` ×${c.mergedCount}` : ''} (${Math.round(c.captureRate*100)}%)
            </button>`).join('')}
        </div>
        <div id="capture-reveal"></div>
        <div id="capture-log"></div>
      </div>` : '';

    // L'overlay s'insère dans .app-shell pour prendre exactement la taille de l'écran de jeu
    const shell = document.querySelector('.app-shell') || document.body;

    const overlay = document.createElement('div');
    overlay.id = 'battle-result-overlay';
    overlay.style.cssText = `
      position:absolute; inset:0; z-index:8000;
      background:#09040f;
      display:flex; flex-direction:column; align-items:center; justify-content:flex-start;
      overflow-y:auto; padding:32px 20px 40px;
      opacity:0; transition:opacity 500ms ease;
    `;

    if (isVictory) {
      // Construire le HTML des level ups
      const levelUps = data.rewards?.levelUps || {};
      const luEntries = Object.entries(levelUps);
      const state = CWGameState.get();

      const levelUpHtml = luEntries.length > 0 ? `
        <div class="bro-levelup-section">
          <div class="bro-levelup-title">⬆️ Montée${luEntries.length > 1 ? 's' : ''} de niveau</div>
          ${luEntries.map(([instanceId, info]) => {
            const inst   = state.player.collection.find(c => c.instanceId === instanceId);
            const def    = inst ? CWGameState.getCharDef(inst.charId) : null;
            const oldLvl = info.levelUps[0] - 1;
            const newLvl = info.levelUps[info.levelUps.length - 1];
            const rd     = CWGameDatabase.RARITIES[def?.rarity || 'common'] || {};
            const crop   = def?.portraitCrop || CWGameDatabase.defaultPortraitCrop?.() || {};
            // Gains de stats
            const so = info.statsOld || {};
            const sn = info.statsNew || {};
            const diff = (k) => { const d = (sn[k]||0)-(so[k]||0); return d > 0 ? `<span class="bro-stat-chip">+${Math.round(d)} ${k==='hp'?'❤️':k==='atk'?'⚔️':k==='def'?'🛡️':'💨'}</span>` : ''; };
            return `<div class="bro-levelup-row">
              <div class="bro-levelup-portrait">
                ${def?.portrait
                  ? `<img src="${def.portrait}" alt="${def.name}" style="object-position:${crop.cx||50}% ${crop.cy||30}%">`
                  : '<span>🎭</span>'}
              </div>
              <div class="bro-levelup-info">
                <div class="bro-levelup-name">${def?.name || 'Inconnue'}</div>
                <div class="bro-levelup-lvl">
                  <span class="bro-lvl-old">Niv.${oldLvl}</span>
                  <span class="bro-lvl-arr">→</span>
                  <span class="bro-lvl-new">Niv.${newLvl}</span>
                  ${info.evolved ? `<span class="bro-evolved-badge">✨ ÉVOLUTION</span>` : ''}
                </div>
                <div class="bro-stat-chips">${diff('hp')}${diff('atk')}${diff('def')}${diff('spd')}</div>
              </div>
            </div>`;
          }).join('')}
        </div>` : '';

      overlay.innerHTML = `
        <div class="bro-victory-top">
          <div class="bro-particles" id="victory-particles"></div>
          <div class="bro-glow-ring"></div>
          <div class="bro-title">✨ VICTOIRE ✨</div>
          <div class="bro-survivors" id="victory-survivors"></div>
          <div class="bro-subtitle">Combat remporté avec brio</div>
        </div>
        ${battle?.mode === 'story' && battle.storyWorld != null ? `
          <div class="bro-story-label">
            ✨ Sanctuaire ${battle.storyWorld} — Rendez-vous ${battle.storySubLevel} accompli !
          </div>` : ''}
        ${data.rewards ? `
          <div class="bro-rewards">
            <span>+${data.rewards.xpEarned} <small>XP</small></span>
            <span>+${data.rewards.gold} 💵</span>
            <span>+${data.rewards.diamonds} 💎</span>
            ${data.rewards.energyPotionsDropped > 0 ? `<span>+${data.rewards.energyPotionsDropped} 🧪</span>` : ''}
          </div>
          ${data.rewards.eliteBonusGold > 0 ? `
            <div class="bro-bonus-badge bro-bonus-elite">⚔️ Bonus Élite +${data.rewards.eliteBonusGold} 💵</div>` : ''}
          ${data.rewards.bossBonusDiamonds > 0 ? `
            <div class="bro-bonus-badge bro-bonus-boss">👑 Bonus Boss +${data.rewards.bossBonusDiamonds} 💎</div>` : ''}
        ` : ''}
        ${levelUpHtml}
        ${captureHtml}
        <button class="btn-primary bro-back-btn" id="btn-back-lobby">Retour au lobby</button>
      `;
    } else if (result === 'record') {
      const r = data.rewards || {};
      overlay.innerHTML = `
        <div class="bro-victory-top">
          <div class="bro-particles" id="victory-particles"></div>
          <div class="bro-glow-ring"></div>
          <div class="bro-title">📊 RUN TERMINÉ</div>
          <div class="bro-subtitle">${(battle?.recordMaxTurns ?? 15)} tours écoulés</div>
        </div>
        <div class="bro-rewards" style="font-size:1.3rem;font-weight:800;">
          <span>${(r.recordScore||0).toLocaleString('fr-FR')} points</span>
        </div>
        <div style="text-align:center;font-size:.85rem;color:#94a3b8;margin:4px 0 12px;">
          💀 ${r.recordKills||0} ennemi${(r.recordKills||0)>1?'s':''} vaincu${(r.recordKills||0)>1?'s':''}
        </div>
        ${r.isNewBest ? `
          <div class="bro-bonus-badge bro-bonus-boss">🏆 Nouveau record personnel !</div>
        ` : `
          <div style="text-align:center;font-size:.8rem;color:#94a3b8;margin-bottom:8px;">
            Ton record : ${(r.previousBest||0).toLocaleString('fr-FR')} points
          </div>
        `}
        <div style="text-align:center;font-size:.8rem;color:#c4b5fd;margin-bottom:12px;">
          🎁 Va réclamer tes récompenses depuis le totem de Performance !
        </div>
        <button class="btn-primary bro-back-btn" id="btn-back-lobby">Retour au lobby</button>
      `;
    } else {
      overlay.innerHTML = `
        <div class="bro-defeat-top">
          <div class="bro-defeat-icon">💀</div>
          <div class="bro-defeat-title">Défaite...</div>
          <div class="bro-defeat-sub">Elles étaient trop fortes cette fois</div>
        </div>
        ${battle?.mode === 'story' && battle.storyWorld != null ? `
          <div class="bro-story-label" style="color:#f87171">
            💢 Sanctuaire ${battle.storyWorld} — Rendez-vous ${battle.storySubLevel} — Réessaie !
          </div>` : ''}
        <button class="btn-primary bro-back-btn" id="btn-back-lobby">Retour au lobby</button>
      `;
    }

    shell.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => { overlay.style.opacity = '1'; }));

    // Animations de victoire
    if (isVictory && battle) {
      const survivors  = battle.playerTeam.filter(c => c.alive);
      const survivorsEl = document.getElementById('victory-survivors');
      const particlesEl = document.getElementById('victory-particles');

      survivors.forEach((c, i) => {
        const srcPortrait = document.getElementById(`fighter-${c.instanceId}`)?.querySelector('.fighter-portrait');
        const wrap = document.createElement('div');
        wrap.className = 'bro-survivor-wrap';
        wrap.style.animationDelay = `${200 + i * 150}ms`;

        // Reproduire le cercle de combat à 300% : même taille que fighter-portrait (74px)
        // affiché via scale(3) pour le zoom ×3
        const circle = document.createElement('div');
        circle.className = 'bro-survivor-circle';
        // Récupérer le style de bordure (couleur de rareté) du portrait original
        if (srcPortrait) {
          const borderColor = window.getComputedStyle(srcPortrait).borderColor;
          circle.style.borderColor = borderColor;
          circle.style.boxShadow   = `0 0 0 3px rgba(0,0,0,.4), 0 0 20px ${borderColor}`;
        }

        // Contenu : image avec son crop exact
        if (srcPortrait) {
          const img = srcPortrait.querySelector('img');
          if (img) {
            const ic = img.cloneNode(true);
            // Reprendre exactement le style de l'image original (position du crop)
            ic.style.animation = 'none';
            circle.appendChild(ic);
          } else {
            // Fallback : texte placeholder
            circle.textContent = srcPortrait.textContent;
          }
        }

        wrap.appendChild(circle);
        survivorsEl?.appendChild(wrap);
      });

      const PARTS = ['💎','✨','💕','🌸','⭐','💫','💖','🌺','👑','🔮','🫦','💄'];
      for (let i = 0; i < 22; i++) {
        const p = document.createElement('div');
        p.textContent = PARTS[i % PARTS.length];
        p.className   = 'bro-particle';
        p.style.left  = `${2 + Math.random() * 96}%`;
        p.style.animationDuration = `${1.2 + Math.random() * 1.1}s`;
        p.style.animationDelay    = `${Math.random() * 1.2}s`;
        p.style.fontSize = `${1 + Math.random() * 1.3}rem`;
        particlesEl?.appendChild(p);
      }
    }

    document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
      // Capturer mode et chapitre AVANT le reset de _battle
      const battleMode    = _battle?.mode;
      const battleChapter = _battle?.storyChapter ?? _storyCurrentChapter;

      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.remove();
        CWCombatEngine.reset();
        _battle = null;
        CWAudioSystem.playGlobal();

        if (battleMode === 'storyMode') {
          // Mode Histoire → retour au chapitre en cours
          showScreen('story-chapter');
          renderStoryChapter(battleChapter);
        } else if (battleMode === 'tutorial') {
          showScreen('hub');
        } else if (battleMode === 'record') {
          // Mode Performance → retour à son écran d'accueil dédié
          showScreen('record');
        } else {
          // Tous les autres modes → écran de sélection des combats
          _showCombatSelect();
        }
      }, 500);
    });

    overlay.querySelectorAll('.btn-capture').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = CWCombatEngine.attemptCapture(btn.dataset.iid);
        const revealEl = document.getElementById('capture-reveal');
        const logEl    = document.getElementById('capture-log');
        btn.disabled = true;
        if (res?.success) {
          btn.style.background = '#4ade80';
          btn.textContent = '✓ Séduite !';
          const awakeningMax = _checkAwakeningMaxAndGrantPill(res.addResult);
          _updateHUD();
          _playCaptureReveal(revealEl, btn.dataset.charId, res.addResult, awakeningMax);
        } else {
          btn.style.background = '#f87171';
          btn.textContent = '✗ Raté';
          if (logEl) logEl.innerHTML += `<div class="log-line">Elle s'échappe...</div>`;
        }
      });
    });
  }

  /**
   * Joue l'animation de révélation (retournement de carte) d'un personnage capturé,
   * en réutilisant exactement le même système que pour une obtention par Gacha :
   * "NOUVEAU !" s'il vient de rejoindre la collection, "Awakening +1" s'il était déjà
   * possédé, ou "AWAKENING MAX" avec Pillule de Puissance s'il atteint le palier max.
   * @param {HTMLElement} container - où injecter la carte
   * @param {string} charId - ID de la définition du personnage capturé
   * @param {{isNew:boolean, awakening:boolean, instance:object}} addResult
   * @param {boolean} awakeningMax
   */
  function _playCaptureReveal(container, charId, addResult, awakeningMax) {
    if (!container || !addResult) return;
    const state = CWGameState.get();
    const char  = CWGameState.getCharDef(charId);
    if (!char) return;

    // Remplace toute révélation précédente plutôt que de l'empiler dessous
    container.innerHTML = '';

    const wrapId = `capture-reveal-${Date.now()}-${Math.floor(Math.random()*1000)}`;
    const holder = document.createElement('div');
    holder.className = 'capture-reveal-holder';
    holder.innerHTML = `
      <div class="gacha-card-wrap" id="${wrapId}">
        <div class="gacha-card-inner">
          <div class="gacha-card-back">
            <div class="gacha-card-back-glow"></div>
            <div class="gacha-card-back-icon">✦</div>
          </div>
          <div class="gacha-card-front"></div>
        </div>
      </div>
    `;
    container.appendChild(holder);

    const result = { char, isNew: addResult.isNew, awakening: addResult.awakening, awakeningMax };
    setTimeout(() => _flipCard(null, result, state, wrapId), 250);
  }

  // ─── GACHA ────────────────────────────────────────────────────────────────────

  function _toggleBannerInfo(btn) {
    if (typeof event !== 'undefined') event.stopPropagation();
    document.querySelectorAll('.banner-info-panel.open').forEach(p => {
      p.classList.remove('open'); p.style.cssText = '';
    });
    const panelId = btn.dataset.panelId;
    const panel   = document.getElementById(panelId);
    if (!panel) return;
    if (panel.classList.contains('open')) {
      panel.classList.remove('open'); panel.style.cssText = ''; return;
    }
    const rect     = btn.getBoundingClientRect();
    const shell    = document.querySelector('.app-shell');
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const panelW   = 224;
    let left = rect.left;
    if (left + panelW > shellRect.right - 8) left = shellRect.right - panelW - 8;
    if (left < shellRect.left + 8)           left = shellRect.left + 8;
    panel.classList.add('open');
    panel.style.cssText = `display:block;position:fixed;left:${left}px;top:${rect.bottom + 6}px;width:${panelW}px;z-index:9000;`;
    setTimeout(() => {
      const close = (e) => {
        if (!panel.contains(e.target) && e.target !== btn) {
          panel.classList.remove('open'); panel.style.cssText = '';
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 50);
  }

  function renderGacha() {
    const el = document.getElementById('screen-gacha');
    if (!el) return;
    const state = CWGameState.get();

    el.innerHTML = `
      <div class="screen-header"><h2>💎 Rencontres</h2>${_helpBtn('gacha')}</div>
      <div class="gacha-tabs">
        <button class="gacha-tab ${_gachaTab === 'chars' ? 'active' : ''}" data-tab="chars">💎 Personnages</button>
        <button class="gacha-tab ${_gachaTab === 'equip' ? 'active' : ''}" data-tab="equip">💍 Parures</button>
      </div>
      <div id="gacha-tab-content"></div>
      <div id="gacha-results"></div>
    `;

    el.querySelectorAll('.gacha-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _gachaTab = btn.dataset.tab;
        document.querySelectorAll('.gacha-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _gachaTab));
        _renderGachaTabContent();
        document.getElementById('gacha-results').innerHTML = '';
      });
    });

    _renderGachaTabContent();
  }

  function _renderGachaTabContent() {
    const el = document.getElementById('gacha-tab-content');
    if (!el) return;
    const state = CWGameState.get();

    if (_gachaTab === 'chars') {
      const cfg     = state.config.gacha;
      const ev      = CWGameState.getActiveEvent();
      const tag     = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;
      // On cherche une bannière event explicite, sinon on la génère depuis l'event
      const banners = state.banners.filter(b => b.active && b.id !== 'banner_event');

      // Helper : bulle d'info d'une bannière (persos disponibles + taux)
      const bannerInfoBubble = (bannerId, dropRates, poolTagId, poolTypeId, poolMode) => {
        const RARITY_ORDER = ['mythic','legendary','epic','rare','uncommon','common'];
        let pool = state.characters.filter(c => c.evolutionStage === 0);
        if (poolMode === 'tag'  && poolTagId)  pool = pool.filter(c => c.tags?.includes(poolTagId));
        if (poolMode === 'type' && poolTypeId) pool = pool.filter(c => c.type1 === poolTypeId || c.type2 === poolTypeId);

        const counts = {};
        pool.forEach(c => { counts[c.rarity] = (counts[c.rarity]||0)+1; });

        const rows = RARITY_ORDER.filter(r => counts[r] || (dropRates?.[r] > 0)).map(r => {
          const rd   = CWGameDatabase.RARITIES[r] || {};
          const rate = dropRates?.[r] ?? 0;
          const nb   = counts[r] ?? 0;
          return `<div class="banner-info-row">
            <span class="banner-info-rarity" style="color:${rd.color||'#aaa'}">${rd.name||r}</span>
            <span class="banner-info-count">${nb} perso${nb>1?'s':''}</span>
            <span class="banner-info-rate">${rate > 0 ? rate + '%' : '—'}</span>
          </div>`;
        }).join('');

        const uid = 'bip_' + bannerId.replace(/[^a-z0-9]/gi,'_');
        return `
          <button class="banner-info-btn" data-panel-id="${uid}" onclick="CWGameUI._toggleBannerInfo(this)" aria-label="Informations bannière">ℹ️</button>
          <div class="banner-info-panel" id="${uid}">
            <div class="banner-info-title">Personnages disponibles</div>
            <div class="banner-info-header-row">
              <span>Rareté</span><span>Nb</span><span>Taux</span>
            </div>
            ${rows}
            <div class="banner-info-total">${pool.length} personnage${pool.length>1?'s':''} au total</div>
          </div>`;
      };

      // Bannière event — sans taux affichés directement (dans la bulle uniquement)
      const eventBannerHtml = ev ? `
        <div class="banner-card banner-card-event" style="position:relative">
          ${bannerInfoBubble('banner_event', ev.bannerRates, ev.tagId, null, 'tag')}
          <div class="banner-event-badge">✨ EVENT — ${tag?.icon || ''}${tag?.name || 'Event'}</div>
          <div class="banner-header">
            <h3>Rencontre ${tag?.name || 'Event'}</h3>
            <p>Invocations exclusives — personnages ${tag?.name || 'Event'} uniquement</p>
          </div>
          <div class="banner-actions">
            <button class="btn-gacha btn-single btn-gacha-event" data-banner="banner_event">
              ✦ Rencontrer ×1<br><small>${cfg.singlePullCost} 💎</small>
            </button>
            <button class="btn-gacha btn-ten btn-gacha-event" data-banner="banner_event">
              ✦✦ Rencontrer ×10<br><small>${cfg.tenPullCost} 💎</small>
            </button>
          </div>
        </div>` : '';

      el.innerHTML = `
        <div class="gacha-currency">
          <span class="hud-icon">💎</span>
          <span>${state.player.currency.crystals.toLocaleString()} Diamants</span>
        </div>
        <div class="banner-list">
          ${eventBannerHtml}
          ${banners.map(b => `
            <div class="banner-card" style="position:relative">
              ${bannerInfoBubble(b.id, cfg.dropRates || {}, b.poolTagId, b.poolTypeId, b.pool)}
              <div class="banner-header"><h3>${b.name}</h3><p>${b.description}</p></div>
              <div class="banner-actions">
                <button class="btn-gacha btn-single" data-banner="${b.id}">
                  ✦ Rencontrer ×1<br><small>${cfg.singlePullCost} 💎</small>
                </button>
                <button class="btn-gacha btn-ten" data-banner="${b.id}">
                  ✦✦ Rencontrer ×10<br><small>${cfg.tenPullCost} 💎</small>
                </button>
              </div>
            </div>`).join('')}
        </div>`;
      el.querySelectorAll('.btn-single').forEach(btn => btn.addEventListener('click', () => _doGachaPull(btn.dataset.banner, 1)));
      el.querySelectorAll('.btn-ten').forEach(btn => btn.addEventListener('click', () => _doGachaPull(btn.dataset.banner, 10)));

    } else {
      // Gacha équipements
      const equipBanners = (state.equipBanners || []).filter(b => b.active);
      el.innerHTML = `
        <div class="gacha-currency">
          <span class="hud-icon">💵</span>
          <span>${(state.player.currency.gold || 0).toLocaleString()} $</span>
        </div>
        <div class="banner-list">
          ${equipBanners.map(b => `
            <div class="banner-card equip-banner-card">
              <div class="banner-header"><h3>${b.name}</h3><p>${b.description}</p></div>
              <div class="banner-actions">
                <button class="btn-gacha btn-single btn-equip-pull" data-banner="${b.id}" data-count="1">
                  ⚙️ Obtenir ×1<br><small>${b.singlePullCost} 💵</small>
                </button>
                <button class="btn-gacha btn-ten btn-equip-pull" data-banner="${b.id}" data-count="10">
                  ⚙️⚙️ Obtenir ×10<br><small>${b.tenPullCost} 💵</small>
                </button>
              </div>
            </div>`).join('')}
          ${equipBanners.length === 0 ? '<p class="empty-msg">Aucun défilé de parures actif.</p>' : ''}
        </div>`;
      el.querySelectorAll('.btn-equip-pull').forEach(btn => {
        btn.addEventListener('click', () => _doEquipGachaPull(btn.dataset.banner, Number(btn.dataset.count)));
      });
    }
  }

  function _doGachaPull(bannerId, count) {
    // Désactiver les boutons pendant l'animation
    document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    const results = count === 1
      ? [CWGachaSystem.pullSingle(bannerId)]
      : CWGachaSystem.pullTen(bannerId);

    if (results[0]?.error) {
      _showToast(results[0].error, 'error');
      document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = false; b.style.opacity = ''; });
      return;
    }

    // ── Détection Awakening Max + attribution Pillule ──────────────────────────
    results.forEach(r => { r.awakeningMax = _checkAwakeningMaxAndGrantPill(r); });

    _updateHUD();
    _showGachaAnimation(results, () => {
      document.querySelectorAll('.btn-gacha').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    });
  }

  /**
   * Détecte si un résultat d'obtention (gacha ou capture) fait atteindre l'awakening
   * maximum à un personnage déjà possédé, et lui octroie une Pillule de Puissance
   * le cas échéant. Renvoie true si l'awakening max vient d'être atteint.
   * @param {{awakening?:boolean, instance?:object}} addResult
   * @returns {boolean}
   */
  function _checkAwakeningMaxAndGrantPill(addResult) {
    const maxAwk = CWGameState.getConfig().awakening.maxLevel;
    const isMax = !!(addResult?.awakening && addResult.instance && (addResult.instance.awakening || 0) >= maxAwk);
    if (isMax) {
      const p = CWGameState.getPlayer();
      const inv = { ...(p.inventory || {}) };
      inv['item_power_pill'] = (inv['item_power_pill'] || 0) + 1;
      CWGameState.updatePlayer({ inventory: inv });
    }
    return isMax;
  }

  /**
   * Affiche l'animation de tirage gacha.
   * Chaque carte apparaît face cachée puis se retourne pour révéler le personnage.
   * @param {Array} results - Résultats du tirage
   * @param {Function} onDone - Callback une fois l'animation terminée
   */
  function _showGachaAnimation(results, onDone) {
    const el = document.getElementById('gacha-results');
    if (!el) { onDone?.(); return; }

    const state = CWGameState.get();

    // Construire la grille de cartes dos initial
    el.innerHTML = `<div class="gacha-result-grid" id="gacha-anim-grid">
      ${results.map((_, i) => `
        <div class="gacha-card-wrap" id="gacha-card-${i}">
          <div class="gacha-card-inner">
            <div class="gacha-card-back">
              <div class="gacha-card-back-glow"></div>
              <div class="gacha-card-back-icon">✦</div>
            </div>
            <div class="gacha-card-front"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <button class="btn-primary gacha-skip-btn" id="gacha-skip-btn" style="margin-top:16px;">⏩ Passer l'animation</button>`;

    el.scrollIntoView({ behavior: 'smooth' });

    let cancelled = false;
    const skipBtn = document.getElementById('gacha-skip-btn');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        cancelled = true;
        _revealAll(results, state, el, onDone);
      });
    }

    // Révéler les cartes une à une avec délai
    results.forEach((r, i) => {
      const delay = cancelled ? 0 : (results.length === 1 ? 400 : i * 220 + 300);
      setTimeout(() => {
        if (cancelled) return;
        _flipCard(i, r, state);
        // Après le dernier, retirer le bouton skip
        if (i === results.length - 1) {
          setTimeout(() => {
            const s = document.getElementById('gacha-skip-btn');
            if (s) s.style.display = 'none';
            onDone?.();
          }, 600);
        }
      }, delay);
    });
  }

  /** Retourne une carte individuelle et affiche son contenu */
  function _flipCard(index, result, state, elementId = `gacha-card-${index}`) {
    const wrap = document.getElementById(elementId);
    if (!wrap) return;

    const rarityDef = CWGameDatabase.RARITIES[result.char.rarity] || {};
    const t1 = state.types.find(t => t.id === result.char.type1);

    // ── Construire le statut (nouveau / awakening / max) ────────────────────
    let statusHtml;
    if (result.awakeningMax) {
      statusHtml = `<div class="gacha-status status-awk-max">★ SUBLIMATION MAX ★<br><small>💊 Élixir de Prestige !</small></div>`;
    } else if (result.awakening) {
      statusHtml = `<div class="gacha-status">✨ Sublimation +1</div>`;
    } else if (result.isNew) {
      statusHtml = `<div class="gacha-status status-new">✦ NOUVEAU !</div>`;
    } else {
      statusHtml = `<div class="gacha-status"></div>`;
    }

    // Remplir le front avant le flip
    const front = wrap.querySelector('.gacha-card-front');
    if (front) {
      front.innerHTML = `
        <div class="gacha-portrait">
          ${result.char.portrait
            ? `<img src="${result.char.portrait}" alt="${result.char.name}">`
            : `<div class="portrait-ph">${result.char.name.charAt(0)}</div>`}
        </div>
        <div class="gacha-info">
          <div class="gacha-name">${result.char.name}</div>
          <div class="gacha-rarity" style="color:${rarityDef.color}">${rarityDef.name}</div>
          ${t1 ? `<div class="gacha-type"><span class="type-badge" style="background:${t1.color}">${t1.icon}</span></div>` : ''}
          ${statusHtml}
        </div>
      `;
    }

    // Classes spéciales pour les états
    wrap.classList.add(`rarity-${result.char.rarity}`);
    wrap.style.setProperty('--rarity-color', rarityDef.color || '#888');
    if (result.isNew)        wrap.classList.add('is-new');
    if (result.awakeningMax) wrap.classList.add('is-awk-max');

    // Déclencher le flip CSS
    wrap.classList.add('flipped');
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.gachaPull);

    // ── Animations post-flip ─────────────────────────────────────────────────
    const highRarity = ['epic','legendary','mythic'].includes(result.char.rarity);
    if (highRarity) {
      setTimeout(() => wrap.classList.add('gacha-card-shine'), 500);
    }

    // Burst "Nouveau !" flottant
    if (result.isNew && !result.awakeningMax) {
      setTimeout(() => {
        const badge = document.createElement('div');
        badge.className = 'new-char-burst';
        badge.textContent = '✦ NOUVEAU !';
        wrap.appendChild(badge);
        setTimeout(() => badge.remove(), 1400);
      }, 580);
    }
  }

  /** Révèle immédiatement toutes les cartes (skip) */
  function _revealAll(results, state, el, onDone) {
    const skipBtn = document.getElementById('gacha-skip-btn');
    if (skipBtn) skipBtn.style.display = 'none';

    results.forEach((r, i) => {
      setTimeout(() => _flipCard(i, r, state), i * 40);
    });

    setTimeout(() => onDone?.(), results.length * 40 + 300);
  }

  // ─── ÉQUIPEMENT ──────────────────────────────────────────────────────────────

  /**
   * Écran principal de gestion des équipements.
   * Deux panneaux : sélection du perso + gestion des slots, et utilisation des items.
   */
  function renderEquip() {
    const el = document.getElementById('screen-equip');
    if (!el) return;

    // Le squelette complet n'est reconstruit qu'à la toute première ouverture de
    // l'écran ; ensuite, chaque interaction passe par les fonctions de
    // rafraîchissement partiel (_refreshEquipCharPicker, _refreshEquipSlots,
    // _refreshEquipSlotPanel, _refreshEquipInvGrid) pour éviter de tout
    // reconstruire (et perdre la position de scroll) à chaque clic.
    if (el.dataset.built === '1') {
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
      _showAutoEquipResult();
      return;
    }
    el.dataset.built = '1';

    el.innerHTML = `
      <div class="screen-header"><h2>💍 Parures</h2>${_helpBtn('equip')}</div>

      <div class="equip-top-zone">
        <div id="auto-equip-result"></div>

        <!-- ── Sélection du personnage ── -->
        <div class="equip-section" style="margin-bottom:10px">
          <div class="equip-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <span>Choisir un personnage</span>
            ${_renderSortSelect('equip-sort', _equipSort)}
          </div>
          <div class="equip-unequipped-filters" id="equip-unequipped-filters">
            ${EQUIP_SLOT_ORDER.map(slotKey => `
              <label class="equip-unequipped-filter-chip">
                <input type="checkbox" class="chk-unequipped-slot" data-slot-key="${slotKey}" ${_equipUnequippedFilter[slotKey] ? 'checked' : ''}>
                Sans ${EQUIP_SLOT_LABELS[slotKey]}
              </label>
            `).join('')}
          </div>
          <div class="equip-char-picker" id="equip-char-picker"></div>
        </div>

        <!-- ── Slots d'équipement ── -->
        <div id="equip-slots-section"></div>

        <!-- ── Panneau inline de sélection (remplace le modal) ── -->
        <div id="equip-slot-panel-container"></div>
      </div>

      <!-- ── Inventaire équipements (zone basse, scrollable) ── -->
      <div class="equip-section" id="equip-inv-section">
        <div class="equip-section-title">Parures en stock <span class="badge" id="equip-inv-count">${CWGameState.getPlayer().equipInventory?.length || 0}</span></div>
        ${_renderEquipInventorySection()}
      </div>
    `;

    document.getElementById('equip-sort')?.addEventListener('change', e => {
      _equipSort = e.target.value;
      _refreshEquipCharPicker();
    });

    document.querySelectorAll('.chk-unequipped-slot').forEach(chk => {
      chk.addEventListener('change', e => {
        _equipUnequippedFilter[e.target.dataset.slotKey] = e.target.checked;
        _refreshEquipCharPicker();
      });
    });

    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _bindEquipInventorySection();
  }

  /**
   * Génère la structure de la section "Parures en stock" : 3 onglets
   * (Armes / Armures / Accessoires), chacun avec son propre tri et ses filtres.
   */
  function _renderEquipInventorySection() {
    return `
      <div class="equip-inv-tabs">
        ${EQUIP_SLOT_ORDER.map(slotKey => `
          <button class="equip-inv-tab-btn ${_equipInvTab === slotKey ? 'active' : ''}" data-slot-tab="${slotKey}">
            ${EQUIP_SLOT_LABELS[slotKey]}
          </button>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
        <button id="btn-auto-equip" style="background:linear-gradient(135deg,var(--accent2),var(--accent2-deep));border:none;border-radius:999px;color:#fff;font-size:.74rem;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap">⚡ Parure auto</button>
        <button id="btn-unequip-all" style="background:var(--danger);border:none;border-radius:999px;color:#fff;font-size:.74rem;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap">🗑️ Déséquiper tout</button>
      </div>
      <div class="screen-controls">
        ${_renderEquipSortSelect('equip-inv-sort', _equipInvSort[_equipInvTab])}
      </div>
      ${_renderEquipFilterBar('equip-inv', _equipInvFilters[_equipInvTab])}
      <div class="equip-inv-grid" id="equip-inv-grid"></div>
    `;
  }

  /** Lie les onglets, le tri et les filtres de la section inventaire d'équipement */
  function _bindEquipInventorySection() {
    document.querySelectorAll('.equip-inv-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _equipInvTab = btn.dataset.slotTab;
        const container = document.getElementById('equip-inv-section');
        if (container) {
          const badge = `<span class="badge" id="equip-inv-count">${CWGameState.getPlayer().equipInventory?.length || 0}</span>`;
          container.innerHTML = `<div class="equip-section-title">Parures en stock ${badge}</div>${_renderEquipInventorySection()}`;
          _bindEquipInventorySection();
        }
      });
    });

    // Bouton déséquiper tout
    document.getElementById('btn-unequip-all')?.addEventListener('click', () => {
      _clearAutoEquipResult();
      _unequipAll();
      _equipSlotOpen = null;
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    // Bouton équipement automatique
    document.getElementById('btn-auto-equip')?.addEventListener('click', () => {
      _equipSlotOpen = null;
      _autoEquip();
      _refreshEquipCharPicker();
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    document.getElementById('equip-inv-sort')?.addEventListener('change', e => {
      _equipInvSort[_equipInvTab] = e.target.value;
      _refreshEquipInvGrid();
    });
    _bindEquipFilterBar('equip-inv', _equipInvFilters[_equipInvTab], _refreshEquipInvGrid);

    _refreshEquipInvGrid();
  }

  /** Déséquipe tous les équipements de tous les personnages */
  function _unequipAll() {
    const state = CWGameState.get();
    state.player.collection.forEach(inst => {
      for (let slot = 0; slot < 3; slot++) {
        if (inst.equipment?.[slot]) {
          CWGameState.equipItem(inst.instanceId, slot, null);
        }
      }
    });
    _showToast('Tous les équipements ont été retirés.', 'info');
  }

  /**
   * Équipement automatique : déséquipe tout, puis équipe les meilleures pièces
   * aux meilleurs personnages (classés par niveau puis rareté).
   * Stratégie : trier les persos du meilleur au moins bon, trier les items
   * par "score total de bonus" décroissant, assigner slot par slot.
   * Le résultat (qui a reçu quoi) est mémorisé dans _autoEquipResult pour
   * affichage inline juste au-dessus des slots.
   */
  function _autoEquip() {
    // 1. Déséquiper tout
    _unequipAll();

    const state = CWGameState.get();
    const inv   = state.player.equipInventory || [];

    // 2. Classer les personnages (meilleurs en premier) : priorité à la rareté,
    // puis au score Aura (départage à rareté égale)
    const RARITY_W = { mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    const chars = [...state.player.collection].sort((a, b) => {
      const da = CWGameState.getCharDef(a.charId);
      const db = CWGameState.getCharDef(b.charId);
      const ra = RARITY_W[da?.rarity] || 0;
      const rb = RARITY_W[db?.rarity] || 0;
      if (rb !== ra) return rb - ra;
      return CWGameState.getCharacterAuraScore(b) - CWGameState.getCharacterAuraScore(a);
    });

    // 3. Classer les items de chaque type par score total de bonus (décroissant)
    const weaponPool    = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && CWGameDatabase.resolveEquipSlot(d) === 'weapon'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db) - _itemScore(da); });
    const armorPool     = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && CWGameDatabase.resolveEquipSlot(d) === 'armor'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db) - _itemScore(da); });
    const accessoryPool = inv.filter(ei => { const d = state.equipment.find(e => e.id === ei.equipId); return d && CWGameDatabase.resolveEquipSlot(d) === 'accessory'; })
                             .sort((a, b) => { const da = state.equipment.find(e => e.id === a.equipId); const db = state.equipment.find(e => e.id === b.equipId); return _itemScore(db) - _itemScore(da); });

    const pools = [weaponPool, armorPool, accessoryPool];
    const poolIdx = [0, 0, 0];
    const results = [];

    // 4. Assigner : chaque perso reçoit le meilleur item disponible pour chaque slot
    chars.forEach(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      const received = [];
      for (let slot = 0; slot < 3; slot++) {
        const pool = pools[slot];
        if (poolIdx[slot] < pool.length) {
          const entry = pool[poolIdx[slot]];
          CWGameState.equipItem(inst.instanceId, slot, entry.instanceId);
          const eqDef = state.equipment.find(e => e.id === entry.equipId);
          if (eqDef) received.push({ slotLabel: EQUIP_SLOT_LABELS[EQUIP_SLOT_ORDER[slot]], itemName: eqDef.name, itemRarity: eqDef.rarity });
          poolIdx[slot]++;
        }
      }
      if (received.length > 0) {
        results.push({ charName: def?.name || '?', charRarity: def?.rarity || 'common', items: received });
      }
    });

    _autoEquipResult = results;
    _showAutoEquipResult();
  }

  /** Calcule le score total (somme des bonus) d'une définition d'équipement */
  function _itemScore(def) {
    return Object.values(def?.bonuses || {}).reduce((s, v) => s + (v || 0), 0);
  }

  /** Affiche (ou efface) le résumé inline du dernier équipement automatique */
  function _showAutoEquipResult() {
    const container = document.getElementById('auto-equip-result');
    if (!container) return;
    clearTimeout(_autoEquipResultTimer);

    if (!_autoEquipResult || _autoEquipResult.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="auto-equip-summary">
        <div class="auto-equip-summary-title">⚡ Parure automatique appliqué</div>
        ${_autoEquipResult.map(r => `
          <div class="auto-equip-summary-line">
            <strong>${r.charName}</strong> :
            ${r.items.map(it => `<span class="auto-equip-item rarity-${it.itemRarity}">${it.slotLabel.replace(/^\S+\s/, '')} ${it.itemName}</span>`).join(', ')}
          </div>
        `).join('')}
      </div>
    `;

    _autoEquipResultTimer = setTimeout(() => {
      _autoEquipResult = null;
      _showAutoEquipResult();
    }, 4000);
  }

  /** Efface immédiatement le résumé d'équipement auto (ex: avant une autre interaction) */
  function _clearAutoEquipResult() {
    if (!_autoEquipResult) return;
    _autoEquipResult = null;
    clearTimeout(_autoEquipResultTimer);
    _showAutoEquipResult();
  }

  /** Construit les 3 pastilles de slot (couleur de rareté si équipé, gris sinon) pour une instance */
  function _buildSlotDots(inst) {
    const state = CWGameState.get();
    return EQUIP_SLOT_ORDER.map((slotKey, slot) => {
      const invId    = inst.equipment?.[slot] || null;
      const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
      const eqDef    = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
      return `<span class="slot-dot ${eqDef ? 'rarity-' + eqDef.rarity : 'empty'}" title="${EQUIP_SLOT_LABELS[slotKey]}${eqDef ? ' : ' + eqDef.name : ' : vide'}"></span>`;
    }).join('');
  }

  /** Sélectionne un personnage dans l'écran Équiper : ferme le panneau de slot ouvert et rafraîchit les zones concernées */
  function _selectEquipChar(instanceId) {
    if (_equipCharId === instanceId) return;
    _clearAutoEquipResult();
    _equipCharId     = instanceId;
    _equipSlotOpen   = null;
    _equipSlotSearch = '';
    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _refreshEquipSlotPanel();
    _refreshEquipInvGrid();
  }

  /** Rafraîchit uniquement le picker de personnages (pour le filtre "sans équipement" et la sélection) */
  function _refreshEquipCharPicker() {
    const state  = CWGameState.get();
    const player = state.player;
    const picker = document.getElementById('equip-char-picker');
    if (!picker) return;

    let instances = player.collection;
    const activeSlots = EQUIP_SLOT_ORDER.filter(slotKey => _equipUnequippedFilter[slotKey]);
    if (activeSlots.length > 0) {
      // Un personnage est retenu s'il lui manque l'équipement d'AU MOINS UNE des
      // catégories cochées (ex: cocher "Sans arme" ET "Sans accessoire" affiche
      // tout personnage sans arme OU sans accessoire, pas nécessairement les deux).
      instances = instances.filter(inst =>
        activeSlots.some(slotKey => {
          const slot = EQUIP_SLOT_ORDER.indexOf(slotKey);
          return !inst.equipment || !inst.equipment[slot];
        })
      );
    }

    if (instances.length === 0) {
      const msg = activeSlots.length > 0
        ? `Tous les personnages ont déjà ${activeSlots.length > 1 ? 'ces équipements' : `un${activeSlots[0] === 'armor' ? 'e' : ''} ${EQUIP_SLOT_LABELS[activeSlots[0]].replace(/^\S+\s/, '').toLowerCase()}`}.`
        : 'Aucun personnage dans la collection.';
      picker.innerHTML = `<p class="empty-msg" style="margin:0;padding:.5rem">${msg}</p>`;
      return;
    }

    picker.innerHTML = _sortDecoratedChars(_decorateInstances(instances, state), _equipSort, state).map(({ inst, def }) => {
      const rarityDef = CWGameDatabase.RARITIES[def.rarity] || {};
      return `<div class="equip-char-mini ${_equipCharId === inst.instanceId ? 'selected' : ''}"
                data-iid="${inst.instanceId}"
                style="border-top:3px solid ${rarityDef.color || '#888'}">
        ${def.portrait
          ? `<img src="${def.portrait}" alt="${def.name}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;display:block;margin:0 auto 4px">`
          : `<div class="portrait-ph" style="width:48px;height:48px;border-radius:6px;margin:0 auto 4px;font-size:1.2rem">${def.name.charAt(0)}</div>`}
        <div class="equip-char-mini-name">${def.name}</div>
        <div class="equip-char-mini-level">Niv.${inst.level}</div>
        <div class="equip-char-slot-dots">${_buildSlotDots(inst)}</div>
      </div>`;
    }).join('');

    picker.querySelectorAll('.equip-char-mini').forEach(card => {
      card.addEventListener('click', () => _selectEquipChar(card.dataset.iid));
    });
  }

  /** Trie une liste décorée d'exemplaires d'équipement ({invInst, def}) */
  function _sortEquipInv(decorated, sortKey) {
    const rarityIndex = (r) => { const idx = RARITY_ORDER.indexOf(r); return idx === -1 ? 0 : idx; };
    const sorted = [...decorated];
    switch (sortKey) {
      case 'rarity': sorted.sort((a, b) => rarityIndex(b.def.rarity) - rarityIndex(a.def.rarity) || a.def.name.localeCompare(b.def.name)); break;
      case 'hp':     sorted.sort((a, b) => (b.def.bonuses.hp  || 0) - (a.def.bonuses.hp  || 0)); break;
      case 'atk':    sorted.sort((a, b) => (b.def.bonuses.atk || 0) - (a.def.bonuses.atk || 0)); break;
      case 'def':    sorted.sort((a, b) => (b.def.bonuses.def || 0) - (a.def.bonuses.def || 0)); break;
      case 'spd':    sorted.sort((a, b) => (b.def.bonuses.spd || 0) - (a.def.bonuses.spd || 0)); break;
      case 'name':
      default:       sorted.sort((a, b) => a.def.name.localeCompare(b.def.name)); break;
    }
    return sorted;
  }

  /** Filtre une liste décorée d'exemplaires d'équipement selon la recherche, la rareté et un seuil de stat */
  function _applyEquipFilters(decorated, filters) {
    if (!filters) return decorated;
    return decorated.filter(({ def }) => {
      if (filters.search && !def.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.rarity && def.rarity !== filters.rarity) return false;
      if (filters.statKey && filters.statMin !== '' && filters.statMin != null) {
        const val = def.bonuses[filters.statKey] || 0;
        if (val < Number(filters.statMin)) return false;
      }
      return true;
    });
  }

  /** Menu déroulant de tri pour l'inventaire d'équipement */
  function _renderEquipSortSelect(id, current) {
    return `
      <select class="sort-select" id="${id}">
        <option value="name"   ${current === 'name'   ? 'selected' : ''}>Trier : Nom (A-Z)</option>
        <option value="rarity" ${current === 'rarity' ? 'selected' : ''}>Trier : Rareté</option>
        <option value="hp"     ${current === 'hp'     ? 'selected' : ''}>Trier : PV</option>
        <option value="atk"    ${current === 'atk'    ? 'selected' : ''}>Trier : ATK</option>
        <option value="def"    ${current === 'def'    ? 'selected' : ''}>Trier : DEF</option>
        <option value="spd"    ${current === 'spd'    ? 'selected' : ''}>Trier : Grace</option>
      </select>
    `;
  }

  /** Barre de filtres pour l'inventaire d'équipement (recherche, rareté, seuil de stat) */
  function _renderEquipFilterBar(prefix, filters) {
    return `
      <div class="filter-bar">
        <input type="text" class="search-input" id="${prefix}-search" placeholder="Rechercher un nom..." value="${filters.search || ''}">
        <select class="sort-select" id="${prefix}-filter-rarity">
          <option value="">Toutes raretés</option>
          ${RARITY_ORDER.map(r => `<option value="${r}" ${filters.rarity === r ? 'selected' : ''}>${RARITY_LABELS_FR[r]}</option>`).join('')}
        </select>
        <div class="stat-filter-group">
          <select class="sort-select" id="${prefix}-filter-statkey">
            <option value="hp"  ${filters.statKey === 'hp'  ? 'selected' : ''}>PV ≥</option>
            <option value="atk" ${filters.statKey === 'atk' ? 'selected' : ''}>ATK ≥</option>
            <option value="def" ${filters.statKey === 'def' ? 'selected' : ''}>DEF ≥</option>
            <option value="spd" ${filters.statKey === 'spd' ? 'selected' : ''}>Vitesse ≥</option>
          </select>
          <input type="number" class="search-input stat-filter-input" id="${prefix}-filter-statmin" placeholder="min." value="${filters.statMin || ''}">
        </div>
      </div>
    `;
  }

  function _bindEquipFilterBar(prefix, filters, onChange) {
    document.getElementById(`${prefix}-search`)?.addEventListener('input', e => { filters.search = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-rarity`)?.addEventListener('change', e => { filters.rarity = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statkey`)?.addEventListener('change', e => { filters.statKey = e.target.value; onChange(); });
    document.getElementById(`${prefix}-filter-statmin`)?.addEventListener('input', e => { filters.statMin = e.target.value; onChange(); });
  }

  /** Rafraîchit la grille de l'onglet d'équipement actif (filtré par slot, trié, filtré) */
  /**
   * Regroupe une liste d'exemplaires d'équipement par equipId pour gagner de la
   * place dans l'inventaire : les exemplaires NON équipés et identiques sont
   * fusionnés en une seule "pile" avec un compteur. Les exemplaires déjà équipés
   * restent affichés individuellement (chacun a un porteur distinct à montrer).
   * @param {Array<{invInst, def}>} items
   * @returns {Array<{invInst, def, instances:Array, count:number, stacked:boolean}>}
   */
  function _groupEquipStacks(items) {
    // On groupe TOUS les items par equipId (nom), qu'ils soient équipés ou non.
    const groups = {};
    items.forEach(({ invInst, def }) => {
      if (!groups[def.id]) groups[def.id] = { def, instances: [] };
      groups[def.id].instances.push(invInst);
    });
    return Object.values(groups).map(group => {
      // Préférer un exemplaire NON équipé comme représentant du groupe (plus utile
      // par défaut pour l'action "cliquer pour équiper" depuis une pile) ; à défaut,
      // le premier exemplaire trouvé.
      const representative = group.instances.find(i => !i.equippedBy) || group.instances[0];
      return {
        invInst:   representative,
        def:       group.def,
        instances: group.instances,
        count:     group.instances.length,
        stacked:   group.instances.length > 1,
      };
    });
  }

  /**
   * Rafraîchit la grille de l'onglet d'équipement actif (filtré par slot, trié,
   * filtré). Quand un slot compatible est ouvert pour le personnage sélectionné,
   * les items meilleurs que celui actuellement équipé sont mis en valeur
   * (classe is-upgrade) et la grille devient directement cliquable pour équiper.
   */
  function _refreshEquipInvGrid() {
    const state = CWGameState.get();
    const grid = document.getElementById('equip-inv-grid');
    if (!grid) return;

    const inv = state.player.equipInventory || [];
    const decoratedAll = inv.map(invInst => {
      const def = state.equipment.find(e => e.id === invInst.equipId);
      if (!def) return null;
      return { invInst, def };
    }).filter(Boolean).filter(({ def }) => CWGameDatabase.resolveEquipSlot(def) === _equipInvTab);

    const grouped  = _groupEquipStacks(decoratedAll);
    const filtered = _applyEquipFilters(grouped, _equipInvFilters[_equipInvTab]);
    const sorted   = _sortEquipInv(filtered, _equipInvSort[_equipInvTab]);

    if (sorted.length === 0) {
      grid.innerHTML = `<p class="empty-msg" style="margin:0;padding:.8rem">${decoratedAll.length === 0 ? `Aucun ${EQUIP_SLOT_LABELS[_equipInvTab].replace(/^\S+\s/, '').toLowerCase()} en stock.<br>Utilisez le Défilé de Parures !` : 'Aucun parure ne correspond aux filtres.'}</p>`;
      return;
    }

    // Le slot ouvert (le cas échéant) correspond-il à l'onglet inventaire actif ?
    // Si oui, la grille devient cliquable pour équiper directement, avec mise en
    // évidence des améliorations par rapport à l'équipement actuel.
    const inst = _equipCharId ? CWGameState.getPlayerChar(_equipCharId) : null;
    const slotMatchesOpenSlot = !!(inst && _equipSlotOpen !== null && EQUIP_SLOT_ORDER[_equipSlotOpen] === _equipInvTab);
    let currentDef = null;
    if (slotMatchesOpenSlot) {
      const currentInvId = inst.equipment?.[_equipSlotOpen] || null;
      const currentEntry = currentInvId ? state.player.equipInventory.find(ei => ei.instanceId === currentInvId) : null;
      currentDef = currentEntry ? state.equipment.find(e => e.id === currentEntry.equipId) : null;
    }

    grid.innerHTML = sorted.map(({ invInst, def, count, stacked }) => {
      const holder = !stacked ? _describeEquippedBy(invInst.equippedBy) : null;
      const usedElsewhere = !stacked && invInst.equippedBy && invInst.equippedBy !== _equipCharId;
      const isUpgrade = slotMatchesOpenSlot && !usedElsewhere && (!currentDef || _itemScore(def) > _itemScore(currentDef));
      const clickable = slotMatchesOpenSlot && !usedElsewhere;
      return `
        <div class="equip-inv-card rarity-${def.rarity} ${isUpgrade ? 'is-upgrade' : ''}"
             data-inst-id="${invInst.instanceId}" data-equip-id="${def.id}"
             ${clickable ? 'style="cursor:pointer"' : ''}>
          ${count > 1 ? `<div class="equip-inv-stack-badge">×${count}</div>` : ''}
          <div class="equip-inv-name">${def.name}</div>
          <div class="equip-inv-bonuses">${_formatEquipBonuses(def.bonuses)}</div>
          ${isUpgrade ? '<div class="equip-upgrade-hint">⬆ Amélioration</div>' : ''}
          ${holder ? `
            <div class="equip-inv-holder" title="Équipé par ${holder.name}">
              <span class="equip-inv-holder-portrait">${holder.portrait ? `<img src="${holder.portrait}" alt="${holder.name}">` : holder.name.charAt(0)}</span>
              <span class="equip-inv-holder-name">${holder.name}</span>
            </div>` : ''}
        </div>`;
    }).join('');

    if (slotMatchesOpenSlot) {
      grid.querySelectorAll('.equip-inv-card').forEach(card => {
        const entry = inv.find(ei => ei.instanceId === card.dataset.instId);
        if (entry?.equippedBy && entry.equippedBy !== _equipCharId) return; // utilisé ailleurs : non cliquable
        card.addEventListener('click', () => _equipFromGrid(card.dataset.instId));
      });
    }
  }

  /** Équipe un exemplaire directement depuis la grille d'inventaire (slot ouvert correspondant) */
  function _equipFromGrid(invInstanceId) {
    if (!_equipCharId || _equipSlotOpen === null) return;
    const result = CWGameState.equipItem(_equipCharId, _equipSlotOpen, invInstanceId);
    if (result?.success) {
      _showToast('Équipement posé !', 'success');
    } else {
      _showToast("Cet équipement est déjà porté par un autre personnage.", 'error');
    }
    _clearAutoEquipResult();
    _equipSlotOpen = null;
    _refreshEquipCharPicker();
    _refreshEquipSlots();
    _refreshEquipSlotPanel();
    _refreshEquipInvGrid();
  }

  /** Construit le HTML des 3 slots d'équipement pour un personnage */
  function _buildEquipSlots(instanceId, state) {
    const inst = CWGameState.getPlayerChar(instanceId);
    if (!inst) return '';
    const def = CWGameState.getCharDef(inst.charId);

    const slotsHtml = EQUIP_SLOT_ORDER.map((slotKey, slot) => {
      const invId    = inst.equipment?.[slot] || null;
      const invEntry = invId ? state.player.equipInventory.find(ei => ei.instanceId === invId) : null;
      const eqDef    = invEntry ? state.equipment.find(e => e.id === invEntry.equipId) : null;
      const rarityDef = eqDef ? (CWGameDatabase.RARITIES[eqDef.rarity] || {}) : {};
      return `
        <div class="equip-slot-card ${eqDef ? 'filled' : ''} ${_equipSlotOpen === slot ? 'active' : ''}" data-slot="${slot}" style="${eqDef ? `border-top:3px solid ${rarityDef.color || '#888'}` : ''}">
          <span class="equip-slot-label">${EQUIP_SLOT_LABELS[slotKey]}</span>
          ${eqDef ? `
            <span class="equip-slot-name">${eqDef.name}</span>
            <span class="equip-slot-bonuses">${_formatEquipBonuses(eqDef.bonuses)}</span>
            <button class="equip-remove-btn" data-slot="${slot}" data-iid="${instanceId}">Retirer</button>
          ` : `<span style="color:var(--text-faint);font-size:.75rem">Vide — Cliquer pour équiper</span>`}
        </div>`;
    }).join('');

    const rarityDef = CWGameDatabase.RARITIES[def.rarity] || {};
    return `
      <div class="equip-section">
        <div class="equip-section-title" style="display:flex;align-items:center;gap:8px">
          <span style="color:${rarityDef.color}">${def.name}</span>
          <span style="color:var(--text-faint);font-size:.7rem">Niv.${inst.level}</span>
        </div>
        <div class="equip-slots-row" id="equip-slots-row">
          ${slotsHtml}
        </div>
      </div>`;
  }

  /** Rafraîchit la zone des 3 slots d'équipement du personnage sélectionné, et lie leurs interactions */
  function _refreshEquipSlots() {
    const container = document.getElementById('equip-slots-section');
    if (!container) return;
    const state = CWGameState.get();

    container.innerHTML = _equipCharId
      ? _buildEquipSlots(_equipCharId, state)
      : '<p class="empty-msg" style="margin:0;padding:1rem">Sélectionne un personnage ci-dessus.</p>';

    container.querySelectorAll('.equip-slot-card').forEach(card => {
      card.addEventListener('click', () => {
        const slot = parseInt(card.dataset.slot);
        if (isNaN(slot) || !_equipCharId) return;
        _clearAutoEquipResult();
        _equipSlotOpen   = (_equipSlotOpen === slot) ? null : slot;
        _equipSlotSearch = '';
        _refreshEquipSlots();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });

    container.querySelectorAll('.equip-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.slot);
        CWGameState.equipItem(btn.dataset.iid, slot, null);
        _clearAutoEquipResult();
        _refreshEquipSlots();
        _refreshEquipCharPicker();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });
  }

  /**
   * Construit la ligne de comparaison "ATK +20 → +45 (▲25)" entre l'équipement
   * actuellement porté dans le slot et un candidat. Vide si rien n'est équipé
   * actuellement (rien à comparer).
   */
  function _buildEquipCompareHtml(currentDef, candidateDef) {
    if (!currentDef) return '';
    const keys = ['hp', 'atk', 'def', 'spd'];
    const lines = keys.map(k => {
      const cur  = currentDef.bonuses?.[k] || 0;
      const next = candidateDef.bonuses?.[k] || 0;
      if (cur === 0 && next === 0) return '';
      const diff = next - cur;
      const cls  = diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
      const diffText = diff !== 0 ? ` (${diff > 0 ? '▲' : '▼'}${Math.abs(diff)})` : '';
      return `<span class="${cls}">${k.toUpperCase()} ${cur >= 0 ? '+' : ''}${cur} → ${next >= 0 ? '+' : ''}${next}${diffText}</span>`;
    }).filter(Boolean);
    return lines.length ? `<div class="equip-compare">${lines.join('<br>')}</div>` : '';
  }

  /**
   * Rafraîchit le panneau inline de sélection d'équipement (remplace l'ancien
   * modal). Affiché sous les slots quand _equipSlotOpen n'est pas null.
   */
  function _refreshEquipSlotPanel() {
    const container = document.getElementById('equip-slot-panel-container');
    if (!container) return;

    if (_equipSlotOpen === null || !_equipCharId) {
      container.innerHTML = '';
      return;
    }

    const state = CWGameState.get();
    const inst  = CWGameState.getPlayerChar(_equipCharId);
    if (!inst) { container.innerHTML = ''; return; }

    const slot    = _equipSlotOpen;
    const slotKey = EQUIP_SLOT_ORDER[slot];
    const currentInvId = inst.equipment?.[slot] || null;
    const currentEntry = currentInvId ? state.player.equipInventory.find(ei => ei.instanceId === currentInvId) : null;
    const currentDef   = currentEntry ? state.equipment.find(e => e.id === currentEntry.equipId) : null;

    const inv = (state.player.equipInventory || []).filter(ei => {
      const ed = state.equipment.find(e => e.id === ei.equipId);
      return ed && CWGameDatabase.resolveEquipSlot(ed) === slotKey;
    });
    const decorated = inv.map(ei => {
      const ed = state.equipment.find(e => e.id === ei.equipId);
      return ed ? { invInst: ei, def: ed } : null;
    }).filter(Boolean);
    const grouped = _groupEquipStacks(decorated);

    // Recherche, et on omet entièrement les exemplaires utilisés par un AUTRE
    // personnage (sans valeur ajoutée dans ce flux, contrairement à l'ancien modal).
    const q = _equipSlotSearch.trim().toLowerCase();
    const available = grouped.filter(({ invInst, def, stacked }) => {
      if (q && !def.name.toLowerCase().includes(q)) return false;
      const isCurrent = !stacked && invInst.instanceId === currentInvId;
      const usedElsewhere = !stacked && invInst.equippedBy && invInst.equippedBy !== _equipCharId && !isCurrent;
      return !usedElsewhere;
    });

    const itemsHtml = available.map(({ invInst, def, count, stacked }) => {
      const isCurrent = !stacked && invInst.instanceId === currentInvId;
      return `
        <div class="equip-inv-card rarity-${def.rarity} ${isCurrent ? 'current-equip' : ''}"
             data-inst-id="${invInst.instanceId}"
             style="${isCurrent ? 'opacity:.5;pointer-events:none' : 'cursor:pointer'}">
          ${count > 1 ? `<div class="equip-inv-stack-badge">×${count}</div>` : ''}
          <div class="equip-inv-name">${def.name}</div>
          <div class="equip-inv-bonuses">${_formatEquipBonuses(def.bonuses)}</div>
          ${isCurrent ? '<div style="font-size:.62rem;color:var(--accent);margin-top:4px">Actuellement équipé</div>' : _buildEquipCompareHtml(currentDef, def)}
        </div>`;
    }).join('');

    container.innerHTML = `
      <div class="equip-slot-panel" id="equip-slot-panel">
        <div class="equip-slot-panel-header">
          <strong>Choisir : ${EQUIP_SLOT_LABELS[slotKey]}</strong>
          <button class="modal-close" id="equip-slot-panel-close">✕</button>
        </div>
        <input type="text" class="search-input" id="equip-slot-search" placeholder="Rechercher un nom..." value="${_equipSlotSearch}" style="width:100%;margin-bottom:10px;box-sizing:border-box;">
        <div class="equip-inv-grid">
          <div class="equip-inv-card equip-empty-card" id="equip-slot-empty-card" ${!currentInvId ? 'style="opacity:.5;pointer-events:none"' : 'style="cursor:pointer"'}>
            <div class="equip-inv-name">— Vide —</div>
            <div class="equip-inv-bonuses">Retirer l'équipement de ce slot</div>
          </div>
          ${itemsHtml || '<p class="empty-msg" style="margin:0;padding:.8rem">Aucun équipement disponible.</p>'}
        </div>
      </div>
    `;

    document.getElementById('equip-slot-panel-close')?.addEventListener('click', () => {
      _equipSlotOpen = null;
      _refreshEquipSlots();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    document.getElementById('equip-slot-search')?.addEventListener('input', e => {
      _equipSlotSearch = e.target.value;
      _refreshEquipSlotPanel();
    });

    document.getElementById('equip-slot-empty-card')?.addEventListener('click', () => {
      CWGameState.equipItem(_equipCharId, slot, null);
      _clearAutoEquipResult();
      _equipSlotOpen = null;
      _refreshEquipSlots();
      _refreshEquipCharPicker();
      _refreshEquipSlotPanel();
      _refreshEquipInvGrid();
    });

    container.querySelectorAll('.equip-inv-card[data-inst-id]:not(.equip-empty-card)').forEach(card => {
      card.addEventListener('click', () => {
        const result = CWGameState.equipItem(_equipCharId, slot, card.dataset.instId);
        if (result?.success) {
          _showToast('Équipement posé !', 'success');
        } else {
          _showToast("Cet équipement est déjà porté par un autre personnage.", 'error');
        }
        _clearAutoEquipResult();
        _equipSlotOpen = null;
        _refreshEquipSlots();
        _refreshEquipCharPicker();
        _refreshEquipSlotPanel();
        _refreshEquipInvGrid();
      });
    });
  }

  // ─── GACHA ÉQUIPEMENTS ────────────────────────────────────────────────────────

  /** Effectue un tirage de gacha d'équipement */
  function _doEquipGachaPull(bannerId, count) {
    const state  = CWGameState.get();
    const banner = (state.equipBanners || []).find(b => b.id === bannerId);
    if (!banner) return;

    const cost   = count === 1 ? banner.singlePullCost : banner.tenPullCost;
    const player = CWGameState.getPlayer();
    if ((player.currency.gold || 0) < cost) {
      _showToast('Dollars insuffisants !', 'error');
      return;
    }

    document.querySelectorAll('.btn-equip-pull').forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    CWGameState.modifyResources({ gold: -cost });

    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(_rollEquipPull(banner, state));
    }

    _updateHUD();
    CWGameState.trackQuestProgress('summon_equipment', count);
    _showEquipResults(results, () => {
      document.querySelectorAll('.btn-equip-pull').forEach(b => { b.disabled = false; b.style.opacity = ''; });
    });
  }

  /** Tire un équipement aléatoire selon les taux de la bannière */
  function _rollEquipPull(banner, state) {
    const rarity = _rollEquipRarity(banner);
    const pool   = state.equipment.filter(e => e.rarity === rarity);
    const def    = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : state.equipment[Math.floor(Math.random() * state.equipment.length)];

    if (!def) return null;

    const instance = {
      instanceId: `einst_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      equipId:    def.id,
      obtainedAt: Date.now(),
      equippedBy: null,
    };

    const p = CWGameState.getPlayer();
    const updatedInv = [...(p.equipInventory || []), instance];
    CWGameState.updatePlayer({ equipInventory: updatedInv });

    return { equip: def, instance };
  }

  /** Tire une rareté selon les dropRates de la bannière */
  function _rollEquipRarity(banner) {
    const rates = banner.dropRates || {};
    const roll  = Math.random() * 100;
    let cum     = 0;
    const order = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    for (const r of order) {
      cum += (rates[r] || 0);
      if (roll < cum) return r;
    }
    return 'common';
  }

  /** Affiche les résultats du gacha équipement sous forme de cartes */
  function _showEquipResults(results, onDone) {
    const el = document.getElementById('gacha-results');
    if (!el) { onDone?.(); return; }

    el.innerHTML = `
      <div class="equip-result-grid">
        ${results.filter(Boolean).map((r, i) => {
          const delay     = i * 80;
          return `
            <div class="equip-result-card rarity-${r.equip.rarity}" style="animation-delay:${delay}ms">
              <div class="equip-result-icon">⚙️</div>
              <div class="equip-result-name">${r.equip.name}</div>
              <div class="equip-result-bonuses">${_formatEquipBonuses(r.equip.bonuses)}</div>
            </div>`;
        }).join('')}
      </div>`;

    el.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => onDone?.(), results.length * 80 + 400);
  }

  // ─── INVENTAIRE ─────────────────────────────────────────────────────────────

  let _inventoryTargetItemId = null; // objet en attente de cible (effet level_up)

  /** Affiche l'écran Inventaire : regroupe tous les objets possédés avec un bouton Utiliser */
  function renderInventory() {
    const el = document.getElementById('screen-inventory');
    if (!el) return;
    const state  = CWGameState.get();
    const player = state.player;
    const effectTypes = CWGameDatabase.ITEM_EFFECT_TYPES;

    const rows = state.items.map(it => {
      const qty = player.inventory?.[it.id] || 0;
      const eff = it.effect && effectTypes[it.effect.type];
      const effDesc = eff ? `${eff.label} ×${it.effect.amount}` : 'Sans effet';
      const energyFull = it.effect?.type === 'energy_regen' && player.energy.current >= player.energy.max;
      const disabled = qty < 1 || !eff || energyFull;
      return `
        <div class="item-section ${qty < 1 ? 'item-section-empty' : ''}">
          <div class="item-info">
            <span class="item-icon">${it.icon || '📦'}</span>
            <div>
              <div class="item-name">${it.name}</div>
              <div class="item-desc">${it.description || effDesc}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="item-count">×${qty}</span>
            <button class="btn-item-use" data-item-id="${it.id}" ${disabled ? 'disabled' : ''}>Utiliser</button>
          </div>
        </div>
        ${energyFull ? '<p style="font-size:.72rem;color:var(--text-faint);margin:4px 0 0;text-align:center">Énergie déjà au maximum</p>' : ''}
      `;
    }).join('');

    el.innerHTML = `
      <div class="screen-header"><h2>🎒 Inventaire</h2>${_helpBtn('inventory')}</div>
      ${rows || '<p class="empty-msg">Aucun objet pour le moment.</p>'}
    `;

    el.querySelectorAll('.btn-item-use').forEach(btn => {
      btn.addEventListener('click', () => _handleUseItem(btn.dataset.itemId));
    });
  }

  /** Déclenche l'utilisation d'un objet : applique l'effet directement, ou ouvre le sélecteur de créature si besoin */
  function _handleUseItem(itemId) {
    const state = CWGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    if (!itemDef?.effect) return;
    const effDef = CWGameDatabase.ITEM_EFFECT_TYPES[itemDef.effect.type];

    if (effDef?.requiresTarget) {
      _openItemTargetModal(itemId);
    } else {
      _applyItemEffect(itemId, null);
    }
  }

  /** Ouvre une fenêtre de sélection de créature pour un objet ciblé (ex: Up de Lvl) */
  function _openItemTargetModal(itemId) {
    const state = CWGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    const modal = document.getElementById('modal');
    if (!itemDef || !modal) return;

    const cards = state.player.collection.map(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return '';
      const rarityDef = CWGameDatabase.RARITIES[def.rarity] || {};
      return `
        <div class="equip-char-mini" data-iid="${inst.instanceId}" style="border-top:3px solid ${rarityDef.color || '#888'}">
          ${def.portrait
            ? `<img src="${def.portrait}" alt="${def.name}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;display:block;margin:0 auto 4px">`
            : `<div class="portrait-ph" style="width:48px;height:48px;border-radius:6px;margin:0 auto 4px;font-size:1.2rem">${def.name.charAt(0)}</div>`}
          <div class="equip-char-mini-name">${def.name}</div>
          <div class="equip-char-mini-level">Niv.${inst.level}</div>
        </div>`;
    }).join('');

    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 style="font-family:var(--font-display);margin:0 0 4px">${itemDef.icon || '📦'} ${itemDef.name}</h3>
          <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 14px">Choisis la créature à cibler.</p>
          <div class="equip-char-picker">
            ${cards || '<p class="empty-msg" style="margin:0;padding:.5rem">Aucune créature dans la collection.</p>'}
          </div>
        </div>
      </div>
    `;

    modal.querySelectorAll('.equip-char-mini').forEach(card => {
      card.addEventListener('click', () => {
        _closeModal();
        _applyItemEffect(itemId, card.dataset.iid);
      });
    });
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') _closeModal();
    });
  }

  /** Applique réellement l'effet d'un objet (après confirmation/sélection de cible le cas échéant) */
  function _applyItemEffect(itemId, targetInstanceId) {
    const state = CWGameState.get();
    const itemDef = state.items.find(i => i.id === itemId);
    const result = CWGameState.useItem(itemId, targetInstanceId);

    if (!result.success) {
      const messages = {
        no_stock: "Tu n'as plus cet objet.",
        target_required: 'Sélectionne une créature.',
        energy_full: 'Désir déjà au maximum.',
        no_effect: 'Cet objet ne fait rien pour le moment.',
      };
      _showToast(messages[result.reason] || 'Action impossible.', 'error');
      return;
    }

    if (itemDef.effect.type === 'level_up') {
      const inst = CWGameState.getPlayerChar(targetInstanceId);
      const def  = inst ? CWGameState.getCharDef(inst.charId) : null;
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      if (result.evolved) {
        setTimeout(() => _showEvolutionShowcase([result.evolved]), 350);
      }
      _showToast(`${def?.name || 'La créature'} est passée au niveau ${result.finalLevel} ! ${itemDef.icon || ''}`, 'success');
    } else if (itemDef.effect.type === 'energy_regen') {
      _showToast(`+${result.energyGained} ⚡ Désir ! ${itemDef.icon || ''}`, 'success');
    }

    if (_currentScreen === 'inventory') renderInventory();
    if (_currentScreen === 'equip') renderEquip();
  }

  // ─── BOUTIQUE ───────────────────────────────────────────────────────────────────

  let _shopTab = 'character'; // 'character' | 'equipment' | 'item'

  /** Affiche l'écran Boutique : articles à vendre, groupés par type, payables en or ou diamants */
  function renderShop() {
    const el = document.getElementById('screen-shop');
    if (!el) return;
    const state    = CWGameState.get();
    const player   = state.player;
    const ev       = CWGameState.getActiveEvent();
    const discount = ev?.shopDiscount ?? 0;
    const tag      = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;

    const resolveRef = (l) => {
      if (l.kind === 'character') return state.characters.find(c => c.id === l.refId);
      if (l.kind === 'equipment') return state.equipment.find(e => e.id === l.refId);
      if (l.kind === 'item')      return state.items.find(i => i.id === l.refId);
      return null;
    };

    const makeCard = (l, overridePrice) => {
      const ref = resolveRef(l);
      if (!ref) return '';
      const priceToUse   = overridePrice ?? l.price;
      const currencyIcon = l.currency === 'crystals' ? '💎' : '💵';
      const balance      = player.currency[l.currency === 'crystals' ? 'crystals' : 'gold'] || 0;
      const canAfford    = balance >= priceToUse;
      const rarityDef    = l.kind !== 'item' ? (CWGameDatabase.RARITIES[ref.rarity] || {}) : {};
      const icon         = l.kind === 'item'      ? (ref.icon || '📦')
                          : l.kind === 'equipment' ? (EQUIP_SLOT_ICON[ref.slot] || '⚙️')
                          : null;
      const isDiscounted = overridePrice != null;

      return `
        <div class="shop-card" data-listing-id="${l.id}" data-price-override="${isDiscounted ? priceToUse : ''}">
          <div class="shop-card-portrait" style="${rarityDef.color ? `border-color:${rarityDef.color}` : ''}">
            ${icon ? `<span style="font-size:1.8rem">${icon}</span>`
              : ref.portrait ? `<img src="${ref.portrait}" alt="${ref.name}">`
              : `<div class="portrait-ph">${ref.name.charAt(0)}</div>`}
          </div>
          <div class="shop-card-name">${ref.name}</div>
          ${(rarityDef.name && l.kind !== 'equipment') ? `<div class="shop-card-rarity" style="color:${rarityDef.color}">${rarityDef.name}</div>` : ''}
          ${isDiscounted ? `<div class="shop-price-old">${l.price.toLocaleString()} ${currencyIcon}</div>` : ''}
          <button class="btn-shop-buy" data-listing-id="${l.id}" data-price-override="${isDiscounted ? priceToUse : ''}" ${canAfford ? '' : 'disabled'}>
            ${priceToUse.toLocaleString()} ${currencyIcon}${isDiscounted ? ' <span class="shop-discount-badge">-'+discount+'%</span>' : ''}
          </button>
        </div>`;
    };

    const allListings = state.shopListings.filter(l => l.enabled !== false);

    // Ligne 1 — Objets permanents : Pilule de Prestige + Potion du Désir (par tag item)
    const permanentItems = allListings.filter(l =>
      l.kind === 'item' && (l.permanent === true || l.tags?.includes('permanent'))
    );

    // Ligne 2 — Personnages du tag event avec réduction
    const eventChars = ev ? allListings.filter(l => {
      if (l.kind !== 'character') return false;
      const ref = resolveRef(l);
      return ref?.tags?.includes(ev.tagId) && ref.evolutionStage === 0;
    }) : [];
    const line2Ids = new Set(eventChars.map(l => l.id));
    const perm2Ids = new Set(permanentItems.map(l => l.id));

    // Ligne 3 — 9 objets aléatoires rotatifs (hors ligne 1 et 2)
    const rotatingListings = CWGameState.getRotatingShopListings().filter(l =>
      !line2Ids.has(l.id) && !perm2Ids.has(l.id)
    );

    const line1Html = permanentItems.length
      ? permanentItems.map(l => makeCard(l)).join('')
      : '<p class="empty-msg" style="font-size:.8rem">Aucun objet permanent disponible.</p>';

    const line2Html = ev
      ? (eventChars.length
        ? eventChars.map(l => {
            const discountedPrice = Math.max(1, Math.round(l.price * (1 - discount / 100)));
            return makeCard(l, discountedPrice);
          }).join('')
        : `<p class="empty-msg" style="font-size:.8rem">Aucun personnage ${tag?.name || 'Event'} disponible.</p>`)
      : '';

    const line3Html = rotatingListings.length
      ? rotatingListings.map(l => makeCard(l)).join('')
      : '<p class="empty-msg" style="font-size:.8rem">Boutique en cours de réapprovisionnement...</p>';

    el.innerHTML = `
      <div class="screen-header"><h2>🛍️ Shopping</h2>${_helpBtn('shop')}</div>
      ${ev ? `<div class="event-shop-banner">
        ✨ Event ${tag?.name || ''} — Réduction de ${discount}% sur les actrices du tag !
      </div>` : ''}

      <div class="shop-section-label shop-label-permanent">💊 Disponible en permanence</div>
      <div class="shop-grid shop-grid-permanent">${line1Html}</div>

      ${ev ? `
      <div class="shop-section-label shop-label-event">✨ Actrices Event ${tag?.name || ''} — Offre limitée</div>
      <div class="shop-grid shop-grid-event">${line2Html}</div>` : ''}

      <div class="shop-section-label shop-label-rotating">🔄 Sélection du moment</div>
      <div class="shop-grid">${line3Html}</div>
    `;

    el.querySelectorAll('.btn-shop-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const override = btn.dataset.priceOverride ? parseInt(btn.dataset.priceOverride) : null;
        _purchaseListing(btn.dataset.listingId, override);
      });
    });
  }

  function _purchaseListing(listingId, priceOverride) {
    const state = CWGameState.get();
    const listing = state.shopListings.find(l => l.id === listingId);
    if (!listing) return;
    // Appliquer le prix surchargé (réduction event) si fourni
    const effectiveListing = priceOverride != null ? { ...listing, price: priceOverride } : listing;
    const result = CWGameState.purchaseShopListing(listingId, priceOverride);

    if (!result.success) {
      const messages = {
        unavailable: 'Cet article n\'est plus disponible.',
        insufficient_funds: 'Fonds insuffisants.',
      };
      _showToast(messages[result.reason] || 'Achat impossible.', 'error');
      return;
    }

    let label = '';
    if (result.kind === 'character') label = result.result?.isNew ? 'Nouvelle actrice obtenue !' : 'Sublimation +1 !';
    else if (result.kind === 'equipment') label = 'Équipement obtenu !';
    else if (result.kind === 'item') label = 'Objet obtenu !';
    _showToast(`✅ ${label}`, 'success');

    renderShop();
  }

  // ─── QUÊTES QUOTIDIENNES & RÉCOMPENSE DE CONNEXION ─────────────────────────────

  /** Date du jour au format YYYY-MM-DD (heure locale), pour comparer aux dates stockées côté joueur */
  function _todayStringUI() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Formate une récompense générique en texte lisible (ou compact, pour les petites puces) */
  function _formatRewardLabel(reward, state, compact = false) {
    if (!reward) return '?';
    if (reward.type === 'gold') return `${reward.amount} 💵`;
    if (reward.type === 'crystals') return `${reward.amount} 💎`;
    if (reward.type === 'item') {
      const def = state.items.find(i => i.id === reward.refId);
      return compact ? `${def?.icon || '🎒'}×${reward.amount}` : `${def?.name || 'Objet'} ×${reward.amount}`;
    }
    if (reward.type === 'equipment') {
      const def = state.equipment.find(e => e.id === reward.refId);
      return compact ? `⚔️×${reward.amount}` : `${def?.name || 'Équipement'} ×${reward.amount}`;
    }
    if (reward.type === 'character') {
      const def = state.characters.find(c => c.id === reward.refId);
      return compact ? `🧝×${reward.amount}` : `${def?.name || 'Créature'} ×${reward.amount}`;
    }
    return '?';
  }

  /** Affiche l'écran Quêtes : récompenses de connexion (cycles actifs) + 3 quêtes du jour */
  // ─── CLASSEMENTS ──────────────────────────────────────────────────────────────

  let _leaderboardTab = 'aura_total'; // 'aura_total' | 'tournee_progress' | 'gallery_entries'

  const LEADERBOARD_TABS = [
    { col: 'aura_total',       label: '💫 Aura',    unit: '💫' },
    { col: 'tournee_progress', label: '🌍 Tournée', unit: '🌍 Niv.' },
    { col: 'gallery_entries',  label: '📖 Galerie', unit: '📖' },
    { col: 'record_best',      label: '📊 Performance', unit: 'pts' },
  ];

  function renderLeaderboard() {
    const el = document.getElementById('screen-leaderboard');
    if (!el) return;
    el.innerHTML = `
      <div class="screen-header"><h2>🏆 Classements</h2></div>
      <div class="lb-tabs">
        ${LEADERBOARD_TABS.map(t => `
          <button class="lb-tab ${_leaderboardTab === t.col ? 'active' : ''}" data-col="${t.col}">${t.label}</button>
        `).join('')}
      </div>
      <div id="leaderboard-list"><p class="empty-msg">⏳ Chargement du classement...</p></div>
    `;
    el.querySelectorAll('.lb-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _leaderboardTab = btn.dataset.col;
        renderLeaderboard();
      });
    });
    _loadLeaderboardList(_leaderboardTab);
  }

  async function _loadLeaderboardList(column) {
    const rows = await CWBackend.loadLeaderboard(column, 100);
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return; // le joueur a changé d'écran pendant le chargement

    if (rows.length === 0) {
      listEl.innerHTML = `<p class="empty-msg">Personne au classement pour l'instant.</p>`;
      return;
    }

    const myUserId  = CWBackend.getCurrentUserId?.();
    const tabConfig = LEADERBOARD_TABS.find(t => t.col === column);

    listEl.innerHTML = `<div class="lb-list">` + rows.map((r, i) => {
      const rank  = i + 1;
      const isMe  = r.user_id === myUserId;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const value = r[column] ?? 0;
      return `
        <div class="lb-row ${isMe ? 'is-me' : ''}">
          <span class="lb-rank">${medal}</span>
          <span class="lb-name">${r.display_name || 'Joueur'}${isMe ? ' (toi)' : ''}</span>
          <span class="lb-value">${Number(value).toLocaleString('fr-FR')} ${tabConfig?.unit || ''}</span>
        </div>`;
    }).join('') + `</div>`;
  }

  // ─── MODE PERFORMANCE ─────────────────────────────────────────────────────────

  /** Écran d'accueil du mode Performance : lancer un run, ou consulter le totem de récompenses */
  function renderRecordHome() {
    const el = document.getElementById('screen-record');
    if (!el) return;
    const state = CWGameState.get();
    const cfg   = state.config.combat || {};
    const best  = state.player.recordBest || 0;
    const totem = CWGameState.getRecordTotemState?.();
    const claimableCount = totem?.claimableCount || 0;

    el.innerHTML = `
      <div class="screen-header">
        <h2>📊 Performance</h2>
      </div>
      <div class="record-home-card">
        <div class="record-home-best">
          <div class="record-home-best-label">Ton record personnel</div>
          <div class="record-home-best-value">${best.toLocaleString('fr-FR')} <small>pts</small></div>
        </div>
        <p class="record-home-desc">
          Inflige un maximum de dégâts en <strong>${cfg.recordMaxTurns ?? 15} tours</strong> à une vague
          d'ennemis qui n'attaquent jamais — chaque ennemi vaincu est immédiatement
          remplacé, et rapporte <strong>+${cfg.recordKillBonus ?? 100} points</strong> bonus.
        </p>
        <button class="btn-primary record-home-btn" id="btn-record-launch">⚔️ Lancer le combat</button>
        <button class="btn-primary record-home-btn record-home-btn-secondary" id="btn-record-rewards">
          🎁 Récompenses${claimableCount > 0 ? `<span class="record-claim-badge">${claimableCount}</span>` : ''}
        </button>
      </div>
    `;

    document.getElementById('btn-record-launch')?.addEventListener('click', () => {
      showScreen('combat');
      setTimeout(() => _launchCombat({ mode: 'record' }), 100);
    });
    document.getElementById('btn-record-rewards')?.addEventListener('click', () => {
      showScreen('record-rewards');
    });
  }

  /** Totem de récompenses du mode Performance : paliers de score à réclamer manuellement */
  function renderRecordRewards() {
    const el = document.getElementById('screen-record-rewards');
    if (!el) return;
    const totem = CWGameState.getRecordTotemState?.();
    if (!totem) return;

    el.innerHTML = `
      <div class="screen-header">
        <button class="cs-back" id="btn-record-rewards-back">‹</button>
        <h2>🎁 Totem de Performance</h2>
      </div>
      <div class="record-totem-summary">
        Record actuel : <strong>${totem.best.toLocaleString('fr-FR')} pts</strong>
        ${totem.claimableCount > 0 ? `
          <button class="btn-primary record-claim-all-btn" id="btn-record-claim-all">
            🎁 Tout réclamer (${totem.claimableCount})
          </button>` : ''}
      </div>
      <div class="record-totem" id="record-totem-list">
        ${[...totem.tiers].reverse().map(t => `
          <div class="record-totem-tier ${t.claimed ? 'is-claimed' : t.reached ? 'is-claimable' : 'is-locked'}">
            <div class="record-totem-tier-threshold">${t.threshold.toLocaleString('fr-FR')} pts</div>
            <div class="record-totem-tier-rewards">
              ${t.gold ? `<span>+${t.gold} 💵</span>` : ''}
              ${t.crystals ? `<span>+${t.crystals} 💎</span>` : ''}
            </div>
            <div class="record-totem-tier-status">
              ${t.claimed
                ? '<span class="record-tier-check">✓ Réclamé</span>'
                : t.reached
                  ? `<button class="btn-primary admin-btn-sm record-claim-btn" data-tier="${t.index}">Réclamer</button>`
                  : '<span class="record-tier-lock">🔒</span>'}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    document.getElementById('btn-record-rewards-back')?.addEventListener('click', () => showScreen('record'));
    document.getElementById('btn-record-claim-all')?.addEventListener('click', () => {
      const res = CWGameState.claimAllRecordTiers?.();
      if (res?.count) {
        _showToast(`🎁 ${res.count} palier(s) réclamé(s) : +${res.gold} 💵 +${res.crystals} 💎`, 'success');
        _updateHUD();
      }
      renderRecordRewards();
    });
    el.querySelectorAll('.record-claim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tier = CWGameState.claimNextRecordTier?.();
        if (tier) {
          _showToast(`🎁 Palier ${tier.threshold.toLocaleString('fr-FR')} pts réclamé : +${tier.gold} 💵 +${tier.crystals} 💎`, 'success');
          _updateHUD();
        }
        renderRecordRewards();
      });
    });
  }

  // ─── MODE DÉFILÉ — PLANIFICATION ──────────────────────────────────────────────

  let _defileState = null; // { programme, playerTeam, assignment, usesPerChar }

  const STAT_LABELS_SHORT = { atk: '✨ Charisme', def: '🌹 Prestance', spd: '🕊️ Grâce' };

  /** Génère l'équipe adverse d'un défilé, niveau calqué sur la moyenne du joueur */
  /**
   * Comme getDefileTalentDisplay, mais résout Légende vers le Talent qu'elle
   * a effectivement copié (une fois le choix fait) — affiche donc "Grand
   * Sourire" et non "Polyvalence" partout dans l'écran de planification.
   */
  function _getPlanningTalentDisplay(typeId, cfg) {
    if (typeId === 'Legende' && _defileState?.legendeCopyTypeId) {
      return CWGameDatabase.getDefileTalentDisplay(_defileState.legendeCopyTypeId, cfg);
    }
    return CWGameDatabase.getDefileTalentDisplay(typeId, cfg);
  }

  function _buildDefileEnemyTeam(playerTeam, cfg, state) {
    const avgLevel = Math.max(1, Math.round(
      playerTeam.reduce((s, f) => s + (f.level || 1), 0) / playerTeam.length
    ));

    // Aucune lignée en commun avec le joueur, ni en double côté adverse —
    // les 6 personnages du duel doivent toutes être des lignées différentes.
    const playerLines = new Set(
      playerTeam.map(f => CWGameState.getCharDef(f.charId)?.evolutionLine).filter(Boolean)
    );
    const usedEnemyLines = new Set();
    const enemyDefs = [];
    for (let i = 0; i < 3; i++) {
      const pool = state.characters.filter(c =>
        c.evolutionStage === 0 &&
        !playerLines.has(c.evolutionLine) &&
        !usedEnemyLines.has(c.evolutionLine)
      );
      if (!pool.length) break; // plus aucune lignée disponible (roster trop petit) — repli silencieux
      const picked = pool[Math.floor(Math.random() * pool.length)];
      enemyDefs.push(picked);
      usedEnemyLines.add(picked.evolutionLine);
    }

    return enemyDefs.map((def, i) => {
      const baseStats = CWGameDatabase.computeStats(def, avgLevel, 0, state.config.awakening, def.rarity, state.config.level);
      const fighter = CWDefileEngine.buildFighter({ instanceId: `enemy_${i}` }, def, baseStats, cfg);
      fighter.level = avgLevel;
      return fighter;
    });
  }

  function renderDefilePlanning() {
    const el = document.getElementById('screen-defile-planning');
    if (!el) return;
    const state = CWGameState.get();
    const cfg   = state.config.combat;
    const teamInstances = CWGameState.getTeam();

    if (teamInstances.length < 3) {
      el.innerHTML = `
        <div class="screen-header"><h2>💃 Défilé</h2></div>
        <p class="empty-msg">Compose une équipe complète (3 personnages) avant de te lancer dans un défilé.</p>
      `;
      return;
    }

    if (!_defileState) {
      const programme = CWDefileEngine.generateProgramme(cfg, state.types);
      const playerTeam = teamInstances.map(inst => {
        const def = CWGameState.getCharDef(inst.charId);
        const finalStats = CWGameState.getCharacterFinalStats(inst);
        const fighter = CWDefileEngine.buildFighter(inst, def, finalStats, cfg);
        fighter.portrait = def.portrait; // pour l'affichage façon fiche Collection
        fighter.level = inst.level;      // pour calquer le niveau de l'équipe adverse
        return fighter;
      });
      const enemyTeam = _buildDefileEnemyTeam(playerTeam, cfg, state);
      const enemyAssignment = CWDefileEngine.autoAssign(programme, enemyTeam, state.typeMatrix, cfg.defileUsesPerChar ?? 3);
      _defileState = {
        programme,
        playerTeam,
        enemyTeam,        // générée une fois pour toute la planification (nécessaire pour Légende et Mystique)
        enemyAssignment,  // idem — son programme complet doit être connu pour Mystique
        assignment: new Array(programme.length).fill(null), // { instanceId } — qui défile
        talentPlacement: {},                                 // { round: { instanceId, typeId } } — Talent placé (libre, par personnage + type)
        usesPerChar: cfg.defileUsesPerChar ?? 3,
        legendeCopyTypeId: null,       // choix de Légende (Polyvalence), tranché avant la planification
        legendeChoicePending: playerTeam.some(f => f.type1 === 'Legende' || f.type2 === 'Legende'),
        mystiqueSwapRounds: {},        // { round (1-based) du talent Mystique : [round1, round2] adverses échangés }
      };
    }

    // Légende (Polyvalence) : si l'équipe du joueur en possède une, elle doit
    // choisir AVANT toute planification quel Talent adverse copier.
    if (_defileState.legendeChoicePending && !_defileState.legendeCopyTypeId) {
      _renderDefileLegendeChoice();
      return;
    }

    _renderDefilePlanningDOM();
  }

  /** Écran de choix de Légende : révèle les Talents adverses, le joueur en copie un */
  function _renderDefileLegendeChoice() {
    const el = document.getElementById('screen-defile-planning');
    if (!el) return;
    const state = CWGameState.get();
    const { enemyTeam } = _defileState;

    // Un Talent par type possédé par chaque adversaire (comme pour le joueur)
    const seen = new Set();
    const choices = [];
    enemyTeam.forEach(f => {
      [f.type1, f.type2].filter(Boolean).forEach(typeId => {
        if (seen.has(typeId)) return;
        seen.add(typeId);
        const talent = CWGameDatabase.getDefileTalentDisplay(typeId, state.config.combat);
        if (talent) choices.push({ typeId, talent, ownerName: f.name });
      });
    });

    el.innerHTML = `
      <div class="screen-header"><h2>👑 Polyvalence</h2></div>
      <p class="defile-help">
        Une de tes personnages est de type Légende — avant toute planification,
        choisis lequel des Talents adverses elle copiera pour tout ce défilé.
      </p>
      <div class="affinity-list">
        ${choices.map(c => `
          <div class="affinity-card legende-choice-card" data-type="${c.typeId}" style="cursor:pointer;">
            <div class="affinity-portrait" style="display:flex;align-items:center;justify-content:center;font-size:1.4rem;">⭐</div>
            <div class="affinity-info">
              <div class="affinity-name-row">
                <span class="affinity-name">${c.talent.name}</span>
                <span class="affinity-rarity-badge" style="background:#8c00ff;">${c.ownerName}</span>
              </div>
              <div style="font-size:.74rem;color:var(--text-dim);">${c.talent.description}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    el.querySelectorAll('.legende-choice-card').forEach(card => {
      card.addEventListener('click', () => {
        _defileState.legendeCopyTypeId = card.dataset.type;
        renderDefilePlanning();
      });
    });
  }

  /**
   * Ouvre une fenêtre modale montrant le programme adverse (personnages,
   * stats, thème de chaque passage — SANS les Talents), et laisse le joueur
   * choisir un passage adverse ULTÉRIEUR à échanger avec celui où Mystique
   * vient d'être placée.
   */
  function _openDefileMystiquePicker(mystiqueRound) {
    const state = CWGameState.get();
    const { programme, enemyTeam, enemyAssignment } = _defileState;

    const eligible = enemyAssignment
      .map((slot, idx) => ({ idx, slot }))
      .filter(({ idx, slot }) => idx > mystiqueRound && slot);

    const overlay = document.createElement('div');
    overlay.className = 'defile-modal-overlay';
    overlay.innerHTML = `
      <div class="defile-modal">
        <h3 class="defile-modal-title">🪄 Substitution — choisis un passage adverse</h3>
        <p class="defile-modal-help">
          Voici le programme complet de l'adversaire (ses Talents restent secrets).
          Choisis un passage <strong>ultérieur</strong> à échanger avec le Tournage ${mystiqueRound + 1},
          où ta Mystique est programmée : les deux personnages adverses concernées seront échangées.
        </p>
        <div class="defile-modal-list">
          ${eligible.map(({ idx, slot }) => {
            const f = enemyTeam.find(x => x.instanceId === slot.instanceId);
            const p = programme[idx];
            const t = state.types.find(tt => tt.id === p.typeId);
            return `
              <div class="defile-modal-option" data-round="${idx}">
                <div class="defile-modal-option-num">Tournage ${idx + 1}</div>
                <div class="defile-modal-option-info">
                  <strong>${f?.name || '?'}</strong>
                  <span>${STAT_LABELS_SHORT[p.stat]} · <span style="color:${t?.color}">${t?.icon} ${t?.name}</span></span>
                  <span class="defile-modal-option-stats">✨${f?.atk ?? '?'} 🌹${f?.def ?? '?'} 🕊️${f?.spd ?? '?'}</span>
                </div>
              </div>`;
          }).join('') || `<p class="empty-msg">Aucun passage ultérieur disponible pour l'adversaire.</p>`}
        </div>
        ${eligible.length ? '' : '<button class="btn-secondary" id="btn-mystique-cancel" style="width:100%;">Fermer</button>'}
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('.defile-modal-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const targetIdx = parseInt(opt.dataset.round);
        _defileState.mystiqueSwapRounds[mystiqueRound + 1] = [mystiqueRound + 1, targetIdx + 1];
        _showToast(`🪄 Substitution programmée : Tournage ${mystiqueRound + 1} ↔ Tournage ${targetIdx + 1} (côté adverse)`, 'success');
        overlay.remove();
      });
    });
    overlay.querySelector('#btn-mystique-cancel')?.addEventListener('click', () => overlay.remove());
  }

  function _defileUsesLeft(instanceId) {
    const used = _defileState.assignment.filter(a => a && a.instanceId === instanceId).length;
    return _defileState.usesPerChar - used;
  }

  /** Round où CETTE personnage (peu importe lequel de ses types) a déjà placé son Talent, ou -1 */
  function _defileCharacterTalentRound(instanceId) {
    const entry = Object.entries(_defileState.talentPlacement).find(([, v]) => v.instanceId === instanceId);
    return entry ? parseInt(entry[0]) : -1;
  }

  /** Round où LE Talent précis (cette personnage + ce type) est placé, ou -1 */
  function _defileTalentChipRound(instanceId, typeId) {
    const entry = Object.entries(_defileState.talentPlacement).find(([, v]) => v.instanceId === instanceId && v.typeId === typeId);
    return entry ? parseInt(entry[0]) : -1;
  }

  function _renderDefilePlanningDOM() {
    const el = document.getElementById('screen-defile-planning');
    if (!el) return;
    const state = CWGameState.get();
    const types = state.types;
    const { programme, playerTeam, assignment, talentPlacement, mystiqueSwapRounds } = _defileState;

    const allFilled = assignment.every(a => a);
    const maxTalents = state.config.combat.defileTalentsCount ?? 3;
    const talentsPlaced = Object.keys(talentPlacement).length;
    const canValidate = allFilled && talentsPlaced === maxTalents;

    const typeBadge = (typeId) => {
      const t = types.find(tt => tt.id === typeId);
      if (!t) return '';
      return `<span class="defile-type-badge" style="background:${t.color}">${t.icon}</span>`;
    };

    // Une "puce" de Talent par type possédé (donc 2 si double-type) — si 2
    // personnages partagent un même type, chacune a bien sa PROPRE puce
    // indépendante (identifiée par personnage + type, pas juste par type).
    const talentChips = [];
    playerTeam.forEach(f => {
      [f.type1, f.type2].filter(Boolean).forEach(typeId => {
        talentChips.push({ instanceId: f.instanceId, typeId, owner: f });
      });
    });

    el.innerHTML = `
      <div class="screen-header"><h2>💃 Défilé — Planification</h2></div>
      <p class="defile-help">
        Glisse chacune de tes personnages sur ${_defileState.usesPerChar} tournages, puis glisse
        librement un Talent par personnage sur le tournage de ton choix (une fois par duel).
      </p>
      <div class="defile-programme" id="defile-programme">
        ${programme.map((p, idx) => {
          const slot = assignment[idx];
          const fighter = slot ? playerTeam.find(f => f.instanceId === slot.instanceId) : null;
          const t = types.find(tt => tt.id === p.typeId);
          const talentSlot = talentPlacement[idx];
          const talent = talentSlot ? _getPlanningTalentDisplay(talentSlot.typeId, state.config.combat) : null;
          const talentOwner = talentSlot ? playerTeam.find(f => f.instanceId === talentSlot.instanceId) : null;

          // Modificateur en direct de CETTE personnage face au type du passage
          const liveMult = fighter ? CWGameDatabase.getBestTypeEffectiveness(fighter.type1, fighter.type2, p.typeId, null, state.typeMatrix) : null;

          return `
            <div class="defile-slot ${fighter ? 'filled' : ''}" data-round="${idx}">
              <div class="defile-slot-num">Tournage ${p.round}</div>
              <div class="defile-slot-theme">
                <span>${STAT_LABELS_SHORT[p.stat]}</span>
                <span class="defile-slot-type" style="background:${t?.color || '#888'}">${t?.icon || ''} ${t?.name || p.typeId}</span>
              </div>
              <div class="defile-slot-content">
                ${fighter ? `
                  <div class="defile-slot-fighter">
                    <span class="defile-slot-fighter-name">${fighter.name}</span>
                    <button class="defile-slot-remove" data-round="${idx}" title="Retirer">✕</button>
                  </div>
                  <div class="defile-slot-stats">
                    ${typeBadge(fighter.type1)}${typeBadge(fighter.type2)}
                    <span>${STAT_LABELS_SHORT.atk.slice(0,2)}${fighter.atk}</span><span>${STAT_LABELS_SHORT.def.slice(0,2)}${fighter.def}</span><span>${STAT_LABELS_SHORT.spd.slice(0,2)}${fighter.spd}</span>
                  </div>
                  ${liveMult != null ? `<div class="defile-slot-mult ${_affinityMeta(liveMult).cls}">${_formatAffinityMult(liveMult)} sur ce thème</div>` : ''}
                ` : `<span class="defile-slot-empty">Glisse une personnage ici</span>`}
                <div class="defile-slot-talent-zone ${talent ? 'has-talent' : ''}">
                  ${talent
                    ? `<span>⭐ ${talent.name} <small>(${talentOwner?.name || ''})</small></span><button class="defile-talent-remove" data-round="${idx}" title="Retirer">✕</button>`
                    : `<span class="defile-slot-empty">Dépose un Talent ici</span>`}
                </div>
                ${talentSlot?.typeId === 'Mystique' ? `
                  <div class="defile-mystique-indicator">
                    ${mystiqueSwapRounds[idx + 1]
                      ? `🪄 Échange avec le Tournage ${mystiqueSwapRounds[idx + 1][1]} adverse`
                      : `⚠️ Aucun passage choisi`}
                    <button class="defile-mystique-edit-btn" data-round="${idx}">Modifier</button>
                  </div>
                ` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="defile-roster-cards" id="defile-roster">
        ${playerTeam.map(f => {
          const left = _defileUsesLeft(f.instanceId);
          const def = CWGameState.getCharDef(f.charId);
          return `
            <div class="defile-fighter-card ${left === 0 ? 'exhausted' : ''}" data-instance="${f.instanceId}" data-drag-kind="char">
              <div class="defile-fighter-card-portrait">
                ${_detailPortraitImgHtml(def)}
              </div>
              <div class="defile-fighter-card-info">
                <div class="defile-chip-name">${f.name}</div>
                <div class="defile-chip-types">${typeBadge(f.type1)}${typeBadge(f.type2)}</div>
                <div class="defile-chip-stats-grid">
                  <div class="defile-chip-stat-col"><span class="defile-chip-stat-label">✨</span><span class="defile-chip-stat-value">${f.atk}</span></div>
                  <div class="defile-chip-stat-col"><span class="defile-chip-stat-label">🌹</span><span class="defile-chip-stat-value">${f.def}</span></div>
                  <div class="defile-chip-stat-col"><span class="defile-chip-stat-label">🕊️</span><span class="defile-chip-stat-value">${f.spd}</span></div>
                </div>
                <div class="defile-chip-uses">${left}/${_defileState.usesPerChar} restants</div>
                ${_buildCompactAffinitiesHtml(f.type1, f.type2)}
              </div>
            </div>`;
        }).join('')}
      </div>

      <div class="defile-help" style="margin-top:14px;">
        Talents disponibles — ${talentsPlaced}/${maxTalents} placés (glisse-en un sur le tournage de ton choix, peu importe la personnage) :
      </div>
      <div class="defile-roster" id="defile-talents">
        ${talentChips.map(chip => {
          const talent = _getPlanningTalentDisplay(chip.typeId, state.config.combat);
          const ownRound = _defileTalentChipRound(chip.instanceId, chip.typeId);
          const placed = ownRound >= 0;
          const limitReached = talentsPlaced >= maxTalents && !placed;
          const disabled = placed || limitReached;
          return `
            <div class="defile-chip defile-talent-chip ${disabled ? 'exhausted' : ''}"
                 data-instance="${chip.instanceId}" data-type="${chip.typeId}" data-drag-kind="talent">
              <div class="defile-chip-name">${typeBadge(chip.typeId)} ${talent?.name || chip.typeId}
                <small style="color:var(--text-faint);font-weight:400;">— ${chip.owner.name}</small>
              </div>
              <div class="defile-chip-talent-desc">${talent?.description || ''}</div>
              <div class="defile-chip-uses">
                ${placed ? `Placé — tournage ${ownRound + 1}`
                  : limitReached ? `Limite de ${maxTalents} Talents atteinte`
                  : 'Non placé'}
              </div>
            </div>`;
        }).join('')}
      </div>
      <button class="btn-primary" id="btn-defile-validate" ${canValidate ? '' : 'disabled'} style="width:100%;margin-top:14px;">
        ${canValidate ? '✅ Valider le programme' : `Programme incomplet (${assignment.filter(Boolean).length}/${programme.length} placés, ${talentsPlaced}/${maxTalents} Talents)`}
      </button>
    `;

    _bindDefilePlanningEvents();
  }

  function _bindDefilePlanningEvents() {
    const el = document.getElementById('screen-defile-planning');
    if (!el) return;

    // Glisser-déposer tactile/souris via Pointer Events (fonctionne au doigt ET à la souris)
    el.querySelectorAll('.defile-chip:not(.exhausted), .defile-fighter-card:not(.exhausted)').forEach(chip => {
      const kind = chip.dataset.dragKind;
      chip.addEventListener('pointerdown', (e) => {
        if (kind === 'char') _startDefileDrag(e, 'char', { instanceId: chip.dataset.instance });
        else _startDefileDrag(e, 'talent', { instanceId: chip.dataset.instance, typeId: chip.dataset.type });
      });
    });

    el.querySelectorAll('.defile-slot-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const round = parseInt(btn.dataset.round);
        _defileState.assignment[round] = null;
        delete _defileState.talentPlacement[round]; // plus personne pour porter un Talent ici
        delete _defileState.mystiqueSwapRounds[round + 1];
        _renderDefilePlanningDOM();
      });
    });

    el.querySelectorAll('.defile-talent-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const round = parseInt(btn.dataset.round);
        delete _defileState.talentPlacement[round];
        delete _defileState.mystiqueSwapRounds[round + 1];
        _renderDefilePlanningDOM();
      });
    });

    el.querySelectorAll('.defile-mystique-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => _openDefileMystiquePicker(parseInt(btn.dataset.round)));
    });

    document.getElementById('btn-defile-validate')?.addEventListener('click', _runDefileDuel);
  }

  /**
   * Démarre le glisser-déposer via Pointer Events (fonctionne au doigt ET à la
   * souris), pour deux sortes d'éléments :
   * - 'char'   : place une personnage sur un passage (limité à ses N usages)
   * - 'talent' : place librement l'un des Talents d'une personnage (un par
   *              type possédé) sur n'importe quel passage déjà occupé — une
   *              même personnage ne peut en placer qu'un seul au total.
   */
  function _startDefileDrag(e, kind, payload) {
    e.preventDefault();
    const label = kind === 'char'
      ? _defileState.playerTeam.find(f => f.instanceId === payload.instanceId)?.name
      : _getPlanningTalentDisplay(payload.typeId, CWGameState.get().config.combat)?.name;
    if (!label) return;

    const ghost = document.createElement('div');
    ghost.className = 'defile-drag-ghost';
    ghost.textContent = (kind === 'talent' ? '⭐ ' : '') + label;
    document.body.appendChild(ghost);
    _moveDefileGhost(ghost, e.clientX, e.clientY);

    const onMove = (ev) => _moveDefileGhost(ghost, ev.clientX, ev.clientY);
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      ghost.remove();

      const dropEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const slotEl = dropEl?.closest('.defile-slot');
      if (!slotEl) return;
      const round = parseInt(slotEl.dataset.round);

      if (kind === 'char') {
        if (_defileUsesLeft(payload.instanceId) > 0) {
          _defileState.assignment[round] = { instanceId: payload.instanceId };
          _renderDefilePlanningDOM();
        } else {
          _showToast('⚠️ Cette personnage a déjà défilé le nombre de fois autorisé.', 'error');
        }
      } else { // talent
        if (!_defileState.assignment[round]) {
          _showToast('⚠️ Place d\'abord une personnage sur ce tournage.', 'error');
          return;
        }
        const cfg = CWGameState.get().config.combat;
        const maxTalents = cfg.defileTalentsCount ?? 3;
        const alreadyPlacedThisChip = _defileTalentChipRound(payload.instanceId, payload.typeId) >= 0;
        const totalPlaced = Object.keys(_defileState.talentPlacement).length;
        if (!alreadyPlacedThisChip && totalPlaced >= maxTalents) {
          _showToast(`⚠️ Limite de ${maxTalents} Talents déjà atteinte.`, 'error');
          return;
        }
        // Cette puce précise ne peut être placée qu'à un seul endroit à la fois
        if (alreadyPlacedThisChip) {
          const prevRound = _defileTalentChipRound(payload.instanceId, payload.typeId);
          delete _defileState.talentPlacement[prevRound];
          delete _defileState.mystiqueSwapRounds[prevRound + 1]; // le round Mystique change, son choix précédent n'a plus de sens
        }
        _defileState.talentPlacement[round] = { instanceId: payload.instanceId, typeId: payload.typeId };
        _renderDefilePlanningDOM();

        // Mystique (Substitution) : demande immédiatement quel passage adverse
        // ultérieur échanger avec celui-ci — léger délai pour laisser
        // l'événement tactile actuel se terminer avant de créer la modale
        // (sinon le premier tap dessus peut ne pas être pris en compte).
        if (payload.typeId === 'Mystique') {
          setTimeout(() => _openDefileMystiquePicker(round), 60);
        }
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  function _moveDefileGhost(ghost, x, y) {
    ghost.style.left = `${x}px`;
    ghost.style.top  = `${y}px`;
  }

  let _defileLastResult = null;
  let _dpbSkip = false;

  let _dpbSpeed = 1; // 1 = normal, 2 = accéléré
  const _sleep = (ms) => new Promise(r => setTimeout(r, _dpbSkip ? 0 : ms / _dpbSpeed));

  function renderDefilePlayback() {
    const el = document.getElementById('screen-defile-playback');
    if (!el || !_defileLastResult) return;
    _dpbSkip = false;
    _dpbSpeed = 1;

    el.innerHTML = `
      <div class="dpb-screen">
        <div class="dpb-totals">
          <div class="dpb-total-block player">
            <span class="dpb-total-label">Toi</span>
            <strong class="dpb-total-value" id="dpb-total-player">0</strong>
          </div>
          <div class="dpb-round-indicator">Tournage <span id="dpb-round-num">1</span> / ${_defileLastResult.log.length}</div>
          <div class="dpb-total-block enemy">
            <span class="dpb-total-label">Adversaire</span>
            <strong class="dpb-total-value" id="dpb-total-enemy">0</strong>
          </div>
        </div>
        <div class="dpb-theme" id="dpb-theme"></div>
        <div class="dpb-stage">
          <div class="dpb-side dpb-side-player" id="dpb-side-player">
            <div class="dpb-card-frame">
              <div class="dpb-portrait" id="dpb-portrait-player"></div>
              <div class="dpb-nameplate" id="dpb-name-player"></div>
            </div>
            <div class="dpb-stat-line" id="dpb-stat-player"></div>
            <div class="dpb-endurance-line" id="dpb-endurance-player"></div>
            <div class="dpb-score-box">
              <div class="dpb-score-tag">Score</div>
              <div class="dpb-score-row">
                <span class="dpb-score" id="dpb-score-player">—</span>
                <span class="dpb-type-badge" id="dpb-type-badge-player"></span>
              </div>
            </div>
          </div>
          <div class="dpb-vs">VS</div>
          <div class="dpb-side dpb-side-enemy" id="dpb-side-enemy">
            <div class="dpb-card-frame">
              <div class="dpb-portrait" id="dpb-portrait-enemy"></div>
              <div class="dpb-nameplate" id="dpb-name-enemy"></div>
            </div>
            <div class="dpb-stat-line" id="dpb-stat-enemy"></div>
            <div class="dpb-endurance-line" id="dpb-endurance-enemy"></div>
            <div class="dpb-score-box">
              <div class="dpb-score-tag">Score</div>
              <div class="dpb-score-row">
                <span class="dpb-type-badge" id="dpb-type-badge-enemy"></span>
                <span class="dpb-score" id="dpb-score-enemy">—</span>
              </div>
            </div>
          </div>
        </div>
        <div class="dpb-phase-caption" id="dpb-phase-caption"></div>
        <div class="dpb-event-log" id="dpb-event-log"></div>
      </div>
    `;

    // position:fixed (jamais affecté par le défilement de l'écran), mais avec
    // des coordonnées calculées à partir des vraies bornes de l'interface
    // (.app-shell), pas des valeurs CSS fixes qui échapperaient vers tout le
    // NAVIGATEUR sur un écran large. Placés sous le bandeau d'en-tête.
    const shellEl = document.querySelector('.app-shell');
    const shellRect = shellEl ? shellEl.getBoundingClientRect() : { top: 14, right: window.innerWidth - 14 };
    const btnTop = shellRect.top + 78; // sous le bandeau d'en-tête (logo + HUD)
    const btnRight = window.innerWidth - shellRect.right + 14;

    document.querySelectorAll('.dpb-skip-btn, .dpb-speed-btn').forEach(b => b.remove());
    const skipBtn = document.createElement('button');
    skipBtn.className = 'dpb-skip-btn';
    skipBtn.id = 'btn-dpb-skip';
    skipBtn.textContent = 'Passer ›';
    skipBtn.style.top = `${btnTop}px`;
    skipBtn.style.right = `${btnRight}px`;
    skipBtn.addEventListener('click', () => { _dpbSkip = true; });
    document.body.appendChild(skipBtn);

    const speedBtn = document.createElement('button');
    speedBtn.className = 'dpb-speed-btn';
    speedBtn.id = 'btn-dpb-speed';
    speedBtn.textContent = '×1';
    speedBtn.style.top = `${btnTop}px`;
    speedBtn.style.right = `${btnRight + 82}px`;
    speedBtn.addEventListener('click', (e) => {
      _dpbSpeed = _dpbSpeed === 1 ? 2 : 1;
      e.currentTarget.textContent = `×${_dpbSpeed}`;
    });
    document.body.appendChild(speedBtn);

    _runDefilePlaybackSequence();
  }

  async function _runDefilePlaybackSequence() {
    const log = _defileLastResult.log;
    let totalP = 0, totalE = 0;

    for (let i = 0; i < log.length; i++) {
      if (_dpbSkip) break;
      await _playDefileRound(log[i], totalP, totalE);
      totalP += log[i].playerScore;
      totalE += log[i].enemyScore;
    }

    document.querySelectorAll('.dpb-skip-btn, .dpb-speed-btn').forEach(b => b.remove());
    showScreen('defile-result');
  }

  /** Affiche une légende explicative sous les cartes, décrivant ce qui se passe à l'instant */
  function _setDefilePhaseCaption(text) {
    const el = document.getElementById('dpb-phase-caption');
    if (el) {
      el.classList.remove('visible'); void el.offsetWidth;
      el.textContent = text;
      el.classList.add('visible');
    }
    if (text) _appendDefileLog(text);
  }

  /** Ajoute une ligne au log d'événements du bas d'écran (utile si on n'a pas le temps de lire les légendes) */
  function _appendDefileLog(text) {
    const log = document.getElementById('dpb-event-log');
    if (!log) return;
    const line = document.createElement('div');
    line.className = 'dpb-log-line';
    line.textContent = text;
    log.appendChild(line);
    // Garde un historique raisonnable, défile automatiquement vers le bas
    while (log.children.length > 30) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  /** Joue l'intégralité de la séquence d'UN tournage, sans le moindre chevauchement */
  async function _playDefileRound(l, totalPBefore, totalEBefore) {
    const $ = (id) => document.getElementById(id);
    if (!$('dpb-side-player')) return; // écran quitté entre-temps

    $('dpb-round-num').textContent = l.round;
    $('dpb-theme').textContent = `${STAT_LABELS_SHORT[l.stat]} — jugé sur ce tournage`;
    _setDefilePhaseCaption('');

    const pDef = l.playerCharId ? CWGameState.getCharDef(l.playerCharId) : null;
    const eDef = l.enemyCharId  ? CWGameState.getCharDef(l.enemyCharId)  : null;
    $('dpb-portrait-player').innerHTML = pDef ? _combatPortraitImgHtml(pDef) : '';
    $('dpb-portrait-enemy').innerHTML  = eDef ? _combatPortraitImgHtml(eDef) : '';
    $('dpb-name-player').textContent = l.playerFighter || '—';
    $('dpb-name-enemy').textContent  = l.enemyFighter  || '—';
    $('dpb-stat-player').textContent = '';
    $('dpb-stat-enemy').textContent  = '';
    $('dpb-score-player').textContent = '—';
    $('dpb-score-enemy').textContent  = '—';
    $('dpb-type-badge-player').className = 'dpb-type-badge';
    $('dpb-type-badge-player').textContent = '';
    $('dpb-type-badge-enemy').className = 'dpb-type-badge';
    $('dpb-type-badge-enemy').textContent = '';
    $('dpb-side-player').classList.remove('winner');
    $('dpb-side-enemy').classList.remove('winner');
    $('dpb-endurance-player').textContent = (l.playerEnduranceRemaining != null && l.playerEnduranceMax != null) ? `Forme : ${l.playerEnduranceRemaining}/${l.playerEnduranceMax}` : '';
    $('dpb-endurance-enemy').textContent  = (l.enemyEnduranceRemaining  != null && l.enemyEnduranceMax  != null) ? `Forme : ${l.enemyEnduranceRemaining}/${l.enemyEnduranceMax}`   : '';

    const statLabel = STAT_LABELS_SHORT[l.stat].replace(/^[^\s]+\s/, ''); // enlève l'icône, garde le mot
    const pSide = $('dpb-side-player'), eSide = $('dpb-side-enemy');

    /** Affiche un par un les événements d'une étape donnée (jamais 2 en même temps) */
    async function playStageEvents(stage) {
      for (const evt of l.events.filter(e => e.stage === stage)) {
        if (_dpbSkip) break;
        const text = String(evt.text || evt).replace(/<[^>]+>/g, '');
        _setDefilePhaseCaption(text);
        if (evt.reversed && l.reversalInfo) {
          await _showDefileAmazoneReversal(text, l.reversalInfo.beneficiaryName);
        } else {
          CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileTalent);
          await _showDefileTalentBanner(text);
        }
        if (evt.playerScoreAfter != null) await _setScorePop('dpb-score-player', evt.playerScoreAfter);
        if (evt.enemyScoreAfter  != null) await _setScorePop('dpb-score-enemy',  evt.enemyScoreAfter);
        await _sleep(700);
      }
    }

    // Phase 1 — présentation : zoom rapide sur chaque participante, l'une
    // après l'autre (jamais simultané, pour rester lisible)
    pSide.classList.remove('reveal'); eSide.classList.remove('reveal');
    void pSide.offsetWidth; // force le rejeu de l'animation à chaque tournage
    _setDefilePhaseCaption(`Présentation — ${l.playerFighter || '?'}`);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileReveal);
    pSide.classList.add('reveal');
    await _sleep(900);
    _setDefilePhaseCaption(`Présentation — ${l.enemyFighter || '?'}`);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileReveal);
    eSide.classList.add('reveal');
    await _sleep(1400);

    // Phase 1b — événements de tout DÉBUT de tournage (Naturelle, Élégance,
    // Mystique, Diva...) : ils se produisent AVANT toute stat/score, donc
    // affichés en tout premier, dans l'ordre chronologique réel du moteur.
    await playStageEvents(0);
    if (l.cancelledTalent) {
      await _showDefileCancelledTalentBanner(l.cancelledTalent.name, l.cancelledTalent.side);
      await _sleep(400);
    }

    // Phase 2 — la stat jugée apparaît sous chaque participante (peut
    // différer d'un côté à l'autre si Diva a changé celle de l'adversaire)
    $('dpb-stat-player').textContent = STAT_LABELS_SHORT[l.playerJudgedStat || l.stat];
    $('dpb-stat-enemy').textContent  = STAT_LABELS_SHORT[l.enemyJudgedStat  || l.stat];
    _setDefilePhaseCaption(`Épreuve de ce tournage : ${statLabel}`);
    await _sleep(1600);

    // Phase 3 — score de base (valeur BRUTE, avant tout Talent), révélé pour
    // l'alliée D'ABORD, puis pour l'adversaire — jamais les deux en même temps
    _setDefilePhaseCaption(`Score de base (${STAT_LABELS_SHORT[l.playerJudgedStat || l.stat].replace(/^[^\s]+\s/, '')}) — ${l.playerFighter || '?'}`);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileScoreTick);
    await _setScorePop('dpb-score-player', l.playerStatValue ?? 0);
    _setDefilePhaseCaption(`Score de base (${STAT_LABELS_SHORT[l.enemyJudgedStat || l.stat].replace(/^[^\s]+\s/, '')}) — ${l.enemyFighter || '?'}`);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileScoreTick);
    await _setScorePop('dpb-score-enemy', l.enemyStatValue ?? 0);

    // Phase 3b — modificateurs de STAT (Passion, Idole, Enchanteresse),
    // chacun affiché avec son montant exact, AVANT le multiplicateur de type
    await playStageEvents(1);
    if (l.playerStatAfterMods != null) await _setScorePop('dpb-score-player', l.playerStatAfterMods);
    if (l.enemyStatAfterMods  != null) await _setScorePop('dpb-score-enemy',  l.enemyStatAfterMods);

    // Phase 4 — bonus/malus de type révélé, score recalculé en direct
    _setDefilePhaseCaption(`Multiplicateur de type ${l.playerMult != null ? _formatAffinityMult(l.playerMult) : ''} — ${l.playerFighter || '?'}`);
    _showDefileTypeBadge('dpb-type-badge-player', l.playerMult);
    if (l.playerMult != null) CWAudioSystem.playSfx(l.playerMult >= 2 ? CWAudioSystem.SFX_KEYS.defileTypeGood : l.playerMult <= 0.5 ? CWAudioSystem.SFX_KEYS.defileTypeBad : null);
    await _setScorePop('dpb-score-player', l.playerAfterType ?? l.playerStatValue);
    _setDefilePhaseCaption(`Multiplicateur de type ${l.enemyMult != null ? _formatAffinityMult(l.enemyMult) : ''} — ${l.enemyFighter || '?'}`);
    _showDefileTypeBadge('dpb-type-badge-enemy', l.enemyMult);
    if (l.enemyMult != null) CWAudioSystem.playSfx(l.enemyMult >= 2 ? CWAudioSystem.SFX_KEYS.defileTypeGood : l.enemyMult <= 0.5 ? CWAudioSystem.SFX_KEYS.defileTypeBad : null);
    await _setScorePop('dpb-score-enemy', l.enemyAfterType ?? l.enemyStatValue);

    // Phase 4c — modificateurs de SCORE (Charme, Sale Rumeur, Retournement
    // d'Amazone), chacun affiché avec son montant exact, AVANT le Bonus Forme
    await playStageEvents(3);
    if (l.playerScoreBeforeForme != null) await _setScorePop('dpb-score-player', l.playerScoreBeforeForme);
    if (l.enemyScoreBeforeForme  != null) await _setScorePop('dpb-score-enemy',  l.enemyScoreBeforeForme);

    // Phase 4b — bonus de Forme (Endurance restante), révélé alliée puis adversaire
    if (l.playerEnduranceBonusPct != null) {
      _setDefilePhaseCaption(`Bonus de Forme — ${l.playerFighter || '?'}`);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileEndurance);
      await _setScorePop('dpb-score-player', l.playerAfterEndurance ?? l.playerScoreBeforeForme);
    }
    if (l.enemyEnduranceBonusPct != null) {
      _setDefilePhaseCaption(`Bonus de Forme — ${l.enemyFighter || '?'}`);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileEndurance);
      await _setScorePop('dpb-score-enemy', l.enemyAfterEndurance ?? l.enemyScoreBeforeForme);
    }

    // Phase 6 — score final du tournage, révélé alliée d'abord puis adversaire
    _setDefilePhaseCaption(`Score final du tournage — ${l.playerFighter || '?'}`);
    await _setScorePop('dpb-score-player', l.playerScore);
    _setDefilePhaseCaption(`Score final du tournage — ${l.enemyFighter || '?'}`);
    await _setScorePop('dpb-score-enemy', l.enemyScore);
    pSide.classList.toggle('winner', l.playerScore > l.enemyScore);
    eSide.classList.toggle('winner', l.enemyScore > l.playerScore);
    await _sleep(400);

    // Phase 6b — zoom sur la gagnante du tournage ; le son victoire/défaite
    // (le seul, pas un son en plus) se joue une fois le portrait au centre.
    if (l.playerScore !== l.enemyScore) {
      _setDefilePhaseCaption(`${l.playerScore > l.enemyScore ? l.playerFighter : l.enemyFighter} remporte le tournage !`);
      const resultSfx = l.playerScore > l.enemyScore ? CWAudioSystem.SFX_KEYS.defileRoundWin : CWAudioSystem.SFX_KEYS.defileRoundLose;
      await _spotlightDefileWinner(l.playerScore > l.enemyScore ? pSide : eSide, resultSfx);
    }
    await _sleep(600);

    // Phase 6c — la journée se termine, la Forme redescend EN DIRECT sous
    // chaque carte, avec la baisse visible et une mention explicative
    if (l.playerWalked && l.playerEnduranceBefore != null) {
      const dropAmount = l.playerEnduranceBefore - l.playerEnduranceAfter;
      _setDefilePhaseCaption(`La journée est terminée, ${l.playerFighter} est fatiguée : -${dropAmount}% Forme`);
      await _animateDefileEnduranceDrop('dpb-endurance-player', l.playerEnduranceMax, l.playerEnduranceBefore, l.playerEnduranceAfter);
      await _sleep(1800);
    }
    if (l.enemyWalked && l.enemyEnduranceBefore != null) {
      const dropAmount = l.enemyEnduranceBefore - l.enemyEnduranceAfter;
      _setDefilePhaseCaption(`La journée est terminée, ${l.enemyFighter} est fatiguée : -${dropAmount}% Forme`);
      await _animateDefileEnduranceDrop('dpb-endurance-enemy', l.enemyEnduranceMax, l.enemyEnduranceBefore, l.enemyEnduranceAfter);
      await _sleep(1800);
    }

    // Phase 7 — le score du tournage rejoint le total cumulé (compteur animé)
    _setDefilePhaseCaption('Ajout au score total cumulé');
    await Promise.all([
      _animateCountUp('dpb-total-player', totalPBefore, totalPBefore + l.playerScore, 700),
      _animateCountUp('dpb-total-enemy',  totalEBefore,  totalEBefore  + l.enemyScore,  700),
    ]);
    await _sleep(1200);
  }

  /** Anime la baisse de Forme d'une personnage sous sa carte, en valeur X/Y, avec un effet visuel de fatigue */
  function _animateDefileEnduranceDrop(elId, enduranceMax, fromPct, toPct) {
    return new Promise(resolve => {
      const el = document.getElementById(elId);
      if (!el || enduranceMax == null) { resolve(); return; }
      el.classList.add('endurance-dropping');
      const duration = 900;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const pct = fromPct + (toPct - fromPct) * t;
        const remaining = Math.round(enduranceMax * (pct / 100));
        el.textContent = `Forme : ${remaining}/${enduranceMax}`;
        if (t < 1) requestAnimationFrame(step);
        else { el.classList.remove('endurance-dropping'); resolve(); }
      }
      requestAnimationFrame(step);
    });
  }

  /**
   * Affiche la même grande bannière centrale que celle utilisée pour les
   * passifs en combat classique (pilule dégradée, avec rebond), le temps
   * qu'un Talent s'active — attend sa disparition avant de continuer.
   */
  /**
   * Zoom sur la carte gagnante du tournage : clone sa carte à l'identique,
   * l'anime depuis sa position actuelle jusqu'au centre de l'écran en
   * l'agrandissant, puis la retire (l'original reste affiché en dessous,
   * déjà mis en valeur par le halo doré ".winner").
   */
  function _spotlightDefileWinner(sideEl, resultSfxKey) {
    return new Promise(resolve => {
      const cardFrame = sideEl?.querySelector('.dpb-card-frame');
      const shell = document.querySelector('.app-shell');
      if (!cardFrame || !shell) { resolve(); return; }
      const rect = cardFrame.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();

      const clone = cardFrame.cloneNode(true);
      clone.className = 'dpb-card-frame dpb-spotlight-clone';
      clone.style.position = 'absolute'; // ancré DANS .app-shell — plus de calcul viewport fragile
      clone.style.left = `${rect.left - shellRect.left}px`;
      clone.style.top = `${rect.top - shellRect.top}px`;
      clone.style.width = `${rect.width}px`;
      clone.style.margin = '0';
      // Le centre CIBLE est le centre de .app-shell LUI-MÊME (coordonnées relatives, garanties justes)
      clone.style.setProperty('--dpb-target-left', `${shellRect.width / 2}px`);
      clone.style.setProperty('--dpb-target-top', `${shellRect.height / 2}px`);
      shell.appendChild(clone);

      const arrivalDelay = 550; // durée de la transition CSS de rapprochement
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clone.classList.add('active');
      }));

      setTimeout(async () => {
        // Le portrait est maintenant au centre — on attend 500ms de plus,
        // PUIS on joue LE son (celui transmis, pas un second en plus),
        // PUIS on attend sa vraie fin avant de repartir.
        await _sleep(500);
        await CWAudioSystem.playSfxAwait(resultSfxKey);
        clone.classList.remove('active');
        setTimeout(() => { clone.remove(); resolve(); }, 300);
      }, arrivalDelay);
    });
  }

  function _showDefileTalentBanner(text) {
    return new Promise(resolve => {
      const stage = document.querySelector('.dpb-stage');
      if (!stage) { resolve(); return; }
      const big = document.createElement('div');
      big.className = 'passive-banner-big dpb-talent-banner-big';
      big.innerHTML = `<span class="passive-banner-big-icon">⭐</span>${text}`;
      stage.appendChild(big);
      setTimeout(() => { big.remove(); resolve(); }, 1700);
    });
  }

  /**
   * Bannière spéciale pour un Talent CONTRÉ par Élégance (Rectification) :
   * apparaît normalement, puis s'efface vers le BAS (au lieu du fondu
   * classique) avec le son de défaite d'un tournage, pour bien marquer
   * visuellement l'annulation.
   */
  function _showDefileCancelledTalentBanner(name, side) {
    return new Promise(resolve => {
      const stage = document.querySelector('.dpb-stage');
      if (!stage) { resolve(); return; }
      const big = document.createElement('div');
      big.className = 'passive-banner-big dpb-talent-banner-big dpb-cancelled-banner';
      big.innerHTML = `<span class="passive-banner-big-icon">🚫</span>${name} (${side === 'player' ? 'toi' : 'adversaire'}) — annulé`;
      stage.appendChild(big);
      setTimeout(() => {
        big.classList.add('fading-down');
        CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileRoundLose);
        setTimeout(() => { big.remove(); resolve(); }, 500);
      }, 1200);
    });
  }

  /**
   * Chorégraphie du Retournement d'Amazone : la bannière du Talent contré
   * reste affichée, un flash apparaît, la bannière "Retournement" s'affiche
   * PAR-DESSUS, puis à sa disparition une icône rotative pulse 2-3 fois sur
   * la bannière contrée, avant d'afficher qui en bénéficie réellement.
   */
  async function _showDefileAmazoneReversal(text, beneficiaryName) {
    const stage = document.querySelector('.dpb-stage');
    if (!stage) return;
    const amazoneName = CWGameDatabase.getDefileTalentDisplay('Amazone', CWGameState.get().config.combat)?.name || 'Retournement';

    // 1. La bannière du Talent contré apparaît normalement (reste affichée)
    const original = document.createElement('div');
    original.className = 'passive-banner-big dpb-talent-banner-big dpb-amazone-original';
    original.innerHTML = `<span class="passive-banner-big-icon">⭐</span>${text}`;
    stage.appendChild(original);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileTalent);
    await _sleep(500);

    // 2. Flash à l'écran
    const flash = document.createElement('div');
    flash.className = 'dpb-screen-flash';
    stage.appendChild(flash);
    await _sleep(220);
    flash.remove();

    // 3. La bannière "Retournement" s'affiche PAR-DESSUS la bannière contrée
    const overlay = document.createElement('div');
    overlay.className = 'passive-banner-big dpb-talent-banner-big dpb-amazone-overlay';
    overlay.innerHTML = `<span class="passive-banner-big-icon">🥊</span>${amazoneName} !`;
    stage.appendChild(overlay);
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileTalent);
    await _sleep(1300);
    overlay.remove();

    // 4. Icône rotative en zoom/dézoom répété, superposée sur la bannière contrée
    const spin = document.createElement('div');
    spin.className = 'dpb-amazone-spin-icon';
    spin.textContent = '🔄';
    original.appendChild(spin);
    await _sleep(1500); // le temps que le pulse (2-3 répétitions) se joue

    // 5. Message final sur qui bénéficie réellement de l'effet
    _setDefilePhaseCaption(`Talent contré, il s'active pour ${beneficiaryName} !`);
    await _sleep(1000);

    original.remove();
  }

  /**
   * Anime un score en le faisant défiler jusqu'à sa valeur finale (façon
   * compteur), puis attend 1000ms une fois le bon chiffre affiché avant de
   * se résoudre — pour laisser le temps de le lire avant la suite.
   */
  function _setScorePop(elId, value) {
    return new Promise(resolve => {
      const el = document.getElementById(elId);
      if (!el) { resolve(); return; }
      const target = Math.round(value);
      const from = parseInt(el.textContent, 10) || 0;
      const duration = _dpbSkip ? 0 : 550;
      const start = performance.now();
      el.classList.remove('score-pop'); void el.offsetWidth; el.classList.add('score-pop');
      function step(now) {
        const t = duration === 0 ? 1 : Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 2); // ease-out : rapide au début, se stabilise à la fin
        el.textContent = Math.round(from + (target - from) * eased);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          el.textContent = target;
          setTimeout(resolve, _dpbSkip ? 0 : 1000);
        }
      }
      requestAnimationFrame(step);
    });
  }

  function _showDefileTypeBadge(elId, mult) {
    const el = document.getElementById(elId);
    if (!el || mult == null) return;
    el.textContent = _formatAffinityMult(mult);
    el.className = 'dpb-type-badge visible ' + (mult >= 2 ? 'good' : mult <= 0.5 ? 'bad' : 'neutral');
  }

  /** Anime un compteur de total en le faisant défiler de "from" à "to" */
  function _animateCountUp(elId, from, to, duration) {
    return new Promise(resolve => {
      const el = document.getElementById(elId);
      if (!el || _dpbSkip) { if (el) el.textContent = to.toLocaleString('fr-FR'); resolve(); return; }
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = Math.round(from + (to - from) * t).toLocaleString('fr-FR');
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }


  /** Lance la résolution du duel une fois le programme validé */
  function _runDefileDuel() {
    const state = CWGameState.get();
    const cfg = state.config.combat;
    const matrix = state.typeMatrix;
    const enemyTeam = _defileState.enemyTeam;             // générée dès l'entrée dans l'écran
    const enemyAssignment = _defileState.enemyAssignment; // idem — connue dès la planification pour Mystique

    // Fusionne les 2 structures séparées de planification (qui défile / où
    // sont placés les Talents) dans le format attendu par le moteur.
    const playerAssignment = _defileState.assignment.map((slot, idx) => slot ? {
      instanceId: slot.instanceId,
      talentTypeId: _defileState.talentPlacement[idx]?.typeId || null,
    } : null);

    const result = CWDefileEngine.resolveDuel(
      _defileState.programme, playerAssignment, enemyAssignment,
      _defileState.playerTeam, enemyTeam, cfg, matrix,
      {
        legendeCopyTypeId: _defileState.legendeCopyTypeId || null,
        mystiqueSwapRounds: _defileState.mystiqueSwapRounds || {},
      }
    );

    _applyDefileStats(result, playerAssignment);
    _defileRewardsPlan = _computeDefileRewardsPlan(result, playerAssignment);

    _defileLastResult = result;
    _defileState = null; // repart de zéro pour le prochain défilé
    showScreen('defile-playback');
  }

  let _defileRewardsPlan = null;

  /**
   * Met à jour les stats joueur ET personnage après un défilé : Défilés
   * disputés/remportés, passages remportés, points cumulés — au niveau du
   * joueur ET de chaque personnage qui a défilé.
   */
  function _applyDefileStats(result, playerAssignment) {
    const state = CWGameState.get();
    const stats = { ...state.player.stats };
    stats.totalDefiles = (stats.totalDefiles || 0) + 1;
    if (result.winner === 'player') stats.totalDefilesWon = (stats.totalDefilesWon || 0) + 1;

    const charactersWhoWalked = new Set();
    result.log.forEach((l, idx) => {
      stats.totalDefilePoints = (stats.totalDefilePoints || 0) + l.playerScore;
      stats.totalPopularity   = (stats.totalPopularity   || 0) + Math.floor(l.playerScore / 100);
      const passageWon = l.playerScore > l.enemyScore;
      if (passageWon) stats.totalPassagesWon = (stats.totalPassagesWon || 0) + 1;

      const slot = playerAssignment[idx];
      if (slot) {
        charactersWhoWalked.add(slot.instanceId);
        const inst = CWGameState.getPlayerChar(slot.instanceId);
        if (inst) {
          inst.defilePointsEarned = (inst.defilePointsEarned || 0) + l.playerScore;
          inst.popularityEarned   = (inst.popularityEarned   || 0) + Math.floor(l.playerScore / 100);
          if (passageWon) inst.passagesWon = (inst.passagesWon || 0) + 1;
          inst.affection = (inst.affection || 0) + 1; // usage passif : elle a défilé, gagné ou perdu peu importe
        }
      }
    });

    // Défilés gagnés : une fois par personnage ayant défilé, si le défilé est remporté
    if (result.winner === 'player') {
      charactersWhoWalked.forEach(instanceId => {
        const inst = CWGameState.getPlayerChar(instanceId);
        if (inst) inst.defilesWon = (inst.defilesWon || 0) + 1;
      });
    }

    CWGameState.updatePlayer({ stats });
  }

  /**
   * Calcule (sans encore rien appliquer) les récompenses de fin de défilé :
   * XP par personnage (% de SON score marqué ce défilé), XP joueur et
   * dollars (% du score total), et la liste des gains d'affinité à venir.
   * L'application réelle se fait progressivement sur l'écran de récompenses,
   * pour que les jauges animées reflètent fidèlement chaque étape.
   */
  function _computeDefileRewardsPlan(result, playerAssignment) {
    const cfg = CWGameState.get().config.combat;

    // Score personnel cumulé de CHAQUE personnage sur CE défilé uniquement
    const scoreByInstance = {};
    const enemyRoundsWon = [];
    result.log.forEach((l, idx) => {
      const slot = playerAssignment[idx];
      if (slot) scoreByInstance[slot.instanceId] = (scoreByInstance[slot.instanceId] || 0) + l.playerScore;
      if (l.playerScore > l.enemyScore && l.enemyCharId) {
        const enemyDef = CWGameState.getCharDef(l.enemyCharId);
        if (enemyDef) enemyRoundsWon.push({ evolutionLine: enemyDef.evolutionLine, rarity: enemyDef.rarity, evolutionStage: enemyDef.evolutionStage, enemyName: enemyDef.name });
      }
    });

    const charXpPercent = cfg.defileCharXpPercent ?? 10;
    const charXp = Object.entries(scoreByInstance).map(([instanceId, score]) => {
      const inst = CWGameState.getPlayerChar(instanceId);
      const def  = inst ? CWGameState.getCharDef(inst.charId) : null;
      return {
        instanceId,
        name: def?.name || '?',
        xpAmount: Math.round(score * (charXpPercent / 100)),
      };
    }).filter(c => c.xpAmount > 0);

    const playerXp = Math.round(result.playerTotal * ((cfg.defilePlayerXpPercent ?? 5) / 100));
    const gold     = Math.round(result.playerTotal * ((cfg.defileGoldPercent ?? 1) / 100));

    // Réputation : bonus à la victoire, malus à la défaite (aucun ajustement en cas d'égalité)
    const winBonusPct  = cfg.defileReputationWinBonusPct  ?? 75;
    const loseMalusPct = cfg.defileReputationLoseMalusPct ?? 30;
    let reputationScore = result.playerTotal;
    if (result.winner === 'player') reputationScore = Math.round(reputationScore * (1 + winBonusPct / 100));
    else if (result.winner === 'enemy') reputationScore = Math.round(reputationScore * (1 - loseMalusPct / 100));

    return { charXp, playerXp, gold, affinityGains: enemyRoundsWon, reputationScore };
  }

  // ─── ÉCRAN AFFINITÉS (remplace le Gacha) ────────────────────────────────────

  const _rewardSleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function renderDefileRewards() {
    const el = document.getElementById('screen-defile-rewards');
    if (!el || !_defileRewardsPlan) { _showCombatSelect(); return; }
    const plan = _defileRewardsPlan;
    const state = CWGameState.get();

    el.innerHTML = `
      <div class="screen-header"><h2>🎁 Récompenses</h2></div>
      ${plan.charXp.length ? `
        <div class="reward-section-title">✨ Expérience</div>
        <div id="rewards-xp-list">
          ${plan.charXp.map(c => {
            const inst = CWGameState.getPlayerChar(c.instanceId);
            const def  = inst ? CWGameState.getCharDef(inst.charId) : null;
            const startNeeded = inst ? CWGameDatabase.xpForLevel(inst.level + 1, state.config.level) : 1;
            const startPct = inst ? Math.min(100, (inst.xp / startNeeded) * 100) : 0;
            return `
              <div class="reward-row">
                <div class="reward-row-portrait">${def ? _combatPortraitImgHtml(def) : ''}</div>
                <div class="reward-row-info">
                  <div class="reward-row-name">${c.name} <span class="reward-row-level" id="reward-level-${c.instanceId}">Niv. ${inst?.level ?? '?'}</span></div>
                  <div class="reward-bar-track"><div class="reward-bar-fill" id="reward-bar-${c.instanceId}" style="width:${startPct}%"></div></div>
                  <div class="reward-row-gain">+${c.xpAmount} XP</div>
                  <div class="reward-stat-changes" id="reward-stats-${c.instanceId}"></div>
                </div>
              </div>`;
          }).join('')}
        </div>
      ` : ''}
      <div class="reward-section-title" id="rewards-affinity-title" style="display:none;">💞 Affinité</div>
      <div id="rewards-affinity-list"></div>
      <div class="rewards-money" id="rewards-money" style="display:none;"></div>
      <button class="btn-primary" id="btn-rewards-done" style="display:none;width:100%;margin-top:16px;">Terminer</button>
    `;

    await _rewardSleep(400);

    // Phase 1 — XP, une personnage après l'autre, jauge façon Pokémon
    for (const c of plan.charXp) {
      await _animateDefileCharXp(c, state.config.level);
      await _rewardSleep(350);
    }

    // Phase 2 — affinité, une lignée après l'autre
    if (plan.affinityGains.length) {
      document.getElementById('rewards-affinity-title').style.display = '';
      await _animateDefileAffinityGains(plan.affinityGains);
    }

    // Phase 3 — argent + XP joueur (discrets, appliqués en une fois)
    if (plan.gold > 0) CWGameState.modifyResources({ gold: plan.gold });
    if (plan.playerXp > 0) CWGameState.addXpToPlayer(plan.playerXp);
    if (plan.gold > 0) {
      const moneyEl = document.getElementById('rewards-money');
      moneyEl.style.display = '';
      moneyEl.textContent = `💵 +${plan.gold.toLocaleString('fr-FR')}`;
      moneyEl.classList.add('reward-pop');
    }

    // Phase 4 — Réputation (ressource du Grand Casting)
    const repResult = CWGameState.registerReputationGain(plan.reputationScore || 0);
    if (repResult.gain > 0) {
      await _rewardSleep(300);
      const repEl = document.createElement('div');
      repEl.className = 'rewards-money reward-pop';
      repEl.style.color = '#c4b5fd';
      repEl.textContent = `🎬 +${repResult.gain.toLocaleString('fr-FR')} Réputation`;
      document.getElementById('rewards-money')?.insertAdjacentElement('afterend', repEl);
    }
    if (repResult.castingOpened) {
      _showToast('🎬 Un nouveau Grand Casting vient de s\'ouvrir !', 'success');
    }

    const doneBtn = document.getElementById('btn-rewards-done');
    doneBtn.style.display = '';
    doneBtn.addEventListener('click', () => {
      CWAudioSystem.playGlobal();
      _showCombatSelect();
    });
  }

  /** Anime la jauge d'XP d'une personnage façon Pokémon (remplissage → niveau → reset → suite) */
  async function _animateDefileCharXp(c, levelCfg) {
    const inst = CWGameState.getPlayerChar(c.instanceId);
    const barEl = document.getElementById(`reward-bar-${c.instanceId}`);
    const levelEl = document.getElementById(`reward-level-${c.instanceId}`);
    const statsEl = document.getElementById(`reward-stats-${c.instanceId}`);
    if (!inst || !barEl) return;

    const startLevel = inst.level;
    await _rewardSleep(150);

    const result = CWGameState.addXpToCharacter(c.instanceId, c.xpAmount); // applique réellement le gain

    let level = startLevel;
    for (const newLevel of result.levelUps) {
      barEl.style.width = '100%';
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      await _rewardSleep(600);
      level = newLevel;
      levelEl.textContent = `Niv. ${level}`;
      levelEl.classList.add('reward-pop');
      barEl.style.transition = 'none';
      barEl.style.width = '0%';
      void barEl.offsetWidth;
      barEl.style.transition = 'width 650ms ease';
      await _rewardSleep(150);
    }
    const finalNeeded = CWGameDatabase.xpForLevel(level + 1, levelCfg);
    barEl.style.width = `${Math.min(100, (inst.xp / finalNeeded) * 100)}%`;
    await _rewardSleep(600);

    // Évolution éventuelle (son + mention) puis affichage des stats gagnées
    if (result.evolved) {
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.evolution);
      if (statsEl) {
        statsEl.innerHTML = `<div class="reward-evolved-tag">✨ A évolué !</div>`;
        await _rewardSleep(400);
      }
    }
    if (statsEl && (result.levelUps.length > 0 || result.evolved) && result.statsOld && result.statsNew) {
      const STAT_ICONS = { atk: '✨', def: '🌹', spd: '🕊️', hp: '💗' };
      const STAT_NAMES = { atk: 'Charisme', def: 'Prestance', spd: 'Grâce', hp: 'Endurance' };
      const rows = Object.keys(STAT_ICONS).map(key => {
        const before = Math.round(result.statsOld[key] || 0);
        const after  = Math.round(result.statsNew[key] || 0);
        if (after === before) return '';
        return `<div class="reward-stat-row">${STAT_ICONS[key]} ${STAT_NAMES[key]} : ${before} → <strong>${after}</strong> (+${after - before})</div>`;
      }).join('');
      statsEl.innerHTML += rows;
    }
  }

  /** Anime les jauges d'affinité gagnées, lignée par lignée */
  async function _animateDefileAffinityGains(affinityGains) {
    const grouped = {};
    affinityGains.forEach(g => {
      if (!grouped[g.evolutionLine]) grouped[g.evolutionLine] = { ...g, occurrences: 0 };
      grouped[g.evolutionLine].occurrences++;
    });

    const listEl = document.getElementById('rewards-affinity-list');
    for (const lineageId of Object.keys(grouped)) {
      const g = grouped[lineageId];
      const rd = CWGameDatabase.RARITIES[g.rarity] || {};
      const startPercent = CWGameState.getAffinityPercent(lineageId);
      const baseCharNow = CWGameState.get().characters.find(c => c.evolutionLine === lineageId && c.evolutionStage === 0);

      const row = document.createElement('div');
      row.className = 'reward-row affinity-reward-row';
      row.innerHTML = `
        <div class="reward-row-portrait affinity-reward-portrait" id="affinity-reward-portrait-${lineageId}">
          ${baseCharNow ? _combatPortraitImgHtml(baseCharNow) : `<div class="unknown-silhouette">?</div>`}
        </div>
        <div class="reward-row-info">
          <div class="reward-row-name">${g.enemyName} <span class="affinity-rarity-badge" style="background:${rd.color}">${rd.name}</span></div>
          <div class="reward-bar-track"><div class="reward-bar-fill affinity-reward-fill" id="affinity-reward-bar-${lineageId}" style="width:${startPercent}%"></div></div>
          <div class="reward-row-gain" id="affinity-reward-pct-${lineageId}">${startPercent}%</div>
        </div>
      `;
      listEl.appendChild(row);
      await _rewardSleep(250);

      let unlocked = null;
      for (let i = 0; i < g.occurrences; i++) {
        const res = CWGameState.registerAffinityGain(g.evolutionLine, g.rarity, g.evolutionStage);
        if (!res) break;
        if (res.unlocked) unlocked = res.unlocked;
        document.getElementById(`affinity-reward-bar-${lineageId}`).style.width = `${res.current}%`;
        document.getElementById(`affinity-reward-pct-${lineageId}`).textContent = `${res.current}%`;
        await _rewardSleep(450);
      }

      if (unlocked) {
        const baseChar = CWGameState.get().characters.find(c => c.evolutionLine === lineageId && c.evolutionStage === 0);
        const portraitEl = document.getElementById(`affinity-reward-portrait-${lineageId}`);
        if (portraitEl && baseChar) portraitEl.innerHTML = _combatPortraitImgHtml(baseChar);
        _showToast(`💞 L'affinité avec ${g.enemyName} a atteint 100% — elle rejoint ta collection !`, 'success');
        await _rewardSleep(700);
      }
    }
  }

  // ─── ÉCRAN GRAND CASTING ─────────────────────────────────────────────────────

  function renderCasting() {
    const el = document.getElementById('screen-casting');
    if (!el) return;
    const state = CWGameState.get();
    const player = state.player;
    const casting = player.currentCasting;

    if (!casting) {
      const remaining = Math.max(0, (player.castingThreshold || 0) - (player.defilesSinceLastCasting || 0));
      el.innerHTML = `
        <div class="screen-header"><h2>🎬 Grand Casting</h2></div>
        <p class="defile-help">
          Des agences rivales et toi disputez le recrutement des prochaines
          candidates. Un nouveau Casting s'ouvre tous les 25 à 30 Défilés.
        </p>
        <div class="casting-progress-card">
          <div class="casting-rep-label">Réputation accumulée</div>
          <div class="casting-rep-value">🎬 ${(player.reputation || 0).toLocaleString('fr-FR')}</div>
          <div class="casting-countdown">${remaining} Défilé${remaining > 1 ? 's' : ''} avant le prochain Casting</div>
        </div>
        <button class="btn-secondary" id="btn-debug-force-casting" style="width:100%;margin-top:14px;">
          🧪 [TEST] +10 000 Réputation et ouvrir un Casting
        </button>
      `;
      document.getElementById('btn-debug-force-casting')?.addEventListener('click', () => {
        CWGameState.debugForceCasting();
        renderCasting();
      });
      return;
    }

    el.innerHTML = `
      <div class="screen-header"><h2>🎬 Grand Casting</h2></div>
      <div class="casting-rep-bar">
        <span>Réputation disponible</span>
        <strong>🎬 ${(player.reputation || 0).toLocaleString('fr-FR')}</strong>
      </div>
      <div class="casting-candidates">
        ${casting.candidates.map((c, index) => _renderCastingCandidateCard(c, casting, index)).join('')}
      </div>
    `;

    el.querySelectorAll('.casting-bid-btn').forEach(btn => {
      btn.addEventListener('click', () => _handleCastingBid(btn.dataset.candidate, true));
    });
    el.querySelectorAll('.casting-pass-btn').forEach(btn => {
      btn.addEventListener('click', () => _handleCastingBid(btn.dataset.candidate, false));
    });
  }

  function _renderCastingCandidateCard(c, casting, index) {
    const isLocked = index > (casting.activeIndex ?? 0);
    if (isLocked) {
      return `
        <div class="casting-candidate-card locked">
          <div class="casting-candidate-portrait"><div class="unknown-silhouette">?</div></div>
          <div class="casting-candidate-info">
            <div class="casting-candidate-name-row">
              <span class="casting-candidate-name">???</span>
              <span class="affinity-rarity-badge" style="background:#555;">???</span>
            </div>
            <div class="casting-candidate-locked-msg">🔒 Se révèle après la candidate précédente</div>
          </div>
        </div>
      `;
    }

    const state = CWGameState.get();
    const cfg = state.config.combat;
    const def = CWGameState.getCharDef(c.charId);
    const rd = CWGameDatabase.RARITIES[c.rarity] || {};
    const conviction = CWGameState.getCastingConvictionBonus(c.charId);
    const baseIncrementPct = cfg.castingBidIncrement ?? 10;
    const effectiveIncrementPct = baseIncrementPct * (1 - conviction / 100);
    const nextBidPreview = Math.ceil(c.currentBid * (1 + effectiveIncrementPct / 100));
    const leaderName = c.currentLeader === 'player' ? 'Toi'
      : c.currentLeader ? (casting.rivals.find(r => r.id === c.currentLeader)?.name || '?')
      : 'Personne encore';
    const resolved = c.status !== 'active';

    return `
      <div class="casting-candidate-card ${resolved ? 'resolved' : 'is-live'}" data-candidate-card="${c.id}">
        <div class="casting-candidate-portrait">${def ? _combatPortraitImgHtml(def) : ''}</div>
        <div class="casting-candidate-info">
          <div class="casting-candidate-name-row">
            <span class="casting-candidate-name">${def?.name || '?'}</span>
            <span class="affinity-rarity-badge" style="background:${rd.color}">${rd.name}</span>
          </div>
          ${resolved ? `
            <div class="casting-candidate-result ${c.status === 'won_player' ? 'is-won' : 'is-lost'}">
              ${c.status === 'won_player'
                ? `✅ ${def?.name || 'Elle'} a signé avec ton agence pour ${(c.finalCost || 0).toLocaleString('fr-FR')} Réputation !`
                : `❌ Recrutée par ${leaderName}`}
            </div>
          ` : `
            <div class="casting-candidate-bid">
              Enchère actuelle : <strong id="casting-bid-value-${c.id}">${c.currentBid.toLocaleString('fr-FR')}</strong>
              — meneuse : <span id="casting-leader-${c.id}">${leaderName}</span>
            </div>
            ${conviction > 0 ? `<div class="casting-conviction">💞 Bonus de conviction : l'enchère ne monte que de ${effectiveIncrementPct.toFixed(1)}% par tour au lieu de ${baseIncrementPct}% (Tags partagés)</div>` : ''}
            ${c.playerPassed ? `
              <div class="casting-candidate-passed">Tu as laissé passer cette candidate.</div>
            ` : `
              <div class="casting-candidate-actions">
                <button class="btn-primary casting-bid-btn" data-candidate="${c.id}" style="flex:1;">
                  Enchérir (${nextBidPreview.toLocaleString('fr-FR')} 🎬)
                </button>
                <button class="btn-secondary casting-pass-btn" data-candidate="${c.id}">Passer</button>
              </div>
            `}
          `}
        </div>
      </div>
    `;
  }

  async function _handleCastingBid(candidateId, playerBids) {
    // Désactive les boutons pendant que la séquence joue, pour éviter tout double-clic
    document.querySelectorAll(`[data-candidate="${candidateId}"]`).forEach(b => b.disabled = true);

    const result = CWGameState.placeCastingBid(candidateId, playerBids);
    if (!result) return;
    if (result.error === 'insufficient') {
      _showToast('⚠️ Réputation insuffisante pour cette enchère.', 'error');
      document.querySelectorAll(`[data-candidate="${candidateId}"]`).forEach(b => b.disabled = false);
      return;
    }

    const cardEl = document.querySelector(`[data-candidate-card="${candidateId}"]`);
    const bidEl = document.getElementById(`casting-bid-value-${candidateId}`);
    const leaderEl = document.getElementById(`casting-leader-${candidateId}`);

    // 1. Le coup de marteau de la mise du joueur (ou l'abandon)
    const playerEvt = result.log.find(e => e.type === 'player_bid' || e.type === 'player_pass');
    if (playerEvt?.type === 'player_bid') {
      await _showCastingGavel(cardEl);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileScoreTick);
      if (bidEl) await _animateCastingBidNumber(bidEl, playerEvt.bid);
      if (leaderEl) leaderEl.textContent = 'Toi';
      await _sleep(500);
    } else if (playerEvt?.type === 'player_pass') {
      await _showCastingReactionBanner(cardEl, "Tu laisses passer...", 'neutral');
      await _sleep(400);
    }

    // 2. Chaque rivale réagit, une par une — jamais deux en même temps
    for (const evt of result.log) {
      if (evt.type === 'rival_raises') {
        await _showCastingReactionBanner(cardEl, `${evt.name} surenchérit !`, 'tension');
        CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileTypeGood);
        if (bidEl) await _animateCastingBidNumber(bidEl, evt.bid);
        if (leaderEl) leaderEl.textContent = evt.name;
        await _sleep(400);
      } else if (evt.type === 'rival_drops') {
        await _showCastingReactionBanner(cardEl, `${evt.name} se retire...`, 'drop');
        CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileTypeBad);
        await _sleep(400);
      }
      // 'rival_watches' : discret, pas de bannière pour ne pas surcharger le rythme
    }

    // 3. Dénouement — si la candidate est résolue, un vrai moment de conclusion
    if (result.candidate.status === 'won_player') {
      const def = CWGameState.getCharDef(result.candidate.charId);
      await _showCastingSoldBanner(cardEl, `${def?.name || 'Elle'} — ADJUGÉ !`, true);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileVictory);
      _showToast(`🎉 ${def?.name || 'La candidate'} rejoint ton agence !`, 'success');
      await _sleep(600);
    } else if (result.candidate.status === 'won_rival') {
      const leaderName = result.candidate.currentLeader
        ? (CWGameState.get().player.currentCasting?.rivals.find(r => r.id === result.candidate.currentLeader)?.name || '?')
        : '?';
      await _showCastingSoldBanner(cardEl, `Recrutée par ${leaderName}`, false);
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.defileDefeat);
      _showToast('😔 Une agence rivale a remporté cette candidate.', 'error');
      await _sleep(600);
    }

    renderCasting();
  }

  /** Effet de "coup de marteau" sur la carte : petit choc + flash discret */
  function _showCastingGavel(cardEl) {
    return new Promise(resolve => {
      if (!cardEl) { resolve(); return; }
      cardEl.classList.add('casting-gavel-hit');
      setTimeout(() => { cardEl.classList.remove('casting-gavel-hit'); resolve(); }, 350);
    });
  }

  /** Anime le chiffre de l'enchère en défilant jusqu'à la nouvelle valeur */
  function _animateCastingBidNumber(el, target) {
    return new Promise(resolve => {
      const from = parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
      const duration = 450;
      const start = performance.now();
      el.classList.add('casting-bid-pulse');
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 2);
        el.textContent = Math.round(from + (target - from) * eased).toLocaleString('fr-FR');
        if (t < 1) requestAnimationFrame(step);
        else { el.textContent = target.toLocaleString('fr-FR'); el.classList.remove('casting-bid-pulse'); resolve(); }
      }
      requestAnimationFrame(step);
    });
  }

  /** Petite bannière de réaction (rivale qui surenchérit, se retire, ou joueur qui passe) */
  function _showCastingReactionBanner(cardEl, text, tone) {
    return new Promise(resolve => {
      if (!cardEl) { resolve(); return; }
      const banner = document.createElement('div');
      banner.className = `casting-reaction-banner casting-reaction-${tone}`;
      banner.textContent = text;
      cardEl.appendChild(banner);
      requestAnimationFrame(() => banner.classList.add('visible'));
      setTimeout(() => {
        banner.classList.remove('visible');
        setTimeout(() => { banner.remove(); resolve(); }, 250);
      }, 900);
    });
  }

  /** Grande bannière de conclusion ("ADJUGÉ !" ou "Recrutée par ...") */
  function _showCastingSoldBanner(cardEl, text, won) {
    return new Promise(resolve => {
      if (!cardEl) { resolve(); return; }
      const banner = document.createElement('div');
      banner.className = `casting-sold-banner ${won ? 'is-won' : 'is-lost'}`;
      banner.innerHTML = `<span class="casting-sold-icon">${won ? '🔨' : '💔'}</span>${text}`;
      cardEl.appendChild(banner);
      requestAnimationFrame(() => banner.classList.add('visible'));
      setTimeout(() => { banner.remove(); resolve(); }, 1400);
    });
  }

  let _affinitySortMode = 'rarity'; // 'rarity' | 'name' | 'percent'
  let _affinityHideUndiscovered = false;

  const RARITY_ORDER_INDEX = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

  function renderAffinity() {
    const el = document.getElementById('screen-affinity');
    if (!el) return;
    const state = CWGameState.get();
    let progress = CWGameState.getAllAffinityProgress();

    if (_affinityHideUndiscovered) progress = progress.filter(p => p.percent > 0);

    progress = [...progress].sort((a, b) => {
      if (_affinitySortMode === 'name')    return a.baseChar.name.localeCompare(b.baseChar.name);
      if (_affinitySortMode === 'percent') return b.percent - a.percent;
      // rarity (du plus rare au plus commun)
      return (RARITY_ORDER_INDEX[b.baseChar.rarity] ?? 0) - (RARITY_ORDER_INDEX[a.baseChar.rarity] ?? 0);
    });

    el.innerHTML = `
      <div class="screen-header"><h2>💞 Affinités</h2></div>
      <button class="btn-primary" id="btn-goto-casting" style="width:100%;margin-bottom:12px;">
        🎬 Voir le Grand Casting ${state.player.currentCasting ? '— Casting ouvert !' : ''}
      </button>
      <p class="defile-help">
        Chaque tournage de Défilé gagné contre une personnage augmente ton
        affinité avec sa lignée. À 100%, elle rejoint ta collection.
      </p>
      <div class="affinity-controls">
        <select id="affinity-sort-select" class="affinity-sort-select">
          <option value="rarity"  ${_affinitySortMode === 'rarity'  ? 'selected' : ''}>Trier par rareté</option>
          <option value="name"    ${_affinitySortMode === 'name'    ? 'selected' : ''}>Trier par nom</option>
          <option value="percent" ${_affinitySortMode === 'percent' ? 'selected' : ''}>Trier par taux d'affinité</option>
        </select>
        <label class="affinity-filter-toggle">
          <input type="checkbox" id="affinity-hide-toggle" ${_affinityHideUndiscovered ? 'checked' : ''} />
          Masquer les non-affinées
        </label>
      </div>
      ${progress.length === 0 ? `
        <p class="empty-msg">${_affinityHideUndiscovered ? 'Aucune lignée avec de l\'affinité pour l\'instant.' : 'Toutes les lignées disponibles ont déjà rejoint ta collection !'}</p>
      ` : `
        <div class="affinity-list">
          ${progress.map(p => {
            const rd = CWGameDatabase.RARITIES[p.baseChar.rarity] || {};
            const discovered = p.percent > 0;
            return `
              <div class="affinity-card">
                <div class="affinity-portrait">
                  ${discovered && p.baseChar.portrait
                    ? `<img src="${p.baseChar.portrait}" alt="${p.baseChar.name}" style="width:100%;height:100%;object-fit:cover;object-position:center 15%;">`
                    : `<div class="unknown-silhouette">?</div>`}
                </div>
                <div class="affinity-info">
                  <div class="affinity-name-row">
                    <span class="affinity-name">${discovered ? p.baseChar.name : '???'}</span>
                    <span class="affinity-rarity-badge" style="background:${rd.color}">${rd.name}</span>
                  </div>
                  <div class="affinity-bar-track">
                    <div class="affinity-bar-fill" style="width:${p.percent}%;"></div>
                  </div>
                  <div class="affinity-percent">${p.percent}%</div>
                </div>
              </div>`;
          }).join('')}
        </div>
      `}
    `;
    document.getElementById('btn-goto-casting')?.addEventListener('click', () => showScreen('casting'));
    document.getElementById('affinity-sort-select')?.addEventListener('change', (e) => {
      _affinitySortMode = e.target.value;
      renderAffinity();
    });
    document.getElementById('affinity-hide-toggle')?.addEventListener('change', (e) => {
      _affinityHideUndiscovered = e.target.checked;
      renderAffinity();
    });
  }

  function renderDefileResult() {
    const el = document.getElementById('screen-defile-result');
    if (!el || !_defileLastResult) return;
    const r = _defileLastResult;
    const won = r.winner === 'player';
    CWAudioSystem.playSfx(won ? CWAudioSystem.SFX_KEYS.defileVictory : r.winner === 'tie' ? null : CWAudioSystem.SFX_KEYS.defileDefeat);

    el.innerHTML = `
      <div class="screen-header"><h2>${won ? '🏆 Défilé remporté !' : r.winner === 'tie' ? '🤝 Égalité' : '💔 Défilé perdu'}</h2></div>
      <div class="defile-result-score">
        <div class="defile-result-score-block ${won ? 'is-winner' : ''}">
          <div class="defile-result-score-label">Toi</div>
          <div class="defile-result-score-value">${r.playerTotal.toLocaleString('fr-FR')}</div>
        </div>
        <div class="defile-result-score-vs">VS</div>
        <div class="defile-result-score-block ${r.winner === 'enemy' ? 'is-winner' : ''}">
          <div class="defile-result-score-label">Adversaire</div>
          <div class="defile-result-score-value">${r.enemyTotal.toLocaleString('fr-FR')}</div>
        </div>
      </div>
      <div class="defile-result-log">
        ${r.log.map(l => {
          const pDef = l.playerCharId ? CWGameState.getCharDef(l.playerCharId) : null;
          const eDef = l.enemyCharId  ? CWGameState.getCharDef(l.enemyCharId)  : null;
          const multClass = (m) => m == null ? '' : m >= 2 ? 'defile-stat-good' : m <= 0.5 ? 'defile-stat-bad' : '';
          const side = (def, name, score, mult, mirrored, isWinner, judgedStat) => `
            <div class="defile-result-side ${mirrored ? 'mirrored' : ''}">
              <div class="fighter-portrait defile-result-portrait">
                ${def ? _combatPortraitImgHtml(def) : ''}
              </div>
              <div class="defile-result-side-info">
                <div class="defile-result-side-name">${name || '—'}</div>
                <div class="defile-result-side-issue ${isWinner ? 'is-victory' : 'is-defeat'}">${isWinner ? 'VICTOIRE' : 'DÉFAITE'}</div>
                <div class="defile-result-side-score">${score}</div>
                <div class="defile-result-side-stat ${multClass(mult)}">${STAT_LABELS_SHORT[judgedStat || l.stat]} ${mult != null ? _formatAffinityMult(mult) : ''}</div>
              </div>
            </div>`;
          return `
          <div class="defile-result-round">
            <div class="defile-result-round-num">Tournage ${l.round} — ${STAT_LABELS_SHORT[l.stat]}</div>
            <div class="defile-result-round-mirror">
              ${side(pDef, l.playerFighter, l.playerScore, l.playerMult, false, l.playerScore > l.enemyScore, l.playerJudgedStat)}
              <div class="defile-result-round-vs">VS</div>
              ${side(eDef, l.enemyFighter, l.enemyScore, l.enemyMult, true, l.enemyScore > l.playerScore, l.enemyJudgedStat)}
            </div>
            ${l.events.length ? `<div class="defile-result-round-events">${l.events.map(e => e.text || e).join('<br>')}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <button class="btn-primary" id="btn-defile-continue" style="width:100%;margin-top:14px;">Voir les récompenses ›</button>
    `;
    document.getElementById('btn-defile-continue')?.addEventListener('click', () => showScreen('defile-rewards'));
  }


  function renderQuests() {
    const el = document.getElementById('screen-quests');
    if (!el) return;
    const state  = CWGameState.get();
    const player = state.player;
    const dq     = player.dailyQuestState || { activeQuestIds: [], progress: {}, claimed: {} };
    const ev     = CWGameState.getActiveEvent();
    const tag    = ev ? (state.tags?.find(t => t.id === ev.tagId)) : null;
    const today  = _todayStringUI();

    // ── Bloc Missions Event ──────────────────────────────────────────
    let eventBlockHtml = '';
    if (ev) {
      const quests = ev.questConfig?.quests || [];
      const questCards = quests.map((q, i) => {
        const progress = ev.questProgress?.[i] || 0;
        const claimed  = !!ev.questClaimed?.[i];
        const complete = progress >= q.target;
        const pct      = Math.min(100, Math.round((progress / q.target) * 100));
        const typeLabel = {
          event_defeat:       `⚔️ Éliminer ${q.target} rivales ${tag?.name || 'Event'}`,
          event_capture:      `🎭 Capturer ${q.target} rivales ${tag?.name || 'Event'}`,
          event_win_caprice:  `🌟 Réussir ${q.target} Caprice de Star`,
          event_win_tag:      `✨ Réussir ${q.target} combats ${tag?.name || 'Event'}`,
          event_win_with_tag: `🏅 Finir ${q.target} combats avec un perso ${tag?.name || 'Event'} vivant`,
          event_summon:       `💎 Rencontrer ${q.target} personnages sur la bannière ${tag?.name || 'Event'}`,
        }[q.type] || q.type;

        return `
          <div class="quest-card event-quest-card ${claimed ? 'quest-claimed' : complete ? 'quest-complete' : ''}">
            <div class="quest-card-name">${typeLabel}</div>
            <div class="quest-progress-bar-wrap">
              <div class="quest-progress-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="quest-progress-label">${progress} / ${q.target}</div>
            <div class="quest-reward-label">🎁 ${_formatRewardLabel(q.reward, state)}</div>
            <button class="btn-quest-claim btn-event-claim" data-event-quest-index="${i}" ${(!complete || claimed) ? 'disabled' : ''}>
              ${claimed ? '✓ Réclamée' : complete ? 'Réclamer' : 'En cours...'}
            </button>
          </div>`;
      }).join('');

      // Cycles de connexion EVENT (rituels sur 10 jours)
      const evCycles = ev.loginCycles || [];
      const evCyclesHtml = evCycles.filter(c => c.enabled !== false).map(c => {
        const prog = player.dailyLogin?.progress?.[c.id] || { currentDay: 1, lastClaimDate: null };
        const claimedToday = prog.lastClaimDate === today;
        const length = c.length || (c.rewards || []).length || 10;
        const daysHtml = Array.from({ length }, (_, i2) => {
          const day   = i2 + 1;
          const entry = (c.rewards || []).find(r => r.day === day);
          const isDone    = day < prog.currentDay || (day === prog.currentDay && claimedToday);
          const isCurrent = day === prog.currentDay && !claimedToday;
          const isLocked  = !isDone && !isCurrent;
          return `
            <div class="login-day-chip ${isCurrent?'current':''} ${isDone?'done':''} ${isLocked?'locked':''}">
              <div class="login-day-num">J${day}</div>
              <div class="login-day-reward">${entry ? _formatRewardLabel(entry.reward, state, true) : '—'}</div>
              ${isDone ? '<div class="login-day-check">✓</div>' : ''}
              ${isLocked ? '<div class="login-day-lock">🔒</div>' : ''}
            </div>`;
        }).join('');
        return `
          <div class="login-cycle-card event-login-cycle">
            <div class="login-cycle-title">🗓️ ${c.name}</div>
            <div class="login-cycle-days">${daysHtml}</div>
            ${!claimedToday ? `
              <div class="daily-claim-zone" id="daily-claim-zone-${c.id}">
                <button class="btn-claim-daily-inline" data-cycle-id="${c.id}">🎁 Réclamer la récompense du jour</button>
              </div>` : ''}
          </div>`;
      }).join('');

      const countdown = Math.max(0, ev.endDate - Date.now());
      const d = Math.floor(countdown / 86400000);
      const h = Math.floor((countdown % 86400000) / 3600000);

      eventBlockHtml = `
        <div class="event-quests-block">
          <div class="event-quests-header">
            <div class="event-quests-title">✨ Missions Event — ${tag?.icon || ''}${tag?.name || 'Event'}</div>
            <div class="event-quests-countdown">⏳ ${d}j ${String(h).padStart(2,'0')}h restants</div>
          </div>
          ${evCyclesHtml ? `<div style="margin-bottom:12px">${evCyclesHtml}</div>` : ''}
          <div class="quest-cards-list">${questCards || '<p class="empty-msg">Aucune mission event configurée.</p>'}</div>
        </div>`;
    }

    // ── Quêtes quotidiennes ──────────────────────────────────────────
    const questCards = (dq.activeQuestIds || []).map(qid => {
      const questDef = state.dailyQuests.find(q => q.id === qid);
      if (!questDef) return '';
      const progress = dq.progress?.[qid] || 0;
      const claimed  = !!dq.claimed?.[qid];
      const complete = progress >= questDef.target;
      const pct = Math.min(100, Math.round((progress / questDef.target) * 100));
      return `
        <div class="quest-card ${claimed ? 'quest-claimed' : complete ? 'quest-complete' : ''}">
          <div class="quest-card-name">${questDef.name}</div>
          <div class="quest-progress-bar-wrap">
            <div class="quest-progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="quest-progress-label">${progress} / ${questDef.target}</div>
          <div class="quest-reward-label">🎁 ${_formatRewardLabel(questDef.reward, state)}</div>
          <button class="btn-quest-claim" data-quest-id="${qid}" ${(!complete || claimed) ? 'disabled' : ''}>
            ${claimed ? '✓ Réclamée' : complete ? 'Réclamer' : 'En cours...'}
          </button>
        </div>`;
    }).join('');

    // ── Rituels de connexion classiques ─────────────────────────────────────
    const activeCycles = (state.dailyLoginCycles || []).filter(c => c.enabled !== false);
    const cyclesHtml = activeCycles.length ? `
      <div class="equip-section-title" style="margin-top:12px">🎁 Rituels quotidiens</div>
      <div class="login-cycles-list">
        ${activeCycles.map(c => {
          const prog = player.dailyLogin?.progress?.[c.id] || { currentDay: 1, lastClaimDate: null };
          const claimedToday = prog.lastClaimDate === today;
          const length = c.length || (c.rewards || []).length || 1;
          const daysHtml = Array.from({ length }, (_, i) => {
            const day   = i + 1;
            const entry = (c.rewards || []).find(r => r.day === day);
            const isDone    = day < prog.currentDay || (day === prog.currentDay && claimedToday);
            const isCurrent = day === prog.currentDay && !claimedToday;
            const isLocked  = !isDone && !isCurrent;
            return `<div class="login-day-chip ${isCurrent?'current':''} ${isDone?'done':''} ${isLocked?'locked':''}">
              <div class="login-day-num">J${day}</div>
              <div class="login-day-reward">${entry ? _formatRewardLabel(entry.reward, state, true) : '—'}</div>
              ${isDone ? '<div class="login-day-check">✓</div>' : ''}
              ${isLocked ? '<div class="login-day-lock">🔒</div>' : ''}
            </div>`;
          }).join('');
          return `<div class="login-cycle-card">
            <div class="login-cycle-title">${c.name}</div>
            <div class="login-cycle-days">${daysHtml}</div>
            ${!claimedToday ? `
              <div class="daily-claim-zone" id="daily-claim-zone-${c.id}">
                <button class="btn-claim-daily-inline" data-cycle-id="${c.id}">🎁 Réclamer la récompense du jour</button>
              </div>` : `<div style="text-align:center;font-size:.78rem;color:#4ade80;padding:6px 0">✓ Réclamé aujourd'hui</div>`}
          </div>`;
        }).join('')}
      </div>` : '';

    el.innerHTML = `
      <div class="screen-header"><h2>📅 Escapades</h2>${_helpBtn('quests')}</div>
      ${eventBlockHtml}
      ${cyclesHtml}
      <div class="equip-section-title" style="margin-top:${ev||activeCycles.length?'16px':'0'}">📅 Rendez-vous du jour</div>
      <div class="quest-cards-list">${questCards || '<p class="empty-msg">Aucun rendez-vous aujourd\'hui.</p>'}</div>
    `;

    el.querySelectorAll('.btn-quest-claim:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => _claimQuest(btn.dataset.questId));
    });
    el.querySelectorAll('.btn-event-claim:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => _claimEventQuest(parseInt(btn.dataset.eventQuestIndex)));
    });
    el.querySelectorAll('.btn-claim-daily-inline').forEach(btn => {
      btn.addEventListener('click', () => _claimDailyLoginInline(btn.dataset.cycleId));
    });
  }

  function _claimEventQuest(index) {
    const result = CWGameState.claimEventQuest(index);
    if (result.success) {
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      _showToast('🎁 Récompense Event réclamée !', 'success');
      _updateHUD();
    } else {
      _showToast('Impossible de réclamer cette mission.', 'error');
    }
    renderQuests();
  }

  /** Réclame un cycle de connexion directement depuis l'écran Quêtes (animation Validé puis rafraîchissement) */
  function _claimDailyLoginInline(cycleId) {
    const result = CWGameState.claimDailyLoginReward(cycleId);
    const zone = document.getElementById(`daily-claim-zone-${cycleId}`);
    if (!result.success) {
      _showToast('Cette récompense a déjà été réclamée.', 'error');
      if (zone) zone.innerHTML = '';
      return;
    }
    CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
    const state = CWGameState.get();
    if (zone) {
      zone.innerHTML = `
        <div class="daily-claim-validated" id="daily-claim-validated-${cycleId}">
          <div class="validated-checkmark">✓</div>
          <div class="validated-text">Validé !</div>
          <div class="validated-reward-label">${_formatRewardLabel(result.reward, state)}</div>
        </div>
      `;
      requestAnimationFrame(() => document.getElementById(`daily-claim-validated-${cycleId}`)?.classList.add('visible'));
    }
    // L'animation doit se jouer entièrement avant de rafraîchir l'écran (recalcule les jours faits/verrouillés)
    setTimeout(() => renderQuests(), 1600);
  }

  /** Réclame la récompense d'une quête quotidienne complétée */
  function _claimQuest(questId) {
    const result = CWGameState.claimDailyQuest(questId);
    if (result.success) {
      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      _showToast('Récompense réclamée ! 🎁', 'success');
    } else {
      _showToast('Impossible de réclamer ce rendez-vous.', 'error');
    }
    renderQuests();
  }

  /**
   * Affiche le popup de réclamation d'un cycle de connexion quotidienne : vue
   * de TOUS les jours du cycle (faits / jour du jour / verrouillés), bouton
   * "🎁 Récompense" pour le jour courant. La récompense n'est accordée QUE
   * lorsque le joueur clique sur ce bouton. Une animation "✓ Validé" se joue
   * alors entièrement avant que le popup ne se ferme et que onDone() ne soit
   * appelé (ce qui laisse la file d'animations enchaîner le cycle suivant, le
   * cas échéant, ou revenir simplement à l'écran principal).
   * @param {{cycleId, cycleName, currentDay, cycle}} info
   * @param {Function} onDone - appelé une fois le popup fermé (réclamé ou non)
   */
  function _showDailyLoginClaimPopup(info, onDone) {
    const modal = document.getElementById('modal');
    if (!modal) { onDone?.(); return; }
    const state = CWGameState.get();
    const { cycleId, cycleName, currentDay, cycle } = info;
    const length = cycle.length || (cycle.rewards || []).length || 1;

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      _closeModal();
      onDone?.();
    };

    const buildDaysHtml = () => Array.from({ length }, (_, i) => {
      const day = i + 1;
      const entry = (cycle.rewards || []).find(r => r.day === day);
      const status = day < currentDay ? 'done' : day === currentDay ? 'current' : 'locked';
      return `
        <div class="login-day-chip ${status}">
          <div class="login-day-num">J${day}</div>
          <div class="login-day-reward">${entry ? _formatRewardLabel(entry.reward, state, true) : '—'}</div>
          ${status === 'done' ? '<div class="login-day-check">✓</div>' : ''}
          ${status === 'locked' ? '<div class="login-day-lock">🔒</div>' : ''}
        </div>
      `;
    }).join('');

    modal.style.display = 'block';
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box daily-login-popup">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 style="font-family:var(--font-display);margin:0 0 4px;text-align:center">🎁 ${cycleName}</h3>
          <p style="font-size:.8rem;color:var(--text-dim);margin:0 0 14px;text-align:center">Jour ${currentDay} sur ${length}</p>
          <div class="login-cycle-days login-cycle-days-popup">${buildDaysHtml()}</div>
          <div class="daily-claim-zone" id="daily-claim-zone">
            <button class="btn-primary btn-claim-daily-reward" id="btn-claim-daily-reward">🎁 Récompense</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-close')?.addEventListener('click', finish);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => { if (e.target === e.currentTarget) finish(); });

    document.getElementById('btn-claim-daily-reward')?.addEventListener('click', () => {
      const result = CWGameState.claimDailyLoginReward(cycleId);
      const zone = document.getElementById('daily-claim-zone');
      if (!zone) { finish(); return; }

      if (!result.success) {
        _showToast('Cette récompense a déjà été réclamée.', 'error');
        finish();
        return;
      }

      CWAudioSystem.playSfx(CWAudioSystem.SFX_KEYS.levelUp);
      // Empêcher toute fermeture anticipée (clic backdrop / croix) pendant l'animation
      document.getElementById('modal-close')?.remove();

      zone.innerHTML = `
        <div class="daily-claim-validated" id="daily-claim-validated">
          <div class="validated-checkmark">✓</div>
          <div class="validated-text">Validé !</div>
          <div class="validated-reward-label">${_formatRewardLabel(result.reward, state)}</div>
        </div>
      `;
      requestAnimationFrame(() => document.getElementById('daily-claim-validated')?.classList.add('visible'));

      // L'animation doit se jouer ENTIÈREMENT avant de fermer / passer au cycle suivant
      setTimeout(finish, 1600);
    });
  }

  // ─── CATALOGUE ─────────────────────────────────────────────────────────────────

  function renderCatalogue() {
    const el = document.getElementById('screen-catalogue');
    if (!el) return;
    const state   = CWGameState.get();
    const catalogue = state.player.catalogue;
    const allChars = state.characters;

    // Progression globale (sur tous les personnages)
    const discovered = Object.keys(catalogue).length;
    const total = allChars.length;
    const pct = total ? Math.round((discovered / total) * 100) : 0;

    // N'afficher que les premières formes (evolutionStage === 0)
    // Grouper tous les personnages par lignée pour pouvoir les retrouver au clic
    const baseChars = allChars.filter(c => c.evolutionStage === 0);

    el.innerHTML = `
      <div class="screen-header"><h2>📖 Catalogue</h2>${_helpBtn('catalogue')}</div>
      <div class="catalogue-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-text">${discovered} / ${total} découverts (${pct}%)</div>
      </div>
      <div class="catalogue-grid">
        ${baseChars.map(char => {
          const entry = catalogue[char.id];
          const types = state.types;
          const t1 = types.find(t => t.id === char.type1);
          const rarityDef = CWGameDatabase.RARITIES[char.rarity] || {};
          // Compter les formes découvertes dans la lignée
          const lineChars = allChars.filter(c => c.evolutionLine === char.evolutionLine);
          const lineDiscovered = lineChars.filter(c => catalogue[c.id]).length;
          return `
          <div class="catalogue-entry ${entry ? 'discovered' : 'unknown'}" data-line="${char.evolutionLine}" style="cursor:pointer">
            <div class="catalogue-portrait">
              ${entry && char.portrait ? `<img src="${char.portrait}" alt="${char.name}">` :
                entry ? `<div class="portrait-ph">${char.name.charAt(0)}</div>` :
                `<div class="unknown-silhouette">?</div>`}
            </div>
            <div class="catalogue-info">
              <div class="catalogue-name">${entry ? char.name : '???'}</div>
              <div class="catalogue-rarity" style="color:${rarityDef.color}">${entry ? rarityDef.name : ''}</div>
              ${entry && t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon}</span>` : ''}
              ${lineChars.length > 1
                ? `<div class="catalogue-line-count">${lineDiscovered}/${lineChars.length} formes</div>`
                : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    // Clic sur une entrée → modal de la lignée évolutive
    el.querySelectorAll('.catalogue-entry').forEach(entry => {
      entry.addEventListener('click', () => _openCatalogueLine(entry.dataset.line));
    });
  }

  /**
   * Ouvre un modal affichant toutes les formes d'une lignée évolutive.
   * Les formes débloquées sont affichées en 540×675, les autres en "?".
   * @param {string} evolutionLine - ID de la lignée
   */
  function _openCatalogueLine(evolutionLine) {
    const state   = CWGameState.get();
    const catalogue = state.player.catalogue;
    const types   = state.types;

    // Récupérer et trier les formes de la lignée par stade
    const lineChars = state.characters
      .filter(c => c.evolutionLine === evolutionLine)
      .sort((a, b) => a.evolutionStage - b.evolutionStage);

    if (lineChars.length === 0) return;

    const modal = document.getElementById('modal');
    if (!modal) return;

    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box modal-catalogue-line">
          <button class="modal-close" id="modal-close">✕</button>
          <h3 class="catalogue-line-title">Lignée évolutive</h3>
          <div class="catalogue-line-forms">
            ${lineChars.map((char, i) => {
              const entry    = catalogue[char.id];
              const rarityDef = CWGameDatabase.RARITIES[char.rarity] || {};
              const t1 = types.find(t => t.id === char.type1);
              const t2 = char.type2 ? types.find(t => t.id === char.type2) : null;
              return `
              ${i > 0 ? '<div class="catalogue-line-arrow">→</div>' : ''}
              <div class="catalogue-line-form ${entry ? 'discovered' : 'unknown'}">
                <div class="catalogue-line-portrait">
                  ${entry && char.portrait
                    ? `<img src="${char.portrait}" alt="${char.name}" style="width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block;">`
                    : entry
                      ? `<div class="portrait-ph large">${char.name.charAt(0)}</div>`
                      : `<div class="unknown-silhouette large">?</div>`}
                </div>
                <div class="catalogue-line-info">
                  <div class="catalogue-line-name">${entry ? char.name : '???'}</div>
                  <div class="catalogue-line-rarity" style="color:${rarityDef.color}">${entry ? rarityDef.name : ''}</div>
                  <div class="catalogue-line-types">
                    ${entry && t1 ? `<span class="type-badge" style="background:${t1.color}">${t1.icon} ${t1.name}</span>` : ''}
                    ${entry && t2 ? `<span class="type-badge" style="background:${t2.color}">${t2.icon} ${t2.name}</span>` : ''}
                  </div>
                  ${entry && char.evolvesTo
                    ? `<div class="catalogue-line-evo-hint">Évolue au niveau <strong>${char.evolutionCondition?.value || '?'}</strong></div>`
                    : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;

    modal.style.display = 'block';
    document.getElementById('modal-close')?.addEventListener('click', _closeModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  // ─── TOAST ────────────────────────────────────────────────────────────────────

  function _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return {
    init, showScreen,
    renderCollection, renderTeam, renderGacha, renderEquip, renderInventory, renderShop, renderQuests, renderCatalogue, renderCombatLobby, renderCombatByLine, showHelp, _toggleBannerInfo,
    _openPlayerMenu, _closePlayerMenu, _pmSelectAvatar, _editPlayerName,
    _pmToggleMusic, _pmSetMusicVol, _pmSetSfxVol, _pmToggleSfx, _pmTogglePref,
    _showStatDetail, _showTitleScreen, _runTutorial,
    renderStoryChapters, renderStoryChapter,
    _showEvolutionShowcase, _showPlayerLevelUpShowcase,
  };
})();
