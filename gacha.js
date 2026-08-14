/**
 * ============================================================
 * GACHA.JS — Système d'invocation
 * Gère les tirages simples et x10, la pitié, les bannières
 * ============================================================
 */

'use strict';

const CWGachaSystem = (() => {

  // ─── TIRAGE ──────────────────────────────────────────────────────────────────

  /**
   * Effectue un tirage simple
   * @param {string} bannerId
   * @returns {object|null} Résultat { char, isNew, awakening } ou null si erreur
   */
  function pullSingle(bannerId) {
    const state = CWGameState.get();
    const cfg   = state.config.gacha;
    const cost  = cfg.singlePullCost;
    const player = CWGameState.getPlayer();

    if (player.currency.crystals < cost) {
      return { error: 'Cristaux insuffisants !' };
    }

    CWGameState.modifyResources({ crystals: -cost });
    const result = _doPull(bannerId, state);
    _updateStats(1, bannerId);
    return result;
  }

  /**
   * Effectue un tirage x10
   * @param {string} bannerId
   * @returns {Array<object>|object} Tableau de résultats ou erreur
   */
  function pullTen(bannerId) {
    const state  = CWGameState.get();
    const cfg    = state.config.gacha;
    const cost   = cfg.tenPullCost;
    const player = CWGameState.getPlayer();

    if (player.currency.crystals < cost) {
      return { error: 'Cristaux insuffisants !' };
    }

    CWGameState.modifyResources({ crystals: -cost });
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(_doPull(bannerId, state));
    }
    _updateStats(10, bannerId);
    return results;
  }

  // ─── LOGIQUE INTERNE ──────────────────────────────────────────────────────────

  /**
   * Effectue un tirage dans une bannière donnée
   * @param {string} bannerId
   * @param {object} state
   * @returns {object} { char: charDef, isNew, awakening }
   */
  function _doPull(bannerId, state) {
    // Bannière event : si elle n'existe pas dans la DB, on la crée virtuellement
    let banner = state.banners.find(b => b.id === bannerId);
    if (!banner && bannerId === 'banner_event') {
      const ev = CWGameState.getActiveEvent?.() ?? null;
      banner = {
        id: 'banner_event', name: 'Bannière Event', active: true,
        pool: ev?.tagId ? 'tag' : 'all',
        poolTagId: ev?.tagId || null,
        featured: [], featuredRateBoost: 1,
      };
    }
    banner = banner || state.banners[0];
    const cfg    = state.config.gacha;
    const player = state.player;

    // Obtenir le pool de personnages
    let pool = _getPool(banner, state.characters);

    // Pity counters
    const pityKey = bannerId;
    if (!player.pity[pityKey]) {
      player.pity[pityKey] = { pulls: 0, rareGuarantee: 0, epicGuarantee: 0, legendaryGuarantee: 0 };
    }
    const pity = player.pity[pityKey];
    pity.pulls++;
    pity.rareGuarantee++;
    pity.epicGuarantee++;
    pity.legendaryGuarantee++;

    // Déterminer la rareté
    let rarity = _rollRarity(state, pity, cfg, bannerId);

    // Garanties de pitié
    if (pity.legendaryGuarantee >= cfg.guaranteedLegendaryAfter) {
      rarity = 'legendary';
      pity.legendaryGuarantee = 0;
      pity.epicGuarantee = 0;
      pity.rareGuarantee = 0;
    } else if (pity.epicGuarantee >= cfg.guaranteedEpicAfter) {
      rarity = rarity === 'legendary' ? rarity : 'epic';
      if (rarity === 'epic') { pity.epicGuarantee = 0; pity.rareGuarantee = 0; }
    } else if (pity.rareGuarantee >= cfg.guaranteedRareAfter) {
      if (['common', 'uncommon'].includes(rarity)) { rarity = 'rare'; pity.rareGuarantee = 0; }
    }

    // Reset des pity selon ce qui est sorti
    if (['legendary', 'mythic'].includes(rarity)) { pity.legendaryGuarantee = 0; pity.epicGuarantee = 0; pity.rareGuarantee = 0; }
    else if (rarity === 'epic') { pity.epicGuarantee = 0; pity.rareGuarantee = 0; }
    else if (['rare'].includes(rarity)) { pity.rareGuarantee = 0; }

    // Filtrer le pool par rareté
    let rarityPool = pool.filter(c => c.rarity === rarity);
    if (rarityPool.length === 0) rarityPool = pool; // fallback

    // Boost des personnages mis en avant dans la bannière
    let selected;
    if (banner.id === 'banner_event') {
      // Bannière event : pool = persos avec le tag event, boost fort sur les featured
      const ev = CWGameState.getActiveEvent();
      const boost = ev?.bannerBoost ?? 2.0;
      const featuredInPool = rarityPool.filter(c => banner.featured?.includes(c.id));
      if (featuredInPool.length > 0) {
        // Probabilité de tomber sur un featured = boost / (1 + boost)
        const featuredChance = boost / (1 + boost);
        if (Math.random() < featuredChance) {
          selected = featuredInPool[Math.floor(Math.random() * featuredInPool.length)];
        }
      }
    } else if (banner.featured?.length > 0 && banner.featuredRateBoost > 1) {
      const featuredInPool = rarityPool.filter(c => banner.featured.includes(c.id));
      if (featuredInPool.length > 0 && Math.random() < 0.5) {
        selected = featuredInPool[Math.floor(Math.random() * featuredInPool.length)];
      }
    }
    if (!selected) {
      selected = rarityPool[Math.floor(Math.random() * rarityPool.length)];
    }

    // Ajouter à la collection
    const addResult = CWGameState.addCharacterToCollection(selected.id, 'gacha');

    // Tracking quête event : invocation sur la bannière event
    // Comptage ici dans _doPull (par tirage individuel), PAS dans _updateStats
    if (banner.id === 'banner_event') {
      const ev = CWGameState.getActiveEvent?.() ?? null;
      if (ev) {
        // Compter uniquement si le perso tiré a bien le tag (pool 100% tag normalement)
        if (selected.tags?.includes(ev.tagId)) {
          CWGameState.trackEventQuestProgress?.('event_summon');
        }
      }
    }

    return {
      char: selected,
      isNew:     addResult?.isNew     || false,
      awakening: addResult?.awakening || false,
      instance:  addResult?.instance  || null,
    };
  }

  /**
   * Détermine la rareté du tirage via les poids configurables
   * Lit en priorité config.gacha.dropRates, sinon fallback sur CWGameDatabase.RARITIES
   */
  function _rollRarity(state, pity, cfg, bannerId) {
    // La bannière event utilise ses propres taux (indépendants de la bannière classique)
    const ev = bannerId === 'banner_event' ? (CWGameState.getActiveEvent?.() ?? null) : null;
    const dropRates = ev?.bannerRates || cfg.dropRates || {};
    const rarities  = CWGameDatabase.RARITIES;
    const roll = Math.random() * 100;
    let cumulative = 0;
    const order = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    for (const r of order) {
      const weight = dropRates[r] !== undefined ? dropRates[r] : (rarities[r]?.gachaWeight || 0);
      cumulative += weight;
      if (roll < cumulative) return r;
    }
    return 'common';
  }

  /**
   * Retourne le pool de personnages pour une bannière, selon son mode de pool
   * (banner.pool) : 'all' (tous, défaut), 'featured' (uniquement les personnages
   * mis en avant), 'type' (uniquement un type prédéfini), 'tag' (uniquement un
   * tag prédéfini). Dans tous les cas, seuls les personnages de stade 0 (formes
   * de base) sont invocables.
   */
  function _getPool(banner, allChars) {
    const base = allChars.filter(c => c.evolutionStage === 0);
    const mode = banner.pool || 'all';

    if (mode === 'featured') {
      const featuredPool = base.filter(c => banner.featured?.includes(c.id));
      return featuredPool.length > 0 ? featuredPool : base; // repli si la liste featured est vide
    }
    if (mode === 'type' && banner.poolTypeId) {
      const typePool = base.filter(c => c.type1 === banner.poolTypeId || c.type2 === banner.poolTypeId);
      return typePool.length > 0 ? typePool : base;
    }
    if (mode === 'tag' && banner.poolTagId) {
      const tagPool = base.filter(c => c.tags?.includes(banner.poolTagId));
      return tagPool.length > 0 ? tagPool : base;
    }
    return base;
  }

  function _updateStats(pullCount, bannerId) {
    const player = CWGameState.getPlayer();
    CWGameState.updatePlayer({
      stats: { ...player.stats, totalPulls: player.stats.totalPulls + pullCount },
    });
    CWGameState.trackQuestProgress('summon_character', pullCount);
    // event_summon est tracké dans _doPull (par tirage individuel) — pas ici
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return { pullSingle, pullTen };
})();
