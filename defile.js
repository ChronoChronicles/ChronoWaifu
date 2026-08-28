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

    // Effets en attente qui modifient un passage FUTUR au moment où on l'atteint
    // { round: index (0-based), side: 'player'|'enemy', type: 'malus_pct'|'cancel_talent'|'random_category', value }
    const pendingRoundEffects = [];
    // Le prochain Talent activé (n'importe quel camp) voit sa cible inversée (Amazone)
    let reversalArmed = false;

    const enduranceLoss = cfg.defileEnduranceLossPct ?? 15;
    const enduranceGain = cfg.defileEnduranceGainPct ?? 15;
    // (plus de facteur configurable ici — formule fixée en dur, cf. computeSideScore)

    // Talent copié par une éventuelle Légende (choisi AVANT toute planification)
    const legendeCopy = choices.legendeCopyTypeId || null;

    function talentOf(typeId) {
      if (typeId === 'Legende' && legendeCopy) return CWGameDatabase.getDefileTalentDisplay(legendeCopy, cfg);
      return CWGameDatabase.getDefileTalentDisplay(typeId, cfg);
    }

    function computeSideScore(fighter, passage) {
      const statValue = Math.ceil(fighter[passage.stat]);
      const mult = CWGameDatabase.getBestTypeEffectiveness(fighter.type1, fighter.type2, passage.typeId, null, matrix);
      const afterType = Math.ceil(statValue * mult); // plus de variance aléatoire : calcul 100% déterministe
      const endurancePercent = fighter.endurance;
      // "Forme restante" = valeur ABSOLUE (comme les PV), pas un pourcentage :
      // enduranceMax × (endurancePercent/100). Bonus = cette valeur absolue
      // ÷ 100, arrondi à l'unité supérieure (ex: 785 → +8%).
      const enduranceRemaining = Math.ceil(fighter.enduranceMax * (endurancePercent / 100));
      const enduranceBonusPct = Math.ceil(enduranceRemaining / 100);
      // IMPORTANT : ce calcul part de "afterType" déjà arrondi ci-dessus —
      // exactement le nombre affiché à l'écran à l'étape précédente. Plus
      // aucun écart possible entre ce que le joueur voit et ce qui est
      // réellement utilisé pour la suite du calcul.
      const afterEndurance = Math.ceil(afterType * (1 + enduranceBonusPct / 100));
      const final = afterEndurance;
      return { statValue, mult, afterType, endurancePercent, enduranceRemaining, enduranceBonusPct, afterEndurance, final };
    }

    for (let i = 0; i < rounds; i++) {
      const passage = programme[i];
      const pSlot = playerAssignment[i];
      const eSlot = enemyAssignment[i];
      const pFighter = pSlot ? byId[pSlot.instanceId] : null;
      const eFighter = eSlot ? byId[eSlot.instanceId] : null;
      const entry = { round: passage.round, stat: passage.stat, typeId: passage.typeId, events: [] };

      // Catégorie éventuellement chamboulée par un Chaos de Casting programmé plus tôt
      let effectivePassage = passage;
      const chaos = pendingRoundEffects.find(e => e.round === i && e.type === 'random_category');
      if (chaos) {
        effectivePassage = { ...passage, stat: STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)] };
        entry.events.push({ text: `🎲 Catégorie chamboulée (Chaos de Casting) → ${effectivePassage.stat}`, playerScoreAfter: null, enemyScoreAfter: null });
      }

      // (l'Endurance est désormais mise à jour APRÈS le score final du
      // tournage, cf. plus bas — elle reflète ici l'état AVANT ce tournage)

      // Scores de base — calcul détaillé, exposé dans l'entrée pour l'animation
      const pDetail = pFighter ? computeSideScore(pFighter, effectivePassage) : null;
      const eDetail = eFighter ? computeSideScore(eFighter, effectivePassage) : null;
      let pScore = pDetail ? pDetail.final : 0;
      let eScore = eDetail ? eDetail.final : 0;
      entry.playerEndurancePercent  = pDetail?.endurancePercent  ?? null;
      entry.enemyEndurancePercent   = eDetail?.endurancePercent  ?? null;
      entry.playerEnduranceRemaining = pDetail?.enduranceRemaining ?? null;
      entry.enemyEnduranceRemaining  = eDetail?.enduranceRemaining ?? null;
      entry.playerEnduranceMax = pFighter ? Math.round(pFighter.enduranceMax) : null;
      entry.enemyEnduranceMax  = eFighter ? Math.round(eFighter.enduranceMax) : null;
      entry.playerEnduranceBonusPct = pDetail?.enduranceBonusPct ?? null;
      entry.enemyEnduranceBonusPct  = eDetail?.enduranceBonusPct ?? null;
      entry.playerAfterType = pDetail ? Math.ceil(pDetail.afterType) : null;
      entry.enemyAfterType  = eDetail ? Math.ceil(eDetail.afterType) : null;
      entry.playerAfterEndurance = pDetail ? Math.ceil(pDetail.afterEndurance) : null;
      entry.enemyAfterEndurance  = eDetail ? Math.ceil(eDetail.afterEndurance) : null;

      // Capture le score courant des DEUX côtés à l'instant de chaque
      // événement (malus différé, Talent...), pour que l'écran puisse mettre
      // à jour le chiffre affiché en même temps que le texte — plus aucun
      // changement de score "invisible" révélé seulement au score final.
      function pushEvt(text) {
        entry.events.push({ text, playerScoreAfter: Math.ceil(pScore), enemyScoreAfter: Math.ceil(eScore) });
      }

      // ── Talents programmés sur CE passage (déjà placés lors de la planification) ──
      const pTalentId = pSlot?.talentTypeId || null;
      const eTalentId = eSlot?.talentTypeId || null;
      const pTalentCancelled = pendingRoundEffects.some(e => e.round === i && e.side === 'player' && e.type === 'cancel_talent');
      const eTalentCancelled = pendingRoundEffects.some(e => e.round === i && e.side === 'enemy'  && e.type === 'cancel_talent');

      // Malus programmé plus tôt (Sale Rumeur / Vol de Vedette ciblent le round suivant/du jour)
      pendingRoundEffects.filter(e => e.round === i).forEach(e => {
        if (e.type === 'malus_pct' && e.side === 'player') { pScore *= (1 - e.value / 100); pushEvt(`📉 ${talentOf('Rebelle').name} reçue (-${e.value}%)`); }
        if (e.type === 'malus_pct' && e.side === 'enemy')  { eScore *= (1 - e.value / 100); pushEvt(`📉 L'adversaire subit ${talentOf('Rebelle').name} (-${e.value}%)`); }
      });

      function applyTalent(typeId, isPlayerSide, cancelled) {
        if (!typeId || cancelled) return;
        const t = talentOf(typeId);
        if (!t) return;
        const selfFighter  = isPlayerSide ? pFighter : eFighter;
        const enemyIdxSameRound = i; // passage du même numéro côté adverse

        // Amazone : si un retournement est armé, on inverse la cible de CE talent
        let reversedNow = false;
        if (reversalArmed && t.effect !== 'next_talent_reversal') {
          reversedNow = true;
          reversalArmed = false;
        }

        switch (t.effect) {
          case 'self_score_bonus_flat': { // Charme
            const bonus = cfg.defileTalentCharmeBonus ?? 15;
            const delta = (isPlayerSide ? pScore : eScore) * (bonus / 100);
            if (isPlayerSide) pScore += reversedNow ? -delta : delta; else eScore += reversedNow ? -delta : delta;
            pushEvt(`✨ ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) ${reversedNow ? '— retourné !' : ''}`);
            break;
          }
          case 'cancel_enemy_talent_same_round': { // Élégance
            // Résolu directement ici : on annule le talent adverse de CE passage,
            // s'il n'a pas déjà été exécuté (ordre : on traite Élégance en premier
            // dans la boucle des talents du passage, cf. plus bas).
            const otherCancelled = isPlayerSide ? eTalentCancelledRef : pTalentCancelledRef;
            otherCancelled.value = true;
            pushEvt(`🚫 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — Talent adverse annulé ce passage`);
            break;
          }
          case 'team_endurance_restore': { // Naturelle
            const gain = cfg.defileTalentNatureRegen ?? 10;
            (isPlayerSide ? playerTeam : enemyTeam).forEach(f => { f.endurance = Math.min(100, f.endurance + gain); });
            pushEvt(`💗 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — +${gain}% Endurance à toute l'équipe`);
            break;
          }
          case 'enemy_next_round_malus': { // Rebelle
            const malus = cfg.defileTalentRebelleMalus ?? 20;
            if (i + 1 < rounds) pendingRoundEffects.push({ round: i + 1, side: reversedNow ? (isPlayerSide ? 'player' : 'enemy') : (isPlayerSide ? 'enemy' : 'player'), type: 'malus_pct', value: malus });
            pushEvt(`😈 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) programmée pour le prochain passage`);
            break;
          }
          case 'enemy_same_round_random_category': { // Diva
            pendingRoundEffects.push({ round: enemyIdxSameRound, side: 'n/a', type: 'random_category' });
            pushEvt(`👠 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — catégorie adverse du passage ${passage.round} chamboulée`);
            break;
          }
          case 'self_stats_boost': { // Passion
            const boost = cfg.defileTalentPassionBoost ?? 20;
            const delta = (isPlayerSide ? pScore : eScore) * (boost / 100);
            if (isPlayerSide) pScore += reversedNow ? -delta : delta; else eScore += reversedNow ? -delta : delta;
            pushEvt(`🔥 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'})`);
            break;
          }
          case 'self_stat_transfer': { // Idole
            if (selfFighter) {
              const statVals = { atk: selfFighter.atk, def: selfFighter.def, spd: selfFighter.spd };
              const sortedKeys = Object.keys(statVals).sort((a, b) => statVals[b] - statVals[a]);
              const highestKey = sortedKeys[0] === effectivePassage.stat ? sortedKeys[1] : sortedKeys[0];
              const pct = cfg.defileTalentIdoleTransfer ?? 10;
              const delta = statVals[highestKey] * (pct / 100);
              if (isPlayerSide) pScore += reversedNow ? -delta : delta; else eScore += reversedNow ? -delta : delta;
              pushEvt(`⭐ ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — +${pct}% de ${highestKey} transféré`);
            }
            break;
          }
          case 'next_talent_reversal': { // Amazone
            reversalArmed = true;
            pushEvt(`🥊 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — le prochain Talent activé sera inversé`);
            break;
          }
          case 'swap_enemy_future_rounds': { // Mystique
            const targetSide = isPlayerSide ? enemyAssignment : playerAssignment;
            const futureRounds = targetSide.map((s, idx) => idx).filter(idx => idx > i && targetSide[idx]);
            let r1, r2;
            const preChoice = choices.mystiqueSwapRounds?.[passage.round];
            if (preChoice && futureRounds.includes(preChoice[0] - 1) && futureRounds.includes(preChoice[1] - 1)) {
              r1 = preChoice[0] - 1; r2 = preChoice[1] - 1;
            } else if (futureRounds.length >= 2) {
              // Repli automatique : 2 passages futurs au hasard
              const shuffled = [...futureRounds].sort(() => Math.random() - 0.5);
              r1 = shuffled[0]; r2 = shuffled[1];
            }
            if (r1 !== undefined && r2 !== undefined) {
              const tmp = targetSide[r1]; targetSide[r1] = targetSide[r2]; targetSide[r2] = tmp;
              pushEvt(`🪄 ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — passages ${r1 + 1} et ${r2 + 1} adverses échangés`);
            }
            break;
          }
          case 'steal_enemy_same_round_stat': { // Enchanteresse
            const otherFighter = isPlayerSide ? eFighter : pFighter;
            if (otherFighter) {
              const pct = cfg.defileTalentEnchantSteal ?? 10;
              const stolen = otherFighter[effectivePassage.stat] * (pct / 100);
              if (isPlayerSide) { pScore += reversedNow ? -stolen : stolen; eScore -= reversedNow ? -stolen : stolen; }
              else              { eScore += reversedNow ? -stolen : stolen; pScore -= reversedNow ? -stolen : stolen; }
              pushEvt(`🧚‍♀️ ${t.name} (${isPlayerSide ? 'toi' : 'adversaire'}) — ${pct}% de la stat adverse volée`);
            }
            break;
          }
          case 'copy_enemy_talent_pre_planning': // Légende — déjà résolu avant le duel (legendeCopy), rien à faire ici
          default:
            break;
        }
      }

      // Références mutables pour qu'Élégance puisse annuler le talent adverse
      // du MÊME passage (résolu dans l'ordre : Élégance d'abord, sinon l'ordre
      // de placement en tableau).
      const pTalentCancelledRef = { value: pTalentCancelled };
      const eTalentCancelledRef = { value: eTalentCancelled };
      const pIsElegance = pTalentId && talentOf(pTalentId)?.effect === 'cancel_enemy_talent_same_round';
      const eIsElegance = eTalentId && talentOf(eTalentId)?.effect === 'cancel_enemy_talent_same_round';
      if (pIsElegance) applyTalent(pTalentId, true, pTalentCancelledRef.value);
      if (eIsElegance) applyTalent(eTalentId, false, eTalentCancelledRef.value);
      if (pTalentId && !pIsElegance) applyTalent(pTalentId, true, pTalentCancelledRef.value);
      if (eTalentId && !eIsElegance) applyTalent(eTalentId, false, eTalentCancelledRef.value);

      playerScores[i] = Math.max(0, Math.ceil(pScore));
      enemyScores[i]  = Math.max(0, Math.ceil(eScore));
      entry.playerFighter = pFighter?.name || null;
      entry.enemyFighter  = eFighter?.name || null;
      entry.playerCharId  = pFighter?.charId || null;
      entry.enemyCharId   = eFighter?.charId || null;
      entry.playerMult = pDetail?.mult ?? null;
      entry.enemyMult  = eDetail?.mult ?? null;
      entry.playerStatValue = pDetail ? Math.ceil(pDetail.statValue) : null;
      entry.enemyStatValue  = eDetail ? Math.ceil(eDetail.statValue) : null;
      entry.playerScore = playerScores[i];
      entry.enemyScore  = enemyScores[i];

      // Endurance : mise à jour APRÈS le score final de ce tournage (elle
      // reflète la fatigue/le repos qui s'installe EN CONSÉQUENCE de ce
      // tournage, visible juste après le score plutôt que masquée avant).
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
