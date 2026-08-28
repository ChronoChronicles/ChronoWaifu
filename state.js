/**
 * ============================================================
 * STATE.JS — Gestionnaire d'état central du jeu
 * Single source of truth. Toutes les mutations passent ici.
 * Architecture flux unidirectionnel (préparé pour Redux-like)
 * ============================================================
 */

'use strict';

const CWGameState = (() => {

  // ─── ÉTAT INTERNE ────────────────────────────────────────────────────────────

  let _state = null;
  let _listeners = [];   // Abonnés aux changements d'état

  // ─── INITIALISATION ──────────────────────────────────────────────────────────

  /**
   * Initialise l'état à partir des données sauvegardées ou par défaut
   * @param {object|null} savedData - Données de sauvegarde (ou null pour new game)
   */
  function init(savedData) {
    if (savedData) {
      // Migration : fusionner avec les défauts pour les nouvelles clés
      _state = _mergeWithDefaults(savedData);
    } else {
      _state = _buildDefaultState();
    }
    _migrateEquipmentRefs();
    _notify('init');
    return _state;
  }

  /**
   * Migration : avant le suivi par exemplaire, inst.equipment[slot] stockait l'ID
   * de définition de l'équipement (ex. "equip_001"), ce qui permettait au même
   * équipement d'être "équipé" sur plusieurs créatures à la fois. On convertit
   * désormais ces références vers l'ID d'exemplaire d'inventaire (equipInventory)
   * correspondant, et on maintient equippedBy en conséquence. Idempotent : ne fait
   * rien sur un état déjà migré.
   */
  function _migrateEquipmentRefs() {
    const player = _state.player;
    if (!player) return;
    player.equipInventory = player.equipInventory || [];
    player.equipInventory.forEach(ei => { if (ei.equippedBy === undefined) ei.equippedBy = null; });

    (player.collection || []).forEach(inst => {
      if (!Array.isArray(inst.equipment)) return;
      inst.equipment = inst.equipment.map(slotVal => {
        if (!slotVal) return null;

        // Déjà un ID d'exemplaire d'inventaire valide ?
        const asInstance = player.equipInventory.find(ei => ei.instanceId === slotVal);
        if (asInstance) {
          if (!asInstance.equippedBy) asInstance.equippedBy = inst.instanceId;
          return slotVal;
        }

        // Ancien format (ID de définition) : chercher un exemplaire libre correspondant
        const free = player.equipInventory.find(ei => ei.equipId === slotVal && !ei.equippedBy);
        if (free) {
          free.equippedBy = inst.instanceId;
          return free.instanceId;
        }

        // Impossible à résoudre proprement : on vide le slot plutôt que de garder une référence invalide
        return null;
      });
    });
  }

  /** Construit un état vierge à partir de la DB */
  function _buildDefaultState() {
    return {
      config:       JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_CONFIG)),
      types:        JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_TYPES)),
      typeMatrix:   JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_TYPE_MATRIX)),
      tagCategories: JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_TAG_CATEGORIES)),
      tags:         JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_TAGS)),
      passives:     JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_PASSIVES)),
      characters:   JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_CHARACTERS)),
      equipment:    JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_EQUIPMENT)),
      items:        JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_ITEMS)),
      shopListings: JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_SHOP_LISTINGS)),
      dailyLoginCycles: JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_DAILY_LOGIN_CYCLES)),
      dailyQuests:      JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_DAILY_QUESTS)),
      equipBanners: JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_EQUIP_BANNERS)),
      banners:      JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_BANNERS)),
      player:       JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_PLAYER)),
    };
  }

  /**
   * Fusionne les objets sauvegardés avec les définitions par défaut : répare les
   * objets existants auxquels il manquerait un champ "effect" (anciennes
   * sauvegardes antérieures au système d'effets génériques), tout en préservant
   * les objets personnalisés créés depuis l'administration, et ajoute les objets
   * par défaut qui seraient totalement absents d'une très vieille sauvegarde.
   */
  function _mergeItems(defaultItems, savedItems) {
    if (!savedItems) return defaultItems;
    const defaultsById = new Map(defaultItems.map(i => [i.id, i]));
    const savedIds = new Set(savedItems.map(i => i.id));
    const merged = savedItems.map(item => {
      const def = defaultsById.get(item.id);
      return def ? { ...def, ...item, effect: item.effect || def.effect } : item;
    });
    defaultItems.forEach(def => { if (!savedIds.has(def.id)) merged.push({ ...def }); });
    return merged;
  }

  /**
   * Fusionne les quêtes quotidiennes sauvegardées avec les définitions par
   * défaut : ajoute toute nouvelle quête par défaut absente d'une ancienne
   * sauvegarde, tout en préservant les personnalisations déjà faites (cible,
   * récompense, activation) sur les quêtes existantes.
   */
  function _mergeDailyQuests(defaultQuests, savedQuests) {
    if (!savedQuests) return defaultQuests;
    const savedIds = new Set(savedQuests.map(q => q.id));
    const merged = [...savedQuests];
    defaultQuests.forEach(def => { if (!savedIds.has(def.id)) merged.push({ ...def }); });
    return merged;
  }

  /** Fusionne les données sauvegardées avec les valeurs par défaut */
  function _mergeWithDefaults(saved) {
    const defaults = _buildDefaultState();
    const result = {
      config:       _mergeConfig(defaults.config, saved.config),
      types:        saved.types        || defaults.types,
      typeMatrix:   saved.typeMatrix   || defaults.typeMatrix,
      tagCategories: saved.tagCategories || defaults.tagCategories,
      tags:         saved.tags         || defaults.tags,
      passives:     saved.passives     || defaults.passives,
      characters:   saved.characters   || defaults.characters,
      equipment:    saved.equipment    || defaults.equipment,
      items:        _mergeItems(defaults.items, saved.items),
      shopListings: saved.shopListings || defaults.shopListings,
      dailyLoginCycles: saved.dailyLoginCycles || defaults.dailyLoginCycles,
      dailyQuests:      _mergeDailyQuests(defaults.dailyQuests, saved.dailyQuests),
      equipBanners: saved.equipBanners || defaults.equipBanners,
      banners:      saved.banners      || defaults.banners,
      player:       _mergePlayer(defaults.player, saved.player),
    };
    // Garantir que les sous-configs critiques sont toujours présentes
    if (!result.config.energy)         result.config.energy         = { ...defaults.config.energy };
    if (!result.config.energy.costs)   result.config.energy.costs   = { ...(defaults.config.energy?.costs || {}) };
    if (result.config.energy.enabled === undefined) result.config.energy.enabled = false;
    if (!result.config.game)           result.config.game           = { ...defaults.config.game };
    if (!result.config.gacha)          result.config.gacha          = { ...defaults.config.gacha };
    if (!result.config.combat)         result.config.combat         = { ...defaults.config.combat };
    if (!result.config.level)          result.config.level          = { ...defaults.config.level };
    if (!result.config.awakening)      result.config.awakening      = { ...defaults.config.awakening };
    if (!result.config.playerLevel)    result.config.playerLevel    = { ...defaults.config.playerLevel };
    return result;
  }

  /**
   * Fusionne la config sauvegardée avec les défauts, niveau par niveau,
   * pour que les nouveaux champs ajoutés par une mise à jour du jeu
   * apparaissent même sur une ancienne sauvegarde.
   */
  function _mergeConfig(defaults, saved) {
    if (!saved) return defaults;
    return {
      ...defaults,
      ...saved,
      game:        { ...defaults.game,        ...(saved.game        || {}) },
      combat:      {
        ...defaults.combat, ...(saved.combat || {}),
        story: { ...(defaults.combat?.story  || {}), ...((saved.combat || {}).story || {}) },
        costs: { ...(defaults.combat?.costs  || {}), ...((saved.combat || {}).costs || {}) },
      },
      level:       { ...defaults.level,       ...(saved.level       || {}) },
      playerLevel: { ...defaults.playerLevel, ...(saved.playerLevel || {}) },
      energy:      { ...defaults.energy,      ...(saved.energy      || {}),
        costs: { ...(defaults.energy?.costs || {}), ...((saved.energy || {}).costs || {}) },
      },
      gacha:       { ...defaults.gacha,       ...(saved.gacha       || {}) },
      audio:       { ...defaults.audio,       ...(saved.audio       || {}) },
      awakening:   { ...defaults.awakening,   ...(saved.awakening   || {}) },
      shop:        { ...(defaults.shop        || {}), ...(saved.shop        || {}) },
      playerBonus: { ...(defaults.playerBonus || {}), ...(saved.playerBonus || {}) },
      event:       { ...(defaults.event       || {}), ...(saved.event       || {}) },
      backgrounds: { ...(defaults.backgrounds || {}), ...(saved.backgrounds || {}) },
      // Contenu narratif — toujours préserver intégralement depuis la sauvegarde
      // Ne JAMAIS écraser avec les défauts si la sauvegarde contient quelque chose
      tutorial:  (saved.tutorial  && Object.keys(saved.tutorial).length  > 0) ? saved.tutorial  : (defaults.tutorial  || {}),
      storyMode: (saved.storyMode && Object.keys(saved.storyMode).length > 0) ? saved.storyMode : (defaults.storyMode || {}),
    };
  }

  function _mergePlayer(defaults, saved) {
    if (!saved) return defaults;
    // Migration : selon la version du jeu, ces données ont pu être stockées sous
    // d'anciennes clés ("pokedex" ou "bestiaire"). On fusionne tout pour ne perdre
    // aucune découverte déjà enregistrée par le joueur.
    const catalogue = { ...(saved.bestiaire || {}), ...(saved.pokedex || {}), ...(saved.catalogue || {}) };
    return {
      ...defaults,
      ...saved,
      currency:  { ...defaults.currency,  ...(saved.currency  || {}) },
      energy:    { ...defaults.energy,     ...(saved.energy    || {}) },
      stats:     { ...defaults.stats,      ...(saved.stats     || {}) },
      catalogue: catalogue,   // ← clé unifiée ; les anciennes clés ne sont plus utilisées
      story:     { ...defaults.story,      ...(saved.story     || {}) },
      dailyLogin: {
        progress: { ...(saved.dailyLogin?.progress || {}) },
      },
      dailyQuestState: {
        ...defaults.dailyQuestState,
        ...(saved.dailyQuestState || {}),
      },
      rotatingShop: {
        date:       saved.rotatingShop?.date       || null,
        listingIds: saved.rotatingShop?.listingIds || [],
      },
      weeklyQuestState: {
        weekStart:      saved.weeklyQuestState?.weekStart      || null,
        activeQuestIds: saved.weeklyQuestState?.activeQuestIds || [],
        progress:       saved.weeklyQuestState?.progress       || {},
        claimed:        saved.weeklyQuestState?.claimed        || {},
      },
      event: {
        current: saved.event?.current ? { ...saved.event.current } : null,
        next:    saved.event?.next    ? { ...saved.event.next    } : null,
      },
    };
  }

  // ─── GETTERS ─────────────────────────────────────────────────────────────────

  const get = () => _state;

  const getPlayer = () => _state.player;

  const getConfig  = () => _state.config;
  const getTypes   = () => _state.types;
  const getMatrix  = () => _state.typeMatrix;
  const getCharDefs  = () => _state.characters;
  const getEquipDefs = () => _state.equipment;
  const getBanners   = () => _state.banners;

  /** Retourne la définition d'un créature par son ID */
  const getCharDef = (id) => _state.characters.find(c => c.id === id);

  /** Retourne une instance de créature dans la collection du joueur */
  const getPlayerChar = (instanceId) =>
    _state.player.collection.find(c => c.instanceId === instanceId);

  /** Retourne les membres de l'équipe active */
  const getTeam = () =>
    _state.player.team.map(iid => getPlayerChar(iid)).filter(Boolean);

  // ─── MUTATIONS JOUEUR ────────────────────────────────────────────────────────

  /**
   * Ajoute un créature à la collection du joueur
   * Gère l'awakening si déjà possédé
   * @param {string} charDefId - ID de la définition
   * @param {string} source    - 'gacha' | 'combat' | 'admin'
   * @returns {{ isNew: boolean, awakening: boolean, instance: object }}
   */
  function addCharacterToCollection(charDefId, source = 'gacha') {
    const charDef = getCharDef(charDefId);
    if (!charDef) return null;

    // Vérifier si la lignée est déjà possédée (quelque forme que ce soit)
    const lineOwned = _state.player.collection.find(c => {
      const def = getCharDef(c.charId);
      return def?.evolutionLine === charDef.evolutionLine;
    });

    if (lineOwned) {
      // Awakening : trouver le créature de la même lignée et augmenter son awakening
      const awakTarget = lineOwned;
      const oldAwk = awakTarget.awakening || 0;
      const maxAwk = _state.config.awakening.maxLevel;
      awakTarget.awakening = Math.min(oldAwk + 1, maxAwk);
      _state.player.stats = { ..._state.player.stats, totalAwakenings: (_state.player.stats.totalAwakenings || 0) + 1 };
      if (source !== 'admin' && source !== 'shop' && source !== 'reward') addXpToPlayer(_state.config.playerLevel.xpPerCapture);
      _notify('awakening', { instanceId: awakTarget.instanceId });
      _autoSave();
      return { isNew: false, awakening: true, instance: awakTarget };
    }

    // Nouveau créature
    const instance = _createCharInstance(charDef);
    _state.player.collection.push(instance);

    // Mettre à jour le Catalogue
    _registerInCatalogue(charDef);

    // XP joueur : chaque créature capturée (tirage Gacha ou capture en combat) en rapporte.
    // Les ajouts via le panneau admin (tests/debug) n'accordent volontairement pas d'XP.
    if (source !== 'admin' && source !== 'shop' && source !== 'reward') addXpToPlayer(_state.config.playerLevel.xpPerCapture);

    _notify('characterAdded', { instance });
    _autoSave();
    return { isNew: true, awakening: false, instance };
  }

  /**
   * Ajoute de l'XP au JOUEUR (distinct de l'XP des créatures). Gère la montée
   * de niveau (potentiellement plusieurs paliers d'un coup), l'augmentation de
   * l'énergie maximale (+config.playerLevel.energyPerLevel par niveau gagné),
   * et le plein regain d'énergie jusqu'au nouveau maximum si au moins un niveau
   * a été gagné.
   * @param {number} xpAmount
   * @returns {{ levelUps: number[], newLevel: number, newMaxEnergy: number }}
   */
  function addXpToPlayer(xpAmount) {
    if (!xpAmount || xpAmount <= 0) return { levelUps: [], newLevel: _state.player.level, newMaxEnergy: _state.player.energy.max };

    const player = _state.player;
    const cfg = _state.config.playerLevel;
    player.experience = (player.experience || 0) + xpAmount;

    const levelUps = [];
    while (true) {
      const xpNeeded = CWGameDatabase.xpForPlayerLevel(player.level + 1, cfg);
      if (player.experience >= xpNeeded) {
        player.experience -= xpNeeded;
        player.level++;
        player.energy.max += cfg.energyPerLevel;
        levelUps.push(player.level);
      } else {
        break;
      }
    }

    if (levelUps.length > 0) {
      // Regagne autant d'énergie que le nouveau total à chaque level up
      player.energy.current = player.energy.max;
      const energyGained = levelUps.length * cfg.energyPerLevel;
      _notify('playerLevelUp', { levelUps, newLevel: player.level, newMaxEnergy: player.energy.max, energyGained });
    }

    _autoSave();
    return { levelUps, newLevel: player.level, newMaxEnergy: player.energy.max };
  }

  /**
   * Crée une instance de créature pour la collection
   * @param {object} charDef
   * @returns {object} Instance
   */
  function _createCharInstance(charDef) {
    return {
      instanceId: `inst_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      charId:     charDef.id,
      level:      1,
      xp:         0,
      awakening:  0,
      equipment:  [null, null, null],  // 3 slots
      nickname:   null,
      obtainedAt: Date.now(),
    };
  }

  /**
   * Enregistre un créature dans le Catalogue
   * @param {object} charDef
   */
  function _registerInCatalogue(charDef) {
    // Garde contre les nouvelles parties où le catalogue n'est pas encore initialisé
    if (!_state.player.catalogue) _state.player.catalogue = {};
    if (!_state.player.catalogue[charDef.id]) {
      _state.player.catalogue[charDef.id] = {
        discovered:  true,
        portrait:    charDef.portrait,
        name:        charDef.name,
        rarity:      charDef.rarity,
        type1:       charDef.type1,
        type2:       charDef.type2,
        discoveredAt: Date.now(),
      };
    }
  }

  /**
   * Ajoute de l'XP à un créature et gère la montée de niveau + évolution
   * @param {string} instanceId
   * @param {number} xpAmount
   * @returns {{ levelUps: number[], evolved: object|null }}
   */
  function addXpToCharacter(instanceId, xpAmount) {
    const inst = getPlayerChar(instanceId);
    if (!inst) return null;

    // Snapshot stats AVANT la montée de niveau
    const defBefore = getCharDef(inst.charId);
    const statsOld = defBefore ? CWGameDatabase.computeStats(
      defBefore, inst.level, inst.awakening,
      _state.config.awakening, defBefore.rarity, _state.config.level
    ) : {};

    inst.xp += xpAmount;
    const levelUps = [];
    let evolved = null;

    // Boucle de montée de niveau
    while (true) {
      const xpNeeded = CWGameDatabase.xpForLevel(inst.level + 1, _state.config.level);
      if (inst.xp >= xpNeeded) {
        inst.xp -= xpNeeded;
        inst.level++;
        levelUps.push(inst.level);

        // Vérifier évolution
        const charDef = getCharDef(inst.charId);
        if (charDef?.evolvesTo && charDef.evolutionCondition) {
          const cond = charDef.evolutionCondition;
          if (cond.type === 'level' && inst.level >= cond.value) {
            evolved = _evolveCharacter(inst, charDef);
          }
        }
      } else {
        break;
      }
    }

    // Snapshot stats APRÈS la montée de niveau
    const defAfter = getCharDef(inst.charId);
    const statsNew = defAfter ? CWGameDatabase.computeStats(
      defAfter, inst.level, inst.awakening,
      _state.config.awakening, defAfter.rarity, _state.config.level
    ) : {};

    if (levelUps.length > 0) _notify('levelUp', { instanceId, levelUps, evolved });
    _autoSave();
    return { levelUps, evolved, statsOld, statsNew };
  }

  /**
   * Fait évoluer un créature (remplace la forme précédente)
   * @param {object} inst     - Instance actuelle
   * @param {object} charDef  - Définition actuelle
   * @returns {object} Nouvelle définition
   */
  function _evolveCharacter(inst, charDef) {
    const nextDef = getCharDef(charDef.evolvesTo);
    if (!nextDef) return null;

    inst.charId = nextDef.id;
    _registerInCatalogue(nextDef);

    // Tracking quête event : si le perso (forme de base) a le tag de l'event
    const ev = getActiveEvent();
    if (ev && (charDef.tags?.includes(ev.tagId) || nextDef.tags?.includes(ev.tagId))) {
    _state.player.stats = {
      ..._state.player.stats,
      totalEvolutions: (_state.player.stats.totalEvolutions || 0) + 1,
    };
    trackEventQuestProgress('event_evolve');
    }

    _notify('evolved', { instanceId: inst.instanceId, newCharId: nextDef.id });
    return nextDef;
  }

  /** Met à jour l'équipe active */
  function setTeam(instanceIds) {
    const maxSize = _state.config.game.maxTeamSize;
    _state.player.team = instanceIds.slice(0, maxSize);
    _notify('teamChanged');
    _autoSave();
  }

  /**
   * Ajoute/retire une pièce d'équipement sur un créature.
   * @param {string} instanceId  - Instance du créature
   * @param {number} slot        - 0 (arme), 1 (armure) ou 2 (accessoire)
   * @param {string|null} invInstanceId - ID d'exemplaire d'inventaire à équiper, ou null pour retirer
   * @returns {{success:boolean, reason?:string, equippedBy?:string}}
   */
  function equipItem(instanceId, slot, invInstanceId) {
    const inst = getPlayerChar(instanceId);
    if (!inst || slot < 0 || slot > 2) return { success: false, reason: 'invalid' };

    const inv = _state.player.equipInventory || [];
    const prevInvId = inst.equipment[slot];

    // Libérer l'ancien exemplaire de ce slot, le cas échéant
    if (prevInvId) {
      const prevEntry = inv.find(ei => ei.instanceId === prevInvId);
      if (prevEntry) prevEntry.equippedBy = null;
    }

    if (invInstanceId) {
      const entry = inv.find(ei => ei.instanceId === invInstanceId);
      if (!entry) return { success: false, reason: 'not_found' };

      // Un même exemplaire physique ne peut être équipé que par un seul créature à la fois
      if (entry.equippedBy && entry.equippedBy !== instanceId) {
        // On restaure l'exemplaire précédent pour ne pas laisser le slot vide par erreur
        if (prevInvId) {
          const prevEntry = inv.find(ei => ei.instanceId === prevInvId);
          if (prevEntry) prevEntry.equippedBy = instanceId;
        }
        return { success: false, reason: 'already_equipped', equippedBy: entry.equippedBy };
      }

      entry.equippedBy = instanceId;
      inst.equipment[slot] = invInstanceId;

      // Tracking quête event : si le personnage équipé a le tag de l'event
      const def = getCharDef(inst.charId);
      const ev  = getActiveEvent();
      if (ev && def?.tags?.includes(ev.tagId)) {
        trackEventQuestProgress('event_equip');
      }
    } else {
      inst.equipment[slot] = null;
    }

    _notify('equipmentChanged', { instanceId, slot, equipId: invInstanceId });
    _autoSave();
    return { success: true };
  }

  /** Modifie les ressources du joueur (monnaie, énergie) */
  function modifyResources(changes) {
    const p = _state.player;
    if (changes.crystals  !== undefined) p.currency.crystals  = Math.max(0, (p.currency.crystals  || 0) + changes.crystals);
    if (changes.gold      !== undefined) p.currency.gold      = Math.max(0, (p.currency.gold      || 0) + changes.gold);
    if (changes.energy    !== undefined) p.energy.current     = Math.max(0, Math.min(p.energy.max, p.energy.current + changes.energy));
    _notify('resourceChanged');
    _autoSave();
  }

  /** Régénère l'énergie selon le temps écoulé */
  function regenEnergy() {
    const cfg = _state.config?.energy;
    if (!cfg || !cfg.enabled) return;
    const p = _state.player;
    if (!p.energy) return;
    const now = Date.now();
    const elapsed = (now - (p.energy.lastRegen || now)) / 60000;
    const regen = Math.floor(elapsed * (cfg.regenPerMinute || 1));
    if (regen > 0) {
      p.energy.current = Math.min(p.energy.max || 100, p.energy.current + regen);
      p.energy.lastRegen = now;
    }
  }

  // ─── MUTATIONS ADMIN ─────────────────────────────────────────────────────────

  /** Remplace la config globale */
  function updateConfig(patch) {
    // Merger en profondeur les clés du patch dans la config existante
    // sans écraser les autres clés (tutorial, storyMode, gacha, etc.)
    _state.config = _deepMerge(_state.config, patch);
    _notify('configChanged');
    _autoSave();
  }

  function _deepMerge(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    const result = Object.assign({}, base);
    for (const key of Object.keys(patch)) {
      const v = patch[key];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        result[key] = _deepMerge(base[key], v);
      } else {
        result[key] = JSON.parse(JSON.stringify(v === undefined ? null : v));
      }
    }
    return result;
  }

  /** Met à jour un créature dans la DB */
  function updateCharDef(charId, data) {
    const idx = _state.characters.findIndex(c => c.id === charId);
    if (idx === -1) return false;
    _state.characters[idx] = { ..._state.characters[idx], ...data };
    _notify('charDefChanged');
    _autoSave();
    return true;
  }

  /** Ajoute un nouveau créature à la DB */
  function addCharDef(charData) {
    if (!charData.tags) charData.tags = [];
    _state.characters.push(charData);
    _notify('charDefAdded');
    _autoSave();
  }

  /** Supprime un créature de la DB */
  function removeCharDef(charId) {
    _state.characters = _state.characters.filter(c => c.id !== charId);
    _notify('charDefRemoved');
    _autoSave();
  }

  /**
   * Réordonne la liste des créatures selon l'ordre d'IDs fourni (drag & drop admin).
   * Les IDs absents de la liste fournie sont conservés à la fin, par sécurité.
   * @param {Array<string>} orderedIds
   */
  function reorderCharDefs(orderedIds) {
    const byId = new Map(_state.characters.map(c => [c.id, c]));
    const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
    _state.characters.forEach(c => { if (!orderedIds.includes(c.id)) reordered.push(c); });
    _state.characters = reordered;
    _notify('charDefsReordered');
    _autoSave();
  }

  /** Met à jour la matrice de types */
  function updateTypeMatrix(matrix) {
    _state.typeMatrix = JSON.parse(JSON.stringify(matrix));
    _notify('matrixChanged');
    _autoSave();
  }

  /** Met à jour les types */
  function updateTypes(types) {
    _state.types = JSON.parse(JSON.stringify(types));
    _notify('typesChanged');
    _autoSave();
  }

  // ─── PASSIFS ────────────────────────────────────────────────────────────────────

  function addPassive(data) {
    _state.passives.push(data);
    _notify('passiveAdded');
    _autoSave();
  }

  function updatePassive(id, data) {
    const idx = _state.passives.findIndex(p => p.id === id);
    if (idx === -1) return false;
    _state.passives[idx] = { ..._state.passives[idx], ...data };
    _notify('passiveChanged');
    _autoSave();
    return true;
  }

  function removePassive(id) {
    _state.passives = _state.passives.filter(p => p.id !== id);
    // Détacher des types qui le référençaient
    _state.types.forEach(t => { if (t.passiveId === id) t.passiveId = null; });
    _notify('passiveRemoved');
    _autoSave();
  }

  /**
   * Résout la liste des passifs (définitions complètes) d'un personnage à partir
   * de ses types élémentaires (type1/type2). Dédoublonne si les deux types
   * pointent vers le même passif.
   * @param {object} charDef - définition de personnage (avec type1/type2)
   * @returns {Array<object>} définitions de passifs (peut être vide)
   */
  function getPassivesForCharacter(charDef) {
    if (!charDef) return [];
    const typeIds = [charDef.type1, charDef.type2].filter(Boolean);
    const passiveIds = new Set();
    typeIds.forEach(tid => {
      const typeDef = _state.types.find(t => t.id === tid);
      if (typeDef?.passiveId) passiveIds.add(typeDef.passiveId);
    });
    return [..._state.passives.filter(p => passiveIds.has(p.id))];
  }

  /** Ajoute un équipement à la DB */
  function addEquipDef(data) {
    _state.equipment.push(data);
    _notify('equipDefAdded');
    _autoSave();
  }

  /** Met à jour un équipement */
  function updateEquipDef(id, data) {
    const idx = _state.equipment.findIndex(e => e.id === id);
    if (idx === -1) return false;
    _state.equipment[idx] = { ..._state.equipment[idx], ...data };
    _notify('equipDefChanged');
    _autoSave();
    return true;
  }

  /** Supprime un équipement */
  function removeEquipDef(id) {
    _state.equipment = _state.equipment.filter(e => e.id !== id);
    _notify('equipDefRemoved');
    _autoSave();
  }

  /**
   * Réordonne la liste des équipements selon l'ordre d'IDs fourni (drag & drop admin).
   * @param {Array<string>} orderedIds
   */
  function reorderEquipDefs(orderedIds) {
    const byId = new Map(_state.equipment.map(e => [e.id, e]));
    const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
    _state.equipment.forEach(e => { if (!orderedIds.includes(e.id)) reordered.push(e); });
    _state.equipment = reordered;
    _notify('equipDefsReordered');
    _autoSave();
  }

  // ─── OBJETS (définitions + effets génériques) ────────────────────────────────

  /** Ajoute une nouvelle définition d'objet */
  function addItemDef(data) {
    _state.items.push(data);
    _notify('itemDefAdded');
    _autoSave();
  }

  /** Met à jour une définition d'objet */
  function updateItemDef(id, data) {
    const idx = _state.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    _state.items[idx] = { ..._state.items[idx], ...data };
    _notify('itemDefChanged');
    _autoSave();
    return true;
  }

  /** Supprime une définition d'objet */
  function removeItemDef(id) {
    _state.items = _state.items.filter(i => i.id !== id);
    _notify('itemDefRemoved');
    _autoSave();
  }

  /**
   * Utilise un exemplaire d'objet de l'inventaire du joueur, en appliquant son
   * effet générique (cf. CWGameDatabase.ITEM_EFFECT_TYPES). Décrémente le stock
   * d'un exemplaire si l'effet a bien été appliqué.
   * @param {string} itemId
   * @param {string|null} targetInstanceId - Créature ciblée (requis pour 'level_up')
   * @returns {{success:boolean, reason?:string, levelUps?:number[], evolved?:object, finalLevel?:number}}
   */
  function useItem(itemId, targetInstanceId = null) {
    const itemDef = _state.items.find(i => i.id === itemId);
    if (!itemDef) return { success: false, reason: 'unknown_item' };

    const qty = _state.player.inventory?.[itemId] || 0;
    if (qty < 1) return { success: false, reason: 'no_stock' };

    const effect = itemDef.effect;
    if (!effect || !effect.type) return { success: false, reason: 'no_effect' };

    if (effect.type === 'level_up') {
      if (!targetInstanceId) return { success: false, reason: 'target_required' };
      const inst = _state.player.collection.find(c => c.instanceId === targetInstanceId);
      if (!inst) return { success: false, reason: 'target_not_found' };

      let evolved = null;
      const levelUpsGained = [];
      for (let i = 0; i < effect.amount; i++) {
        const xpNeeded = CWGameDatabase.xpForLevel(inst.level + 1, _state.config.level);
        const xpToGive = Math.max(1, xpNeeded - inst.xp);
        const res = addXpToCharacter(targetInstanceId, xpToGive);
        if (res?.levelUps?.length) levelUpsGained.push(...res.levelUps);
        if (res?.evolved) evolved = res.evolved;
      }

      _consumeItem(itemId);
      return { success: true, levelUps: levelUpsGained, evolved, finalLevel: inst.level };
    }

    if (effect.type === 'energy_regen') {
      if (_state.player.energy.current >= _state.player.energy.max) {
        return { success: false, reason: 'energy_full' };
      }
      modifyResources({ energy: effect.amount });
      _consumeItem(itemId);
      return { success: true, energyGained: effect.amount };
    }

    return { success: false, reason: 'unsupported_effect' };
  }

  /** Décrémente d'un exemplaire le stock d'un objet (interne) */
  function _consumeItem(itemId) {
    const inv = { ...(_state.player.inventory || {}) };
    inv[itemId] = Math.max(0, (inv[itemId] || 0) - 1);
    _state.player.inventory = inv;
    _autoSave();
  }

  // ─── BOUTIQUE ───────────────────────────────────────────────────────────────────

  /** Ajoute un article à la boutique */
  function addShopListing(data) {
    _state.shopListings.push(data);
    _notify('shopListingAdded');
    _autoSave();
  }

  /** Met à jour un article de la boutique */
  function updateShopListing(id, data) {
    const idx = _state.shopListings.findIndex(l => l.id === id);
    if (idx === -1) return false;
    _state.shopListings[idx] = { ..._state.shopListings[idx], ...data };
    _notify('shopListingChanged');
    _autoSave();
    return true;
  }

  /** Supprime un article de la boutique */
  function removeShopListing(id) {
    _state.shopListings = _state.shopListings.filter(l => l.id !== id);
    _notify('shopListingRemoved');
    _autoSave();
  }

  /**
   * Achète un article de la boutique : vérifie et débite la devise requise,
   * puis octroie la créature / l'équipement / l'objet correspondant au joueur.
   * @param {string} listingId
   * @returns {{success:boolean, reason?:string}}
   */
  function purchaseShopListing(listingId, priceOverride) {
    const listing = _state.shopListings.find(l => l.id === listingId);
    if (!listing || listing.enabled === false) return { success: false, reason: 'unavailable' };

    const currency = listing.currency === 'crystals' ? 'crystals' : 'gold';
    const balance = _state.player.currency[currency] || 0;

    // Prix : utiliser le priceOverride si fourni (réduction event calculée côté UI)
    // sinon appliquer la réduction event automatiquement
    let price;
    if (priceOverride != null) {
      price = priceOverride;
    } else {
      price = listing.price;
      const activeEv = getActiveEvent();
      if (activeEv && listing.kind === 'character' && activeEv.shopDiscount > 0) {
        const charDef = _state.characters.find(c => c.id === listing.refId);
        if (charDef?.tags?.includes(activeEv.tagId)) {
          price = Math.max(1, Math.round(price * (1 - activeEv.shopDiscount / 100)));
        }
      }
    }

    if (balance < price) return { success: false, reason: 'insufficient_funds' };
    modifyResources({ [currency]: -price });
    // Tracking dépenses
    const spentKey = currency === 'crystals' ? 'totalCrystalsSpent' : 'totalGoldSpent';
    _state.player.stats = { ..._state.player.stats, [spentKey]: (_state.player.stats[spentKey] || 0) + price };

    if (listing.kind === 'character') {
      const result = addCharacterToCollection(listing.refId, 'shop');
      return { success: true, kind: 'character', result };
    }

    if (listing.kind === 'equipment') {
      const instance = {
        instanceId: `einst_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        equipId:    listing.refId,
        obtainedAt: Date.now(),
        equippedBy: null,
      };
      _state.player.equipInventory = [...(_state.player.equipInventory || []), instance];
      _notify('equipmentPurchased', { instance });
      _autoSave();
      return { success: true, kind: 'equipment', instance };
    }

    if (listing.kind === 'item') {
      const inv = { ...(_state.player.inventory || {}) };
      inv[listing.refId] = (inv[listing.refId] || 0) + 1;
      _state.player.inventory = inv;
      _notify('itemPurchased', { itemId: listing.refId });
      _autoSave();
      return { success: true, kind: 'item' };
    }

    return { success: false, reason: 'unknown_kind' };
  }

  // ─── UTILITAIRE COMMUN : OCTROI DE RÉCOMPENSE GÉNÉRIQUE ─────────────────────────
  // Utilisé par les récompenses de connexion quotidienne ET les quêtes quotidiennes.
  // Forme : { type:'gold'|'crystals'|'item'|'equipment'|'character', amount, refId? }

  function _grantReward(reward) {
    if (!reward || !reward.type) return;
    const amount = Math.max(1, reward.amount || 1);

    if (reward.type === 'gold') {
      modifyResources({ gold: amount });
    } else if (reward.type === 'crystals') {
      modifyResources({ crystals: amount });
    } else if (reward.type === 'item' && reward.refId) {
      const inv = { ...(_state.player.inventory || {}) };
      inv[reward.refId] = (inv[reward.refId] || 0) + amount;
      _state.player.inventory = inv;
    } else if (reward.type === 'equipment' && reward.refId) {
      const newInstances = [];
      for (let i = 0; i < amount; i++) {
        newInstances.push({
          instanceId: `einst_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
          equipId:    reward.refId,
          obtainedAt: Date.now(),
          equippedBy: null,
        });
      }
      _state.player.equipInventory = [...(_state.player.equipInventory || []), ...newInstances];
    } else if (reward.type === 'character' && reward.refId) {
      for (let i = 0; i < amount; i++) {
        addCharacterToCollection(reward.refId, 'reward'); // source 'reward' : n'accorde pas d'XP joueur
      }
    }
  }

  /** Date du jour au format YYYY-MM-DD (heure locale) */
  function _todayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /**
   * Retourne la date du lundi de la semaine courante au format YYYY-MM-DD (heure locale).
   * Sert de clé de reset : si cette valeur change, une nouvelle semaine a commencé.
   */
  function _mondayString() {
    const d = new Date();
    const day = d.getDay(); // 0=dim, 1=lun … 6=sam
    const diff = (day === 0) ? -6 : 1 - day; // retour au lundi
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** Date d'hier au format YYYY-MM-DD (heure locale) */
  function _yesterdayString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ─── SYSTÈME D'ÉVÉNEMENTS ───────────────────────────────────────────────────────

  /**
   * Retourne la date du prochain jour d'event (8, 18 ou 28) à partir d'une date donnée.
   * Si on EST le jour J et que l'event n'a pas encore été déclenché, retourne aujourd'hui.
   */
  /** Retourne le template d'Event depuis la config globale (avec fallback sur les défauts) */
  function _getEventTemplate() {
    return _state.config.event || CWGameDatabase.DEFAULT_CONFIG.event;
  }

  /**
   * Calcule la date de début du prochain Event.
   * Règle : endDate + breakDays jours de pause → début à minuit.
   */
  function _nextEventStartDate(afterDate) {
    const tpl = _getEventTemplate();
    const breakDays = tpl.breakDays ?? 4;
    const start = new Date(afterDate);
    start.setDate(start.getDate() + breakDays);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  /** Tire un tagId aléatoire différent du tagId en cours si possible */
  function _drawRandomTagId(excludeTagId) {
    const tags = (_state.tags || []).filter(t => t.id !== excludeTagId);
    if (!tags.length) {
      // Si un seul tag, on le reprend
      const all = _state.tags || [];
      return all.length ? all[Math.floor(Math.random() * all.length)].id : null;
    }
    return tags[Math.floor(Math.random() * tags.length)].id;
  }

  /**
   * Construit un objet event à partir du template global.
   * Seul le tagId, les dates, et le perso épique J10 sont spécifiques à cet event.
   * Toutes les autres données (quêtes, combatConfig, bannerRates, etc.) viennent
   * du template — donc modifier le template suffit pour changer tous les Events.
   */
  function _buildEventData(tagId, startDate) {
    const tpl   = _getEventTemplate();
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end   = new Date(start);
    end.setDate(end.getDate() + (tpl.durationDays ?? 10) - 1);
    end.setHours(23, 59, 59, 999);

    // Perso Épique du tag pour le J10 (dernier jour du cycle de connexion)
    const epicChar = (_state.characters || []).find(c =>
      c.evolutionStage === 0 && c.rarity === 'epic' && c.tags?.includes(tagId)
    ) || null;

    // Cycle de connexion issu du template
    const cycleTpl = tpl.loginCycle || CWGameDatabase.DEFAULT_CONFIG.event.loginCycle;
    const loginCycle = JSON.parse(JSON.stringify(cycleTpl));
    loginCycle.id      = `ev_login_${tagId}_${Date.now()}`;
    loginCycle.enabled = true;
    // Remplacer le refId du dernier jour par le perso épique du tag
    const lastReward = loginCycle.rewards[loginCycle.rewards.length - 1];
    if (lastReward?.reward?.type === 'character' && epicChar) {
      lastReward.reward.refId = epicChar.id;
    }

    return {
      tagId,
      startDate:     start.getTime(),
      endDate:       end.getTime(),
      shopDiscount:  tpl.shopDiscount  ?? 20,
      bannerRates:   JSON.parse(JSON.stringify(tpl.bannerRates  ?? CWGameDatabase.DEFAULT_CONFIG.event.bannerRates)),
      bannerBoost:   tpl.bannerBoost   ?? 2.0,
      questConfig: {
        quests: JSON.parse(JSON.stringify(tpl.questTemplates ?? CWGameDatabase.DEFAULT_CONFIG.event.questTemplates)),
      },
      combatConfig:  JSON.parse(JSON.stringify(tpl.combatConfig ?? CWGameDatabase.DEFAULT_CONFIG.event.combatConfig)),
      loginCycles:   [loginCycle],
      active:        false,
      questProgress: {},   // remis à 0 à chaque nouvel Event
      questClaimed:  {},
    };
  }

  /**
   * Vérifie l'état de l'Event et déclenche la rotation automatique si nécessaire.
   * Appeler au démarrage et périodiquement (via checkDailyQuests ou setInterval).
   */
  function checkEvent() {
    const now = Date.now();
    const ev  = _state.player.event || { current: null, next: null };

    // Clôturer l'event en cours si expiré
    if (ev.current?.active && now > ev.current.endDate) {
      ev.current.active = false;
      _notify('eventEnded', { event: ev.current });
    }

    // Préparer l'event suivant si pas encore planifié
    if (!ev.next && ev.current) {
      const afterEnd  = new Date(ev.current.endDate + 60000); // 1 minute après la fin
      const nextStart = _nextEventStartDate(afterEnd);
      const tagId     = _drawRandomTagId(ev.current.tagId);
      if (tagId) ev.next = _buildEventData(tagId, nextStart);
    }

    // Premier lancement : si ni current ni next, ne rien faire (attend _forceStartEvent)
    // (Le premier Event est déclenché manuellement depuis l'admin)

    // Activer l'event suivant si sa date est arrivée
    if (ev.next && !ev.next.active && now >= ev.next.startDate) {
      ev.next.active = true;
      ev.current     = ev.next;
      // Préparer immédiatement le suivant
      const afterEnd  = new Date(ev.current.endDate + 60000);
      const nextStart = _nextEventStartDate(afterEnd);
      const tagId     = _drawRandomTagId(ev.current.tagId);
      ev.next = tagId ? _buildEventData(tagId, nextStart) : null;
      _notify('eventStarted', { event: ev.current });
    }

    _state.player.event = ev;
    _autoSave();
  }

  // Vérifie si une feature est déverrouillée selon la progression mode histoire
  function isFeatureUnlocked(featureId) {
    // Conditions de déblocage désactivées (tout est accessible immédiatement).
    // Ancien code conservé en commentaire pour un rétablissement facile :
    //
    // const prog = _state.player.storyMode || {};
    // const stagesInChapter = (ci) => prog[ci]?.completedStages?.length || 0;
    // const chapterDone     = (ci) => stagesInChapter(ci) >= 10;
    // switch (featureId) {
    //   case 'gacha':    return stagesInChapter(1) >= 5;  // Chap.2 Stage 5
    //   case 'shop':     return stagesInChapter(1) >= 5;  // Chap.2 Stage 5 (même condition que le Gacha)
    //   case 'caprice':  return chapterDone(1);            // Fin Chap.2
    //   case 'saga':     return chapterDone(3);            // Fin Chap.4
    //   case 'tournee':  return chapterDone(2);            // Fin Chap.3
    //   case 'grandgala':return chapterDone(4);            // Fin Chap.5
    //   case 'record':   return chapterDone(5);            // Fin Chap.6
    //   case 'defile':   return chapterDone(6);            // Fin Chap.7 (à ajuster si besoin)
    //   default:         return true;
    // }
    return true;
  }
  function getStoryChapterProgress(chapterIdx) {
    const prog = _state.player.storyMode?.[chapterIdx] || { completedStages: [], highestStage: 0 };
    return prog;
  }

  // Marque un stage du mode histoire comme complété
  function completeStoryStage(chapterIdx, stage) {
    if (!_state.player.storyMode) _state.player.storyMode = {};
    if (!_state.player.storyMode[chapterIdx]) {
      _state.player.storyMode[chapterIdx] = { completedStages: [], highestStage: 0 };
    }
    const prog = _state.player.storyMode[chapterIdx];
    if (!prog.completedStages.includes(stage)) {
      prog.completedStages.push(stage);
    }
    prog.highestStage = Math.max(prog.highestStage, stage);
    _notify('storyProgress');
    _autoSave();
  }
  function getActiveEvent() {
    const ev = _state.player.event;
    if (!ev?.current?.active) return null;
    if (Date.now() > ev.current.endDate) return null;
    return ev.current;
  }

  // Calcule le bonus de stats joueur à partir des compteurs de progression.
  // Chaque palier atteint dans un compteur ajoute +1 à toutes les stats.
  // @param {string[]} [excludeKeys] - clés à ignorer (utilisé en interne pour
  //        éviter une référence circulaire : le calcul du score Aura d'un
  //        personnage a besoin du bonus joueur, mais SANS le bonus Aura lui-même).
  function getPlayerStatBonus(excludeKeys = []) {
    const stats  = _state.player.stats || {};
    const cfg    = _state.config?.playerBonus || CWGameDatabase.DEFAULT_CONFIG.playerBonus;

    const mapping = {
      battles:    stats.totalBattles     || 0,
      victories:  stats.totalVictories   || 0,
      kills:      stats.totalKills       || 0,
      captures:   stats.totalCaptures    || 0,
      pulls:      stats.totalPulls       || 0,
      evolutions: stats.totalEvolutions  || 0,
      awakenings: stats.totalAwakenings  || 0,
      goldEarned: stats.totalGoldEarned  || 0,
      tourneeProgress: getTourneeProgress(),
      galleryEntries:  Object.keys(_state.player.catalogue || {}).length,
    };
    // Score Aura : ce ne sont PAS des compteurs stockés mais des valeurs
    // recalculées en direct à partir de toute la collection (cf. plus bas).
    if (!excludeKeys.includes('scoreTotal')) mapping.scoreTotal = getPlayerAuraScoreTotal();
    if (!excludeKeys.includes('scoreTeam'))  mapping.scoreTeam  = getPlayerAuraScoreTeam();

    let total = 0;
    const detail = [];
    Object.entries(mapping).forEach(([key, count]) => {
      const rule   = cfg[key];
      if (!rule || !rule.every) return;
      const points = Math.floor(count / rule.every);
      total += points;
      detail.push({ key, label: rule.label, count, every: rule.every, points });
    });
    return { bonus: total, detail };
  }

  // ─── SCORE DE PUISSANCE "AURA" ────────────────────────────────────────────────
  // Dérivé de la vraie formule de combat (cf. CWGameDatabase.computeAuraScore).
  // Mis en cache (invalidé à chaque sauvegarde auto, donc à chaque mutation
  // d'état) car le calculer nécessite de parcourir toute la collection —
  // coûteux si on le refaisait à chaque rendu de carte personnage.
  let _auraCacheVersion = 0;
  let _auraCache = { version: -1, total: 0, team: 0 };

  /** Score Aura d'un personnage possédé (stats totales, hors bonus Aura lui-même) */
  /**
   * Stats finales d'un personnage (base + niveau + éveil + équipement + bonus
   * joueur) — logique partagée par le score Aura ET le mode Défilé.
   */
  function getCharacterFinalStats(inst) {
    if (!inst) return null;
    const def = getCharDef(inst.charId);
    if (!def) return null;
    const computed = CWGameDatabase.computeStats(
      def, inst.level, inst.awakening || 0, _state.config.awakening, def.rarity, _state.config.level
    );
    const eqBonus = CWGameDatabase.computeEquipBonus(
      inst.equipment, _state.player.equipInventory, _state.equipment
    );
    const playerBonus = getPlayerStatBonus(['scoreTotal', 'scoreTeam']).bonus;
    return {
      hp:  computed.hp  + eqBonus.hp  + playerBonus,
      atk: computed.atk + eqBonus.atk + playerBonus,
      def: computed.def + eqBonus.def + playerBonus,
      spd: computed.spd + eqBonus.spd + playerBonus,
    };
  }

  function getCharacterAuraScore(inst) {
    if (!inst) return 0;
    const finalStats = getCharacterFinalStats(inst);
    if (!finalStats) return 0;
    return CWGameDatabase.computeAuraScore(finalStats);
  }

  function _computeAuraTotals() {
    if (_auraCache.version === _auraCacheVersion) return _auraCache;
    const scores = (_state.player.collection || []).map(inst => getCharacterAuraScore(inst));
    const total  = scores.reduce((sum, v) => sum + v, 0);
    const team   = [...scores].sort((a, b) => b - a).slice(0, 3).reduce((sum, v) => sum + v, 0);
    _auraCache = { version: _auraCacheVersion, total, team };
    return _auraCache;
  }

  /** Score Aura total : somme des scores de TOUS les personnages possédés */
  function getPlayerAuraScoreTotal() { return _computeAuraTotals().total; }
  /** Score Aura d'équipe : somme des 3 meilleurs scores individuels de la collection */
  function getPlayerAuraScoreTeam()  { return _computeAuraTotals().team; }

  // ─── MODE PERFORMANCE ───────────────────────────────────────────────────────

  /** Lit la config des paliers du mode Performance (avec valeurs de repli) */
  function _recordTierConfig() {
    const cfg = _state.config.combat || {};
    return {
      tier1Step: cfg.recordTier1Step ?? 1000,  tier1Cap: cfg.recordTier1Cap ?? 20000,
      tier2Step: cfg.recordTier2Step ?? 2000,  tier2Cap: cfg.recordTier2Cap ?? 40000,
      tier3Step: cfg.recordTier3Step ?? 5000,
      totemMaxScore: cfg.recordTotemMaxScore ?? 100000,
      goldPerTier: cfg.recordGoldPerTier ?? 50,
      crystalsPerTier: cfg.recordCrystalsPerTier ?? 2,
      rewardGrowth: cfg.recordRewardGrowth ?? 1,
    };
  }

  /**
   * Convertit un score en nombre de paliers franchis, selon la structure
   * configurée (3 segments à pas croissant — cf. _recordTierConfig).
   */
  function _recordTierCount(score) {
    if (score <= 0) return 0;
    const { tier1Step, tier1Cap, tier2Step, tier2Cap, tier3Step } = _recordTierConfig();

    if (score <= tier1Cap) return Math.floor(score / tier1Step);
    let tiers = tier1Cap / tier1Step;

    if (score <= tier2Cap) return tiers + Math.floor((score - tier1Cap) / tier2Step);
    tiers += (tier2Cap - tier1Cap) / tier2Step;

    return tiers + Math.floor((score - tier2Cap) / tier3Step);
  }

  /**
   * Génère la liste complète des seuils de score du totem, jusqu'à
   * totemMaxScore, avec la récompense associée à chaque palier.
   * @returns {Array<{index:number, threshold:number, gold:number, crystals:number}>}
   */
  function _recordTierThresholds() {
    const { tier1Step, tier1Cap, tier2Step, tier2Cap, tier3Step, totemMaxScore, goldPerTier, crystalsPerTier, rewardGrowth } = _recordTierConfig();
    const thresholds = [];
    let score = 0, index = 0;
    while (score < totemMaxScore) {
      score += score < tier1Cap ? tier1Step : score < tier2Cap ? tier2Step : tier3Step;
      index++;
      const growth = Math.pow(rewardGrowth || 1, index - 1);
      thresholds.push({
        index,
        threshold: score,
        gold:     Math.round(goldPerTier * growth),
        crystals: Math.round(crystalsPerTier * growth),
      });
      if (thresholds.length > 500) break; // garde-fou anti-boucle infinie sur une config aberrante
    }
    return thresholds;
  }

  /**
   * Enregistre le score obtenu à la fin d'un run du mode Performance : met à
   * jour le record personnel si dépassé. Les récompenses ne sont PLUS
   * accordées automatiquement ici — elles se réclament manuellement depuis le
   * totem (cf. getRecordTotemState / claimNextRecordTier).
   * @param {number} score
   * @returns {{isNewBest:boolean, previousBest:number}}
   */
  function registerRecordScore(score) {
    const player = _state.player;
    const previousBest = player.recordBest || 0;
    const isNewBest = score > previousBest;
    if (isNewBest) updatePlayer({ recordBest: score });
    return { isNewBest, previousBest };
  }

  /**
   * État complet du totem de récompenses du mode Performance : pour chaque
   * palier, son seuil, sa récompense, s'il est atteint (record personnel) et
   * s'il a déjà été réclamé.
   */
  function getRecordTotemState() {
    const best    = _state.player.recordBest || 0;
    const claimed = _state.player.recordClaimedTierCount || 0;
    const tiers = _recordTierThresholds().map(t => ({
      ...t,
      reached: best >= t.threshold,
      claimed: t.index <= claimed,
    }));
    const nextClaimable = tiers.find(t => t.reached && !t.claimed) || null;
    const claimableCount = tiers.filter(t => t.reached && !t.claimed).length;
    return { tiers, best, claimedTierCount: claimed, nextClaimable, claimableCount };
  }

  /** Réclame le prochain palier atteint et pas encore réclamé (un seul). */
  function claimNextRecordTier() {
    const state = getRecordTotemState();
    const tier = state.nextClaimable;
    if (!tier) return null;
    updatePlayer({ recordClaimedTierCount: tier.index });
    if (tier.gold || tier.crystals) modifyResources({ gold: tier.gold, crystals: tier.crystals });
    return tier;
  }

  /** Réclame TOUS les paliers atteints et pas encore réclamés d'un coup. */
  function claimAllRecordTiers() {
    const state = getRecordTotemState();
    const claimable = state.tiers.filter(t => t.reached && !t.claimed);
    if (claimable.length === 0) return { count: 0, gold: 0, crystals: 0 };
    const totalGold     = claimable.reduce((s, t) => s + t.gold, 0);
    const totalCrystals = claimable.reduce((s, t) => s + t.crystals, 0);
    const lastIndex = claimable[claimable.length - 1].index;
    updatePlayer({ recordClaimedTierCount: lastIndex });
    modifyResources({ gold: totalGold, crystals: totalCrystals });
    return { count: claimable.length, gold: totalGold, crystals: totalCrystals };
  }

  // ─── SYSTÈME D'AFFINITÉ (remplace le Gacha) ─────────────────────────────────

  /** @returns {number} pourcentage d'affinité actuel d'une lignée (0-100) */
  function getAffinityPercent(evolutionLine) {
    return _state.player.affinity?.[evolutionLine] || 0;
  }

  /** @returns {boolean} true si au moins une forme de cette lignée est déjà possédée */
  function _isLineageOwned(evolutionLine) {
    return _state.player.collection.some(inst => {
      const def = getCharDef(inst.charId);
      return def && def.evolutionLine === evolutionLine;
    });
  }

  /**
   * Enregistre le gain d'affinité pour une lignée après un tournage GAGNÉ
   * contre une adversaire de cette lignée. Ne fait rien si la lignée est
   * déjà possédée. À 100%, la forme de BASE (stade 0) rejoint la collection.
   * @returns {{gain:number, current:number, unlocked:object|null}|null}
   */
  function registerAffinityGain(evolutionLine, rarity, evolutionStage) {
    if (!evolutionLine || _isLineageOwned(evolutionLine)) return null;

    const cfg = _state.config.combat;
    const baseIncrement = cfg.affinityRarityIncrement?.[rarity] ?? 1;
    const stageMult     = cfg.affinityStageMultiplier?.[evolutionStage] ?? 1;
    const globalMult    = cfg.affinityGainMultiplier ?? 1;
    const gain = baseIncrement * stageMult * globalMult;

    const current = getAffinityPercent(evolutionLine);
    const next = Math.min(100, current + gain);
    _state.player.affinity = { ..._state.player.affinity, [evolutionLine]: next };

    let unlocked = null;
    if (next >= 100) {
      const baseChar = _state.characters.find(c => c.evolutionLine === evolutionLine && c.evolutionStage === 0);
      if (baseChar) unlocked = addCharacterToCollection(baseChar.id, 'affinity');
    }

    _notify('affinityChanged');
    _autoSave();
    return { gain, current: next, unlocked };
  }

  /**
   * Liste toutes les lignées NON possédées avec leur affinité actuelle —
   * pour l'écran dédié (remplace l'écran Gacha).
   */
  function getAllAffinityProgress() {
    const lines = {};
    _state.characters.forEach(c => {
      if (c.evolutionStage !== 0) return; // une entrée par lignée, basée sur sa forme de base
      if (_isLineageOwned(c.evolutionLine)) return;
      lines[c.evolutionLine] = {
        baseChar: c,
        percent: getAffinityPercent(c.evolutionLine),
      };
    });
    return Object.values(lines);
  }

  // ─── GRAND CASTING (recrutement, remplace le Gacha) ────────────────────────

  function _rollCastingThreshold() {
    const cfg = _state.config.combat;
    const min = cfg.castingThresholdMin ?? 25, max = cfg.castingThresholdMax ?? 30;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  /**
   * Enregistre le gain de Réputation d'un Défilé (proportionnel au score),
   * fait avancer le compteur vers le prochain Casting, et l'ouvre
   * automatiquement dès que le seuil (25-30, tiré aléatoirement) est atteint.
   * @returns {{gain:number, castingOpened:boolean}}
   */
  function registerReputationGain(score) {
    const cfg = _state.config.combat;
    const gain = Math.round(score * ((cfg.reputationPercentOfScore ?? 10) / 100));
    _state.player.reputation = (_state.player.reputation || 0) + gain;

    let castingOpened = false;
    if (!_state.player.currentCasting) {
      _state.player.defilesSinceLastCasting = (_state.player.defilesSinceLastCasting || 0) + 1;
      if (_state.player.castingThreshold == null) _state.player.castingThreshold = _rollCastingThreshold();

      if (_state.player.defilesSinceLastCasting >= _state.player.castingThreshold) {
        _openNewCasting();
        castingOpened = true;
      }
    }

    _notify('reputationChanged');
    _autoSave();
    return { gain, castingOpened };
  }

  /** Génère un nouveau Casting : candidates (tirage pondéré par rareté, façon gacha) + agences rivales */
  function _openNewCasting() {
    const cfg = _state.config.combat;
    const candidateCount = cfg.castingCandidateCount ?? 4;
    const rivalCount = cfg.castingRivalCount ?? 3;
    const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const weights = _state.config.gacha?.dropRates || {};

    let unowned = _state.characters.filter(c => c.evolutionStage === 0 && !_isLineageOwned(c.evolutionLine));
    const candidates = [];

    for (let i = 0; i < candidateCount && unowned.length > 0; i++) {
      const byRarity = {};
      unowned.forEach(c => { (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c); });
      const totalW = RARITY_ORDER.reduce((s, r) => s + Math.max(0, weights[r] || 0), 0);
      let rolled = RARITY_ORDER[0], roll = Math.random() * totalW;
      for (const r of RARITY_ORDER) { roll -= Math.max(0, weights[r] || 0); if (roll <= 0) { rolled = r; break; } }
      let pool = byRarity[rolled];
      if (!pool || !pool.length) pool = unowned; // repli si la rareté tirée n'a personne de disponible
      const picked = pool[Math.floor(Math.random() * pool.length)];
      const basePrice = cfg.castingBasePriceByRarity?.[picked.rarity] ?? 100;

      candidates.push({
        id: `cand_${Date.now()}_${i}`,
        charId: picked.id,
        rarity: picked.rarity,
        basePrice,
        currentBid: basePrice,
        currentLeader: null, // 'player' | id d'une rivale | null
        status: 'active',    // 'active' | 'won_player' | 'won_rival'
      });

      unowned = unowned.filter(c => c.id !== picked.id); // jamais 2 fois la même dans un Casting
    }

    const RIVAL_NAMES = ['Agence Étoile', 'Maison Prestige', 'Studio Lumière', 'Agence Zénith', 'Collectif Aurore'];
    const aggrMin = cfg.castingRivalAggressionMin ?? 0.6, aggrMax = cfg.castingRivalAggressionMax ?? 1.2;
    const rivals = [];
    for (let i = 0; i < rivalCount; i++) {
      rivals.push({
        id: `rival_${i}`,
        name: RIVAL_NAMES[i % RIVAL_NAMES.length],
        aggression: aggrMin + Math.random() * (aggrMax - aggrMin),
      });
    }

    _state.player.currentCasting = { id: `casting_${Date.now()}`, openedAt: Date.now(), candidates, rivals };
    _state.player.defilesSinceLastCasting = 0;
    _state.player.castingThreshold = _rollCastingThreshold();
  }

  /** [TEST] Crédite 10 000 Réputation et force l'ouverture immédiate d'un Casting */
  function debugForceCasting() {
    _state.player.reputation = (_state.player.reputation || 0) + 10000;
    _openNewCasting();
    _notify('castingUpdated');
    _autoSave();
  }

  /**
   * Bonus de conviction : réduit le coût EFFECTIF d'une enchère du joueur si
   * sa collection possède déjà au moins une personnage partageant un Tag
   * avec la candidate visée ("notre agence connaît déjà ce profil").
   */
  function _getCastingConvictionBonus(candidateCharId) {
    const cfg = _state.config.combat;
    const candidateDef = getCharDef(candidateCharId);
    if (!candidateDef || !candidateDef.tags?.length) return 0;

    const ownedTags = new Set();
    _state.player.collection.forEach(inst => {
      const def = getCharDef(inst.charId);
      def?.tags?.forEach(t => ownedTags.add(t));
    });

    const sharesTag = candidateDef.tags.some(t => ownedTags.has(t));
    return sharesTag ? (cfg.castingConvictionBonus ?? 15) : 0;
  }

  /**
   * Joue UN tour d'enchère sur une candidate du Casting en cours : le joueur
   * mise (ou passe), puis chaque agence rivale encore en lice décide à son
   * tour de suivre ou d'abandonner. Répété jusqu'à ce qu'une seule partie
   * reste (le joueur, ou une rivale qui remporte alors la candidate).
   *
   * @param {string} candidateId
   * @param {boolean} playerBids - true = le joueur mise ce tour, false = il passe
   * @returns {{candidate:object, playerReputation:number}|null}
   */
  function placeCastingBid(candidateId, playerBids) {
    const casting = _state.player.currentCasting;
    if (!casting) return null;
    const candidate = casting.candidates.find(c => c.id === candidateId);
    if (!candidate || candidate.status !== 'active') return null;

    const cfg = _state.config.combat;
    const increment = (cfg.castingBidIncrement ?? 10) / 100;
    const conviction = _getCastingConvictionBonus(candidate.charId);

    // Le joueur passe définitivement sur cette candidate
    if (!playerBids) {
      candidate.playerPassed = true;
    } else {
      const effectiveCost = Math.round(candidate.currentBid * (1 - conviction / 100));
      if (effectiveCost > _state.player.reputation) return { candidate, playerReputation: _state.player.reputation, error: 'insufficient' };
      candidate.currentBid = Math.ceil(candidate.currentBid * (1 + increment));
      candidate.currentLeader = 'player';
      candidate.lastBidCost = effectiveCost;
    }

    // Chaque rivale encore active décide de suivre ou d'abandonner
    (candidate.activeRivals ??= casting.rivals.map(r => r.id)).slice().forEach(rivalId => {
      if (candidate.currentLeader === rivalId) return; // déjà meneuse, ne remise pas contre elle-même
      const rival = casting.rivals.find(r => r.id === rivalId);
      if (!rival) return;
      // Une rivale abandonne si l'enchère dépasse ce que son agressivité tolère pour cette rareté
      const rarityCeiling = (cfg.castingBasePriceByRarity?.[candidate.rarity] ?? 100) * 3 * rival.aggression;
      const follows = candidate.currentBid <= rarityCeiling && Math.random() < rival.aggression;
      if (!follows) {
        candidate.activeRivals = candidate.activeRivals.filter(id => id !== rivalId);
      } else if (candidate.currentLeader !== 'player' || Math.random() < rival.aggression * 0.5) {
        candidate.currentBid = Math.ceil(candidate.currentBid * (1 + increment));
        candidate.currentLeader = rivalId;
      }
    });

    // Résolution : la candidate est attribuée dès qu'il ne reste qu'une seule
    // partie en lice — ou immédiatement à une rivale si le joueur a passé
    // (l'enchère entre rivales seules ne nous concerne plus, pas besoin de
    // la faire durer indéfiniment).
    const playerStillIn = !candidate.playerPassed;
    const rivalsStillIn = candidate.activeRivals.length;
    if (!playerStillIn && rivalsStillIn >= 1) {
      candidate.status = 'won_rival';
    } else if (playerStillIn && rivalsStillIn === 0 && candidate.currentLeader === 'player') {
      candidate.status = 'won_player';
      const cost = candidate.lastBidCost ?? candidate.currentBid;
      _state.player.reputation = Math.max(0, _state.player.reputation - cost);
      const baseChar = _state.characters.find(c => c.id === candidate.charId);
      if (baseChar) addCharacterToCollection(baseChar.id, 'casting');
    } else if (!playerStillIn && rivalsStillIn === 0) {
      // Personne ne la remporte (cas limite) — on referme quand même la candidate
      candidate.status = 'won_rival';
    }

    // Une fois TOUTES les candidates traitées, referme le Casting pour de bon
    // — sans ça, le compteur de défilés vers le prochain Casting resterait
    // bloqué indéfiniment (il ne progresse jamais tant qu'un Casting est ouvert).
    if (casting.candidates.every(c => c.status !== 'active')) {
      _state.player.currentCasting = null;
    }

    _notify('castingUpdated');
    _autoSave();
    return { candidate, playerReputation: _state.player.reputation };
  }

  // ─── CLASSEMENTS ────────────────────────────────────────────────────────────

  /**
   * Progression cumulée dans le mode Tournée (Odyssée), sous forme d'un seul
   * nombre comparable entre joueurs : nombre total de sous-niveaux complétés,
   * tous mondes confondus (ex: monde 3 + 12 sous-niveaux, à 25/monde, = 62).
   */
  function getTourneeProgress() {
    const s = _state.player.story || { world: 1, subLevel: 0 };
    const perWorld = _state.config.combat?.story?.subLevelsPerWorld || 25;
    return Math.max(0, (s.world - 1) * perWorld + (s.subLevel || 0));
  }

  /**
   * Résumé des 3 chiffres utilisés pour les classements, calculés localement
   * (peu coûteux, cf. cache Aura) — à publier vers Supabase après sauvegarde.
   */
  function getLeaderboardSnapshot() {
    return {
      auraTotal:       getPlayerAuraScoreTotal(),
      tourneeProgress: getTourneeProgress(),
      galleryEntries:  Object.keys(_state.player.catalogue || {}).length,
      recordBest:      _state.player.recordBest || 0,
    };
  }

  /**
   * Les modifications s'appliquent à TOUS les Events futurs.
   * Si `applyToCurrent: true` dans le patch, met aussi à jour l'event en cours.
   */
  function setEventConfig(patch) {
    if (!_state.config.event) _state.config.event = JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_CONFIG.event));
    const applyToCurrent = patch.applyToCurrent !== false; // par défaut true
    const cleanPatch = { ...patch };
    delete cleanPatch.applyToCurrent;

    Object.assign(_state.config.event, cleanPatch);

    // Propager les changements à l'event en cours (sauf questProgress/questClaimed/tagId)
    if (applyToCurrent && _state.player.event?.current) {
      const cur = _state.player.event.current;
      if (cleanPatch.shopDiscount  != null) cur.shopDiscount  = cleanPatch.shopDiscount;
      if (cleanPatch.bannerRates   != null) cur.bannerRates   = JSON.parse(JSON.stringify(cleanPatch.bannerRates));
      if (cleanPatch.bannerBoost   != null) cur.bannerBoost   = cleanPatch.bannerBoost;
      if (cleanPatch.combatConfig  != null) cur.combatConfig  = JSON.parse(JSON.stringify(cleanPatch.combatConfig));
      if (cleanPatch.questTemplates != null) {
        // Mettre à jour les quêtes sans toucher à la progression
        cur.questConfig = { quests: JSON.parse(JSON.stringify(cleanPatch.questTemplates)) };
        cur.questProgress = {};
        cur.questClaimed  = {};
      }
      if (cleanPatch.loginCycle != null) {
        // Rebuilder le cycle de connexion
        const epicChar = (_state.characters || []).find(c =>
          c.evolutionStage === 0 && c.rarity === 'epic' && c.tags?.includes(cur.tagId)
        ) || null;
        const lc = JSON.parse(JSON.stringify(cleanPatch.loginCycle));
        lc.id = `ev_login_${cur.tagId}_${Date.now()}`;
        lc.enabled = true;
        const lastR = lc.rewards[lc.rewards.length - 1];
        if (lastR?.reward?.type === 'character' && epicChar) lastR.reward.refId = epicChar.id;
        cur.loginCycles = [lc];
      }
      if (cleanPatch.durationDays != null) {
        const start = new Date(cur.startDate);
        const end   = new Date(start);
        end.setDate(end.getDate() + cleanPatch.durationDays - 1);
        end.setHours(23, 59, 59, 999);
        cur.endDate = end.getTime();
      }
    }

    // Rebuilder l'event suivant entièrement depuis le nouveau template
    if (_state.player.event?.next) {
      const nxt    = _state.player.event.next;
      const rebuilt = _buildEventData(nxt.tagId, new Date(nxt.startDate));
      _state.player.event.next = rebuilt;
    }

    _notify('eventConfigChanged');
    _autoSave();
  }

  /** Alias gardé pour compatibilité — même comportement que setEventConfig */
  function setNextEventConfig(patch) {
    setEventConfig({ ...patch, applyToCurrent: false });
  }

  /** Force le tag de l'event suivant */
  function setNextEventTag(tagId) {
    if (!_state.player.event) return;
    const ev = _state.player.event;
    if (!ev.next) {
      const afterEnd  = ev.current ? new Date(ev.current.endDate + 60000) : new Date();
      const nextStart = _nextEventStartDate(afterEnd);
      ev.next = _buildEventData(tagId, nextStart);
    } else {
      ev.next = _buildEventData(tagId, new Date(ev.next.startDate));
    }
    _notify('eventConfigChanged');
    _autoSave();
  }

  /**
   * Planifie le prochain Event avec une date de début et une durée custom.
   * @param {string}  tagId       - Tag de l'event
   * @param {Date}    startDate   - Date/heure de début choisie
   * @param {number}  durationDays - Durée en jours (null = utilise le template)
   */
  function planifyNextEvent(tagId, startDate, durationDays) {
    if (!_state.player.event) _state.player.event = { current: null, next: null };
    const ev    = _state.player.event;
    const tpl   = _getEventTemplate();
    const dur   = durationDays ?? (tpl.durationDays ?? 10);

    // Override temporaire du template pour cette planification
    const savedDur = tpl.durationDays;
    tpl.durationDays = dur;
    ev.next = _buildEventData(tagId, startDate);
    tpl.durationDays = savedDur; // restaurer

    _notify('eventConfigChanged');
    _autoSave();
  }

  /** Annule l'Event suivant planifié (aucun effet si aucun n'est planifié) */
  function cancelNextEvent() {
    if (!_state.player.event) return;
    _state.player.event.next = null;
    _notify('eventConfigChanged');
    _autoSave();
  }

  /** Force le tag de l'event en cours (sans changer les dates ni la progression) */
  function setCurrentEventTag(tagId) {
    if (!_state.player.event?.current) return;
    _state.player.event.current.tagId = tagId;
    _notify('eventConfigChanged');
    _autoSave();
  }

  /** Avance la progression d'une quête d'event (capture ou combat) */
  function trackEventQuestProgress(type, amount = 1) {
    const ev = getActiveEvent();
    if (!ev) return;
    const quests = ev.questConfig?.quests || [];
    let changed = false;
    quests.forEach((q, i) => {
      if (q.type !== type) return;
      if (ev.questClaimed?.[i]) return;
      const prev = ev.questProgress?.[i] || 0;
      const next = Math.min(q.target, prev + amount);
      if (next !== prev) {
        if (!ev.questProgress) ev.questProgress = {};
        ev.questProgress[i] = next;
        changed = true;
      }
    });
    if (changed) { _notify('eventQuestProgress'); _autoSave(); }
  }

  /** Réclame une récompense de quête d'event */
  function claimEventQuest(index) {
    const ev = getActiveEvent();
    if (!ev) return { success: false, reason: 'no_event' };
    const quests = ev.questConfig?.quests || [];
    const q = quests[index];
    if (!q) return { success: false, reason: 'unknown_quest' };
    if (ev.questClaimed?.[index]) return { success: false, reason: 'already_claimed' };
    if ((ev.questProgress?.[index] || 0) < q.target) return { success: false, reason: 'not_complete' };
    _grantReward(q.reward);
    if (!ev.questClaimed) ev.questClaimed = {};
    ev.questClaimed[index] = true;
    _notify('eventQuestClaimed');
    _autoSave();
    return { success: true, reward: q.reward };
  }

  // ─── SHOP TOURNANT ──────────────────────────────────────────────────────────────

  /**
   * Vérifie si le shop tournant doit être régénéré (nouveau jour), et si oui,
   * pioche aléatoirement 12 listings parmi ceux qui sont activés (enabled !== false).
   * Chaque catégorie (character, equipment, item) est représentée proportionnellement
   * à sa disponibilité, sans maximum par catégorie imposé.
   * Si moins de 12 listings sont disponibles au total, on prend tous ceux disponibles.
   * @returns {{ refreshed: boolean }} true si un nouveau tirage a été effectué
   */
  function refreshRotatingShop() {
    const today  = _todayString();
    const rs     = _state.player.rotatingShop;
    if (rs.date === today && rs.listingIds.length > 0) return { refreshed: false };

    const pool = (_state.shopListings || []).filter(l => l.enabled !== false);
    if (pool.length === 0) {
      rs.date       = today;
      rs.listingIds = [];
      _autoSave();
      return { refreshed: true };
    }

    // Mélange Fisher-Yates déterministe sur une copie du pool
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    rs.date       = today;
    const rotatingCount = _state.config?.shop?.rotatingCount ?? 9;
    rs.listingIds = shuffled.slice(0, rotatingCount).map(l => l.id);
    _autoSave();
    return { refreshed: true };
  }

  /**
   * Retourne les listings du shop tournant du jour (déjà filtrés et ordonnés).
   * Appelle refreshRotatingShop() automatiquement si besoin.
   */
  function getRotatingShopListings() {
    refreshRotatingShop();
    const ids = _state.player.rotatingShop.listingIds;
    return ids
      .map(id => (_state.shopListings || []).find(l => l.id === id))
      .filter(Boolean);
  }

  // ─── RÉCOMPENSE DE CONNEXION QUOTIDIENNE ────────────────────────────────────────

  function addDailyLoginCycle(data) {
    _state.dailyLoginCycles.push(data);
    _notify('dailyLoginCycleAdded');
    _autoSave();
  }

  function updateDailyLoginCycle(id, data) {
    const idx = _state.dailyLoginCycles.findIndex(c => c.id === id);
    if (idx === -1) return false;
    _state.dailyLoginCycles[idx] = { ..._state.dailyLoginCycles[idx], ...data };
    _notify('dailyLoginCycleChanged');
    _autoSave();
    return true;
  }

  function removeDailyLoginCycle(id) {
    _state.dailyLoginCycles = _state.dailyLoginCycles.filter(c => c.id !== id);
    if (_state.player.dailyLogin?.progress) delete _state.player.dailyLogin.progress[id];
    _notify('dailyLoginCycleRemoved');
    _autoSave();
  }

  /**
   * Vérifie tous les cycles de connexion ACTIFS et accorde la récompense du jour
   * pour chacun d'eux si pas déjà réclamée aujourd'hui. À appeler une fois au
   * démarrage de l'application (ou à la première interaction de la journée).
   * Gère la rupture de série : si un jour est sauté, le cycle redémarre au jour 1.
   * @returns {Array<{cycleName, day, reward}>} Liste de ce qui vient d'être accordé
   */
  /**
   * Calcule, SANS RIEN ACCORDER, la liste des cycles de connexion réclamables
   * aujourd'hui (actifs, pas encore réclamés aujourd'hui). Corrige aussi une
   * éventuelle rupture de série (jour sauté → retour au jour 1) AVANT affichage,
   * pour que le jour montré au joueur soit toujours le bon.
   * @returns {Array<{cycleId, cycleName, currentDay, cycle}>}
   */
  function getDailyLoginClaimable() {
    if (!_state.player.dailyLogin) _state.player.dailyLogin = { progress: {} };
    if (!_state.player.dailyLogin.progress) _state.player.dailyLogin.progress = {};

    const today     = _todayString();
    const yesterday = _yesterdayString();
    const claimable = [];

    (_state.dailyLoginCycles || []).filter(c => c.enabled !== false).forEach(cycle => {
      const progMap = _state.player.dailyLogin.progress;
      if (!progMap[cycle.id]) progMap[cycle.id] = { currentDay: 1, lastClaimDate: null };
      const prog = progMap[cycle.id];

      if (prog.lastClaimDate === today) return; // déjà réclamé aujourd'hui pour ce cycle

      // Rupture de série : recalculer AVANT affichage pour montrer le bon jour
      if (prog.lastClaimDate !== null && prog.lastClaimDate !== yesterday) {
        prog.currentDay = 1;
      }

      claimable.push({ cycleId: cycle.id, cycleName: cycle.name, currentDay: prog.currentDay, cycle });
    });

    return claimable;
  }

  /**
   * Réclame réellement la récompense du jour courant d'un cycle de connexion
   * (appelé uniquement quand le joueur clique sur le bouton "Récompense").
   * Fait progresser le cycle au jour suivant (ou le fait boucler / le bloque
   * au dernier jour selon sa configuration).
   * @param {string} cycleId
   * @returns {{success:boolean, reason?:string, reward?:object, day?:number, cycleName?:string}}
   */
  function claimDailyLoginReward(cycleId) {
    const cycle = _state.dailyLoginCycles.find(c => c.id === cycleId);
    if (!cycle || cycle.enabled === false) return { success: false, reason: 'unavailable' };

    if (!_state.player.dailyLogin) _state.player.dailyLogin = { progress: {} };
    if (!_state.player.dailyLogin.progress[cycleId]) {
      _state.player.dailyLogin.progress[cycleId] = { currentDay: 1, lastClaimDate: null };
    }
    const prog  = _state.player.dailyLogin.progress[cycleId];
    const today = _todayString();

    if (prog.lastClaimDate === today) return { success: false, reason: 'already_claimed' };

    const dayEntry = (cycle.rewards || []).find(r => r.day === prog.currentDay);
    if (dayEntry?.reward) _grantReward(dayEntry.reward);

    const claimedDay = prog.currentDay;
    prog.lastClaimDate = today;
    const length = cycle.length || (cycle.rewards || []).length || 1;
    if (prog.currentDay >= length) {
      prog.currentDay = cycle.loop !== false ? 1 : length; // boucle par défaut ; reste bloqué au dernier jour sinon
    } else {
      prog.currentDay++;
    }

    _notify('dailyLoginClaimed', { cycleId });
    _autoSave();
    return { success: true, reward: dayEntry?.reward || null, day: claimedDay, cycleName: cycle.name };
  }

  // ─── QUÊTES QUOTIDIENNES ─────────────────────────────────────────────────────────

  function addDailyQuest(data) {
    _state.dailyQuests.push(data);
    _notify('dailyQuestDefAdded');
    _autoSave();
  }

  function updateDailyQuest(id, data) {
    const idx = _state.dailyQuests.findIndex(q => q.id === id);
    if (idx === -1) return false;
    _state.dailyQuests[idx] = { ..._state.dailyQuests[idx], ...data };
    _notify('dailyQuestDefChanged');
    _autoSave();
    return true;
  }

  function removeDailyQuest(id) {
    _state.dailyQuests = _state.dailyQuests.filter(q => q.id !== id);
    _notify('dailyQuestDefRemoved');
    _autoSave();
  }

  /**
   * Tire 3 quêtes aléatoires et différentes parmi les quêtes activées si ce
   * n'est pas déjà fait pour aujourd'hui. À appeler une fois au démarrage de
   * l'application. Ne fait rien si déjà tiré pour la date du jour.
   */
  function checkDailyQuests() {
    if (!_state.player.dailyQuestState) {
      _state.player.dailyQuestState = { date: null, activeQuestIds: [], progress: {}, claimed: {} };
    }
    const dq = _state.player.dailyQuestState;
    const today = _todayString();
    if (dq.date === today) return; // déjà tiré aujourd'hui

    const pool = (_state.dailyQuests || []).filter(q => q.enabled !== false);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(3, shuffled.length));

    dq.date = today;
    dq.activeQuestIds = picked.map(q => q.id);
    dq.progress = {};
    dq.claimed  = {};
    picked.forEach(q => { dq.progress[q.id] = 0; dq.claimed[q.id] = false; });

    _notify('dailyQuestsRefreshed');
    _autoSave();
  }

  // ─── QUÊTES HEBDOMADAIRES ────────────────────────────────────────────────────────

  /**
   * Tire 5 quêtes hebdomadaires aléatoires si la semaine a changé (lundi à minuit).
   * À appeler au démarrage et à chaque affichage de l'écran Escapades.
   */
  function checkWeeklyQuests() {
    if (!_state.player.weeklyQuestState) {
      _state.player.weeklyQuestState = { weekStart: null, activeQuestIds: [], progress: {}, claimed: {} };
    }
    const wq = _state.player.weeklyQuestState;
    const monday = _mondayString();
    if (wq.weekStart === monday) return; // déjà tiré cette semaine

    const pool = CWGameDatabase.DEFAULT_WEEKLY_QUESTS || [];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(5, shuffled.length));

    wq.weekStart      = monday;
    wq.activeQuestIds = picked.map(q => q.id);
    wq.progress       = {};
    wq.claimed        = {};
    picked.forEach(q => { wq.progress[q.id] = 0; wq.claimed[q.id] = false; });

    _notify('weeklyQuestsRefreshed');
    _autoSave();
  }

  /**
   * Réclame la récompense d'une quête hebdomadaire active et complétée.
   * @param {string} questId
   * @returns {{ success:boolean, reason?:string, reward?:object }}
   */
  function claimWeeklyQuest(questId) {
    const wq = _state.player.weeklyQuestState;
    if (!wq || !wq.activeQuestIds?.includes(questId)) return { success: false, reason: 'not_active' };
    if (wq.claimed[questId]) return { success: false, reason: 'already_claimed' };

    const questDef = (CWGameDatabase.DEFAULT_WEEKLY_QUESTS || []).find(q => q.id === questId);
    if (!questDef) return { success: false, reason: 'unknown_quest' };
    if ((wq.progress[questId] || 0) < questDef.target) return { success: false, reason: 'not_complete' };

    _grantReward(questDef.reward);
    wq.claimed[questId] = true;
    _notify('weeklyQuestClaimed', { questId });
    _autoSave();
    return { success: true, reward: questDef.reward };
  }

  /**
   * Fait progresser toute quête ACTIVE aujourd'hui correspondant au type donné.
   * Appelé automatiquement par les systèmes de jeu concernés (capture, combat,
   * Gacha...) — jamais besoin d'appel manuel depuis l'UI.
   * @param {string} type - une clé de CWGameDatabase.QUEST_TYPES
   * @param {number} [amount=1]
   */
  function trackQuestProgress(type, amount = 1) {
    let changed = false;

    // ── Quêtes quotidiennes ──
    const dq = _state.player.dailyQuestState;
    if (dq?.activeQuestIds?.length) {
      dq.activeQuestIds.forEach(qid => {
        const questDef = _state.dailyQuests.find(q => q.id === qid);
        if (!questDef || questDef.type !== type) return;
        if (dq.claimed[qid]) return;
        const prev = dq.progress[qid] || 0;
        if (prev >= questDef.target) return; // déjà complète
        const next = Math.min(questDef.target, prev + amount);
        if (next !== prev) { dq.progress[qid] = next; changed = true; }
      });
    }

    // ── Quêtes hebdomadaires ──
    const wq = _state.player.weeklyQuestState;
    if (wq?.activeQuestIds?.length && CWGameDatabase.DEFAULT_WEEKLY_QUESTS) {
      wq.activeQuestIds.forEach(qid => {
        const questDef = CWGameDatabase.DEFAULT_WEEKLY_QUESTS.find(q => q.id === qid);
        if (!questDef || questDef.type !== type) return;
        if (wq.claimed[qid]) return;
        const prev = wq.progress[qid] || 0;
        if (prev >= questDef.target) return;
        const next = Math.min(questDef.target, prev + amount);
        if (next !== prev) { wq.progress[qid] = next; changed = true; }
      });
    }

    if (changed) {
      _notify('questProgress');
      _autoSave();
    }
  }

  /**
   * Réclame la récompense d'une quête quotidienne active et complétée.
   * @param {string} questId
   * @returns {{success:boolean, reason?:string, reward?:object}}
   */
  function claimDailyQuest(questId) {
    const dq = _state.player.dailyQuestState;
    if (!dq || !dq.activeQuestIds?.includes(questId)) return { success: false, reason: 'not_active' };
    if (dq.claimed[questId]) return { success: false, reason: 'already_claimed' };

    const questDef = _state.dailyQuests.find(q => q.id === questId);
    if (!questDef) return { success: false, reason: 'unknown_quest' };
    if ((dq.progress[questId] || 0) < questDef.target) return { success: false, reason: 'not_complete' };

    _grantReward(questDef.reward);
    dq.claimed[questId] = true;
    _notify('questClaimed', { questId });
    _autoSave();
    return { success: true, reward: questDef.reward };
  }

  /**
   * Réordonne la liste des types selon l'ordre d'IDs fourni (drag & drop admin).
   * @param {Array<string>} orderedIds
   */
  function reorderTypes(orderedIds) {
    const byId = new Map(_state.types.map(t => [t.id, t]));
    const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
    _state.types.forEach(t => { if (!orderedIds.includes(t.id)) reordered.push(t); });
    _state.types = reordered;
    _notify('typesReordered');
    _autoSave();
  }

  // ─── CATÉGORIES DE TAGS ─────────────────────────────────────────────────────

  /** Ajoute une catégorie de tags */
  function addTagCategory(data) {
    if (!_state.tagCategories) _state.tagCategories = [];
    _state.tagCategories.push(data);
    _notify('tagCategoryAdded');
    _autoSave();
  }

  /** Met à jour une catégorie de tags */
  function updateTagCategory(id, data) {
    if (!_state.tagCategories) return false;
    const idx = _state.tagCategories.findIndex(c => c.id === id);
    if (idx === -1) return false;
    _state.tagCategories[idx] = { ..._state.tagCategories[idx], ...data };
    _notify('tagCategoryChanged');
    _autoSave();
    return true;
  }

  /** Supprime une catégorie et tous ses tags (retirés des personnages également) */
  function removeTagCategory(id) {
    if (!_state.tagCategories) return;
    // Trouver tous les tags de cette catégorie
    const tagIdsToRemove = (_state.tags || [])
      .filter(t => t.categoryId === id)
      .map(t => t.id);
    // Retirer ces tags de tous les personnages
    tagIdsToRemove.forEach(tagId => {
      _state.characters.forEach(c => {
        if (c.tags?.includes(tagId)) c.tags = c.tags.filter(t => t !== tagId);
      });
    });
    // Supprimer les tags
    _state.tags = (_state.tags || []).filter(t => t.categoryId !== id);
    // Supprimer la catégorie
    _state.tagCategories = _state.tagCategories.filter(c => c.id !== id);
    _notify('tagCategoryRemoved');
    _autoSave();
  }

  // ─── TAGS ───────────────────────────────────────────────────────────────────

  /** Ajoute un tag */
  function addTag(data) {
    _state.tags.push(data);
    _notify('tagAdded');
    _autoSave();
  }

  /** Met à jour un tag */
  function updateTag(id, data) {
    const idx = _state.tags.findIndex(t => t.id === id);
    if (idx === -1) return false;
    _state.tags[idx] = { ..._state.tags[idx], ...data };
    _notify('tagChanged');
    _autoSave();
    return true;
  }

  /** Supprime un tag (et le retire de tous les personnages qui le portaient) */
  function removeTag(id) {
    _state.tags = _state.tags.filter(t => t.id !== id);
    _state.characters.forEach(c => {
      if (c.tags?.includes(id)) c.tags = c.tags.filter(t => t !== id);
    });
    _notify('tagRemoved');
    _autoSave();
  }

  /**
   * Ajoute un tag à une LIGNÉE ÉVOLUTIVE entière : le tag est propagé à tous les
   * personnages partageant cette evolutionLine (forme de base et toutes ses
   * évolutions reçoivent le même tag).
   * @param {string} evolutionLine
   * @param {string} tagId
   */
  function addTagToLine(evolutionLine, tagId) {
    let changed = false;
    _state.characters.forEach(c => {
      if (c.evolutionLine !== evolutionLine) return;
      if (!c.tags) c.tags = [];
      if (!c.tags.includes(tagId)) { c.tags.push(tagId); changed = true; }
    });
    if (changed) {
      _notify('lineTagsChanged', { evolutionLine });
      _autoSave();
    }
  }

  /**
   * Retire un tag d'une lignée évolutive entière : retiré de tous les
   * personnages partageant cette evolutionLine.
   * @param {string} evolutionLine
   * @param {string} tagId
   */
  function removeTagFromLine(evolutionLine, tagId) {
    let changed = false;
    _state.characters.forEach(c => {
      if (c.evolutionLine !== evolutionLine) return;
      if (c.tags?.includes(tagId)) { c.tags = c.tags.filter(t => t !== tagId); changed = true; }
    });
    if (changed) {
      _notify('lineTagsChanged', { evolutionLine });
      _autoSave();
    }
  }

  /** Mise à jour des bannières gacha */
  function updateBanners(banners) {
    _state.banners = JSON.parse(JSON.stringify(banners));
    _notify('bannersChanged');
    _autoSave();
  }

  /** Remplace complètement le joueur (admin) */
  function updatePlayer(playerData) {
    _state.player = { ..._state.player, ...playerData };
    _notify('playerChanged');
    _autoSave();
  }

  // ─── ÉVÉNEMENTS ──────────────────────────────────────────────────────────────

  /** Abonne un listener aux changements d'état */
  function subscribe(fn) {
    _listeners.push(fn);
    return () => { _listeners = _listeners.filter(l => l !== fn); }; // Unsubscribe
  }

  function _notify(event, data = {}) {
    _listeners.forEach(fn => {
      try { fn(event, data, _state); } catch (e) { console.error('[CWGameState] Listener error:', e); }
    });
  }

  // ─── AUTOSAVE INTERNE ─────────────────────────────────────────────────────────

  let _autoSaveFn = null;
  function setAutoSaveFn(fn) { _autoSaveFn = fn; }
  function _autoSave() { _auraCacheVersion++; if (_autoSaveFn) _autoSaveFn(_state); }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  // ─── PROGRESSION MODE ODYSSÉE ───────────────────────────────────────────────

  /**
   * Retourne le prochain sous-niveau accessible (non encore complété).
   * { world: number, subLevel: number } ou null si aucun (jamais null en pratique).
   */
  function getStoryNext() {
    const s = _state.player.story || { world: 1, subLevel: 0 };
    const cfg = _state.config.combat.story || {};
    const perWorld = cfg.subLevelsPerWorld || 25;
    let { world, subLevel } = s;
    if (subLevel >= perWorld) { world++; subLevel = 0; }
    return { world, subLevel: subLevel + 1 };
  }

  /**
   * Marque un sous-niveau comme complété et met à jour la progression.
   * @param {number} world
   * @param {number} subLevel
   */
  function completeStoryLevel(world, subLevel) {
    const s = _state.player.story || { world: 1, subLevel: 0 };
    const cfg = _state.config.combat.story || {};
    const perWorld = cfg.subLevelsPerWorld || 25;
    if (world !== s.world) return; // sécurité : ne peut avancer que dans le monde actuel

    const newSubLevel = subLevel;
    let newWorld = world;
    if (newSubLevel >= perWorld) {
      newWorld = world + 1;
      _state.player.story = { world: newWorld, subLevel: 0 };
    } else {
      _state.player.story = { world, subLevel: newSubLevel };
    }
    _notify('storyProgress');
    _autoSave();
  }

  return {
    init, get,
    getPlayer, getConfig, getTypes, getMatrix,
    getCharDefs, getEquipDefs, getBanners, getCharDef, getPlayerChar, getTeam,
    addCharacterToCollection, addXpToCharacter, addXpToPlayer, setTeam, equipItem,
    modifyResources, regenEnergy,
    updateConfig, updateCharDef, addCharDef, removeCharDef, reorderCharDefs,
    updateTypeMatrix, updateTypes, reorderTypes, addEquipDef, updateEquipDef, removeEquipDef, reorderEquipDefs,
    addPassive, updatePassive, removePassive, getPassivesForCharacter,
    addTagCategory, updateTagCategory, removeTagCategory,
    addTag, updateTag, removeTag, addTagToLine, removeTagFromLine,
    addItemDef, updateItemDef, removeItemDef, useItem,
    addShopListing, updateShopListing, removeShopListing, purchaseShopListing,
    refreshRotatingShop, getRotatingShopListings,
    checkEvent, getActiveEvent, setEventConfig, setNextEventConfig, setNextEventTag, setCurrentEventTag,
    trackEventQuestProgress, claimEventQuest, planifyNextEvent, cancelNextEvent, getPlayerStatBonus,
    getCharacterAuraScore, getCharacterFinalStats, getPlayerAuraScoreTotal, getPlayerAuraScoreTeam,
    getTourneeProgress, getLeaderboardSnapshot, registerRecordScore,
    getRecordTotemState, claimNextRecordTier, claimAllRecordTiers,
    getAffinityPercent, registerAffinityGain, getAllAffinityProgress,
    registerReputationGain, placeCastingBid, getCastingConvictionBonus: _getCastingConvictionBonus, debugForceCasting,
    getStoryChapterProgress, completeStoryStage, isFeatureUnlocked,
    addDailyLoginCycle, updateDailyLoginCycle, removeDailyLoginCycle, getDailyLoginClaimable, claimDailyLoginReward,
    addDailyQuest, updateDailyQuest, removeDailyQuest, checkDailyQuests, trackQuestProgress, claimDailyQuest,
    checkWeeklyQuests, claimWeeklyQuest,
    updateBanners, updatePlayer,
    subscribe, setAutoSaveFn,
    getStoryNext, completeStoryLevel,
  };
})();
