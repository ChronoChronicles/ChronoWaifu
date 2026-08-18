/**
 * ============================================================
 * ENGINE.JS — Moteur de combat tour par tour
 * Gère l'initialisation, l'ordre d'action, les dégâts,
 * les captures et les récompenses de fin de combat.
 * ============================================================
 */

'use strict';

const CWCombatEngine = (() => {

  // ─── ÉTAT INTERNE DU COMBAT ──────────────────────────────────────────────────

  let _battle    = null;   // État courant du combat
  let _onEvent   = null;   // Callback d'événements (pour l'UI)

  // ─── STRUCTURES ──────────────────────────────────────────────────────────────

  /**
   * Crée un combattant (joueur ou ennemi) à partir d'une instance et sa définition
   * @param {object} instance   - Instance du personnage (collection joueur ou ennemi généré)
   * @param {object} charDef    - Définition du personnage
   * @param {boolean} isEnemy
   * @returns {object} Combattant
   */
  function _buildCombatant(instance, charDef, isEnemy) {
    const state   = CWGameState.get();
    const cfg     = state.config;

    // Stats de base calculées
    const computed = CWGameDatabase.computeStats(
      charDef,
      instance.level,
      instance.awakening || 0,
      cfg.awakening,
      charDef.rarity,
      cfg.level
    );

    // Bonus équipement (résolu via les exemplaires d'inventaire équipés)
    const eqBonus = CWGameDatabase.computeEquipBonus(
      instance.equipment,
      state.player.equipInventory,
      state.equipment
    );

    // Bonus joueur (progression des compteurs) — appliqué aux alliées uniquement
    const playerBonus = !isEnemy ? (CWGameState.getPlayerStatBonus?.()?.bonus ?? 0) : 0;

    const finalStats = {
      hp:  Math.min(999999, computed.hp  + eqBonus.hp  + playerBonus),
      atk: Math.min(99999,  computed.atk + eqBonus.atk + playerBonus),
      def: Math.min(99999,  computed.def + eqBonus.def + playerBonus),
      spd: Math.min(99999,  computed.spd + eqBonus.spd + playerBonus),
    };

    return {
      instanceId: instance.instanceId,
      charId:     charDef.id,
      name:       charDef.name,
      portrait:   charDef.portrait,
      rarity:     charDef.rarity,
      type1:      charDef.type1,
      type2:      charDef.type2,
      level:      instance.level,
      awakening:  instance.awakening || 0,
      isEnemy,
      maxHp:      finalStats.hp,
      currentHp:  finalStats.hp,
      atk:        finalStats.atk,
      def:        finalStats.def,
      spd:        finalStats.spd,
      alive:      true,
      captured:   false,
      // ── Système de passifs (liés aux types) ──────────────────────────────────
      passives:        CWGameState.getPassivesForCharacter(charDef), // passifs "natifs" résolus via type1/type2
      extraPassiveIds: [],   // passifs supplémentaires acquis EN COMBAT (ex: Mystère)
      statusEffects:   [],   // [{ type:'poison'|'paralysis'|'charm', turnsLeft, ... }]
      tempAtkBuffPercent: 0, // buff d'ATK temporaire consommé à la prochaine attaque (Ardente)
    };
  }

  // ─── SYSTÈME DE PASSIFS ──────────────────────────────────────────────────────
  // Chaque passif est résolu automatiquement depuis les types (type1/type2) du
  // personnage (cf. _buildCombatant) ; ces fonctions implémentent les 11 effets
  // possibles (cf. CWGameDatabase.PASSIVE_EFFECT_TYPES) et journalisent/émettent
  // un évènement 'passiveTriggered' à chaque déclenchement pour que l'UI puisse
  // afficher le nom du passif et jouer une petite animation.

  /** Renvoie TOUS les passifs actifs d'un combattant (natifs + acquis en combat, ex: Mystère) */
  function _getAllPassives(combatant) {
    const state = CWGameState.get();
    const extra = (combatant.extraPassiveIds || []).map(id => state.passives.find(p => p.id === id)).filter(Boolean);
    return [...(combatant.passives || []), ...extra];
  }

  /** Renvoie le premier passif actif d'un combattant correspondant à un effectType donné, ou null */
  function _findPassive(combatant, effectType) {
    return _getAllPassives(combatant).find(p => p.effectType === effectType) || null;
  }

  function _rollChance(percent) {
    return Math.random() * 100 < (percent || 0);
  }

  function _hasStatus(combatant, type) {
    return (combatant.statusEffects || []).some(s => s.type === type);
  }

  function _removeStatus(combatant, type) {
    combatant.statusEffects = (combatant.statusEffects || []).filter(s => s.type !== type);
  }

  function _applyStatus(combatant, type, extra = {}) {
    if (_hasStatus(combatant, type)) return; // déjà affecté, ne pas cumuler
    combatant.statusEffects = [...(combatant.statusEffects || []), { type, ...extra }];
  }

  /**
   * Mystère : au tout début du combat, chaque combattant qui possède ce passif
   * copie un passif aléatoire d'un adversaire pour la durée du combat.
   * L'adversaire CONSERVE son passif — c'est une copie, pas un vol.
   * À la fin du combat, extraPassiveIds est vidé → le passif copié disparaît.
   */
  function _initBattlePassives() {
    const all = [..._battle.playerTeam, ..._battle.enemyTeam];
    all.forEach(c => {
      const mystere = _findPassive(c, 'random_passive_steal');
      if (!mystere) return;

      // Pool = passifs natifs des ADVERSAIRES (équipe opposée), hors Mystère lui-même
      const opponents = c.isEnemy ? _battle.playerTeam : _battle.enemyTeam;
      const pool = opponents.flatMap(opp => (opp.passives || []).filter(p => p.effectType !== 'random_passive_steal'));
      if (pool.length === 0) return;

      const picked = pool[Math.floor(Math.random() * pool.length)];
      // Copie : on ajoute l'id dans extraPassiveIds (vidé au reset du combat)
      c.extraPassiveIds = [...(c.extraPassiveIds || []), picked.id];
      _battle.log.push(`🌟 ${c.name} utilise Mystère et copie le passif "${picked.name}" sur un adversaire !`);
      _emit('passiveTriggered', {
        combatantId: c.instanceId, isEnemy: c.isEnemy,
        passiveId: mystere.id, passiveName: mystere.name,
        message: `${c.name} utilise Mystère !`,
        extra: { copiedPassiveId: picked.id, copiedPassiveName: picked.name },
      });
    });
  }

  /** Garde Robe : juste avant d'attaquer, retire ses propres altérations d'état */
  function _processPreAttack(attacker) {
    const garderobe = _findPassive(attacker, 'pre_attack_cleanse_self');
    if (!garderobe) return;
    if (!attacker.statusEffects || attacker.statusEffects.length === 0) return;
    if (!_rollChance(garderobe.params.chance)) return;
    attacker.statusEffects = [];
    _battle.log.push(`👗 ${attacker.name} utilise Garde Robe sur elle-même et retire toutes ses altérations !`);
    _emit('passiveTriggered', {
      combatantId: attacker.instanceId, isEnemy: attacker.isEnemy,
      passiveId: garderobe.id, passiveName: garderobe.name,
      message: `${attacker.name} active Garde Robe !`,
    });
  }

  /** Contre-Attaque (Amazone) : déclenchée juste après que la cible ait pris des dégâts */
  function _processPostDamageCounter(target, originalAttacker) {
    // Mode Record : les ennemis ne doivent jamais agir de façon agressive,
    // même via une contre-attaque déclenchée par un de leurs passifs.
    if (_battle.mode === 'record' && target.isEnemy) return;
    const counter = _findPassive(target, 'on_damaged_counter');
    if (!counter) return;
    if (!originalAttacker.alive) return; // rien à contre-attaquer
    if (!_rollChance(counter.params.chance)) return;

    const result = _executeAttack(target, originalAttacker);
    _battle.log.push(`👊 ${target.name} utilise Contre-Attaque sur ${originalAttacker.name} !`);
    _logAction(target, originalAttacker, result);
    _emit('passiveTriggered', {
      combatantId: target.instanceId, isEnemy: target.isEnemy,
      passiveId: counter.id, passiveName: counter.name,
      message: `${target.name} active Contre-Attaque !`,
      extra: { targetId: originalAttacker.instanceId, damage: result.damage },
    });
  }

  /**
   * Traite les passifs de fin de tour pour l'acteur qui vient d'agir :
   * Fanatisme (dégâts de zone), Ardente (buff d'ATK à un allié), Régénération
   * (soin de l'allié le plus faible).
   */
  function _processEndOfTurn(actor) {
    if (!actor.alive) return;

    // Fanatisme : dégâts de zone à tous les adversaires
    const fanatisme = _findPassive(actor, 'end_turn_aoe_damage');
    if (fanatisme && _rollChance(fanatisme.params.chance)) {
      const opponents = (actor.isEnemy ? _battle.playerTeam : _battle.enemyTeam).filter(c => c.alive);
      if (opponents.length > 0) {
        let totalDmgDealt = 0;
        opponents.forEach(o => {
          const dmg = Math.max(1, Math.round(o.maxHp * (fanatisme.params.damagePercentMaxHp / 100)));
          o.currentHp = Math.max(0, o.currentHp - dmg);
          if (o.currentHp <= 0) { o.alive = false; o.currentHp = 0; }
          totalDmgDealt += dmg;
        });
        // Mode Record : les dégâts de zone infligés par un allié comptent aussi au score
        if (_battle.mode === 'record' && !actor.isEnemy) {
          _battle.recordScore = (_battle.recordScore || 0) + totalDmgDealt;
        }
        _battle.log.push(`💥 ${actor.name} utilise Fanatisme sur tous les adversaires (${fanatisme.params.damagePercentMaxHp}% Endurance max) !`);
        // Calcul des dégâts par cible (déjà appliqués ci-dessus, recalculés ici pour l'UI)
        const damageMap = {};
        opponents.forEach(o => { damageMap[o.instanceId] = Math.max(1, Math.round(o.maxHp * (fanatisme.params.damagePercentMaxHp / 100))); });
        _emit('passiveTriggered', {
          combatantId: actor.instanceId, isEnemy: actor.isEnemy,
          passiveId: fanatisme.id, passiveName: fanatisme.name,
          message: `${actor.name} active Fanatisme !`,
          extra: { targetIds: opponents.map(o => o.instanceId), damageMap },
        });
      }
    }

    // Ardente : booste l'ATK d'un allié pour sa prochaine attaque
    // Si l'acteur est le seul survivant de son camp, le buff s'applique à lui-même
    const ardente = _findPassive(actor, 'buff_ally_atk_once');
    if (ardente && _rollChance(ardente.params.chance)) {
      const sameSide = (actor.isEnemy ? _battle.enemyTeam : _battle.playerTeam).filter(c => c.alive);
      const allies   = sameSide.filter(c => c.instanceId !== actor.instanceId);
      // Fallback sur soi-même si aucun allié vivant
      const chosen   = allies.length > 0
        ? allies[Math.floor(Math.random() * allies.length)]
        : actor;
      chosen.tempAtkBuffPercent = (chosen.tempAtkBuffPercent || 0) + ardente.params.percent;
      const target = chosen.instanceId === actor.instanceId ? 'elle-même' : chosen.name;
      _battle.log.push(`🔥 ${actor.name} utilise Ardente sur ${target} : Charisme +${ardente.params.percent}% pour la prochaine attaque !`);
      _emit('passiveTriggered', {
        combatantId: actor.instanceId, isEnemy: actor.isEnemy,
        passiveId: ardente.id, passiveName: ardente.name,
        message: `${actor.name} utilise Ardente !`,
        extra: { buffedId: chosen.instanceId },
      });
    }

    // Régénération : soigne l'allié (ou soi-même) ayant le moins de vie en proportion
    const regen = _findPassive(actor, 'end_turn_heal_lowest_ally');
    if (regen && _rollChance(regen.params.chance)) {
      const sameSide = (actor.isEnemy ? _battle.enemyTeam : _battle.playerTeam).filter(c => c.alive);
      if (sameSide.length > 0) {
        const lowest = sameSide.reduce((min, c) => (c.currentHp / c.maxHp) < (min.currentHp / min.maxHp) ? c : min, sameSide[0]);
        if (lowest.currentHp < lowest.maxHp) {
          const heal = Math.max(1, Math.round(lowest.maxHp * (regen.params.healPercentMaxHp / 100)));
          const healHpBefore = lowest.currentHp;
          lowest.currentHp = Math.min(lowest.maxHp, lowest.currentHp + heal);
          const healHpAfter  = lowest.currentHp;
          _battle.log.push(`💚 ${actor.name} utilise Régénération sur ${lowest.name} : +${heal} Endurance !`);
          _emit('passiveTriggered', {
            combatantId: actor.instanceId, isEnemy: actor.isEnemy,
            passiveId: regen.id, passiveName: regen.name,
            message: `${actor.name} active Régénération !`,
            extra: { healedId: lowest.instanceId, amount: heal, hpBefore: healHpBefore, hpAfter: healHpAfter },
          });
        }
      }
    }
  }

  /** Poison : tic de dégâts en tout début du tour du combattant affecté */
  function _tickPoison(combatant) {
    const poison = (combatant.statusEffects || []).find(s => s.type === 'poison');
    if (!poison) return;
    const dmg = Math.max(1, Math.round(combatant.maxHp * (poison.damagePercentMaxHp / 100)));
    const poisonHpBefore = combatant.currentHp;
    combatant.currentHp = Math.max(0, combatant.currentHp - dmg);
    const poisonHpAfter  = combatant.currentHp;
    if (combatant.currentHp <= 0) { combatant.alive = false; combatant.currentHp = 0; }
    poison.turnsLeft--;
    // Mode Record : le poison ne peut avoir été infligé que par un allié à un
    // ennemi (les ennemis n'attaquent jamais dans ce mode) — compte au score
    if (_battle.mode === 'record' && combatant.isEnemy) {
      _battle.recordScore = (_battle.recordScore || 0) + dmg;
    }
    _battle.log.push(`☠️ ${combatant.name} subit ${dmg} dégâts de poison (${Math.max(0, poison.turnsLeft)} tour(s) restant(s)).`);
    _emit('statusTriggered', { combatantId: combatant.instanceId, isEnemy: combatant.isEnemy, statusType: 'poison', amount: dmg, hpBefore: poisonHpBefore, hpAfter: poisonHpAfter });
    if (poison.turnsLeft <= 0) _removeStatus(combatant, 'poison');
  }

  /** Paralysie : si présente, consomme l'effet et fait passer le tour du combattant */
  function _checkAndConsumeParalysis(combatant) {
    if (!_hasStatus(combatant, 'paralysis')) return false;
    _removeStatus(combatant, 'paralysis');
    _battle.log.push(`⚡ ${combatant.name} est paralysé(e) et ne peut pas agir !`);
    _emit('statusTriggered', { combatantId: combatant.instanceId, isEnemy: combatant.isEnemy, statusType: 'paralysis' });
    return true;
  }

  /** Charme : si présent, consomme l'effet et redirige l'attaque vers un coéquipier au hasard */
  function _checkCharmRedirect(attacker) {
    if (!_hasStatus(attacker, 'charm')) return null;
    _removeStatus(attacker, 'charm');
    const ownTeam = (attacker.isEnemy ? _battle.enemyTeam : _battle.playerTeam)
      .filter(c => c.instanceId !== attacker.instanceId && c.alive);
    if (ownTeam.length === 0) return null;
    const redirected = ownTeam[Math.floor(Math.random() * ownTeam.length)];
    _battle.log.push(`💞 ${attacker.name} est charmé(e) et attaque ${redirected.name} par erreur !`);
    _emit('statusTriggered', {
      combatantId: attacker.instanceId, isEnemy: attacker.isEnemy, statusType: 'charm',
      extra: { redirectedTo: redirected.instanceId },
    });
    return redirected;
  }

  /**
   * Génère une équipe ennemie aléatoire.
   * Les ennemis ont un léger désavantage de stats (enemyStatRatio configurable)
   * et un niveau calé sur le niveau moyen du joueur avec une variation réduite.
   */
  /**
   * Choisit un personnage au hasard dans une liste, pondéré par la rareté
   * (selon cfg.combat.enemyRarityWeights configuré en admin). Repli sur un
   * poids égal pour tous si aucune pondération valide n'est trouvée.
   * @param {Array<object>} chars
   * @param {Object<string,number>} rarityWeights
   * @returns {object}
   */
  /**
   * Choisit un personnage au hasard, pondéré par rareté ET par stade d'évolution.
   * Une forme évoluée (stade ≥ 1) voit son poids multiplié par stageFactor^stade,
   * en plus de son poids de rareté — donc plus rare qu'une forme de base de même
   * rareté, et de plus en plus rare à mesure que le stade augmente.
   * @param {Array<object>} chars
   * @param {object} rarityWeights
   * @param {number} [stageFactor=1] - cfg.combat.evolvedFormWeightFactor (1 = pas de réduction)
   */
  /**
   * Tire un personnage ennemi EXACTEMENT comme le gacha, en 2 étapes :
   * 1. Tire une rareté selon les pourcentages fournis (cf. cfg.enemyRarityWeights)
   *    — un pourcentage exact, indépendant du nombre de personnages existant
   *    dans chaque rareté (contrairement à un poids par personnage, qui
   *    sur-représenterait les raretés ayant le plus de personnages).
   * 2. Choisit un personnage au hasard parmi les éligibles de cette rareté,
   *    pondéré par stageFactor selon le stade d'évolution (une forme évoluée
   *    apparaît plus rarement que la forme de base de la même rareté).
   * Repli en cascade sur la rareté non-vide la plus proche si la rareté tirée
   * n'a encore aucun personnage éligible (ex: aucun Légendaire débloqué) —
   * jamais un biais silencieux vers une autre rareté au hasard.
   */
  function _pickWeightedRandomChar(chars, rarityWeights, stageFactor = 1) {
    const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

    // Regrouper les personnages éligibles par rareté
    const byRarity = {};
    chars.forEach(c => {
      (byRarity[c.rarity] = byRarity[c.rarity] || []).push(c);
    });

    // 1. Tirer une rareté selon les pourcentages (comme _rollRarity du gacha)
    const weights = rarityWeights || {};
    const totalW  = RARITY_ORDER.reduce((s, r) => s + Math.max(0, weights[r] || 0), 0);
    let rolledRarity = RARITY_ORDER[0];
    if (totalW > 0) {
      let roll = Math.random() * totalW;
      for (const r of RARITY_ORDER) {
        roll -= Math.max(0, weights[r] || 0);
        if (roll <= 0) { rolledRarity = r; break; }
      }
    }

    // 2. Repli en cascade si la rareté tirée n'a aucun personnage éligible
    let pool = byRarity[rolledRarity];
    if (!pool || pool.length === 0) {
      const idx = RARITY_ORDER.indexOf(rolledRarity);
      for (let d = 1; d < RARITY_ORDER.length && (!pool || pool.length === 0); d++) {
        const below = RARITY_ORDER[idx - d];
        const above = RARITY_ORDER[idx + d];
        if (below && byRarity[below]?.length) pool = byRarity[below];
        else if (above && byRarity[above]?.length) pool = byRarity[above];
      }
    }
    if (!pool || pool.length === 0) pool = chars; // dernier repli : n'importe quel éligible
    if (!pool.length) return null;

    // 3. Choisir un personnage dans cette rareté, pondéré par stade d'évolution
    const weighted = pool.map(c => ({ c, w: Math.pow(stageFactor, c.evolutionStage || 0) }));
    const wTotal = weighted.reduce((s, x) => s + x.w, 0);
    if (wTotal <= 0) return pool[Math.floor(Math.random() * pool.length)];
    let roll2 = Math.random() * wTotal;
    for (const x of weighted) {
      roll2 -= x.w;
      if (roll2 <= 0) return x.c;
    }
    return weighted[weighted.length - 1].c;
  }

  /**
   * Choisit un élément au hasard dans un pool pré-pondéré [{c, weight}, ...].
   * @param {Array<{c:object, weight:number}>} pool
   * @returns {object}
   */
  function _pickFromWeightedPool(pool) {
    const total = pool.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return pool[Math.floor(Math.random() * pool.length)].c;
    let roll = Math.random() * total;
    for (const x of pool) {
      roll -= x.weight;
      if (roll <= 0) return x.c;
    }
    return pool[pool.length - 1].c;
  }

  /**
   * Un personnage est éligible aux pools d'ennemis aléatoires/arène s'il est de
   * stade 0 (forme de base, toujours disponible), ou si c'est une forme évoluée
   * que le joueur a déjà débloquée (présente dans son Catalogue).
   */
  function _isEligibleWildChar(charDef, player) {
    return charDef.evolutionStage === 0 || !!player.catalogue?.[charDef.id];
  }

  // ─── ÉQUILIBRAGE ADAPTATIF (ANTI-SNOWBALL) ───────────────────────────────────
  // Problème ciblé : un personnage évolué + équipé + awakened peut devenir
  // largement plus fort que ce que son niveau seul suggère, alors que les
  // ennemis sauvages (sans équipement, sans awakening, niveau calé sur la
  // moyenne joueur) ne suivent pas cette progression. Résultat : les combats
  // s'effondrent en non-évènement après les premières heures de jeu.
  //
  // Solution : on mesure, pour l'équipe du joueur, à quel point ses stats
  // RÉELLES dépassent celles d'une version "nue" du même personnage — à la
  // forme DE BASE de sa lignée (donc l'évolution compte aussi), au même
  // niveau, sans équipement ni awakening. Cet écart ("ratio de puissance")
  // est ensuite reporté sur les stats des ennemis générés, de façon croisée :
  // un surplus d'ATK joueur renforce la DEF/PV ennemis (ils survivent plus
  // longtemps face à cette frappe), un surplus de PV/DEF joueur renforce
  // l'ATK ennemie (ils redeviennent une menace face à cette résilience).

  /**
   * Retrouve la forme de base (stade 0) de la lignée d'un personnage donné.
   * Repli sur le personnage lui-même si sa lignée est introuvable (solo, etc.)
   */
  function _getLineBaseForm(charDef, allChars) {
    if (!charDef) return charDef;
    return allChars.find(c => c.evolutionLine === charDef.evolutionLine && c.evolutionStage === 0) || charDef;
  }

  /**
   * Moyenne géométrique, sur toute l'équipe, du ratio (stat réelle ÷ stat "nue")
   * pour une statistique donnée. Toujours ≥ 1 en pratique (équipement et
   * awakening ne peuvent qu'ajouter, jamais retirer).
   * @param {Array<object>} teamInstances - Instances de la collection (équipe active)
   * @param {'hp'|'atk'|'def'|'spd'} stat
   * @returns {number}
   */
  function _computeStatRatio(teamInstances, stat) {
    const state = CWGameState.get();
    let sumLog = 0, count = 0;

    teamInstances.forEach(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return;
      const baseForm = _getLineBaseForm(def, state.characters);

      const vanilla = CWGameDatabase.computeStats(
        baseForm, inst.level, 0, state.config.awakening, baseForm.rarity, state.config.level
      );
      const realBase = CWGameDatabase.computeStats(
        def, inst.level, inst.awakening || 0, state.config.awakening, def.rarity, state.config.level
      );
      const eqBonus = CWGameDatabase.computeEquipBonus(inst.equipment, state.player.equipInventory, state.equipment);

      const realVal    = realBase[stat] + (eqBonus[stat] || 0);
      const vanillaVal = vanilla[stat];
      if (vanillaVal > 0) {
        sumLog += Math.log(Math.max(0.05, realVal / vanillaVal));
        count++;
      }
    });

    return count > 0 ? Math.exp(sumLog / count) : 1;
  }

  /**
   * Calcule le profil de puissance complet (4 stats) de l'équipe active.
   * @param {Array<object>} teamInstances
   * @returns {{hp:number, atk:number, def:number, spd:number}}
   */
  function _computePowerProfile(teamInstances) {
    return {
      hp:  _computeStatRatio(teamInstances, 'hp'),
      atk: _computeStatRatio(teamInstances, 'atk'),
      def: _computeStatRatio(teamInstances, 'def'),
      spd: _computeStatRatio(teamInstances, 'spd'),
    };
  }

  /**
   * Applique le ratio de stats "historique" (enemyStatRatio) PUIS le bonus
   * adaptatif croisé à un combattant ennemi déjà construit par _buildCombatant.
   * @param {object} combatant - Combattant ennemi (modifié en place)
   * @param {{hp,atk,def,spd}} powerProfile - Profil de puissance du joueur
   * @param {number} baseStatRatio - cfg.combat.enemyStatRatio (malus historique, défaut 0.85)
   * @param {number} scalingFactor - cfg.combat.adaptiveScalingFactor (0 = désactivé, 1 = parité totale)
   */
  function _applyAdaptiveScaling(combatant, powerProfile, baseStatRatio, scalingFactor) {
    const sf = Math.max(0, Math.min(1, scalingFactor ?? 0));

    // Croisé : l'ATK ennemie répond à la résilience joueur (PV+DEF),
    // la DEF/PV ennemie répond à l'offensive joueur (ATK).
    const tankiness = Math.sqrt(Math.max(0.01, powerProfile.def) * Math.max(0.01, powerProfile.hp));
    const offense   = powerProfile.atk;
    const speed     = powerProfile.spd;

    const atkMult = baseStatRatio * (1 + (tankiness - 1) * sf);
    const defMult = baseStatRatio * (1 + (offense   - 1) * sf);
    const spdMult = baseStatRatio * (1 + (speed     - 1) * sf * 0.5); // amorti : impact indirect (ordre des tours, esquive, crit)
    const hpMult  = 1             * (1 + (offense   - 1) * sf);       // les PV n'ont pas de malus de base, seulement le bonus adaptatif

    combatant.maxHp     = Math.max(1, Math.floor(combatant.maxHp * hpMult));
    combatant.currentHp = combatant.maxHp;
    combatant.atk = Math.max(1, Math.floor(combatant.atk * atkMult));
    combatant.def = Math.max(0, Math.floor(combatant.def * defMult));
    combatant.spd = Math.max(1, Math.floor(combatant.spd * spdMult));
  }

  function _generateEnemyTeam(size) {
    const state   = CWGameState.get();
    const cfg     = state.config.combat;
    const chars   = state.characters.filter(c => _isEligibleWildChar(c, state.player));
    const enemies = [];
    const statRatio = cfg.enemyStatRatio ?? 0.85;

    const playerTeam   = CWGameState.getTeam();
    const powerProfile = _computePowerProfile(playerTeam);
    const avgLevel = playerTeam.length
      ? Math.round(playerTeam.reduce((s, c) => s + c.level, 0) / playerTeam.length)
      : 1;

    for (let i = 0; i < size; i++) {
      const charDef = _pickWeightedRandomChar(chars, cfg.enemyRarityWeights, cfg.evolvedFormWeightFactor ?? 1);
      // Variation réduite : ±2 niveaux autour de la moyenne joueur
      const enemyLevel = Math.max(1, avgLevel + Math.floor(Math.random() * 5) - 2);

      const enemyInstance = {
        instanceId: `enemy_${Date.now()}_${i}`,
        charId: charDef.id,
        level: enemyLevel,
        awakening: 0,
        equipment: [null, null, null],
      };

      const combatant = _buildCombatant(enemyInstance, charDef, true);
      _applyAdaptiveScaling(combatant, powerProfile, statRatio, cfg.adaptiveScalingFactor);
      enemies.push(combatant);
    }
    return enemies;
  }

  /**
   * Génère une équipe ennemie pour un combat d'event :
   * tous les ennemis ont le tag de l'event actif.
   * Seules les formes de base sont sélectionnées.
   */
  function _generateEventEnemyTeam() {
    const state  = CWGameState.get();
    const cfg    = state.config.combat;
    const ev     = CWGameState.getActiveEvent?.() ?? null;
    const statRatio = cfg.enemyStatRatio ?? 0.85;

    const tagId = ev?.tagId;
    const pool  = tagId
      ? state.characters.filter(c => c.evolutionStage === 0 && c.tags?.includes(tagId))
      : state.characters.filter(c => c.evolutionStage === 0);

    if (!pool.length) return [];

    const playerTeam   = CWGameState.getTeam();
    const powerProfile = _computePowerProfile(playerTeam);
    const avgLevel     = playerTeam.length
      ? Math.round(playerTeam.reduce((s, c) => s + c.level, 0) / playerTeam.length)
      : 1;

    const diffMult = ev?.combatConfig?.difficulty ?? 1.0;
    // Taille aléatoire entre 1 et 5
    const size     = 1 + Math.floor(Math.random() * 5);
    const enemies  = [];

    for (let i = 0; i < size; i++) {
      const charDef = pool[Math.floor(Math.random() * pool.length)];
      const lvl     = Math.max(1, avgLevel + Math.floor(Math.random() * 5) - 2);
      const inst    = { instanceId: `enemy_event_${Date.now()}_${i}`, charId: charDef.id, level: lvl, awakening: 0, equipment: [null, null, null] };
      const combatant = _buildCombatant(inst, charDef, true);
      _applyAdaptiveScaling(combatant, powerProfile, statRatio * diffMult, cfg.adaptiveScalingFactor);
      enemies.push(combatant);
    }
    return enemies;
  }

  /**
   * Génère une équipe ennemie pour un combat de lignée : 3 emplacements, chacun
   * tiré indépendamment parmi la forme de base et les formes évoluées de cette
   * lignée déjà débloquées par le joueur. Chaque stade d'évolution divise par 2
   * la chance d'apparition par rapport au stade précédent (la forme de base
   * n'est pas une "évolution" et garde toujours le poids plein).
   * @param {string} lineId - ID de la lignée évolutive (champ evolutionLine)
   * @returns {Array<object>} Tableau de combattants ennemis (vide si lignée introuvable/désactivée)
   */
  function _generateEnemyTeamFromLine(lineId) {
    const state = CWGameState.get();
    const cfg   = state.config.combat;
    const statRatio = cfg.enemyStatRatio ?? 0.85;
    const COPIES = 3;

    const lineMembers = state.characters
      .filter(c => c.evolutionLine === lineId)
      .sort((a, b) => a.evolutionStage - b.evolutionStage);

    const baseChar = lineMembers[0];
    if (!baseChar || baseChar.availableInLineCombat === false) return [];

    // Pool pondéré : stade 0 (poids plein) + formes évoluées débloquées
    // (poids réduit par cfg.evolvedFormWeightFactor élevé à la puissance du stade)
    const stageFactor = cfg.evolvedFormWeightFactor ?? 1;
    const weightedPool = lineMembers
      .filter(c => _isEligibleWildChar(c, state.player))
      .map(c => ({ c, weight: Math.pow(stageFactor, c.evolutionStage) }));

    const playerTeam = CWGameState.getTeam();
    const powerProfile = _computePowerProfile(playerTeam);
    const avgLevel = playerTeam.length
      ? Math.round(playerTeam.reduce((s, c) => s + c.level, 0) / playerTeam.length)
      : 1;

    return Array.from({ length: COPIES }, (_, i) => {
      const charDef = _pickFromWeightedPool(weightedPool);
      const enemyLevel = Math.max(1, avgLevel + Math.floor(Math.random() * 3) - 1);
      const enemyInstance = {
        instanceId: `enemy_${Date.now()}_${i}`,
        charId: charDef.id,
        level: enemyLevel,
        awakening: 0,
        equipment: [null, null, null],
      };
      const combatant = _buildCombatant(enemyInstance, charDef, true);
      _applyAdaptiveScaling(combatant, powerProfile, statRatio, state.config.combat.adaptiveScalingFactor);
      return combatant;
    });
  }

  /**
   * Tire au hasard une équipe parmi les personnages déjà débloqués par le joueur
   * (utilisé par le mode 'fullRandom'). L'équipe d'origine n'est pas modifiée ici :
   * c'est à l'appelant de la restaurer après le combat.
   * @param {number} maxSize - Taille maximale d'équipe (config.game.maxTeamSize)
   * @returns {Array<string>} Tableau d'instanceId (peut être plus court si collection réduite)
   */
  function _pickRandomTeam(maxSize) {
    const player = CWGameState.getPlayer();
    const pool = [...player.collection];
    // Mélange de Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, maxSize).map(inst => inst.instanceId);
  }

  /**
   * Génère une équipe ennemie d'arène : 6 personnages partageant tous le type
   * donné (en type principal OU secondaire), tirés au sort en respectant les
   * poids de fréquence par rareté configurés en admin. Les formes évoluées déjà
   * débloquées par le joueur sont éligibles au même titre que les formes de base.
   * @param {string} typeId
   * @returns {Array<object>} Tableau de 6 combattants ennemis (vide si type sans personnage éligible)
   */
  function _generateArenaTeam(typeId) {
    const state = CWGameState.get();
    const cfg   = state.config.combat;
    const statRatio = cfg.enemyStatRatio ?? 0.85;
    const SIZE = 6;

    const eligible = state.characters.filter(c =>
      (c.type1 === typeId || c.type2 === typeId) && _isEligibleWildChar(c, state.player)
    );
    if (eligible.length === 0) return [];

    const playerTeam = CWGameState.getTeam();
    const powerProfile = _computePowerProfile(playerTeam);
    const avgLevel = playerTeam.length
      ? Math.round(playerTeam.reduce((s, c) => s + c.level, 0) / playerTeam.length)
      : 1;

    return Array.from({ length: SIZE }, (_, i) => {
      const charDef = _pickWeightedRandomChar(eligible, cfg.enemyRarityWeights, cfg.evolvedFormWeightFactor ?? 1);
      const enemyLevel = Math.max(1, avgLevel + Math.floor(Math.random() * 5) - 2);
      const enemyInstance = {
        instanceId: `enemy_${Date.now()}_${i}`,
        charId: charDef.id,
        level: enemyLevel,
        awakening: 0,
        equipment: [null, null, null],
      };
      const combatant = _buildCombatant(enemyInstance, charDef, true);
      _applyAdaptiveScaling(combatant, powerProfile, statRatio, cfg.adaptiveScalingFactor);
      return combatant;
    });
  }

  /**
   * Génère des ennemis pour le mode Odyssée (histoire).
   * Le niveau de base est calé sur la moyenne de l'équipe joueur, puis les
   * modificateurs de sous-niveau (élite / boss) et de monde sont appliqués
   * APRÈS l'équilibrage adaptatif, dans cet ordre :
   *   1. Génération de base (niveaux calés sur l'équipe joueur)
   *   2. Équilibrage adaptatif (anti-snowball)
   *   3. Boost de sous-niveau (élite +10%, boss +25%)
   *   4. Bonus mondial (+10% par monde supplémentaire complété, appliqué aux stats)
   *
   * @param {number} size - Nombre d'ennemis
   * @param {number} world - Monde courant (1-indexé)
   * @param {number} subLevel - Sous-niveau courant (1-25)
   */
  function _generateStoryEnemyTeam(size, world, subLevel) {
    const state   = CWGameState.get();
    const cfg     = state.config.combat;
    const storyCfg = cfg.story || {};
    const statRatio = cfg.enemyStatRatio ?? 0.85;

    const chars = state.characters.filter(c => _isEligibleWildChar(c, state.player));
    if (chars.length === 0) return [];

    const playerTeam = CWGameState.getTeam();
    const powerProfile = _computePowerProfile(playerTeam);
    const avgLevel = playerTeam.length
      ? Math.round(playerTeam.reduce((s, c) => s + c.level, 0) / playerTeam.length)
      : 1;

    // Déterminer le type de sous-niveau
    const eliteSubs  = storyCfg.eliteSubLevels || [10, 20];
    const bossSub    = storyCfg.bossSubLevel    || 25;
    const isElite    = eliteSubs.includes(subLevel);
    const isBoss     = subLevel === bossSub;
    const sublevelBoost = isBoss ? (storyCfg.bossStatBoost ?? 0.25) : isElite ? (storyCfg.eliteStatBoost ?? 0.10) : 0;

    // Bonus mondial : +X% par monde supplémentaire complété (monde 1 = 0%, monde 2 = +10%…)
    const worldBoost = (world - 1) * (storyCfg.worldStatBoost ?? 0.10);

    // Facteur total post-équilibrage = (1 + sublevelBoost) × (1 + worldBoost)
    const postScalingMult = (1 + sublevelBoost) * (1 + worldBoost);

    return Array.from({ length: size }, (_, i) => {
      const charDef = _pickWeightedRandomChar(chars, cfg.enemyRarityWeights, cfg.evolvedFormWeightFactor ?? 1);

      // Le niveau de base est ajusté par le boost de sous-niveau
      const baseLevel = Math.max(1, avgLevel + Math.floor(Math.random() * 5) - 2);
      const enemyLevel = Math.max(1, Math.round(baseLevel * (1 + sublevelBoost)));

      const enemyInstance = {
        instanceId: `enemy_${Date.now()}_${i}`,
        charId: charDef.id,
        level: enemyLevel,
        awakening: 0,
        equipment: [null, null, null],
      };

      const combatant = _buildCombatant(enemyInstance, charDef, true);
      // Étape 1 : équilibrage adaptatif (anti-snowball)
      _applyAdaptiveScaling(combatant, powerProfile, statRatio, cfg.adaptiveScalingFactor);
      // Étape 2 : boosts de progression (élite/boss + monde) appliqués APRÈS
      if (postScalingMult !== 1) {
        combatant.maxHp     = Math.max(1, Math.floor(combatant.maxHp * postScalingMult));
        combatant.currentHp = combatant.maxHp;
        combatant.atk = Math.max(1, Math.floor(combatant.atk * postScalingMult));
        combatant.def = Math.max(0, Math.floor(combatant.def * postScalingMult));
        combatant.spd = Math.max(1, Math.floor(combatant.spd * postScalingMult));
      }
      // Marquer le type de rencontre pour l'interface
      combatant.storyEncounterType = isBoss ? 'boss' : isElite ? 'elite' : 'normal';
      return combatant;
    });
  }

  // ─── INITIALISATION ──────────────────────────────────────────────────────────

  /**
   * Démarre un nouveau combat
   * @param {Function} onEvent - Callback appelé à chaque événement de combat
   * @param {object} [options]
   * @param {'random'|'story'|'line'|'fullRandom'|'arena'} [options.mode='random']
   * @param {string} [options.lineId] - ID de lignée évolutive (mode 'line')
   * @param {string} [options.arenaType] - ID du type d'arène (mode 'arena')
   * @param {number} [options.storyWorld] - Monde Odyssée (mode 'story')
   * @param {number} [options.storySubLevel] - Sous-niveau Odyssée (mode 'story')
   * @returns {object|null} État initial du combat, ou null si erreur
   */
  function start(onEvent, options = {}) {
    const mode = options.mode || (options.lineId ? 'line' : 'random');
    const { lineId = null, arenaType = null, storyWorld = 1, storySubLevel = 1,
            storyChapter = 0, storyStage = 1 } = options;

    _onEvent = onEvent;
    const state = CWGameState.get();
    const cfg   = state.config;

    // Régénérer l'énergie
    CWGameState.regenEnergy();

    // Vérifier l'énergie (coût spécifique au mode)
    const player = CWGameState.getPlayer();
    const energyCost = cfg.energy.costs?.[mode] ?? cfg.energy.combatCost ?? 10;
    if (cfg.energy.enabled && player.energy.current < energyCost && mode !== 'tutorial') {
      _emit('error', { message: 'Énergie insuffisante !' });
      return null;
    }

    // Combat Full Aléatoire : on tire une équipe au hasard dans la collection du
    // joueur pour ce combat ; l'équipe d'origine sera restaurée à la fin du combat.
    let restoreTeam = null;
    if (mode === 'fullRandom') {
      restoreTeam = [...player.team];
      const randomTeamIds = _pickRandomTeam(cfg.game.maxTeamSize);
      if (randomTeamIds.length === 0) {
        _emit('error', { message: "Aucun personnage débloqué pour composer une équipe !" });
        return null;
      }
      CWGameState.setTeam(randomTeamIds);
    }

    // Combat Event Tag : l'équipe joueur est tirée parmi les persos du tag event uniquement
    if (mode === 'fullEvent') {
      const ev = CWGameState.getActiveEvent?.() ?? null;
      if (!ev) { _emit('error', { message: "Aucun Event actif !" }); return null; }
      restoreTeam = [...player.team];
      const tagPool = player.collection.filter(inst => {
        const def = CWGameState.getCharDef(inst.charId);
        return def?.tags?.includes(ev.tagId);
      });
      if (tagPool.length === 0) {
        CWGameState.setTeam(restoreTeam);
        _emit('error', { message: `Aucun personnage de ce tag dans ta collection !` });
        return null;
      }
      // Mélange Fisher-Yates et sélection jusqu'à maxTeamSize
      const shuffled = [...tagPool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      CWGameState.setTeam(shuffled.slice(0, cfg.game.maxTeamSize).map(inst => inst.instanceId));
    }

    // Construire l'équipe joueur
    const teamInstances = CWGameState.getTeam();
    if (teamInstances.length === 0) {
      if (restoreTeam) CWGameState.setTeam(restoreTeam); // rien à restaurer en pratique ici, mais par sécurité
      _emit('error', { message: "Aucun personnage dans l'équipe !" });
      return null;
    }

    const playerTeam = teamInstances.map(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      return _buildCombatant(inst, def, false);
    });

    // Déterminer l'équipe ennemie selon le mode
    let enemyTeam;
    if (mode === 'line') {
      enemyTeam = _generateEnemyTeamFromLine(lineId);
      if (enemyTeam.length === 0) {
        if (restoreTeam) CWGameState.setTeam(restoreTeam);
        _emit('error', { message: 'Lignée évolutive introuvable ou indisponible !' });
        return null;
      }
    } else if (mode === 'arena') {
      enemyTeam = _generateArenaTeam(arenaType);
      if (enemyTeam.length === 0) {
        if (restoreTeam) CWGameState.setTeam(restoreTeam);
        _emit('error', { message: 'Aucun personnage disponible pour cette arène !' });
        return null;
      }
    } else if (mode === 'story') {
      const esCfg = cfg.game.enemyTeamSize;
      let enemySize;
      if (esCfg.mode === 'fixed') enemySize = esCfg.value;
      else if (esCfg.mode === 'random') enemySize = esCfg.min + Math.floor(Math.random() * (esCfg.max - esCfg.min + 1));
      else enemySize = esCfg.value || 3;

      // Vérifier s'il existe un snapshot de l'équipe ennemie d'un essai précédent
      // pour cette même épreuve (défaite en cours). Si oui, on restaure exactement
      // la même équipe pour garantir des adversaires identiques jusqu'à la victoire.
      const pending = state.player.story?.pendingEnemies;
      if (pending && pending.world === storyWorld && pending.subLevel === storySubLevel) {
        enemyTeam = pending.snapshot.map((s, i) => ({
          ...s,
          instanceId: `enemy_${Date.now()}_${i}`,
          currentHp: s.maxHp,
          alive: true,
          isEnemy: true,
          effects: [],
          passives:        CWGameState.getPassivesForCharacter({ type1: s.type1, type2: s.type2 }),
          extraPassiveIds: [],
          statusEffects:   [],
          tempAtkBuffPercent: 0,
        }));
      } else {
        enemyTeam = _generateStoryEnemyTeam(enemySize, storyWorld, storySubLevel);
        // Sauvegarder le snapshot immédiatement pour les éventuels réessais
        const snapshot = enemyTeam.map(e => ({
          charId: e.charId, level: e.level, rarity: e.rarity,
          type1: e.type1, type2: e.type2, name: e.name, portrait: e.portrait,
          maxHp: e.maxHp, atk: e.atk, def: e.def, spd: e.spd,
          storyEncounterType: e.storyEncounterType, awakening: 0,
        }));
        const playerStory = state.player.story || { world: storyWorld, subLevel: 0 };
        CWGameState.updatePlayer({ story: { ...playerStory, pendingEnemies: { world: storyWorld, subLevel: storySubLevel, snapshot } } });
      }
    } else if (mode === 'tutorial') {
      // Combat tutoriel : 2 ennemis communs, forme de base, niveau 1, sans coût énergie
      const commonBase = state.characters.filter(c =>
        c.rarity === 'common' && (c.evolutionStage ?? 0) === 0
      );
      if (commonBase.length === 0) {
        _emit('error', { message: "Aucun personnage commun disponible pour le tutoriel !" });
        return null;
      }
      const picks = [...commonBase].sort(() => Math.random() - .5).slice(0, 2);
      enemyTeam = picks.map((def, i) => {
        const fakeInst = { instanceId: `tuto_enemy_${i}`, charId: def.id, level: 1, awakening: 0, equipment: null };
        return _buildCombatant(fakeInst, def, true);
      });
    } else if (mode === 'storyMode') {
      // Mode Histoire : nb ennemis et niveau définis par la config du stage
      const chapter   = cfg.storyMode?.chapters?.[storyChapter] || {};
      const stageCfg  = chapter.stages?.[storyStage] || { enemies: 2, level: 1 };
      const nbEnemies = Math.max(1, Math.min(3, stageCfg.enemies));
      const lvl       = Math.max(1, stageCfg.level);

      // Tirer les ennemis en respectant les poids de rareté (common 50, mythic 0.5)
      const allBase = state.characters.filter(c => (c.evolutionStage ?? 0) === 0);
      if (allBase.length === 0) {
        _emit('error', { message: "Aucun personnage disponible pour le Mode Histoire !" });
        return null;
      }
      enemyTeam = [];
      for (let i = 0; i < nbEnemies; i++) {
        const def = _pickWeightedRandomChar(allBase, cfg.enemyRarityWeights, 1);
        const fakeInst = {
          instanceId: `story_enemy_${i}`,
          charId: def.id, level: lvl, awakening: 0, equipment: null,
        };
        enemyTeam.push(_buildCombatant(fakeInst, def, true));
      }
    } else {
      // 'random', 'fullRandom' — génération ennemie standard
      const esCfg = (cfg.game || {}).enemyTeamSize || {};
      let enemySize;
      if (esCfg.mode === 'fixed')        enemySize = esCfg.value;
      else if (esCfg.mode === 'random')  enemySize = esCfg.min + Math.floor(Math.random() * (esCfg.max - esCfg.min + 1));
      else                               enemySize = esCfg.value || 3;

      if (mode === 'event' || mode === 'fullEvent') {
        enemyTeam = _generateEventEnemyTeam();
        if (!enemyTeam.length) {
          if (restoreTeam) CWGameState.setTeam(restoreTeam);
          _emit('error', { message: "Aucune adversaire disponible pour cet Event !" });
          return null;
        }
      } else if (mode === 'record') {
        // Mode Performance : vague d'ennemis générés dans les mêmes conditions
        // d'apparition qu'un combat classique (même tirage de rareté).
        enemyTeam = _generateEnemyTeam(cfg.combat?.recordEnemyCount ?? 3);
      } else {
        enemyTeam = _generateEnemyTeam(enemySize);
      }
    }

    // Consommer l'énergie (pas pour le mode tutorial)
    if (cfg.energy.enabled && mode !== 'tutorial') {
      CWGameState.modifyResources({ energy: -energyCost });
    }

    // Construire l'état du combat
    _battle = {
      turn:         1,
      phase:        'player',
      mode,
      lineId:       lineId || null,
      arenaType:    arenaType || null,
      storyWorld:   mode === 'story' ? storyWorld : null,
      storySubLevel: mode === 'story' ? storySubLevel : null,
      storyChapter: mode === 'storyMode' ? storyChapter : null,
      storyStage:   mode === 'storyMode' ? storyStage   : null,
      restoreTeam,
      playerTeam,
      enemyTeam,
      turnOrder:    [],
      turnIndex:    0,
      currentActor: null,
      log:          [],
      result:       null,
      capturable:   [],
      rewards:      null,
      // Mode Record uniquement : score cumulé, ennemis vaincus, limite de tours
      recordScore:    mode === 'record' ? 0 : null,
      recordKills:    mode === 'record' ? 0 : null,
      recordMaxTurns: mode === 'record' ? (cfg.combat?.recordMaxTurns ?? 15) : null,
    };

    // Mettre à jour les stats de combat
    CWGameState.updatePlayer({
      stats: { ...player.stats, totalBattles: player.stats.totalBattles + 1 },
    });

    _emit('battleStart', { battle: _battle });
    // Différé : laisse l'interface rendre la scène de combat AVANT d'émettre les passifs
    // de début de combat (Mystère). Sans ce délai, le DOM n'existe pas encore et
    // l'animation ne peut pas trouver les cartes fighter-xxx.
    // Le round démarre après les passifs de début (qui peuvent durer ~3.5s si Mystère).
    setTimeout(() => {
      _initBattlePassives();
      // Le round commence après les passifs de début. On attend 3600ms pour laisser
      // l'animation Mystère se terminer si elle s'est déclenchée.
      const hasMysterePending = [..._battle.playerTeam, ..._battle.enemyTeam].some(c =>
        c.extraPassiveIds?.length > 0
      );
      setTimeout(() => _startRound(), hasMysterePending ? 3650 : 50);
    }, 200);
    return _battle;
  }

  // ─── DÉROULEMENT DU COMBAT ────────────────────────────────────────────────────

  /**
   * Construit l'ordre d'action de la manche : tous les combattants vivants
   * (alliés ET ennemis confondus), triés par vitesse décroissante.
   * En cas d'égalité de vitesse, l'ordre est départagé aléatoirement.
   */
  function _buildTurnOrder() {
    const all = [..._battle.playerTeam, ..._battle.enemyTeam].filter(c => c.alive);
    return all
      .map(c => ({ instanceId: c.instanceId, isEnemy: c.isEnemy, spd: c.spd, _r: Math.random() }))
      .sort((a, b) => (b.spd - a.spd) || (a._r - b._r))
      .map(({ instanceId, isEnemy }) => ({ instanceId, isEnemy }));
  }

  function _findCombatant(instanceId, isEnemy) {
    const team = isEnemy ? _battle.enemyTeam : _battle.playerTeam;
    return team.find(c => c.instanceId === instanceId);
  }

  /** Démarre une nouvelle manche : recalcule l'ordre de vitesse et lance le premier acteur */
  function _startRound() {
    if (!_battle) return;
    _battle.turnOrder = _buildTurnOrder();
    _battle.turnIndex = 0;
    _emit('roundStart', { turn: _battle.turn, battle: _battle });
    setTimeout(_advanceTurn, 0); // setTimeout pour couper la chaîne d'appels et libérer la pile
  }

  /**
   * Fait avancer la file d'action d'un cran :
   * - si c'est un ennemi, l'IA agit automatiquement (avec un court délai pour l'animation)
   * - si c'est un allié, on attend l'action du joueur via playerAttack()
   * - si la manche est terminée, on en démarre une nouvelle
   */
  function _advanceTurn() {
    if (!_battle) return;

    // ── Garde-fou : combat trop long (ex. passifs de soin infinis) ───────────────
    const MAX_TURNS = 200;
    if (_battle.turn > MAX_TURNS) {
      _endBattle('defeat'); // nul / défaite par épuisement
      return;
    }

    if (_battle.turnIndex >= _battle.turnOrder.length) {
      _battle.turn++;
      _startRound();
      return;
    }

    const entry      = _battle.turnOrder[_battle.turnIndex];
    const combatant  = _findCombatant(entry.instanceId, entry.isEnemy);

    // Combattant déjà KO entre-temps : passe au suivant via setTimeout pour ne pas empiler les appels
    if (!combatant || !combatant.alive) {
      _battle.turnIndex++;
      setTimeout(_advanceTurn, 0);
      return;
    }

    // ── Poison : tic de dégâts en tout début de tour ──────────────────────────
    _tickPoison(combatant);
    if (!combatant.alive) {
      _battle.turnIndex++;
      if (_checkBattleEnd()) return;
      setTimeout(_advanceTurn, 0);
      return;
    }

    // ── Paralysie : le combattant passe entièrement son tour ──────────────────
    if (_checkAndConsumeParalysis(combatant)) {
      _battle.turnIndex++;
      if (_checkBattleEnd()) return;
      setTimeout(_advanceTurn, 600);
      return;
    }

    if (entry.isEnemy) {
      _battle.phase        = 'enemy';
      _battle.currentActor = combatant.instanceId;

      // Mode Record : les ennemis n'attaquent jamais, leur tour passe sans rien faire
      if (_battle.mode === 'record') {
        _battle.turnIndex++;
        if (_checkBattleEnd()) return;
        setTimeout(_advanceTurn, 150);
        return;
      }

      const players = _battle.playerTeam.filter(p => p.alive);
      if (players.length === 0) { _checkBattleEnd(); return; }

      const chosenTarget = _aiChooseTarget(combatant, players);
      if (chosenTarget) {
        // Hypnose : si l'ennemi est charmé, sa cible est redirigée vers un coéquipier
        const target = _checkCharmRedirect(combatant) || chosenTarget;
        _processPreAttack(combatant);
        const result = _executeAttack(combatant, target);
        _logAction(combatant, target, result);
        _emit('enemyAttack', { attacker: combatant, target, result });
        if (!result.evaded && target.alive && result.damage > 0) {
          _processPostDamageCounter(target, combatant);
        }
      }

      _processEndOfTurn(combatant);

      _battle.turnIndex++;
      if (_checkBattleEnd()) return;
      setTimeout(_advanceTurn, 750);
    } else {
      _battle.phase        = 'player';
      _battle.currentActor = combatant.instanceId;
      _emit('playerTurn', { actor: combatant, battle: _battle });
      // On attend ici l'appel à playerAttack() depuis l'interface
    }
  }

  /**
   * Exécute l'action du personnage allié dont c'est actuellement le tour
   * @param {string} attackerInstanceId - ID de l'attaquant joueur (doit être l'acteur courant)
   * @param {string} targetInstanceId   - ID de la cible ennemie
   */
  function playerAttack(attackerInstanceId, targetInstanceId) {
    if (!_battle || _battle.phase !== 'player') return;
    if (_battle.currentActor !== attackerInstanceId) return;

    const attacker = _battle.playerTeam.find(c => c.instanceId === attackerInstanceId && c.alive);
    const chosenTarget = _battle.enemyTeam.find(c => c.instanceId === targetInstanceId && c.alive);

    if (!attacker || !chosenTarget) return;

    // Hypnose : si le joueur est charmé, l'attaque est redirigée vers un coéquipier
    const target = _checkCharmRedirect(attacker) || chosenTarget;
    _processPreAttack(attacker);
    const result = _executeAttack(attacker, target);
    _logAction(attacker, target, result);
    _emit('playerAttack', { attacker, target, result });
    if (!result.evaded && target.alive && result.damage > 0) {
      _processPostDamageCounter(target, attacker);
    }

    // Mode Record : chaque point de dégât infligé par le joueur = 1 point de score
    if (_battle.mode === 'record' && result.damage > 0) {
      _battle.recordScore = (_battle.recordScore || 0) + result.damage;
    }

    _processEndOfTurn(attacker);

    _battle.turnIndex++;
    if (_checkBattleEnd()) return;
    setTimeout(_advanceTurn, 750);
  }

  /**
   * IA : choisit la cible optimale pour un ennemi
   * Priorité : faiblesse élémentaire > dégâts max > n'importe qui
   */
  /**
   * Choisit la cible d'une attaque ennemie. 75% du temps, choisit tactiquement
   * la meilleure cible (dégâts pondérés par l'efficacité de type + bonus coup
   * fatal) ; 25% du temps, attaque une cible aléatoire parmi les vivantes.
   */
  function _aiChooseTarget(attacker, targets) {
    const alive = targets.filter(t => t.alive);
    if (alive.length === 0) return targets[0] || null;

    // 25% du temps : attaque aléatoire plutôt que le meilleur choix tactique
    if (Math.random() < 0.25) {
      return alive[Math.floor(Math.random() * alive.length)];
    }

    const state  = CWGameState.get();
    const matrix = state.typeMatrix;

    let best     = null;
    let bestScore = -1;

    for (const target of alive) {
      const mult  = CWGameDatabase.getBestTypeEffectiveness(attacker.type1, attacker.type2, target.type1, target.type2, matrix);
      const dmg   = Math.max(1, attacker.atk - target.def) * mult;
      // Score : dégâts pondérés + bonus si coup fatal
      const score = dmg + (dmg >= target.currentHp ? 10000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = target;
      }
    }
    return best || alive[0];
  }

  /**
   * Calcule et applique les dégâts d'une attaque
   *
   * Formule : Charisme² / (Charisme + Prestance)
   *   → garantit des dégâts significatifs même contre une haute DEF
   *   → un ennemi avec DEF = ATK reçoit encore ~50% des dégâts max
   *   → un ennemi avec DEF = 0 reçoit 100% (ATK), DEF = ATK → 50%, DEF = 3×ATK → 25%
   *
   * Variance  : ±5% aléatoire sur le résultat final
   * Critique  : chance basée sur la VIT de l'attaquant → spd / (spd + critDivisor)
   *             multiplicateur : critMultiplier (défaut ×1.5)
   *
   * @param {object} attacker
   * @param {object} target
   * @returns {{ damage, multiplier, critical, evaded, variance }}
   */
  function _executeAttack(attacker, target) {
    const state  = CWGameState.get();
    const cfg    = state.config.combat;
    const matrix = state.typeMatrix;

    // ── Passifs : buff d'ATK temporaire (Ardente) consommé dès la tentative d'attaque ──
    const atkBuffPercent = attacker.tempAtkBuffPercent || 0;
    attacker.tempAtkBuffPercent = 0;

    // ── Efficacité de type ──────────────────────────────────────────────────
    const mult = CWGameDatabase.getBestTypeEffectiveness(attacker.type1, attacker.type2, target.type1, target.type2, matrix);

    // ── Esquive via vitesse (cap configurable) + bonus passif (Adorable) ────
    const spdDiff    = target.spd - attacker.spd;
    const adorable    = _findPassive(target, 'stat_boost_evasion');
    const evasionBonus = (adorable?.params?.percent || 0) / 100;
    const evadeChance = Math.min(cfg.speedEvasionCap, Math.max(0, spdDiff / 9999)) + evasionBonus;
    if (Math.random() < evadeChance) {
      return { damage: 0, multiplier: mult, critical: false, evaded: true, variance: 0 };
    }

    // ── Formule de dégâts : ATK² / (ATK + DEF) ─────────────────────────────
    // Avec un plancher à 1 pour ATK et DEF afin d'éviter la division par zéro
    const atk    = Math.max(1, attacker.atk * (1 + atkBuffPercent / 100));
    const def    = Math.max(0, target.def);
    const baseDmg = (atk * atk) / (atk + def);

    // ── Variance ±5% ────────────────────────────────────────────────────────
    const variancePct = (Math.random() * 0.10) - 0.05;   // −5 % à +5 %
    const afterVariance = baseDmg * (1 + variancePct);

    // ── Coup critique (basé sur VIT de l'attaquant) + bonus passif (Scénique) ──
    const critDivisor    = cfg.critDivisor    ?? 200;   // plus bas → plus de crits
    const scenique        = _findPassive(attacker, 'stat_boost_crit_damage');
    const critMultiplier  = (cfg.critMultiplier ?? 1.5) + (scenique?.params?.percent || 0) / 100;
    const critChance     = attacker.spd / (attacker.spd + critDivisor);
    const critical       = Math.random() < critChance;
    const critFactor     = critical ? critMultiplier : 1;

    // ── Bonus joueur vs ennemi ───────────────────────────────────────────────
    // Le joueur bénéficie d'un léger avantage structurel
    const playerBonus = (!attacker.isEnemy && target.isEnemy) ? (cfg.playerDmgBonus ?? 1.15) : 1;
    const enemyPenalty = (attacker.isEnemy && !target.isEnemy) ? (cfg.enemyDmgPenalty ?? 0.80) : 1;

    // ── Calcul final ────────────────────────────────────────────────────────
    const rawDamage = afterVariance * mult * critFactor * playerBonus * enemyPenalty;
    const damage    = Math.max(cfg.minDamage ?? 1, Math.floor(rawDamage));

    const hpBefore        = target.currentHp;
    target.currentHp = Math.max(0, target.currentHp - damage);
    const hpAfter         = target.currentHp;
    if (target.currentHp <= 0) {
      target.alive     = false;
      target.currentHp = 0;
      if (!attacker.isEnemy && target.isEnemy) {
        // Stat personnage : kills
        const inst = CWGameState.getPlayerChar(attacker.instanceId);
        if (inst) inst.enemiesDefeated = (inst.enemiesDefeated || 0) + 1;
        // Quête event : éliminer des rivales du tag
        const ev = CWGameState.getActiveEvent?.() ?? null;
        if (ev) {
          const def = CWGameState.getCharDef?.(target.charId);
          if (def?.tags?.includes(ev.tagId)) {
            CWGameState.trackEventQuestProgress?.('event_defeat');
          }
        }
      }
    }

    // ── Passifs déclenchés au contact (Présence/paralysie, Caractérielle/poison,
    // Hypnose/charme) : uniquement sur un coup qui touche une cible encore en vie ──
    if (target.alive) {
      const presence = _findPassive(attacker, 'on_hit_paralyze');
      if (presence && !_hasStatus(target, 'paralysis') && _rollChance(presence.params.chance)) {
        _applyStatus(target, 'paralysis', {});
        _battle.log.push(`✨ ${attacker.name} utilise Présence sur ${target.name} : paralysie !`);
        _emit('passiveTriggered', {
          combatantId: attacker.instanceId, isEnemy: attacker.isEnemy,
          passiveId: presence.id, passiveName: presence.name,
          message: `${attacker.name} utilise Présence !`,
          extra: { statusType: 'paralysis', targetId: target.instanceId },
        });
      }

      const caracterielle = _findPassive(attacker, 'on_hit_poison');
      if (caracterielle && !_hasStatus(target, 'poison') && _rollChance(caracterielle.params.chance)) {
        _applyStatus(target, 'poison', {
          turnsLeft: caracterielle.params.duration,
          damagePercentMaxHp: caracterielle.params.damagePercentMaxHp,
        });
        _battle.log.push(`☠️ ${attacker.name} utilise Caractérielle sur ${target.name} : empoisonnement !`);
        _emit('passiveTriggered', {
          combatantId: attacker.instanceId, isEnemy: attacker.isEnemy,
          passiveId: caracterielle.id, passiveName: caracterielle.name,
          message: `${attacker.name} utilise Caractérielle !`,
          extra: { statusType: 'poison', targetId: target.instanceId },
        });
      }

      const hypnose = _findPassive(attacker, 'on_hit_charm');
      if (hypnose && !_hasStatus(target, 'charm') && _rollChance(hypnose.params.chance)) {
        _applyStatus(target, 'charm', {});
        _battle.log.push(`💞 ${attacker.name} utilise Hypnose sur ${target.name} : charme !`);
        _emit('passiveTriggered', {
          combatantId: attacker.instanceId, isEnemy: attacker.isEnemy,
          passiveId: hypnose.id, passiveName: hypnose.name,
          message: `${attacker.name} utilise Hypnose !`,
          extra: { statusType: 'charm', targetId: target.instanceId },
        });
      }
    }

    return { damage, multiplier: mult, critical, evaded: false, variance: Math.round(variancePct * 100), hpBefore, hpAfter };
  }

  // ─── FIN DE COMBAT ────────────────────────────────────────────────────────────

  /**
   * Vérifie si le combat est terminé
   * @returns {boolean} true si combat terminé
   */
  function _checkBattleEnd() {
    if (!_battle) return true;

    // Mode Record : pas de victoire/défaite classique — les ennemis vaincus
    // sont immédiatement remplacés, le combat se termine uniquement après le
    // nombre de tours prévu.
    if (_battle.mode === 'record') {
      _recordReplaceDeadEnemies();
      if (_battle.turn > (_battle.recordMaxTurns || 15)) {
        _endRecordBattle();
        return true;
      }
      return false;
    }

    const playerAlive = _battle.playerTeam.some(c => c.alive);
    const enemyAlive  = _battle.enemyTeam.some(c => c.alive);

    if (!playerAlive) {
      _endBattle('defeat');
      return true;
    }
    if (!enemyAlive) {
      _endBattle('victory');
      return true;
    }
    return false;
  }

  /**
   * Mode Record uniquement : remplace immédiatement tout ennemi vaincu par un
   * nouvel ennemi généré dans les mêmes conditions d'apparition qu'un combat
   * classique, et accorde le bonus de score par ennemi vaincu.
   */
  function _recordReplaceDeadEnemies() {
    if (!_battle || _battle.mode !== 'record') return;
    const cfg = CWGameState.get().config.combat;
    const killBonus = cfg.recordKillBonus ?? 100;

    _battle.enemyTeam.forEach((e, idx) => {
      if (e.alive) return;
      _battle.recordScore = (_battle.recordScore || 0) + killBonus;
      _battle.recordKills = (_battle.recordKills || 0) + 1;
      const replacement = _generateEnemyTeam(1)[0];
      if (!replacement) return;
      replacement.instanceId = `enemy_${Date.now()}_${idx}_${Math.floor(Math.random() * 100000)}`;
      _battle.enemyTeam[idx] = replacement;
      _emit('recordEnemyReplaced', { index: idx, oldInstanceId: e.instanceId, newEnemy: replacement, score: _battle.recordScore, kills: _battle.recordKills });
    });
  }

  /**
   * Conclut un combat en mode Record : calcule le score final, met à jour le
   * record personnel du joueur si dépassé, et distribue les récompenses selon
   * les paliers de score (indépendant des récompenses de combat classiques).
   */
  function _endRecordBattle() {
    if (!_battle) return;
    _battle.phase  = 'end';
    _battle.result = 'record';

    if (_battle.restoreTeam) CWGameState.setTeam(_battle.restoreTeam);

    const finalScore = _battle.recordScore || 0;
    const finalKills = _battle.recordKills || 0;
    const recordInfo = CWGameState.registerRecordScore(finalScore);

    _battle.rewards = {
      recordScore:  finalScore,
      recordKills:  finalKills,
      isNewBest:    recordInfo.isNewBest,
      previousBest: recordInfo.previousBest,
    };

    _emit('record', { battle: _battle, rewards: _battle.rewards });
  }

  /**
   * Conclut le combat et calcule les récompenses
   * @param {'victory'|'defeat'} result
   */
  function _endBattle(result) {
    if (!_battle) return;
    _battle.phase  = 'end';
    _battle.result = result;

    // Combat Full Aléatoire : on restaure l'équipe d'origine du joueur maintenant
    // que le combat est terminé (gagné ou perdu).
    if (_battle.restoreTeam) {
      CWGameState.setTeam(_battle.restoreTeam);
    }

    const state  = CWGameState.get();
    const cfg    = state.config;

    if (result === 'victory') {
      // Mode Odyssée : enregistrer la progression et effacer le snapshot d'ennemis
      if (_battle.mode === 'story' && _battle.storyWorld != null && _battle.storySubLevel != null) {
        CWGameState.completeStoryLevel(_battle.storyWorld, _battle.storySubLevel);
        // completeStoryLevel met déjà à jour player.story — on y efface aussi pendingEnemies
        const s = CWGameState.getPlayer().story || {};
        CWGameState.updatePlayer({ story: { ...s, pendingEnemies: null } });
      }

      // XP, pièces d'or et diamants — montants configurables depuis l'administration
      const xpEarned  = Math.floor(_battle.enemyTeam.reduce((s, e) => {
        const baseXp    = e.level * cfg.combat.rewardXpPerEnemy;
        const bonusPct  = cfg.combat.enemyXpBonusByRarity?.[e.rarity] || 0;
        return s + baseXp * (1 + bonusPct / 100);
      }, 0));
      let gold     = Math.floor(_battle.enemyTeam.length * cfg.combat.rewardGoldPerEnemy);
      let diamonds = Math.floor(_battle.enemyTeam.length * cfg.combat.rewardDiamondsPerEnemy);

      // Bonus Élite / Boss en mode Odyssée
      let eliteBonusGold = 0;
      let bossBonusDiamonds = 0;
      if (_battle.mode === 'story' && _battle.storySubLevel != null) {
        const storyCfg    = cfg.combat?.story || {};
        const eliteSubs   = storyCfg.eliteSubLevels || [10, 20];
        const bossSub     = storyCfg.bossSubLevel    || 25;
        const rewardElite = storyCfg.rewardEliteGold      ?? 100;
        const rewardBoss  = storyCfg.rewardBossDiamonds   ?? 100;
        const isElite = eliteSubs.includes(_battle.storySubLevel);
        const isBoss  = _battle.storySubLevel === bossSub;
        if (isBoss)  { bossBonusDiamonds = rewardBoss;  diamonds += bossBonusDiamonds; }
        else if (isElite) { eliteBonusGold = rewardElite; gold += eliteBonusGold; }
      }

      // Distribuer XP
      const levelUps = {};
      _battle.playerTeam.forEach(combatant => {
        if (combatant.alive) {
          const res = CWGameState.addXpToCharacter(combatant.instanceId, xpEarned);
          if (res?.levelUps?.length) levelUps[combatant.instanceId] = res;
        }
      });

      // XP joueur : gagnée par ennemi éliminé en combat (distincte de l'XP des créatures)
      const playerXpPerEnemy = cfg.playerLevel?.xpPerEnemyKill || 0;
      const playerXpEarned = _battle.enemyTeam.length * playerXpPerEnemy;
      const playerLevelResult = playerXpEarned > 0 ? CWGameState.addXpToPlayer(playerXpEarned) : null;

      // Ressources
      CWGameState.modifyResources({ crystals: diamonds, gold });

      // Drop d'objet : 1% de chance par ennemi vaincu d'obtenir une Potion d'Énergie
      const ENERGY_POTION_DROP_RATE = 0.01;
      let energyPotionsDropped = 0;
      _battle.enemyTeam.forEach(() => {
        if (Math.random() < ENERGY_POTION_DROP_RATE) energyPotionsDropped++;
      });
      if (energyPotionsDropped > 0) {
        const p = CWGameState.getPlayer();
        const inv = { ...(p.inventory || {}) };
        inv['item_energy_potion'] = (inv['item_energy_potion'] || 0) + energyPotionsDropped;
        CWGameState.updatePlayer({ inventory: inv });
      }

      // Possibilité de capture : fusionner les ennemis identiques (même personnage)
      // en un seul choix, avec une probabilité doublée à chaque exemplaire "virtuel"
      // (ex. 4 exemplaires → taux de base × 2⁴ au lieu de 4 choix séparés au taux de base).
      // Une forme évoluée compte pour 2 exemplaires virtuels par stade d'évolution
      // (la forme de base, stade 0, compte normalement pour 1 ; une 3e évolution
      // compte donc pour 6, conformément à la règle demandée). Taux plafonné à 50%.
      const groupedByChar = {};
      _battle.enemyTeam.forEach(enemy => {
        if (!groupedByChar[enemy.charId]) groupedByChar[enemy.charId] = [];
        groupedByChar[enemy.charId].push(enemy);
      });
      _battle.capturable = Object.values(groupedByChar).map(group => {
        const charDef = CWGameState.getCharDef(group[0].charId);
        const stage = charDef?.evolutionStage || 0;
        const perEntryWeight = stage === 0 ? 1 : 2 * stage;
        const virtualCount = group.length * perEntryWeight;
        // -1 sur l'exposant : un seul exemplaire (rien à fusionner) ne doit donner
        // aucun bonus et garder le taux de base tel quel (2⁰ = ×1).
        const mergedRate = Math.min(0.5, cfg.combat.captureBaseRate * Math.pow(2, Math.max(0, virtualCount - 1)));
        return {
          ...group[0],
          captureRate: mergedRate,
          mergedCount: group.length,
        };
      });

      // Mettre à jour les stats victoires
      const player = CWGameState.getPlayer();
      // Statistiques victoire
      const streak = (player.stats.currentWinStreak || 0) + 1;
      CWGameState.updatePlayer({
        stats: {
          ...player.stats,
          totalVictories:    (player.stats.totalVictories    || 0) + 1,
          totalKills:        (player.stats.totalKills        || 0) + _battle.enemyTeam.length,
          totalGoldEarned:   (player.stats.totalGoldEarned   || 0) + gold,
          totalCrystalsEarned: (player.stats.totalCrystalsEarned || 0) + diamonds,
          currentWinStreak:  streak,
          longestWinStreak:  Math.max(player.stats.longestWinStreak || 0, streak),
        },
      });

      // Stats par personnage : battlesWon sur les survivants (enemiesDefeated géré au coup par coup)
      _battle.playerTeam.filter(c => !c.isEnemy && c.alive).forEach(combatant => {
        const inst = CWGameState.getPlayerChar(combatant.instanceId);
        if (inst) inst.battlesWon = (inst.battlesWon || 0) + 1;
      });

      // Quêtes quotidiennes : ennemis vaincus (cumulatif) + victoire par mode de combat
      CWGameState.trackQuestProgress('defeat_enemies', _battle.enemyTeam.length);
      if (_battle.mode === 'line') CWGameState.trackQuestProgress('win_line_combat');
      else if (_battle.mode === 'fullRandom') CWGameState.trackQuestProgress('win_full_random_combat');
      else if (_battle.mode === 'story') CWGameState.trackQuestProgress('win_odyssey_combat');
      else if (_battle.mode === 'event') CWGameState.trackEventQuestProgress?.('event_win');
      else if (_battle.mode === 'fullEvent') {
        CWGameState.trackEventQuestProgress?.('event_win');
        CWGameState.trackEventQuestProgress?.('event_win_tag');
      }

      _battle.rewards = { xpEarned, gold, diamonds, levelUps, energyPotionsDropped, playerXpEarned, playerLevelResult, eliteBonusGold, bossBonusDiamonds };
      _emit('victory', { battle: _battle, rewards: _battle.rewards });

    } else {
      const playerDef = CWGameState.getPlayer();
      CWGameState.updatePlayer({
        stats: {
          ...playerDef.stats,
          totalDefeats:     (playerDef.stats.totalDefeats     || 0) + 1,
          currentWinStreak: 0,
        },
      });
      _emit('defeat', { battle: _battle });
    }
  }

  /**
   * Tente de capturer un ennemi vaincu
   * @param {string} enemyInstanceId
   * @returns {{ success: boolean, result: object }}
   */
  function attemptCapture(enemyInstanceId) {
    if (!_battle || _battle.result !== 'victory') return null;

    const capturable = _battle.capturable.find(c => c.instanceId === enemyInstanceId && !c.captured);
    if (!capturable) return null;

    const success = Math.random() < capturable.captureRate;
    if (success) {
      capturable.captured = true;
      const addResult = CWGameState.addCharacterToCollection(capturable.charId, 'combat');
      const player = CWGameState.getPlayer();
      CWGameState.updatePlayer({
        stats: { ...player.stats, totalCaptures: player.stats.totalCaptures + 1 },
      });
      CWGameState.updatePlayer({
        stats: {
          ...CWGameState.getPlayer().stats,
          totalCaptures: (CWGameState.getPlayer().stats.totalCaptures || 0) + 1,
        },
      });
      CWGameState.trackQuestProgress('capture_character');
      _emit('capture', { success: true, charId: capturable.charId, addResult });
      return { success: true, addResult };
    } else {
      _emit('capture', { success: false, charId: capturable.charId });
      return { success: false };
    }
  }

  // ─── UTILITAIRES ─────────────────────────────────────────────────────────────

  function _logAction(attacker, target, result) {
    if (!_battle) return;
    let msg;
    if (result.evaded) {
      msg = `💨 ${target.name} esquive l'attaque de ${attacker.name} !`;
    } else {
      const critText = result.critical ? ' 💥 CRITIQUE !' : '';
      // La variance ±5% (result.variance) reste appliquée au calcul des dégâts,
      // mais n'est volontairement plus affichée dans le résumé de combat.
      const effText  = result.multiplier >= 2.0 ? ' ⚡ Super efficace !' :
                       result.multiplier <= 0.5 && result.multiplier > 0 ? ' 🔽 Peu efficace...' :
                       result.multiplier === 0 ? ' ❌ Aucun effet !' : '';
      const hpLeft   = target.alive ? ` [${target.currentHp}♥]` : ` 💀 KO !`;
      msg = `${attacker.isEnemy ? '👹' : '⚔️'} ${attacker.name} → ${target.name} : ${result.damage} dégâts${critText}${effText}${hpLeft}`;
    }
    _battle.log.push(msg);
    if (_battle.log.length > 50) _battle.log.shift();
  }

  function _emit(event, data = {}) {
    if (_onEvent) {
      try { _onEvent(event, data); } catch (e) { console.error('[CWCombatEngine] Event error:', e); }
    }
  }

  /** Retourne l'état courant du combat */
  const getBattle = () => _battle;

  /** Réinitialise le combat */
  const reset = () => { _battle = null; };

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return { start, playerAttack, attemptCapture, getBattle, reset, _aiChooseTarget, _computePowerProfile };
})();
