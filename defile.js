/**
 * ============================================================
 * DEFILE.JS — Moteur du mode Défilé
 * Duel de popularité : 9 passages jugés sur une stat + un type, chaque
 * personnage défile 3 fois, 3 Talents (un par personnage) placés sur les
 * passages de son choix. Aucun PV ni KO — uniquement un score cumulé,
 * comparé à la fin pour déterminer la gagnante.
 * ============================================================
 */

'use strict';

const CWDefileEngine = (() => {

  const STAT_KEYS = ['atk', 'def', 'spd'];

  // ─── GÉNÉRATION DU PROGRAMME ────────────────────────────────────────────────

  /** Tire les 9 (ou N) passages du programme : une stat + un type au hasard chacun */
  function generateProgramme(cfg, types) {
    const count = cfg.defilePassageCount ?? 9;
    const typeIds = types.map(t => t.id);
    const programme = [];
    for (let i = 0; i < count; i++) {
      programme.push({
        round: i + 1,
        stat: STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)],
        typeId: typeIds[Math.floor(Math.random() * typeIds.length)],
      });
    }
    return programme;
  }

  /**
   * Construit un "combattant défilé" à partir d'une instance possédée et de
   * ses stats finales déjà calculées (cf. CWGameState.getCharacterFinalStats).
   */
  function buildFighter(inst, def, finalStats, cfg) {
    return {
      instanceId:   inst.instanceId,
      charId:       def.id,
      name:         def.name,
      type1:        def.type1,
      type2:        def.type2,
      atk:          finalStats.atk,
      def:          finalStats.def,
      spd:          finalStats.spd,
      enduranceMax: finalStats.hp,
      endurance:    (cfg.defileStartEndurancePct ?? 50), // en %, propre à CE duel
      talentUsed:   false,
    };
  }

  // ─── ASSIGNATION AUTOMATIQUE (IA adverse) ───────────────────────────────────

  /** Score prévisionnel d'une personnage sur un passage (sans variance/talents) */
  function _estimateScore(fighter, passage, matrix) {
    const mult = CWGameDatabase.getBestTypeEffectiveness(fighter.type1, fighter.type2, passage.typeId, null, matrix);
    return fighter[passage.stat] * mult;
  }

  /**
   * Assigne automatiquement une équipe de 3 aux 9 passages (3 fois chacune),
   * en plaçant à chaque fois la meilleure personnage encore disponible sur le
   * passage le plus disputé. Puis répartit les 3 Talents au hasard.
   * @returns {Array<{instanceId, talentTypeId}|null>} un slot par passage
   */
  function autoAssign(programme, team, matrix, usesPerChar) {
    const usesLeft = {}; team.forEach(f => usesLeft[f.instanceId] = usesPerChar);
    const assignment = new Array(programme.length).fill(null);

    const order = [...programme].sort((a, b) => {
      const sa = team.map(f => _estimateScore(f, a, matrix)).sort((x, y) => y - x);
      const sb = team.map(f => _estimateScore(f, b, matrix)).sort((x, y) => y - x);
      return ((sb[0] || 0) - (sb[1] || 0)) - ((sa[0] || 0) - (sa[1] || 0));
    });

    order.forEach(p => {
      const candidates = team.filter(f => usesLeft[f.instanceId] > 0);
      if (!candidates.length) return;
      let best = candidates[0], bestScore = -Infinity;
      candidates.forEach(f => {
        const s = _estimateScore(f, p, matrix);
        if (s > bestScore) { bestScore = s; best = f; }
      });
      assignment[p.round - 1] = { instanceId: best.instanceId, talentTypeId: null };
      usesLeft[best.instanceId]--;
    });

    // Répartit les 3 Talents (un par personnage de l'équipe) sur 3 passages
    // au hasard parmi ceux où cette personnage est justement programmée.
    team.forEach(f => {
      const eligibleRounds = assignment
        .map((a, idx) => (a && a.instanceId === f.instanceId) ? idx : -1)
        .filter(idx => idx >= 0);
      if (eligibleRounds.length) {
        const chosen = eligibleRounds[Math.floor(Math.random() * eligibleRounds.length)];
        assignment[chosen].talentTypeId = f.type1;
      }
    });

    return assignment;
  }

  // ─── RÉSOLUTION DU DUEL ─────────────────────────────────────────────────────

  /**
   * Résout l'intégralité du duel, passage par passage, dans l'ordre.
   * @param {object} programme - cf. generateProgramme()
   * @param {Array} playerAssignment / enemyAssignment - un slot par passage
   * @param {Array} playerTeam / enemyTeam - combattants construits (buildFighter)
   * @param {object} cfg - config.combat
   * @param {object} matrix - table d'affinité de types
   * @param {object} [choices] - choix interactifs du joueur pour ses propres
   *        Talents (facultatif ; repli automatique si absent) :
   *        { mystiqueSwapRounds: { [round]: [roundCible1, roundCible2] },
   *          legendeCopyTypeId: 'Rebelle' }
   * @returns {{ log: Array, playerTotal: number, enemyTotal: number, winner: 'player'|'enemy'|'tie' }}
   */
  function resolveDuel(programme, playerAssignment, enemyAssignment, playerTeam, enemyTeam, cfg, matrix, choices = {}) {
    const byId = {};
    [...playerTeam, ...enemyTeam].forEach(f => byId[f.instanceId] = f);

    const rounds = programme.length;
    const playerScores = new Array(rounds).fill(0);
    const enemyScores  = new Array(rounds).fill(0);
    const log = [];

    // (le retournement d'Amazone est désormais décidé au cas par cas, cf. reversalInfo dans la boucle)

    const enduranceLoss = cfg.defileEnduranceLossPct ?? 15;
    const enduranceGain = cfg.defileEnduranceGainPct ?? 15;
    // (plus de facteur configurable ici — formule fixée en dur, cf. computeSideScore)

    // Talent copié par une éventuelle Légende (choisi AVANT toute planification)
    const legendeCopy = choices.legendeCopyTypeId || null;

    function talentOf(typeId) {
      if (typeId === 'Legende' && legendeCopy) return CWGameDatabase.getDefileTalentDisplay(legendeCopy, cfg);
      return CWGameDatabase.getDefileTalentDisplay(typeId, cfg);
    }

    const STAT_LABEL = { atk: 'Charisme', def: 'Prestance', spd: 'Grâce' };

    function computeSideScore(fighter, statKey, typeId) {
      const statValue = Math.ceil(fighter[statKey]);
      const mult = CWGameDatabase.getBestTypeEffectiveness(fighter.type1, fighter.type2, typeId, null, matrix);
      return { statValue, mult };
    }

    for (let i = 0; i < rounds; i++) {
      const passage = programme[i];
      let pSlot = playerAssignment[i];
      let eSlot = enemyAssignment[i];
      let pFighter = pSlot ? byId[pSlot.instanceId] : null;
      let eFighter = eSlot ? byId[eSlot.instanceId] : null;
      const entry = { round: passage.round, stat: passage.stat, typeId: passage.typeId, events: [] };

      let pTalentId = pSlot?.talentTypeId || null;
      let eTalentId = eSlot?.talentTypeId || null;
      let pTalent = pTalentId ? talentOf(pTalentId) : null;
      let eTalent = eTalentId ? talentOf(eTalentId) : null;

      /** Relit les combattantes/talents de CE tournage — nécessaire après un
       * éventuel échange de Mystique, qui peut remplacer qui défile ici même. */
      function refreshCurrentRound() {
        pSlot = playerAssignment[i]; eSlot = enemyAssignment[i];
        pFighter = pSlot ? byId[pSlot.instanceId] : null;
        eFighter = eSlot ? byId[eSlot.instanceId] : null;
        pTalentId = pSlot?.talentTypeId || null; eTalentId = eSlot?.talentTypeId || null;
        pTalent = pTalentId ? talentOf(pTalentId) : null; eTalent = eTalentId ? talentOf(eTalentId) : null;
      }

      let _currentStage = 0;
      function pushEvt(text, reversed = false) {
        entry.events.push({ text, stage: _currentStage, reversed, playerScoreAfter: null, enemyScoreAfter: null });
      }

      // ═══ ÉTAPE 0 — déclenchements en tout DÉBUT de tournage ═══════════════════

      // Mystique résout EN TOUT PREMIER : elle peut remplacer qui défile sur
      // CE tournage même, donc tout ce qui suit doit se baser sur l'état
      // d'ASSIGNATION à jour, pas sur celui d'avant l'échange.
      function resolveMystique(isPlayerSide, talent) {
        if (!talent || talent.effect !== 'swap_enemy_future_rounds') return;
        const targetSide = isPlayerSide ? enemyAssignment : playerAssignment;
        const futureRounds = targetSide.map((s, idx) => idx).filter(idx => idx > i && targetSide[idx]);
        const preChoice = choices.mystiqueSwapRounds?.[passage.round];
        let r1, r2;
        // r1 EST le passage actuel par définition (celui où Mystique agit) —
        // seul r2 (le passage cible choisi par le joueur) doit être validé
        // comme réellement ultérieur et occupé côté adverse.
        if (preChoice && (preChoice[0] - 1) === i && futureRounds.includes(preChoice[1] - 1)) {
          r1 = i; r2 = preChoice[1] - 1;
        } else if (futureRounds.length >= 1) {
          r1 = i; r2 = futureRounds[Math.floor(Math.random() * futureRounds.length)];
        }
        if (r1 !== undefined && r2 !== undefined && targetSide[r1]) {
          const tmp = targetSide[r1]; targetSide[r1] = targetSide[r2]; targetSide[r2] = tmp;
          pushEvt(`🪄 ${talent.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — passages ${r1 + 1} et ${r2 + 1} adverses échangés`);
        }
      }
      if (pTalent?.effect === 'swap_enemy_future_rounds') resolveMystique(true, pTalent);
      if (eTalent?.effect === 'swap_enemy_future_rounds') resolveMystique(false, eTalent);
      refreshCurrentRound(); // relit qui défile réellement ce tournage après un éventuel échange

      // Amazone : détermine si son Retournement contre le Talent adverse
      // programmé sur CE MÊME tournage (jamais contre Rectification ni contre
      // Amazone elle-même). Le talent visé ne bénéficie plus à son camp
      // d'origine — c'est l'AUTRE camp (celui qui a activé Retournement) qui
      // en profite à la place.
      let reversalInfo = null; // { targetSide, beneficiaryName }
      const isReversible = (t) => t && t.effect !== 'cancel_enemy_talent_same_round' && t.effect !== 'next_talent_reversal' && t.effect !== 'swap_enemy_future_rounds';
      if (pTalent?.effect === 'next_talent_reversal' && isReversible(eTalent)) {
        reversalInfo = { targetSide: 'enemy', beneficiaryName: pFighter?.name || 'toi' };
      } else if (eTalent?.effect === 'next_talent_reversal' && isReversible(pTalent)) {
        reversalInfo = { targetSide: 'player', beneficiaryName: eFighter?.name || "l'adversaire" };
      }
      entry.reversalInfo = reversalInfo;

      /** true si l'effet numérique du camp `side` doit être inversé ce tournage */
      function consumeReversal(side) {
        return !!(reversalInfo && reversalInfo.targetSide === side);
      }

      // Élégance : annule le talent adverse programmé sur CE MÊME passage
      let pTalentCancelled = false, eTalentCancelled = false;
      if (pTalent?.effect === 'cancel_enemy_talent_same_round' && eTalentId) {
        eTalentCancelled = true;
        pushEvt(`🚫 ${pTalent.name} (toi) — Talent adverse annulé ce passage`);
        entry.cancelledTalent = { side: 'enemy', name: eTalent.name };
      }
      if (eTalent?.effect === 'cancel_enemy_talent_same_round' && pTalentId && !pTalentCancelled) {
        pTalentCancelled = true;
        pushEvt(`🚫 ${eTalent.name} (adversaire) — Talent annulé ce passage`);
        entry.cancelledTalent = { side: 'player', name: pTalent.name };
      }

      // Naturelle : soigne toute l'équipe du camp qui l'active
      if (pTalent?.effect === 'team_endurance_restore' && !pTalentCancelled) {
        const gain = cfg.defileTalentNatureRegen ?? 10;
        playerTeam.forEach(f => { f.endurance = Math.min(100, f.endurance + gain); });
        pushEvt(`💗 ${pTalent.name} (toi) — +${gain}% Endurance à toute l'équipe`);
      }
      if (eTalent?.effect === 'team_endurance_restore' && !eTalentCancelled) {
        const gain = cfg.defileTalentNatureRegen ?? 10;
        enemyTeam.forEach(f => { f.endurance = Math.min(100, f.endurance + gain); });
        pushEvt(`💗 ${eTalent.name} (adversaire) — +${gain}% Endurance à toute l'équipe`);
      }

      // Diva : si la stat jugée est la stat la PLUS ÉLEVÉE de l'adversaire,
      // elle est automatiquement remplacée par sa stat jugée la plus FAIBLE
      let statForPlayer = passage.stat, statForEnemy = passage.stat;
      if (pTalent?.effect === 'enemy_same_round_random_category' && !pTalentCancelled && eFighter) {
        const vals = { atk: eFighter.atk, def: eFighter.def, spd: eFighter.spd };
        const sorted = Object.keys(vals).sort((a, b) => vals[b] - vals[a]);
        if (sorted[0] === passage.stat) {
          statForEnemy = sorted[2];
          pushEvt(`👠 ${pTalent.name} (toi) — la stat jugée de l'adversaire devient ${STAT_LABEL[statForEnemy]}`);
        }
      }
      if (eTalent?.effect === 'enemy_same_round_random_category' && !eTalentCancelled && pFighter) {
        const vals = { atk: pFighter.atk, def: pFighter.def, spd: pFighter.spd };
        const sorted = Object.keys(vals).sort((a, b) => vals[b] - vals[a]);
        if (sorted[0] === passage.stat) {
          statForPlayer = sorted[2];
          pushEvt(`👠 ${eTalent.name} (adversaire) — ta stat jugée devient ${STAT_LABEL[statForPlayer]}`);
        }
      }
      entry.playerStatSwapped = statForPlayer !== passage.stat;
      entry.enemyStatSwapped  = statForEnemy  !== passage.stat;
      entry.playerJudgedStat = statForPlayer;
      entry.enemyJudgedStat  = statForEnemy;

      // ═══ ÉTAPE 1 — stat brute + modificateurs de STAT, AVANT le multiplicateur de type ═══
      _currentStage = 1;

      let pStatValue = pFighter ? pFighter[statForPlayer] : 0;
      let eStatValue = eFighter ? eFighter[statForEnemy]  : 0;
      const pStatBase = Math.ceil(pStatValue), eStatBase = Math.ceil(eStatValue);

      // Passion : augmente sa propre stat jugée
      if (pTalent?.effect === 'self_stats_boost' && !pTalentCancelled) {
        const boost = cfg.defileTalentPassionBoost ?? 20;
        const reversed = consumeReversal('player');
        const delta = pStatValue * (boost / 100) * (reversed ? -1 : 1);
        pStatValue += delta;
        pushEvt(`🔥 ${pTalent.name} (toi) — ${delta>=0?'+':''}${Math.ceil(delta)} ${STAT_LABEL[statForPlayer]} (stat) ${reversed ? '(retourné !)' : ''}`, reversed);
      }
      if (eTalent?.effect === 'self_stats_boost' && !eTalentCancelled) {
        const boost = cfg.defileTalentPassionBoost ?? 20;
        const reversed = consumeReversal('enemy');
        const delta = eStatValue * (boost / 100) * (reversed ? -1 : 1);
        eStatValue += delta;
        pushEvt(`🔥 ${eTalent.name} (adversaire) — ${delta>=0?'+':''}${Math.ceil(delta)} ${STAT_LABEL[statForEnemy]} (stat) ${reversed ? '(retourné !)' : ''}`, reversed);
      }

      // Idole : transfère un % de sa stat la plus haute (hors stat jugée) dans sa stat jugée
      if (pTalent?.effect === 'self_stat_transfer' && !pTalentCancelled && pFighter) {
        const vals = { atk: pFighter.atk, def: pFighter.def, spd: pFighter.spd };
        const sorted = Object.keys(vals).sort((a, b) => vals[b] - vals[a]);
        const highestKey = sorted[0] === statForPlayer ? sorted[1] : sorted[0];
        const pct = cfg.defileTalentIdoleTransfer ?? 20;
        const reversed = consumeReversal('player');
        const delta = vals[highestKey] * (pct / 100) * (reversed ? -1 : 1);
        pStatValue += delta;
        pushEvt(`⭐ ${pTalent.name} (toi) — ${delta>=0?'+':''}${Math.ceil(delta)} ${STAT_LABEL[statForPlayer]} (transféré depuis ${STAT_LABEL[highestKey]}) ${reversed ? '(retourné !)' : ''}`, reversed);
      }
      if (eTalent?.effect === 'self_stat_transfer' && !eTalentCancelled && eFighter) {
        const vals = { atk: eFighter.atk, def: eFighter.def, spd: eFighter.spd };
        const sorted = Object.keys(vals).sort((a, b) => vals[b] - vals[a]);
        const highestKey = sorted[0] === statForEnemy ? sorted[1] : sorted[0];
        const pct = cfg.defileTalentIdoleTransfer ?? 20;
        const reversed = consumeReversal('enemy');
        const delta = vals[highestKey] * (pct / 100) * (reversed ? -1 : 1);
        eStatValue += delta;
        pushEvt(`⭐ ${eTalent.name} (adversaire) — ${delta>=0?'+':''}${Math.ceil(delta)} ${STAT_LABEL[statForEnemy]} (transféré depuis ${STAT_LABEL[highestKey]}) ${reversed ? '(retourné !)' : ''}`, reversed);
      }

      // Enchanteresse : vole un % de la stat jugée adverse (valeur courante, après ses éventuels autres bonus)
      if (pTalent?.effect === 'steal_enemy_same_round_stat' && !pTalentCancelled && eFighter) {
        const pct = cfg.defileTalentEnchantSteal ?? 20;
        const reversed = consumeReversal('player');
        const stolen = Math.max(0, eStatValue) * (pct / 100);
        if (reversed) { pStatValue -= stolen; eStatValue += stolen; }
        else          { eStatValue -= stolen; pStatValue += stolen; }
        pushEvt(`🧚‍♀️ ${pTalent.name} (toi) — ${reversed ? 'perd' : 'vole'} ${Math.ceil(stolen)} de ${STAT_LABEL[statForEnemy]} ${reversed ? "au profit de l'adversaire" : "à l'adversaire"}`, reversed);
      }
      if (eTalent?.effect === 'steal_enemy_same_round_stat' && !eTalentCancelled && pFighter) {
        const pct = cfg.defileTalentEnchantSteal ?? 20;
        const reversed = consumeReversal('enemy');
        const stolen = Math.max(0, pStatValue) * (pct / 100);
        if (reversed) { eStatValue -= stolen; pStatValue += stolen; }
        else          { pStatValue -= stolen; eStatValue += stolen; }
        pushEvt(`🧚‍♀️ ${eTalent.name} (adversaire) — ${reversed ? 'perd' : 'vole'} ${Math.ceil(stolen)} de ${STAT_LABEL[statForPlayer]} ${reversed ? 'à ton profit' : 'à toi'}`, reversed);
      }

      pStatValue = Math.max(0, Math.ceil(pStatValue));
      eStatValue = Math.max(0, Math.ceil(eStatValue));

      // ═══ ÉTAPE 2 — multiplicateur de type ═══════════════════════════════════

      const pMult = pFighter ? CWGameDatabase.getBestTypeEffectiveness(pFighter.type1, pFighter.type2, passage.typeId, null, matrix) : null;
      const eMult = eFighter ? CWGameDatabase.getBestTypeEffectiveness(eFighter.type1, eFighter.type2, passage.typeId, null, matrix) : null;
      let pScore = pFighter ? Math.ceil(pStatValue * pMult) : 0;
      let eScore = eFighter ? Math.ceil(eStatValue * eMult) : 0;

      // ═══ ÉTAPE 3 — Charme / Rebelle, AVANT le Bonus Forme ═══════════════════
      _currentStage = 3;

      if (pTalent?.effect === 'self_score_bonus_flat' && !pTalentCancelled) {
        const bonus = cfg.defileTalentCharmeBonus ?? 50;
        const reversed = consumeReversal('player');
        const delta = pScore * (bonus / 100);
        pScore += reversed ? -delta : delta;
        pushEvt(`✨ ${pTalent.name} (toi) — ${reversed ? '-' : '+'}${Math.ceil(delta)} points ${reversed ? '(retourné !)' : ''}`, reversed);
      }
      if (eTalent?.effect === 'self_score_bonus_flat' && !eTalentCancelled) {
        const bonus = cfg.defileTalentCharmeBonus ?? 50;
        const reversed = consumeReversal('enemy');
        const delta = eScore * (bonus / 100);
        eScore += reversed ? -delta : delta;
        pushEvt(`✨ ${eTalent.name} (adversaire) — ${reversed ? '-' : '+'}${Math.ceil(delta)} points ${reversed ? '(retourné !)' : ''}`, reversed);
      }
      if (pTalent?.effect === 'enemy_next_round_malus' && !pTalentCancelled) {
        const malus = cfg.defileTalentRebelleMalus ?? 50;
        const reversed = consumeReversal('player');
        const delta = (reversed ? pScore : eScore) * (malus / 100);
        if (reversed) pScore -= delta; else eScore -= delta;
        pushEvt(`😈 ${pTalent.name} (toi) — ${reversed ? 'tu perds' : "l'adversaire perd"} ${Math.ceil(delta)} points ${reversed ? '(retourné !)' : ''}`, reversed);
      }
      if (eTalent?.effect === 'enemy_next_round_malus' && !eTalentCancelled) {
        const malus = cfg.defileTalentRebelleMalus ?? 50;
        const reversed = consumeReversal('enemy');
        const delta = (reversed ? eScore : pScore) * (malus / 100);
        if (reversed) eScore -= delta; else pScore -= delta;
        pushEvt(`😈 ${eTalent.name} (adversaire) — ${reversed ? "l'adversaire perd" : 'tu perds'} ${Math.ceil(delta)} points ${reversed ? '(retourné !)' : ''}`, reversed);
      }

      pScore = Math.max(0, Math.ceil(pScore));
      eScore = Math.max(0, Math.ceil(eScore));
      const pScoreBeforeForme = pScore, eScoreBeforeForme = eScore;

      // ═══ ÉTAPE 4 — Bonus Forme (Endurance restante) ═════════════════════════

      const pEnduranceRemaining = pFighter ? Math.ceil(pFighter.enduranceMax * (pFighter.endurance / 100)) : null;
      const eEnduranceRemaining = eFighter ? Math.ceil(eFighter.enduranceMax * (eFighter.endurance / 100)) : null;
      const pBonusPct = pEnduranceRemaining != null ? Math.ceil(pEnduranceRemaining / 100) : null;
      const eBonusPct = eEnduranceRemaining != null ? Math.ceil(eEnduranceRemaining / 100) : null;
      if (pBonusPct != null) pScore = Math.ceil(pScore * (1 + pBonusPct / 100));
      if (eBonusPct != null) eScore = Math.ceil(eScore * (1 + eBonusPct / 100));

      // ── Sauvegarde de toutes les valeurs intermédiaires pour l'affichage ──
      entry.playerStatValue = pFighter ? pStatBase : null;              // stat brute AVANT tout modificateur
      entry.enemyStatValue  = eFighter ? eStatBase : null;
      entry.playerStatAfterMods = pFighter ? Math.ceil(pStatValue) : null; // stat APRÈS Passion/Idole/Enchant
      entry.enemyStatAfterMods  = eFighter ? Math.ceil(eStatValue) : null;
      entry.playerMult = pMult;
      entry.enemyMult  = eMult;
      entry.playerAfterType = pFighter ? Math.ceil(pStatValue * pMult) : null; // score juste après le type (avant Charme/Rebelle)
      entry.enemyAfterType  = eFighter ? Math.ceil(eStatValue * eMult) : null;
      entry.playerScoreBeforeForme = pScoreBeforeForme;
      entry.enemyScoreBeforeForme  = eScoreBeforeForme;
      entry.playerAfterEndurance = pScore;
      entry.enemyAfterEndurance  = eScore;
      entry.playerEnduranceBonusPct = pBonusPct;
      entry.enemyEnduranceBonusPct  = eBonusPct;
      entry.playerEnduranceRemaining = pEnduranceRemaining;
      entry.enemyEnduranceRemaining  = eEnduranceRemaining;
      entry.playerEndurancePercent = pFighter ? pFighter.endurance : null;
      entry.enemyEndurancePercent  = eFighter ? eFighter.endurance : null;
      entry.playerEnduranceMax = pFighter ? Math.round(pFighter.enduranceMax) : null;
      entry.enemyEnduranceMax  = eFighter ? Math.round(eFighter.enduranceMax) : null;

      playerScores[i] = Math.max(0, Math.ceil(pScore));
      enemyScores[i]  = Math.max(0, Math.ceil(eScore));
      entry.playerFighter = pFighter?.name || null;
      entry.enemyFighter  = eFighter?.name || null;
      entry.playerCharId  = pFighter?.charId || null;
      entry.enemyCharId   = eFighter?.charId || null;
      entry.playerScore = playerScores[i];
      entry.enemyScore  = enemyScores[i];

      // Endurance : mise à jour APRÈS le score final de ce tournage (reflète
      // la fatigue/le repos qui s'installe EN CONSÉQUENCE de ce tournage).
      entry.playerEnduranceBefore = pFighter ? pFighter.endurance : null;
      entry.enemyEnduranceBefore  = eFighter ? eFighter.endurance : null;
      [...playerTeam, ...enemyTeam].forEach(f => {
        const isWalkingThisRound = (pFighter && f.instanceId === pFighter.instanceId) || (eFighter && f.instanceId === eFighter.instanceId);
        f.endurance = Math.max(0, Math.min(100, f.endurance + (isWalkingThisRound ? -enduranceLoss : enduranceGain)));
      });
      entry.playerEnduranceAfter = pFighter ? pFighter.endurance : null;
      entry.enemyEnduranceAfter  = eFighter ? eFighter.endurance : null;
      entry.playerWalked = !!pFighter;
      entry.enemyWalked  = !!eFighter;

      log.push(entry);
    }

    const playerTotal = playerScores.reduce((s, v) => s + v, 0);
    const enemyTotal  = enemyScores.reduce((s, v) => s + v, 0);
    const winner = playerTotal > enemyTotal ? 'player' : enemyTotal > playerTotal ? 'enemy' : 'tie';

    return { log, playerTotal, enemyTotal, winner };
  }

  return { generateProgramme, buildFighter, autoAssign, resolveDuel };
})();
