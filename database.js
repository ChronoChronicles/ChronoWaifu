/**
 * ============================================================
 * DATABASE.JS — Base de données centrale du jeu
 * Contient toutes les données de jeu, personnages, types, etc.
 * Architecture prévue pour migration vers serveur (REST/WebSocket)
 * ============================================================
 */

'use strict';

const CWGameDatabase = (() => {

  // ─── CONFIGURATION GLOBALE ───────────────────────────────────────────────────

  const DEFAULT_CONFIG = {
    game: {
      name: "ChronoWaifu Chronicles",
      version: "1.0.0",
      maxTeamSize: 3,
      enemyTeamSize: { mode: "fixed", value: 3, min: 1, max: 5 },
    },
    combat: {
      damageFormula: "atk² / (atk + def)",  // Formule textuelle (documentaire)
      minDamage: 1,                           // Dégâts minimum
      captureBaseRate: 0.15,                  // Taux de capture de base
      rewardXpPerEnemy: 20,                   // XP gagnée par ennemi vaincu (× son niveau)
      rewardGoldPerEnemy: 5,                  // Pièces d'or gagnées par ennemi vaincu
      rewardDiamondsPerEnemy: 10,             // Diamants (cristaux) gagnés par ennemi vaincu
      speedEvasionCap: 0.10,                  // Max 10% d'écart sur esquive via vitesse
      speedAccuracyCap: 0.10,
      // ── Coups critiques ────────────────────────────────────────────────────
      critDivisor:    200,   // Diviseur pour le taux de crit : spd / (spd + critDivisor)
                              // ex: spd=200 → 50% crit, spd=50 → ~20%, spd=20 → ~9%
      critMultiplier: 1.5,   // Multiplicateur de dégâts sur un coup critique
      // ── Score de puissance "Aura" ────────────────────────────────────────────
      // DEF d'un adversaire fictif de référence utilisée pour convertir les
      // stats d'un personnage en un score de puissance comparable (cf.
      // CWGameDatabase.computeAuraScore). Valeur volontairement basse et fixe
      // (indépendante du niveau) pour bien récompenser la progression.
      scoreDefReference: 10,
      // ── Mode Performance ─────────────────────────────────────────────────
      recordMaxTurns: 15,      // Nombre de tours du combat
      recordEnemyCount: 3,     // Taille de la vague d'ennemis (remplacés instantanément)
      recordKillBonus: 100,    // Points bonus accordés par ennemi vaincu
      // Paliers de score (structure à 3 segments, chacun réglable) — utilisés
      // à la fois pour le calcul du nombre de paliers franchis et pour générer
      // l'échelle de récompenses du totem.
      recordTier1Step: 1000,   recordTier1Cap: 20000,
      recordTier2Step: 2000,   recordTier2Cap: 40000,
      recordTier3Step: 5000,   // au-delà de recordTier2Cap, continue à ce rythme
      recordTotemMaxScore: 100000, // plafond d'affichage du totem de récompenses
      // Récompense accordée par palier réclamé (multipliée par recordRewardGrowth
      // à la puissance de l'index du palier, pour une progression plate (1) ou
      // croissante (>1) selon le goût de l'admin)
      recordGoldPerTier: 50,
      recordCrystalsPerTier: 2,
      recordRewardGrowth: 1,
      // ── Mode Défilé ───────────────────────────────────────────────────────
      defilePassageCount: 9,          // Nombre d'épreuves du programme
      defileUsesPerChar: 3,           // Nombre de fois où chaque personnage doit défiler
      defileTalentsCount: 3,          // Nombre de Talents à placer (1 par personnage max, généralement 3)
      // Endurance en cours de défilé (distincte des PV de combat classique)
      defileStartEndurancePct: 50,    // Endurance de départ (% de l'Endurance max)
      defileEnduranceLossPct: 15,     // Perdue quand la personnage défile
      defileEnduranceGainPct: 15,     // Regagnée quand elle est au repos ce passage
      // Bonus Forme : formule figée en dur dans defile.js (Forme restante ÷ 100,
      // arrondi au supérieur) — plus de facteur configurable ici, pour éviter
      // toute confusion avec une ancienne valeur restée sauvegardée.
      // Ampleur de chaque Talent (tous exprimés en %)
      defileTalentCharmeBonus: 50,        // Grand Sourire : + points garantis (avant le Bonus Forme)
      defileTalentRebelleMalus: 50,       // Sale Rumeur : − points au tournage en cours de l'adversaire (avant son Bonus Forme)
      defileTalentNatureRegen: 10,       // Second Souffle : + Endurance à toute l'équipe
      defileTalentPassionBoost: 20,      // Montée en Puissance : + stats sur soi ce passage
      defileTalentIdoleTransfer: 20,     // Sous les Projecteurs : % de la stat la + haute transférée
      defileTalentEnchantSteal: 20,      // Vol de Vedette : % de stat volée à l'adversaire
      // ── Système d'affinité (remplace le Gacha) ──────────────────────────────
      // Gain d'affinité par tournage GAGNÉ contre une adversaire, par lignée :
      // base selon sa rareté (une commune, très fréquente, rapporte peu ; une
      // mythique, quasi jamais rencontrée, rapporte gros) × multiplicateur
      // selon le STADE d'évolution rencontré (plus évoluée = plus gros gain).
      affinityRarityIncrement: {
        common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, mythic: 6,
      },
      affinityStageMultiplier: [1, 2, 3, 4], // index = evolutionStage (0 à 3)
      affinityGainMultiplier: 1, // multiplicateur global appliqué par-dessus le calcul ci-dessus
      // ── Talents du Défilé — nom/description personnalisables (vide = valeur
      // par défaut). Les pourcentages de chaque effet restent dans les champs
      // defileTalentXxx déjà présents plus haut/bas dans cette config.
      defileTalentNameOverrides: {},
      defileTalentDescOverrides: {},
      // ── Récompenses de fin de Défilé (toutes réglables) ─────────────────────
      defileCharXpPercent:   10, // % du score marqué par CHAQUE personnage → XP perso
      defilePlayerXpPercent:  5, // % du score total du défilé → XP joueur
      defileGoldPercent:      1, // % du score total du défilé → dollars
      // Diamants : à définir plus tard
      // ── Grand Casting ────────────────────────────────────────────────────
      reputationPercentOfScore: 10, // % du score d'un Défilé converti en Réputation
      castingThresholdMin: 25,      // Nb minimum de Défilés avant un nouveau Casting
      castingThresholdMax: 30,      // Nb maximum
      castingCandidateCount: 4,     // Nombre de candidates proposées par Casting
      castingRivalCount: 3,         // Nombre d'agences rivales simulées
      // Prix de départ aux enchères, par rareté (en Réputation)
      castingBasePriceByRarity: {
        common: 50, uncommon: 120, rare: 300, epic: 700, legendary: 1500, mythic: 3500,
      },
      castingBidIncrement: 10,      // % d'augmentation minimum à chaque surenchère
      castingConvictionBonus: 5,    // % de réduction du coût effectif, CUMULABLE par tag partagé avec la collection
      castingConvictionMaxPct: 80,  // plafond de sécurité (jamais gratuit)
      castingRivalAggressionMin: 0.6, // Agressivité simulée des rivales (tirée entre min et max à chaque Casting)
      castingRivalAggressionMax: 1.2,
      // ── Équilibrage joueur / ennemi ────────────────────────────────────────
      playerDmgBonus:  1.15, // Multiplicateur de dégâts joueur → ennemi (+15%)
      enemyDmgPenalty: 0.80, // Multiplicateur de dégâts ennemi → joueur (−20%)
      enemyStatRatio:  0.85, // Ratio de stats appliqué aux ennemis générés (−15%)
      // ── Équilibrage adaptatif (anti-snowball) ───────────────────────────────
      // Les ennemis gagnent en puissance en fonction de l'écart entre l'équipe
      // du joueur "telle quelle" (équipement + awakening + évolution) et une
      // version "nue" du même personnage à la forme de base de sa lignée, au
      // même niveau. 0 = désactivé (comportement historique). 1 = les ennemis
      // absorbent l'intégralité de l'avantage du joueur (parité totale).
      adaptiveScalingFactor: 0.6,
      // ── Mode Odyssée (histoire) ────────────────────────────────────────────
      story: {
        subLevelsPerWorld:   25,    // Nombre de sous-niveaux par monde
        eliteSubLevels:      [10, 20], // Sous-niveaux élite (boost 10%)
        bossSubLevel:        25,    // Sous-niveau boss (boost 25%)
        eliteStatBoost:      0.10,  // +10% stats et niveau pour les élites
        bossStatBoost:       0.25,  // +25% stats et niveau pour les boss
        worldStatBoost:      0.10,  // +10% stats par monde supplémentaire complété
      },
      // ── Fréquence d'apparition des ennemis par rareté (combat aléatoire) ────
      // Poids relatifs : plus la valeur est haute, plus cette rareté apparaît souvent.
      enemyRarityWeights: {
        common: 50, uncommon: 30, rare: 12.5, epic: 5, legendary: 2, mythic: 0.5,
      },
      // ── Fréquence d'apparition réduite pour les formes évoluées ─────────────
      // Une forme évoluée n'intègre le pool d'ennemis qu'une fois débloquée par le
      // joueur (présente dans son Catalogue). Une fois débloquée, son poids de
      // sélection est multiplié par ce facteur ÉLEVÉ À LA PUISSANCE de son stade
      // d'évolution : stade 1 → ×facteur, stade 2 → ×facteur², etc. Plus le stade
      // est élevé, plus la forme apparaît rarement. 1 = pas de réduction.
      evolvedFormWeightFactor: 0.5,
      // ── Bonus d'XP en % selon la rareté de l'ennemi vaincu ──────────────────
      // S'ajoute à l'XP de base (niveau × rewardXpPerEnemy) : ex. 50 = +50%.
      enemyXpBonusByRarity: {
        common: 0, uncommon: 10, rare: 25, epic: 50, legendary: 100, mythic: 200,
      },
    },
    level: {
      xpFormula: "base * (level ** expo)",  // Formule XP
      xpBase: 100,
      xpExponent: 1.8,
      statGrowthPerLevel: {
        hp:  0.05,   // +5% PV par niveau
        atk: 0.04,
        def: 0.04,
        spd: 0.03,
      },
    },
    // ── Niveau du JOUEUR (distinct du niveau des créatures) ────────────────────
    playerLevel: {
      xpFormula: "base * (level ** expo)",  // Même forme de formule que le niveau créature, paramètres séparés
      xpBase: 100,
      xpExponent: 1.5,
      energyPerLevel: 5,      // +X énergie maximale à chaque niveau de joueur gagné
      xpPerEnemyKill: 5,      // XP joueur gagnée par ennemi éliminé en combat (par ennemi vaincu)
      xpPerCapture: 20,       // XP joueur gagnée par créature capturée (tirage Gacha OU capture en combat)
    },
    energy: {
      enabled: true,
      max: 100,
      regenPerMinute: 1,
      combatCost: 10,           // conservé pour compatibilité (= coût du combat aléatoire)
      costs: {
        random:     10,
        story:      10,   // Mode Odyssée (histoire)
        line:       20,
        fullRandom: 10,
        arena:      15,
      },
    },
    audio: {
      enabled: true,
      // Ces champs contiennent l'URL publique Supabase Storage du fichier importé
      // (et non plus juste son nom) — accessible à tous les joueurs, cf. audio.js
      globalMusicName: "",     // URL de la musique de fond globale
      combatMusicName: "",     // URL de la musique de combat
      sfxHitNormalName: "",    // Bruitage : coup normal
      sfxHitResistName: "",    // Bruitage : coup sur résistance (peu efficace)
      sfxHitWeakName:   "",    // Bruitage : coup sur faiblesse (super efficace)
      sfxVictoryName:   "",    // Bruitage : fin de combat — victoire
      sfxDefeatName:    "",    // Bruitage : fin de combat — défaite
      sfxLevelUpName:   "",    // Bruitage : montée de niveau
      sfxEvolutionName: "",    // Bruitage : évolution
      sfxGachaPullName: "",    // Bruitage : tirage Gacha (et révélation de capture)
      // ── Mode Défilé ────────────────────────────────────────────────────
      sfxDefileRevealName:    "", // Présentation d'une participante
      sfxDefileScoreTickName: "", // Apparition d'un chiffre de score
      sfxDefileTypeGoodName:  "", // Bonus de type favorable
      sfxDefileTypeBadName:   "", // Malus de type défavorable
      sfxDefileEnduranceName: "", // Bonus de Forme révélé
      sfxDefileTalentName:    "", // Activation d'un Talent
      sfxDefileRoundWinName:  "", // Tournage remporté
      sfxDefileRoundLoseName: "", // Tournage perdu
      sfxDefileVictoryName:   "", // Défilé remporté (applaudissements)
      sfxDefileDefeatName:    "", // Défilé perdu (déception)
    },
    // ── Fonds d'écran personnalisés ─────────────────────────────────────────
    // Une image hébergée (URL) par écran. null/absent = fond par défaut du thème.
    // Clés = identifiants d'écran (mêmes que ceux utilisés par showScreen côté UI).
    // Note : le Bureau (hub) n'est PAS inclus ici — il utilise sa propre
    // illustration (hub.png) avec des zones cliquables positionnées en %,
    // la remplacer casserait l'alignement des zones de navigation.
    backgrounds: {
      'team-hub': null, collection: null, team: null,
      'combat-select': null, combat: null,
      gacha: null, equip: null, inventory: null, shop: null, quests: null,
      catalogue: null, 'story-chapters': null, 'story-chapter': null,
    },
    gacha: {
      currencyName: "Diamants",
      singlePullCost: 100,
      tenPullCost: 900,
      guaranteedRareAfter: 10,
      guaranteedEpicAfter: 50,
      guaranteedLegendaryAfter: 100,
      dropRates: {
        common:    50,
        uncommon:  30,
        rare:      12.5,
        epic:       5,
        legendary:  2,
        mythic:     0.5,
      },
    },
    awakening: {
      maxLevel: 12,
      bonusPerLevel: {
        common:    { hp: 2,  atk: 2,  def: 2,  spd: 1  },
        uncommon:  { hp: 3,  atk: 3,  def: 3,  spd: 2  },
        rare:      { hp: 4,  atk: 4,  def: 4,  spd: 3  },
        epic:      { hp: 5,  atk: 5,  def: 5,  spd: 4  },
        legendary: { hp: 7,  atk: 7,  def: 7,  spd: 5  },
        mythic:    { hp: 10, atk: 10, def: 10, spd: 7  },
      },
    },

    // ─── TEMPLATE EVENT ──────────────────────────────────────────────────────────
    // Tous les Events partagent ces paramètres. Seul le Tag change à chaque rotation.
    // La rotation est automatique : durationDays jours d'Event, puis breakDays jours
    // de pause, puis un nouvel Event avec un Tag différent, sans intervention manuelle.
    event: {
      durationDays: 10,   // Durée d'un Event (jours)
      breakDays:    4,    // Pause entre deux Events (jours)
      shopDiscount: 20,   // % de réduction sur les persos du Tag en boutique
      bannerRates: {      // Taux de la bannière Event (indépendants de la bannière classique)
        mythic: 16.67, legendary: 16.67, epic: 16.67,
        rare: 16.67, uncommon: 16.66, common: 16.66,
      },
      bannerBoost: 2.0,
      combatConfig: {
        capriceDeEtoile: {
          enabled: true, energyCost: 10, difficulty: 1.0,
          xpMult: 1.2, goldMult: 1.2, diamondMult: 1.0,
        },
        combatTag: {
          enabled: true, energyCost: 15, difficulty: 1.2,
          xpMult: 1.5, goldMult: 1.5, diamondMult: 1.2,
        },
      },
      questTemplates: [
        { type: 'event_defeat',       target: 20, reward: { type: 'crystals', amount: 200 } },
        { type: 'event_defeat',       target: 50, reward: { type: 'crystals', amount: 400 } },
        { type: 'event_capture',      target: 3,  reward: { type: 'crystals', amount: 300 } },
        { type: 'event_capture',      target: 8,  reward: { type: 'crystals', amount: 500 } },
        { type: 'event_win_caprice',  target: 5,  reward: { type: 'crystals', amount: 350 } },
        { type: 'event_win_tag',      target: 3,  reward: { type: 'crystals', amount: 400 } },
        { type: 'event_win_tag',      target: 8,  reward: { type: 'crystals', amount: 600 } },
        { type: 'event_win_with_tag', target: 10, reward: { type: 'crystals', amount: 450 } },
        { type: 'event_summon',       target: 10, reward: { type: 'gold',     amount: 500 } },
      ],
      loginCycle: {
        name: 'Rituel Event', length: 10, loop: false,
        rewards: [
          { day: 1,  reward: { type: 'gold',      amount: 500  } },
          { day: 2,  reward: { type: 'crystals',  amount: 100  } },
          { day: 3,  reward: { type: 'gold',      amount: 800  } },
          { day: 4,  reward: { type: 'crystals',  amount: 150  } },
          { day: 5,  reward: { type: 'gold',      amount: 1000 } },
          { day: 6,  reward: { type: 'crystals',  amount: 200  } },
          { day: 7,  reward: { type: 'gold',      amount: 1200 } },
          { day: 8,  reward: { type: 'crystals',  amount: 300  } },
          { day: 9,  reward: { type: 'gold',      amount: 1500 } },
          { day: 10, reward: { type: 'character',  refId: null, amount: 1 } },
        ],
      },
    },

    // ─── BONUS JOUEUR ─────────────────────────────────────────────────────────
    // +1 à toutes les stats de tous les personnages par palier atteint.
    playerBonus: {
      captures:   { every: 100,   label: 'Recrutées'          },
      evolutions: { every: 50,    label: 'Évolutions'         },
      awakenings: { every: 100,   label: 'Sublimation'        },
      goldEarned: { every: 10000, label: 'Dollars gagnés' },
      reputationEarned: { every: 5000, label: 'Réputation gagnée' },
      // ── Score Aura (calculé en direct, pas un compteur cumulé) ──────────────
      scoreTotal: { every: 50000, label: 'Aura totale (collection)' },
      galleryEntries:  { every: 10,  label: 'Entrées débloquées (Galerie)' },
      // ── Bonus par niveau joueur (pas un compteur — géré à part) ─────────────
      perLevelBonus: 2, // +2 points de stat par niveau, dès le niveau 2
    },

    // ─── BONUS INDIVIDUEL PAR PERSONNAGE ─────────────────────────────────────
    // +1 réparti sur les 3 stats jugées (Charisme/Prestance/Grâce) de CETTE
    // personnage précise, selon SES propres compteurs de Défilé.
    characterBonus: {
      popularityEarned:   { every: 20,   label: 'Popularité individuelle' },
      passagesWon:        { every: 20,   label: 'Tournages remportés' },
      defilesWon:         { every: 10,   label: 'Défilés remportés' },
    },

    // ─── AFFECTION ────────────────────────────────────────────────────────────
    // Monte passivement (+1 à chaque fois que la personnage défile), accélérée
    // par des cadeaux achetés en $. Chaque palier franchi ajoute "bonus" points
    // de stat, répartis sur les 3 stats jugées (Charisme/Prestance/Grâce).
    // "threshold" = seuil CUMULÉ total (pas un delta) — permet d'ajouter de
    // nouveaux paliers plus tard (au-delà du 10e) sans tout recalculer.
    affection: {
      tiers: [
        { level: 1,  threshold: 50,   bonus: 2 },
        { level: 2,  threshold: 150,  bonus: 2 },
        { level: 3,  threshold: 300,  bonus: 3 },
        { level: 4,  threshold: 500,  bonus: 3 },
        { level: 5,  threshold: 750,  bonus: 3 },
        { level: 6,  threshold: 1100, bonus: 4 },
        { level: 7,  threshold: 1500, bonus: 4 },
        { level: 8,  threshold: 2000, bonus: 4 },
        { level: 9,  threshold: 2600, bonus: 5 },
        { level: 10, threshold: 3300, bonus: 5 },
      ],
      gifts: [
        { id: 'small',  label: 'Petit cadeau',  cost: 500,   affectionGiven: 30  },
        { id: 'medium', label: 'Cadeau moyen',  cost: 2000,  affectionGiven: 120 },
        { id: 'large',  label: 'Grand cadeau',  cost: 6000,  affectionGiven: 350 },
      ],
    },
  };

  // ─── TYPES ───────────────────────────────────────────────────────────────────
  // Chaque type peut porter un passif (passiveId, optionnel) : tout personnage de
  // ce type hérite automatiquement de son effet en combat. Un personnage à 2
  // types (type1 + type2) cumule les 2 passifs s'ils existent.

  const DEFAULT_TYPES = [
    { id: "Charme",       name: "Charme",        color: "#ffffff", icon: "⚪",   passiveId: "passive_adorable" },
    { id: "Passion",      name: "Passion",       color: "#ff4500", icon: "🔥",   passiveId: "passive_ardente" },
    { id: "Elegance",     name: "Elégance",      color: "#1e90ff", icon: "👗",   passiveId: "passive_garderobe" },
    { id: "Diva",         name: "Diva",          color: "#926885", icon: "👠",   passiveId: "passive_presence" },
    { id: "naturerelle",  name: "Naturelle",     color: "#32cd32", icon: "🌿",   passiveId: "passive_regeneration" },
    { id: "Rebelle",      name: "Rebelle",       color: "#6a0dad", icon: "😈",   passiveId: "passive_caracterielle" },
    { id: "Idole",        name: "Idole",         color: "#ffd700", icon: "✨",   passiveId: "passive_scenique" },
    { id: "Amazone",      name: "Amazone",       color: "#ff0019", icon: "🥊",   passiveId: "passive_contre_attaque" },
    { id: "Mystique",     name: "Mystique",      color: "#1affd9", icon: "🪄",   passiveId: "passive_hypnose" },
    { id: "Enchant",      name: "Enchanteresse", color: "#f948a1", icon: "🧚‍♀", passiveId: "passive_fanatisme" },
    { id: "Legende",      name: "Légende",       color: "#8c00ff", icon: "👑",   passiveId: "passive_mystere" },
  ];

  // ─── TALENTS DU MODE DÉFILÉ ─────────────────────────────────────────────────
  // Un Talent par type, activable UNE SEULE FOIS par duel, sur le passage où
  // la personnage de ce type est programmée. "effect" identifie la logique à
  // appliquer côté moteur (cf. CWDefileEngine) ; les montants exacts (%) sont
  // lus dans config.combat (defileTalent*), réglables depuis l'admin.
  const DEFILE_TALENTS = {
    Charme: {
      name: 'Grand Sourire',
      description: "Points garantis en plus sur ce passage.",
      effect: 'self_score_bonus_flat',
    },
    Elegance: {
      name: 'Rectification',
      description: "Annule le Talent adverse programmé sur ce même passage.",
      effect: 'cancel_enemy_talent_same_round',
    },
    naturerelle: {
      name: 'Second Souffle',
      description: "Restaure de l'Endurance à toute l'équipe.",
      effect: 'team_endurance_restore',
    },
    Rebelle: {
      name: 'Sale Rumeur',
      description: "Réduit les points du prochain passage adverse.",
      effect: 'enemy_next_round_malus',
    },
    Diva: {
      name: 'Chaos de Casting',
      description: "Change aléatoirement la catégorie du passage adverse du même numéro.",
      effect: 'enemy_same_round_random_category',
    },
    Passion: {
      name: 'Montée en Puissance',
      description: "Augmente ses propres stats pour ce passage.",
      effect: 'self_stats_boost',
    },
    Idole: {
      name: 'Sous les Projecteurs',
      description: "Transfère une partie de sa stat la plus haute dans le score de la stat demandée.",
      effect: 'self_stat_transfer',
    },
    Amazone: {
      name: 'Retournement',
      description: "Le prochain Talent activé ce duel (n'importe lequel) voit sa cible inversée.",
      effect: 'next_talent_reversal',
    },
    Mystique: {
      name: 'Substitution',
      description: "Échange les personnages de 2 passages adverses ultérieurs (choisis au déclenchement).",
      effect: 'swap_enemy_future_rounds',
    },
    Enchant: {
      name: 'Vol de Vedette',
      description: "Vole une partie de la stat jugée du passage adverse du même numéro.",
      effect: 'steal_enemy_same_round_stat',
    },
    Legende: {
      name: 'Polyvalence',
      description: "Copie un Talent adverse au choix, avant toute planification.",
      effect: 'copy_enemy_talent_pre_planning',
    },
  };

  /**
   * Résout le Talent d'un type en tenant compte des personnalisations admin
   * (nom/description) — retombe sur DEFILE_TALENTS si rien n'a été modifié.
   */
  function getDefileTalentDisplay(typeId, cfg) {
    const base = DEFILE_TALENTS[typeId];
    if (!base) return null;
    const nameOverride = cfg?.defileTalentNameOverrides?.[typeId];
    const descOverride = cfg?.defileTalentDescOverrides?.[typeId];
    return {
      ...base,
      name: nameOverride || base.name,
      description: descOverride || base.description,
    };
  }

  // ─── MATRICE DES TYPES ────────────────────────────────────────────────────────
  // Format : typeMatrix[attacker][defender] = multiplicateur
  // 2.0 = super efficace, 0.5 = peu efficace, 0 = immunité, 1.0 = normal

  const DEFAULT_TYPE_MATRIX = {
    Charme:      { Charme:2,   Legende:1,   Enchant:1,   Passion:1,   Elegance:1,   Diva:1,   naturerelle:1,   Rebelle:1,   Idole:1,   Amazone:1,   Mystique:1 },
    Legende:     { Charme:1,   Legende:1,   Enchant:0.5, Passion:2,   Elegance:1,   Diva:2,   naturerelle:1,   Rebelle:2,   Idole:2,   Amazone:1,   Mystique:1 },
    Enchant:     { Charme:1,   Legende:2,   Enchant:1,   Passion:1,   Elegance:1,   Diva:1,   naturerelle:1,   Rebelle:1,   Idole:1,   Amazone:0.5, Mystique:1 },
    Passion:     { Charme:1,   Legende:1,   Enchant:0.5, Passion:1,   Elegance:2,   Diva:1,   naturerelle:0.5, Rebelle:1,   Idole:2,   Amazone:0.5, Mystique:2 },
    Elegance:    { Charme:1,   Legende:0.5, Enchant:1,   Passion:0.5, Elegance:1,   Diva:2,   naturerelle:2,   Rebelle:0.5, Idole:1,   Amazone:1,   Mystique:2 },
    Diva:        { Charme:1,   Legende:1,   Enchant:1,   Passion:1,   Elegance:0.5, Diva:1,   naturerelle:2,   Rebelle:1,   Idole:0.5, Amazone:2,   Mystique:1 },
    naturerelle: { Charme:1,   Legende:1,   Enchant:1,   Passion:2,   Elegance:1,   Diva:0.5, naturerelle:0.5, Rebelle:2,   Idole:1,   Amazone:1,   Mystique:0.5 },
    Rebelle:     { Charme:1,   Legende:0.5, Enchant:1,   Passion:1,   Elegance:2,   Diva:1,   naturerelle:1,   Rebelle:1,   Idole:0.5, Amazone:2,   Mystique:1 },
    Idole:       { Charme:1,   Legende:0.5, Enchant:0.5, Passion:0.5, Elegance:1,   Diva:2,   naturerelle:1,   Rebelle:2,   Idole:1,   Amazone:1,   Mystique:1 },
    Amazone:     { Charme:1,   Legende:1,   Enchant:2,   Passion:2,   Elegance:1,   Diva:0.5, naturerelle:1,   Rebelle:0.5, Idole:1,   Amazone:1,   Mystique:1 },
    Mystique:    { Charme:1,   Legende:1,   Enchant:2,   Passion:1,   Elegance:0.5, Diva:1,   naturerelle:2,   Rebelle:1,   Idole:1,   Amazone:1,   Mystique:0.5 },
  };

  // ─── TAGS (créés manuellement depuis l'administration) ─────────────────────────
  const DEFAULT_TAG_CATEGORIES = [
    { id: 'continent',   name: 'Continent',   icon: '🌍', color: '#4a9eff' },
    { id: 'ethnie',      name: 'Ethnie',      icon: '👥', color: '#a78bfa' },
    { id: 'morphologie', name: 'Morphologie', icon: '💃', color: '#f472b6' },
    { id: 'style',       name: 'Style',       icon: '✨', color: '#f4c267' },
    { id: 'divers',      name: 'Divers',      icon: '🏷️', color: '#6b7280' },
  ];

  const DEFAULT_TAGS = [
    { id: 'europe',       name: 'Europe',          color: '#4a9eff', categoryId: 'continent' },
    { id: 'amerique',     name: 'Amérique du Nord', color: '#4a9eff', categoryId: 'continent' },
    { id: 'amerique_sud', name: 'Amérique du Sud',  color: '#4a9eff', categoryId: 'continent' },
    { id: 'asie',         name: 'Asie',             color: '#4a9eff', categoryId: 'continent' },
    { id: 'afrique',      name: 'Afrique',          color: '#4a9eff', categoryId: 'continent' },
    { id: 'oceanie',      name: 'Océanie',          color: '#4a9eff', categoryId: 'continent' },
    { id: 'moyen_orient', name: 'Moyen-Orient',     color: '#4a9eff', categoryId: 'continent' },
  ];

  // ─── PASSIFS (système de combat) ─────────────────────────────────────────────────
  // Un passif est rattaché à un TYPE (champ passiveId sur l'entrée de DEFAULT_TYPES
  // ci-dessus), JAMAIS directement à un personnage : tout personnage possédant ce
  // type (type1 ou type2) hérite automatiquement de son passif. Un personnage à 2
  // types cumule les 2 passifs s'ils existent.
  //
  // Chaque "effectType" correspond à un mécanisme codé en dur dans le moteur de
  // combat (engine.js) ; l'administration ne peut pas inventer de nouveau
  // mécanisme, mais peut librement modifier nom, description et paramètres
  // (pourcentages, etc.) de chaque passif depuis l'onglet "⚔️ Attaques".
  const PASSIVE_EFFECT_TYPES = {
    stat_boost_evasion:        { label: 'Grâce naturelle (esquive)',                    params: ['percent'] },
    random_passive_steal:      { label: 'Dérobe un secret au premier regard', params: [] },
    end_turn_aoe_damage:       { label: 'Fascination collective (dégâts AoE)',              params: ['chance', 'damagePercentMaxHp'] },
    buff_ally_atk_once:        { label: 'Souffle l\'ardeur à une alliée',     params: ['chance', 'percent'] },
    pre_attack_cleanse_self:   { label: 'Se recompose avant d\'agir', params: ['chance'] },
    on_hit_paralyze:           { label: 'Fige d\'un regard au contact',                        params: ['chance'] },
    end_turn_heal_lowest_ally: { label: 'Revitalise l\'alliée la plus fragile', params: ['chance', 'healPercentMaxHp'] },
    on_hit_poison:             { label: 'Inocule son venin au contact',                      params: ['chance', 'damagePercentMaxHp', 'duration'] },
    stat_boost_crit_damage:    { label: 'Frappe au cœur (critiques)',            params: ['percent'] },
    on_damaged_counter:        { label: 'Riposte instinctive',       params: ['chance'] },
    on_hit_charm:              { label: 'Ensorcelleuse au contact',                          params: ['chance'] },
  };

  const DEFAULT_PASSIVES = [
    { id: 'passive_adorable',      name: 'Adorable',      description: 'Ajoute 7% d\'esquive naturelle.',
      effectType: 'stat_boost_evasion',        params: { percent: 7 } },
    { id: 'passive_mystere',       name: 'Mystère',       description: 'En début de duel, dérobe l\'un des secrets de l\'adversaire (le passif volé est révélé).',
      effectType: 'random_passive_steal',      params: {} },
    { id: 'passive_fanatisme',     name: 'Fanatisme',     description: 'En fin de tour, 10% de chance d\'exercer une fascination dévastatrice sur toutes les rivales (5% de leur vitalité max).',
      effectType: 'end_turn_aoe_damage',       params: { chance: 10, damagePercentMaxHp: 5 } },
    { id: 'passive_ardente',       name: 'Ardente',       description: 'Insuffle 10% d\'ardeur supplémentaire à une alliée pour sa prochaine attaque (5% de chance).',
      effectType: 'buff_ally_atk_once',        params: { chance: 5, percent: 10 } },
    { id: 'passive_garderobe',     name: 'Garde Robe',    description: 'Se recompose avant d\'agir, effaçant toute altération (35% de chance).',
      effectType: 'pre_attack_cleanse_self',   params: { chance: 35 } },
    { id: 'passive_presence',      name: 'Présence',      description: 'Peut figer la rivale d\'un regard au contact (5% de chance, elle manque sa prochaine action).',
      effectType: 'on_hit_paralyze',           params: { chance: 5 } },
    { id: 'passive_regeneration',  name: 'Régénération',  description: 'Revitalise l\'alliée la plus fragile de 10% de sa vitalité max (10% de chance).',
      effectType: 'end_turn_heal_lowest_ally', params: { chance: 10, healPercentMaxHp: 10 } },
    { id: 'passive_caracterielle', name: 'Caractérielle', description: 'Peut inoculer son venin au contact (5% de chance, −2% de vitalité max par tour pendant 5 tours).',
      effectType: 'on_hit_poison',             params: { chance: 5, damagePercentMaxHp: 2, duration: 5 } },
    { id: 'passive_scenique',      name: 'Scénique',      description: 'Frappe au cœur avec 25% de puissance supplémentaire sur les coups décisifs.',
      effectType: 'stat_boost_crit_damage',    params: { percent: 25 } },
    { id: 'passive_contre_attaque',name: 'Contre-Attaque',description: 'Lorsqu\'elle encaisse, 5% de chance de riposter instantanément.',
      effectType: 'on_damaged_counter',        params: { chance: 5 } },
    { id: 'passive_hypnose',       name: 'Hypnose',       description: 'Peut ensorceler la rivale au contact (5% de chance, son attaque suivante se retourne contre une de ses alliées).',
      effectType: 'on_hit_charm',              params: { chance: 5 } },
  ];

  /**
   * Templates de quêtes Event par défaut — utilisés pour pré-remplir
   * les quêtes lors de la création d'un nouvel Event depuis l'admin.
   */
  const DEFAULT_EVENT_QUEST_TEMPLATES = [
    { type: 'event_defeat',       target: 20,  reward: { type: 'crystals', amount: 200 } },
    { type: 'event_defeat',       target: 50,  reward: { type: 'crystals', amount: 400 } },
    { type: 'event_capture',      target: 3,   reward: { type: 'crystals', amount: 300 } },
    { type: 'event_capture',      target: 8,   reward: { type: 'crystals', amount: 500 } },
    { type: 'event_win_caprice',  target: 5,   reward: { type: 'crystals', amount: 350 } },
    { type: 'event_win_tag',      target: 3,   reward: { type: 'crystals', amount: 400 } },
    { type: 'event_win_tag',      target: 8,   reward: { type: 'crystals', amount: 600 } },
    { type: 'event_win_with_tag', target: 10,  reward: { type: 'crystals', amount: 450 } },
    { type: 'event_summon',       target: 10,  reward: { type: 'gold',     amount: 500 } },
  ];

  /**
   * Config de combat Event par défaut (Caprice de Star et Combat Tag).
   * Chaque mode a ses propres paramètres indépendants.
   */
  const DEFAULT_EVENT_COMBAT_CONFIG = {
    capriceDeEtoile: {
      enabled:     true,
      energyCost:  10,
      difficulty:  1.0,
      xpMult:      1.2,
      goldMult:    1.2,
      diamondMult: 1.0,
    },
    combatTag: {
      enabled:     true,
      energyCost:  15,
      difficulty:  1.2,
      xpMult:      1.5,
      goldMult:    1.5,
      diamondMult: 1.2,
    },
  };

  /**
   * Cycle de connexion Event par défaut (10 jours, perso Épique au jour 10).
   * Utilisé pour pré-remplir lors de la création d'un Event.
   */
  const DEFAULT_EVENT_LOGIN_CYCLE = {
    id:      'ev_login_default',
    name:    'Rituel Event',
    length:  10,
    loop:    false,
    enabled: true,
    rewards: [
      { day: 1,  reward: { type: 'gold',     amount: 500 } },
      { day: 2,  reward: { type: 'crystals', amount: 100 } },
      { day: 3,  reward: { type: 'gold',     amount: 800 } },
      { day: 4,  reward: { type: 'crystals', amount: 150 } },
      { day: 5,  reward: { type: 'gold',     amount: 1000 } },
      { day: 6,  reward: { type: 'crystals', amount: 200 } },
      { day: 7,  reward: { type: 'gold',     amount: 1200 } },
      { day: 8,  reward: { type: 'crystals', amount: 300 } },
      { day: 9,  reward: { type: 'gold',     amount: 1500 } },
      { day: 10, reward: { type: 'character', refId: null, amount: 1 } }, // perso Épique du tag au J10
    ],
  };

  const DEFAULT_CHARACTERS = [
    // ── LIGNÉE 1 : Ignis → Pyria → Inferna ──
    {
      id: "char_001", name: "Ignis", description: "Une actrice ardente, dont la flamme intérieure consume tout sur son passage.",
      portrait: null, rarity: "common", evolutionLine: "line_001", evolutionStage: 0,
      type1: "Passion", type2: "Idole",
      baseStats: { hp: 350, atk: 65, def: 40, spd: 55 },
      evolutionCondition: { type: "level", value: 15 },
      evolvesTo: "char_002",
    },
    {
      id: "char_002", name: "Pyria", description: "Sa beauté s'est embrasée, révélant une présence dévastatrice.",
      portrait: null, rarity: "uncommon", evolutionLine: "line_001", evolutionStage: 1,
      type1: "Passion", type2: "Idole",
      baseStats: { hp: 550, atk: 95, def: 60, spd: 70 },
      evolutionCondition: { type: "level", value: 35 },
      evolvesTo: "char_003",
    },
    {
      id: "char_003", name: "Inferna", description: "L'incarnation du désir absolu. Sa seule présence consume l'atmosphère.",
      portrait: null, rarity: "epic", evolutionLine: "line_001", evolutionStage: 2,
      type1: "Passion", type2: "Idole",
      baseStats: { hp: 850, atk: 145, def: 90, spd: 90 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 2 : Aqua → Marina → Abyssara ──
    {
      id: "char_004", name: "Aqua", description: "Une actrice dont le regard limpide renferme des profondeurs insondables.",
      portrait: null, rarity: "common", evolutionLine: "line_002", evolutionStage: 0,
      type1: "Elegance", type2: null,
      baseStats: { hp: 400, atk: 55, def: 60, spd: 50 },
      evolutionCondition: { type: "level", value: 15 },
      evolvesTo: "char_005",
    },
    {
      id: "char_005", name: "Marina", description: "Fluide et irrésistible, elle impose sa cadence à ceux qui l'approchent.",
      portrait: null, rarity: "rare", evolutionLine: "line_002", evolutionStage: 1,
      type1: "Elegance", type2: null,
      baseStats: { hp: 650, atk: 85, def: 90, spd: 65 },
      evolutionCondition: { type: "level", value: 40 },
      evolvesTo: "char_006",
    },
    {
      id: "char_006", name: "Abyssara", description: "Souveraine des profondeurs. Sa beauté glacée engloutit les raisons.",
      portrait: null, rarity: "legendary", evolutionLine: "line_002", evolutionStage: 2,
      type1: "Elegance", type2: null,
      baseStats: { hp: 1100, atk: 130, def: 150, spd: 80 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 3 : Sylva → Florica → Verdania ──
    {
      id: "char_007", name: "Sylva", description: "Une actrice au naturel envoûtant, accordée aux secrets de la nature.",
      portrait: null, rarity: "common", evolutionLine: "line_003", evolutionStage: 0,
      type1: "naturerelle", type2: null,
      baseStats: { hp: 420, atk: 50, def: 55, spd: 60 },
      evolutionCondition: { type: "level", value: 12 },
      evolvesTo: "char_008",
    },
    {
      id: "char_008", name: "Florica", description: "Les fleurs éclosent à son passage ; son parfum trouble les esprits les plus résistants.",
      portrait: null, rarity: "uncommon", evolutionLine: "line_003", evolutionStage: 1,
      type1: "naturerelle", type2: null,
      baseStats: { hp: 650, atk: 75, def: 80, spd: 75 },
      evolutionCondition: { type: "level", value: 30 },
      evolvesTo: "char_009",
    },
    {
      id: "char_009", name: "Verdania", description: "L'essence même de la nature. Son souffle fait naître des jardins secrets en un instant.",
      portrait: null, rarity: "epic", evolutionLine: "line_003", evolutionStage: 2,
      type1: "naturerelle", type2: null,
      baseStats: { hp: 950, atk: 110, def: 130, spd: 95 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 4 : Umbra → Noctis → Voidria ──
    {
      id: "char_010", name: "Umbra", description: "Elle surgit de l'ombre avec la grâce d'un secret bien gardé.",
      portrait: null, rarity: "uncommon", evolutionLine: "line_004", evolutionStage: 0,
      type1: "Mystique", type2: null,
      baseStats: { hp: 330, atk: 80, def: 35, spd: 90 },
      evolutionCondition: { type: "level", value: 20 },
      evolvesTo: "char_011",
    },
    {
      id: "char_011", name: "Noctis", description: "L'obscurité personnifiée. Son regard perçoit ce que les autres refusent de voir.",
      portrait: null, rarity: "rare", evolutionLine: "line_004", evolutionStage: 1,
      type1: "Mystique", type2: null,
      baseStats: { hp: 520, atk: 120, def: 55, spd: 130 },
      evolutionCondition: { type: "level", value: 45 },
      evolvesTo: "char_012",
    },
    {
      id: "char_012", name: "Voidria", description: "Elle a transcendé le mystère lui-même. Elle est le silence fascinant entre les étoiles.",
      portrait: null, rarity: "mythic", evolutionLine: "line_004", evolutionStage: 2,
      type1: "Mystique", type2: null,
      baseStats: { hp: 800, atk: 200, def: 80, spd: 200 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 5 : Luce → Aurea → Solaria ──
    {
      id: "char_013", name: "Luce", description: "Une actrice lumineuse, dont la pureté est aussi troublante que sa beauté.",
      portrait: null, rarity: "common", evolutionLine: "line_005", evolutionStage: 0,
      type1: "Legende", type2: null,
      baseStats: { hp: 380, atk: 55, def: 65, spd: 55 },
      evolutionCondition: { type: "level", value: 18 },
      evolvesTo: "char_014",
    },
    {
      id: "char_014", name: "Aurea", description: "Bénie des dieux, sa grâce cache une puissance aussi tendre que fatale.",
      portrait: null, rarity: "rare", evolutionLine: "line_005", evolutionStage: 1,
      type1: "Legende", type2: null,
      baseStats: { hp: 600, atk: 90, def: 100, spd: 70 },
      evolutionCondition: { type: "level", value: 42 },
      evolvesTo: "char_015",
    },
    {
      id: "char_015", name: "Solaria", description: "L'étoile incarnée. Son éclat peut sublimer ou réduire en cendres.",
      portrait: null, rarity: "legendary", evolutionLine: "line_005", evolutionStage: 2,
      type1: "Legende", type2: null,
      baseStats: { hp: 1000, atk: 140, def: 140, spd: 90 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 6 : Volt → Strika → Thundara ──
    {
      id: "char_016", name: "Volt", description: "Sa silhouette file comme un éclair — et laisse une impression durable.",
      portrait: null, rarity: "uncommon", evolutionLine: "line_006", evolutionStage: 0,
      type1: "Amazone", type2: null,
      baseStats: { hp: 310, atk: 75, def: 30, spd: 110 },
      evolutionCondition: { type: "level", value: 22 },
      evolvesTo: "char_017",
    },
    {
      id: "char_017", name: "Strika", description: "Chaque mouvement dégage une énergie qui électrise ceux qui l'entourent.",
      portrait: null, rarity: "rare", evolutionLine: "line_006", evolutionStage: 1,
      type1: "Amazone", type2: null,
      baseStats: { hp: 490, atk: 110, def: 50, spd: 160 },
      evolutionCondition: { type: "level", value: 50 },
      evolvesTo: "char_018",
    },
    {
      id: "char_018", name: "Thundara", description: "La tempête éternelle. Les cieux eux-mêmes plient devant son allure.",
      portrait: null, rarity: "legendary", evolutionLine: "line_006", evolutionStage: 2,
      type1: "Amazone", type2: null,
      baseStats: { hp: 750, atk: 175, def: 70, spd: 230 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 7 : Frosta → Crystallia → Glaciara ──
    {
      id: "char_019", name: "Frosta", description: "Son contact est glacial — et pourtant, inoubliable.",
      portrait: null, rarity: "common", evolutionLine: "line_007", evolutionStage: 0,
      type1: "Diva", type2: null,
      baseStats: { hp: 360, atk: 60, def: 50, spd: 65 },
      evolutionCondition: { type: "level", value: 14 },
      evolvesTo: "char_020",
    },
    {
      id: "char_020", name: "Crystallia", description: "Sculptée dans la glace la plus pure, chaque facette de son être tranche comme un diamant.",
      portrait: null, rarity: "rare", evolutionLine: "line_007", evolutionStage: 1,
      type1: "Diva", type2: null,
      baseStats: { hp: 570, atk: 90, def: 80, spd: 80 },
      evolutionCondition: { type: "level", value: 38 },
      evolvesTo: "char_021",
    },
    {
      id: "char_021", name: "Glaciara", description: "D'une beauté figée dans l'éternité, elle impose son tempo au temps lui-même.",
      portrait: null, rarity: "epic", evolutionLine: "line_007", evolutionStage: 2,
      type1: "Diva", type2: null,
      baseStats: { hp: 880, atk: 135, def: 125, spd: 100 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 8 : Ferroa → Titanis → Adamantia ──
    {
      id: "char_022", name: "Ferroa", description: "Une rebelle blindée, dont l'apparente froideur dissimule un feu intérieur.",
      portrait: null, rarity: "uncommon", evolutionLine: "line_008", evolutionStage: 0,
      type1: "Rebelle", type2: null,
      baseStats: { hp: 500, atk: 55, def: 90, spd: 35 },
      evolutionCondition: { type: "level", value: 25 },
      evolvesTo: "char_023",
    },
    {
      id: "char_023", name: "Titanis", description: "Elle a fusionné avec sa carapace. Sa dureté est devenue sa plus grande séduction.",
      portrait: null, rarity: "rare", evolutionLine: "line_008", evolutionStage: 1,
      type1: "Rebelle", type2: null,
      baseStats: { hp: 800, atk: 85, def: 145, spd: 45 },
      evolutionCondition: { type: "level", value: 55 },
      evolvesTo: "char_024",
    },
    {
      id: "char_024", name: "Adamantia", description: "Forgée dans l'absolu, son endurance fascine autant qu'elle terrife.",
      portrait: null, rarity: "legendary", evolutionLine: "line_008", evolutionStage: 2,
      type1: "Rebelle", type2: null,
      baseStats: { hp: 1300, atk: 130, def: 220, spd: 55 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 9 : Mystara → Arcania → Omnimaga ──
    {
      id: "char_025", name: "Mystara", description: "Une actrice aux dons imprévisibles, dont le charme échappe à toute définition.",
      portrait: null, rarity: "common", evolutionLine: "line_009", evolutionStage: 0,
      type1: "Enchant", type2: null,
      baseStats: { hp: 340, atk: 70, def: 40, spd: 60 },
      evolutionCondition: { type: "level", value: 16 },
      evolvesTo: "char_026",
    },
    {
      id: "char_026", name: "Arcania", description: "Elle maîtrise 7 des 9 arts de la séduction ancienne.",
      portrait: null, rarity: "epic", evolutionLine: "line_009", evolutionStage: 1,
      type1: "Enchant", type2: null,
      baseStats: { hp: 550, atk: 115, def: 65, spd: 85 },
      evolutionCondition: { type: "level", value: 45 },
      evolvesTo: "char_027",
    },
    {
      id: "char_027", name: "Omnimaga", description: "Le charme incarné. Elle remodèle la réalité selon ses désirs.",
      portrait: null, rarity: "mythic", evolutionLine: "line_009", evolutionStage: 2,
      type1: "Enchant", type2: null,
      baseStats: { hp: 900, atk: 190, def: 100, spd: 120 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 10 : Chaora (Personnage solo sans évolution) ──
    {
      id: "char_028", name: "Chaora", description: "L'imprévisible. Son charme échappe à toute loi, à toute forme attendue.",
      portrait: null, rarity: "mythic", evolutionLine: "line_010", evolutionStage: 0,
      type1: "Charme", type2: null,
      baseStats: { hp: 999, atk: 180, def: 80, spd: 180 },
      evolutionCondition: null, evolvesTo: null,
    },

    // ── LIGNÉE 11 : Zara → Zephyra ──
    {
      id: "char_029", name: "Zara", description: "Une nomade libre dont le sourire est la seule arme dont elle ait besoin.",
      portrait: null, rarity: "rare", evolutionLine: "line_011", evolutionStage: 0,
      type1: null, type2: null,
      baseStats: { hp: 450, atk: 90, def: 55, spd: 95 },
      evolutionCondition: { type: "level", value: 30 },
      evolvesTo: "char_030",
    },
    {
      id: "char_030", name: "Zephyra", description: "Elle chevauche les tempêtes avec l'élégance de celle qui n'a rien à prouver.",
      portrait: null, rarity: "epic", evolutionLine: "line_011", evolutionStage: 1,
      type1: null, type2: null,
      baseStats: { hp: 720, atk: 140, def: 85, spd: 145 },
      evolutionCondition: null, evolvesTo: null,
    },
  ];

  // ─── RARITÉS ──────────────────────────────────────────────────────────────────

  const RARITIES = {
    common:    { name: "Figurante",    color: "#9CA3AF", stars: 1, gachaWeight: 50 },
    uncommon:  { name: "Starlette",color: "#34D399", stars: 2, gachaWeight: 30 },
    rare:      { name: "Vedette",       color: "#60A5FA", stars: 3, gachaWeight: 12.5 },
    epic:      { name: "Star",     color: "#A78BFA", stars: 4, gachaWeight: 5  },
    legendary: { name: "Icône", color: "#F59E0B", stars: 5, gachaWeight: 2  },
    mythic:    { name: "Divine",    color: "#F43F5E", stars: 6, gachaWeight: 0.5},
  };

  // ─── BANNIÈRES GACHA ─────────────────────────────────────────────────────────

  const DEFAULT_BANNERS = [
    {
      id: "banner_standard", name: "Rencontre Standard",
      description: "Toutes les actrices disponibles vous attendent.", active: true,
      featured: [], pool: "all",
      featuredRateBoost: 0,
    },
    {
      id: "banner_fire", name: "Défilé Ardent",
      description: "Les actrices de feu s'y révèlent sous leur meilleur jour.",
      active: true, featured: ["char_003", "char_015"],
      pool: "all", featuredRateBoost: 2.0,
    },
  ];

  // ─── ÉQUIPEMENTS ─────────────────────────────────────────────────────────────

  const DEFAULT_EQUIPMENT = [
    { id: "ArmeC", name: "Stiletto d'Acier", slot: "weapon", description: "", rarity: "common", level: 1, maxLevel: 10, bonuses: { hp: 0, atk: 15, def: 0, spd: 0 } },
    { id: "ArmeU", name: "Lame Dorée", slot: "weapon", description: "", rarity: "uncommon", level: 1, maxLevel: 10, bonuses: { hp: 0, atk: 20, def: 0, spd: 0 } },
    { id: "ArmeR", name: "Épine de Lumière", slot: "weapon", description: "", rarity: "rare", level: 1, maxLevel: 10, bonuses: { hp: 20, atk: 30, def: 0, spd: 5 } },
    { id: "ArmeE", name: "Canne de Velours", slot: "weapon", description: "", rarity: "epic", level: 1, maxLevel: 10, bonuses: { hp: 35, atk: 50, def: 5, spd: 5 } },
    { id: "equip_005", name: "Sceptre de Râ", slot: "weapon", description: "L'arme d'apparat de la reine des sables.", rarity: "legendary", level: 1, maxLevel: 10, bonuses: { hp: 100, atk: 80, def: 20, spd: 15 } },
    { id: "ArmeM", name: "Foudre de Zeus", slot: "weapon", description: "", rarity: "mythic", level: 1, maxLevel: 10, bonuses: { hp: 200, atk: 250, def: 50, spd: 50 } },
    { id: "ArmureC", name: "Bustier d'Envie", slot: "armor", description: "", rarity: "common", level: 1, maxLevel: 10, bonuses: { hp: 0, atk: 0, def: 10, spd: 0 } },
    { id: "equip_003", name: "Voile Argenté", slot: "armor", description: "", rarity: "uncommon", level: 1, maxLevel: 10, bonuses: { hp: 0, atk: 0, def: 20, spd: 0 } },
    { id: "equip_002", name: "Robe de Cristal", slot: "armor", description: "Une cuirasse dont l'éclat intimide autant qu'elle protège.", rarity: "rare", level: 1, maxLevel: 10, bonuses: { hp: 50, atk: 0, def: 30, spd: 0 } },
    { id: "ArmureE", name: "Couronne d'Acier", slot: "armor", description: "", rarity: "epic", level: 1, maxLevel: 10, bonuses: { hp: 75, atk: 0, def: 70, spd: 0 } },
    { id: "ArmureR", name: "Bouclier d'Héra", slot: "armor", description: "", rarity: "legendary", level: 1, maxLevel: 10, bonuses: { hp: 80, atk: 10, def: 100, spd: 10 } },
    { id: "ArmureM", name: "Manteau du Serpent-Monde", slot: "armor", description: "", rarity: "mythic", level: 1, maxLevel: 10, bonuses: { hp: 200, atk: 35, def: 250, spd: 25 } },
    { id: "AccAtkC", name: "Bague d'Arès", slot: "accessory", description: "", rarity: "uncommon", level: 1, maxLevel: 10, bonuses: { hp: 10, atk: 5, def: 0, spd: 0 } },
    { id: "equip_001", name: "Bague d'Hermès", slot: "accessory", description: "Sa légèreté dissimule une efficacité irrésistible.", rarity: "uncommon", level: 1, maxLevel: 10, bonuses: { hp: 10, atk: 0, def: 0, spd: 10 } },
    { id: "AccR", name: "Collier Envoûté", slot: "accessory", description: "", rarity: "rare", level: 1, maxLevel: 10, bonuses: { hp: 50, atk: 10, def: 10, spd: 5 } },
    { id: "equip_004", name: "Talisman de Poséidon", slot: "accessory", description: "Ce talisman insuffle une vitalité envoûtante à qui le porte.", rarity: "epic", level: 1, maxLevel: 10, bonuses: { hp: 200, atk: 10, def: 10, spd: 5 } },
    { id: "AccL", name: "Œil d'Hypnos", slot: "accessory", description: "", rarity: "legendary", level: 1, maxLevel: 10, bonuses: { hp: 400, atk: 35, def: 35, spd: 25 } },
    { id: "AccM", name: "Âme de Chronos", slot: "accessory", description: "", rarity: "mythic", level: 1, maxLevel: 10, bonuses: { hp: 800, atk: 100, def: 100, spd: 80 } },
  ];

  // ─── DONNÉES JOUEUR PAR DÉFAUT ────────────────────────────────────────────────

  const DEFAULT_PLAYER = {
    id: "player_local",
    name: "Séducteur",
    level: 1,
    experience: 0,
    currency: { crystals: 0, gold: 0 },
    energy: { current: 100, max: 100, lastRegen: Date.now() },
    team: [],              // IDs des instances dans la collection
    collection: [],        // Tableau d'instances de personnages
    equipment: [],         // Équipements du joueur (instances)
    catalogue: {},          // { charId: { discovered: true, portrait: null, ... } }
    inventory: {},         // { itemId: quantity }
    equipInventory: [],    // Instances d'équipements obtenus
    story: {               // Progression Mode Odyssée
      world: 1,            // Monde courant (1-indexé)
      subLevel: 0,         // Dernier sous-niveau COMPLÉTÉ (0 = aucun)
    },
    recordBest: 0,          // Meilleur score jamais atteint en mode Performance
    recordClaimedTierCount: 0, // Nombre de paliers du totem déjà réclamés
    affinity: {},           // { [evolutionLine]: pourcentage 0-100 } — remplace le Gacha
    // ── Grand Casting ────────────────────────────────────────────────────
    reputation: 0,               // Ressource dédiée, cumulative entre les Castings
    defilesSinceLastCasting: 0,  // Compteur, remis à 0 à l'ouverture d'un nouveau Casting
    castingThreshold: null,      // Nb de Défilés à atteindre ce cycle (tiré 25-30, null = à initialiser)
    currentCasting: null,        // Casting en cours (candidates + enchères), null si aucun ouvert
    storyMode: {           // Progression Mode Histoire
      // { [chapterIdx]: { completedStages: [1,2,...], highestStage: 3 } }
    },
    dailyLogin: {           // Progression des cycles de récompense de connexion quotidienne
      progress: {},         // { [cycleId]: { currentDay: 1, lastClaimDate: 'YYYY-MM-DD'|null } }
    },
    dailyQuestState: {       // Les 3 quêtes quotidiennes tirées pour aujourd'hui
      date: null,            // 'YYYY-MM-DD' du tirage en cours
      activeQuestIds: [],    // Les 3 IDs de quêtes tirées aujourd'hui
      progress: {},          // { [questId]: nombre actuel }
      claimed: {},           // { [questId]: true|false }
    },
    equipPity: {           // Pitié gacha équipements
      standard: { pulls: 0, rareGuarantee: 0, epicGuarantee: 0 },
    },
    pity: {                // Système de pitié gacha
      standard: { pulls: 0, rareGuarantee: 0, epicGuarantee: 0, legendaryGuarantee: 0 },
    },
    stats: {
      totalPulls:       0,   // invocations totales
      totalBattles:     0,   // combats lancés
      totalVictories:   0,   // combats gagnés
      totalDefeats:     0,   // combats perdus
      totalCaptures:    0,   // captures réussies
      totalKills:       0,   // ennemis vaincus (tous combats)
      totalEvolutions:  0,   // évolutions effectuées
      totalAwakenings:  0,   // éveils effectués
      totalGoldEarned:  0,   // or total gagné
      totalCrystalsEarned: 0,// diamants totaux gagnés
      totalGoldSpent:   0,   // or total dépensé
      totalCrystalsSpent:  0,// diamants totaux dépensés
      longestWinStreak: 0,   // plus longue série de victoires
      currentWinStreak: 0,   // série en cours
      favoriteCharId:   null,// perso le plus utilisé (id)
      playTimeMinutes:  0,   // temps de jeu estimé (minutes)
      // ── Mode Défilé ──────────────────────────────────────────────────────
      totalDefiles:      0,  // Défilés disputés
      totalDefilesWon:   0,  // Défilés remportés
      totalPassagesWon:  0,  // passages individuels remportés (toutes personnages confondues)
      totalDefilePoints: 0,  // points cumulés marqués en Défilé (toutes personnages confondues)
      playtime: 0,
    },
  };

  // ─── ITEMS ────────────────────────────────────────────────────────────────────

  // ─── EFFETS D'OBJETS (registre extensible) ─────────────────────────────────────
  // Chaque type d'effet sait comment s'appliquer ; la quantité ("amount") est
  // toujours configurable par objet depuis l'administration. De nouveaux types
  // pourront être ajoutés ici au fil du temps.
  const ITEM_EFFECT_TYPES = {
    level_up: {
      label: 'Montée en Prestige',
      description: 'Fait gagner un certain nombre de niveaux de prestige à l\'actrice choisie.',
      amountLabel: 'Prestiges accordés',
      requiresTarget: true,   // nécessite de choisir une créature
    },
    energy_regen: {
      label: 'Regain de Désir',
      description: 'Redonne immédiatement un certain nombre de points d\'énergie au joueur.',
      amountLabel: 'Désir regagné',
      requiresTarget: false,  // s'applique directement au joueur
    },
  };

  const DEFAULT_ITEMS = [
    {
      id: 'item_power_pill',
      name: 'Élixir de Prestige',
      icon: '💊',
      description: 'Confère instantanément un niveau de prestige supplémentaire à l\'égérie choisie.',
      stackable: true,
      effect: { type: 'level_up', amount: 1 },
    },
    {
      id: 'item_energy_potion',
      name: 'Nectar du Désir',
      icon: '🧪',
      description: 'Redonne immédiatement 50 points d\'énergie.',
      stackable: true,
      effect: { type: 'energy_regen', amount: 50 },
    },
  ];

  // ─── BOUTIQUE ───────────────────────────────────────────────────────────────────
  // Catalogue d'articles à vendre, distinct des définitions elles-mêmes (créatures /
  // équipements / objets) : chaque entrée référence un ID existant avec un prix et
  // une devise propres, entièrement paramétrables depuis l'administration.
  const DEFAULT_SHOP_LISTINGS = [
    { id: 'shop_1781970094272', kind: 'equipment', refId: 'ArmureC', price: 100, currency: 'gold', enabled: true },
    { id: 'shop_1781970134789', kind: 'item', refId: 'item_power_pill', price: 100, currency: 'crystals', enabled: true },
  ];

  // ─── RÉCOMPENSE DE CONNEXION QUOTIDIENNE ────────────────────────────────────────
  // Aucun cycle par défaut : l'administrateur en crée autant qu'il le souhaite
  // (ex: un cycle de 7 jours en pièces, un cycle de 3 jours en potions...), chacun
  // activable/désactivable indépendamment. Forme d'un cycle :
  // { id, name, length, loop, enabled, rewards: [{ day, reward }] }
  // où "reward" suit la même forme générique que les articles de boutique :
  // { type:'gold'|'crystals'|'item'|'equipment'|'character', amount, refId? }
  const DEFAULT_DAILY_LOGIN_CYCLES = [
    { id: "CyclePièces", name: "Cycle Or", length: 7, loop: true, enabled: true, rewards: [{ day: 1, reward: { type: "gold", amount: 100 } }, { day: 2, reward: { type: "gold", amount: 200 } }, { day: 3, reward: { type: "gold", amount: 300 } }, { day: 4, reward: { type: "gold", amount: 400 } }, { day: 5, reward: { type: "gold", amount: 500 } }, { day: 6, reward: { type: "gold", amount: 600 } }, { day: 7, reward: { type: "gold", amount: 700 } }] },
    { id: "Cycle Diamants", name: "Cycle Diamants", length: 7, loop: true, enabled: true, rewards: [{ day: 1, reward: { type: "crystals", amount: 20 } }, { day: 2, reward: { type: "crystals", amount: 40 } }, { day: 3, reward: { type: "crystals", amount: 60 } }, { day: 4, reward: { type: "crystals", amount: 80 } }, { day: 5, reward: { type: "crystals", amount: 100 } }, { day: 6, reward: { type: "crystals", amount: 120 } }, { day: 7, reward: { type: "crystals", amount: 150 } }] },
    { id: "Cycle Cadeaux", name: "Cycle Cadeaux", length: 5, loop: true, enabled: true, rewards: [{ day: 1, reward: { type: "item", amount: 1, refId: "item_energy_potion" } }, { day: 2, reward: { type: "item", amount: 1, refId: "item_energy_potion" } }, { day: 3, reward: { type: "item", amount: 1, refId: "item_energy_potion" } }, { day: 4, reward: { type: "item", amount: 2, refId: "item_energy_potion" } }, { day: 5, reward: { type: "item", amount: 1, refId: "item_power_pill" } }] },
  ];

  // ─── QUÊTES QUOTIDIENNES ─────────────────────────────────────────────────────────
  // Registre des types de quêtes trackables (chacun correspond à un évènement de jeu
  // précis, suivi automatiquement). L'admin ne peut pas créer de nouveau TYPE (ce sont
  // des mécaniques de jeu fixes), mais configure librement la cible et la récompense.
  const QUEST_TYPES = {
    capture_character:     { label: 'Séduire des actrices (duel)' },
    defeat_enemies:        { label: 'Remporter des duels' },
    summon_equipment:      { label: 'Découvrir des parures (Rencontre)' },
    summon_character:      { label: 'Faire des rencontres (Gacha)' },
    win_line_combat:       { label: 'Triompher en Saga' },
    win_full_random_combat:{ label: 'Réussir des Caprices' },
    win_odyssey_combat:    { label: 'Réussir des Tournées' },
    complete_daily_quests: { label: 'Terminer toutes les quêtes Quotidiennes' },
    complete_weekly_quests:{ label: 'Terminer toutes les quêtes Hebdomadaires' },
    complete_event_quests: { label: 'Terminer toutes les quêtes d\'Event' },
    event_defeat:          { label: 'Éliminer des rivales [Tag]' },
    event_capture:         { label: 'Capturer des rivales [Tag]' },
    event_win_caprice:     { label: 'Réussir des Caprices de Star' },
    event_win_tag:         { label: 'Réussir des combats [Tag]' },
    event_win_with_tag:    { label: 'Finir un combat avec un perso [Tag] vivant' },
    event_summon:          { label: 'Rencontrer sur la bannière [Tag]' },
  };

  // Pool de quêtes hebdomadaires — objectifs ×5 vs quotidiennes, récompenses proportionnellement plus généreuses.
  // 5 quêtes sont tirées aléatoirement chaque lundi à minuit (heure locale).
  const DEFAULT_WEEKLY_QUESTS = [
    { id: "wq_capture_5",       type: "capture_character",     target: 5,  name: "Séduire 5 actrices",       reward: { type: "crystals", amount: 100 } },
    { id: "wq_capture_10",      type: "capture_character",     target: 10, name: "Séduire 10 actrices",      reward: { type: "crystals", amount: 200 } },
    { id: "wq_capture_15",      type: "capture_character",     target: 15, name: "Séduire 15 actrices",      reward: { type: "crystals", amount: 350 } },
    { id: "wq_defeat_25",       type: "defeat_enemies",        target: 25, name: "Remporter 25 duels",       reward: { type: "gold",     amount: 800 } },
    { id: "wq_defeat_50",       type: "defeat_enemies",        target: 50, name: "Remporter 50 duels",       reward: { type: "gold",     amount: 1500 } },
    { id: "wq_summon_eq_5",     type: "summon_equipment",      target: 5,  name: "Découvrir 5 parures",      reward: { type: "gold",     amount: 300 } },
    { id: "wq_summon_eq_25",    type: "summon_equipment",      target: 25, name: "Découvrir 25 parures",     reward: { type: "gold",     amount: 1200 } },
    { id: "wq_summon_char_5",   type: "summon_character",      target: 5,  name: "Faire 5 rencontres",       reward: { type: "crystals", amount: 250 } },
    { id: "wq_summon_char_50",  type: "summon_character",      target: 50, name: "Faire 50 rencontres",      reward: { type: "crystals", amount: 2000 } },
    { id: "wq_line_5",          type: "win_line_combat",       target: 5,  name: "Triompher de 5 Sagas",     reward: { type: "gold",     amount: 800 } },
    { id: "wq_line_15",         type: "win_line_combat",       target: 15, name: "Triompher de 15 Sagas",    reward: { type: "gold",     amount: 2000 } },
    { id: "wq_fullrandom_5",    type: "win_full_random_combat",target: 5,  name: "Réussir 5 Caprices",      reward: { type: "gold",     amount: 800 } },
    { id: "wq_fullrandom_15",   type: "win_full_random_combat",target: 15, name: "Réussir 15 Caprices",     reward: { type: "gold",     amount: 2000 } },
    { id: "wq_odyssey_5",       type: "win_odyssey_combat",    target: 5,  name: "Réussir 5 Tournées",      reward: { type: "item",     amount: 10, refId: "item_energy_potion" } },
    { id: "wq_odyssey_15",      type: "win_odyssey_combat",    target: 15, name: "Réussir 15 Tournées",     reward: { type: "crystals", amount: 500 } },
    { id: "wq_complete_daily",  type: "complete_daily_quests", target: 1,  name: "Terminer toutes les quêtes Quotidiennes", reward: { type: "crystals", amount: 150 } },
  ];
  // librement depuis l'administration (type, quantité, objet/équipement/créature).
  const DEFAULT_DAILY_QUESTS = [
    { id: "quest_capture_1", type: "capture_character", target: 1, name: "Séduire 1 actrice", enabled: true, reward: { type: "crystals", amount: 15 } },
    { id: "quest_capture_2", type: "capture_character", target: 2, name: "Séduire 2 actrices", enabled: true, reward: { type: "crystals", amount: 35 } },
    { id: "quest_capture_3", type: "capture_character", target: 3, name: "Séduire 3 actrices", enabled: true, reward: { type: "crystals", amount: 70 } },
    { id: "quest_defeat_5", type: "defeat_enemies", target: 5, name: "Remporter 5 duels", enabled: true, reward: { type: "gold", amount: 150 } },
    { id: "quest_defeat_10", type: "defeat_enemies", target: 10, name: "Remporter 10 duels", enabled: true, reward: { type: "gold", amount: 300 } },
    { id: "quest_summon_eq_1", type: "summon_equipment", target: 1, name: "Découvrir 1 parure", enabled: true, reward: { type: "gold", amount: 50 } },
    { id: "quest_summon_eq_10", type: "summon_equipment", target: 10, name: "Découvrir 10 parures", enabled: true, reward: { type: "gold", amount: 550 } },
    { id: "quest_summon_char_1", type: "summon_character", target: 1, name: "Faire 1 rencontre", enabled: true, reward: { type: "crystals", amount: 50 } },
    { id: "quest_summon_char_10", type: "summon_character", target: 10, name: "Faire 10 rencontres", enabled: true, reward: { type: "crystals", amount: 550 } },
    { id: "quest_line_1", type: "win_line_combat", target: 1, name: "Triompher d'1 Saga", enabled: true, reward: { type: "gold", amount: 150 } },
    { id: "quest_line_3", type: "win_line_combat", target: 3, name: "Triompher de 3 Sagas", enabled: true, reward: { type: "gold", amount: 400 } },
    { id: "quest_fullrandom_1", type: "win_full_random_combat", target: 1, name: "Réussir 1 Caprice", enabled: true, reward: { type: "gold", amount: 150 } },
    { id: "quest_fullrandom_3", type: "win_full_random_combat", target: 3, name: "Réussir 3 Caprices", enabled: true, reward: { type: "gold", amount: 400 } },
    { id: "quest_odyssey_1", type: "win_odyssey_combat", target: 1, name: "Réussir 1 Tournée", enabled: true, reward: { type: "item", amount: 3, refId: "item_energy_potion" } },
  ];

  // ─── BANNIÈRE GACHA ÉQUIPEMENTS ───────────────────────────────────────────────

  const DEFAULT_EQUIP_BANNERS = [
    {
      id: 'equip_banner_standard',
      name: 'Invocation Équipement',
      description: 'Obtenez des équipements pour renforcer vos personnages.',
      active: true,
      singlePullCost: 80,
      tenPullCost: 720,
      guaranteedRareAfter: 10,
      guaranteedEpicAfter: 30,
      dropRates: {
        common:    45,
        uncommon:  30,
        rare:      16,
        epic:       7,
        legendary:  2,
      },
    },
  ];

  // ─── DONNÉES FUTURES (stubs pour migration) ───────────────────────────────────

  const FUTURE_STUBS = {
    talents: [],
    activeSkills: [],
    passiveSkills: [],
    items: [],
    weapons: [],
    events: [],
    quests: [],
    achievements: [],
    leaderboard: [],
    onlineConfig: { enabled: false, serverUrl: null, wsUrl: null },
  };

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return {
    DEFAULT_CONFIG,
    DEFAULT_TYPES,
    DEFILE_TALENTS,
    getDefileTalentDisplay,
    DEFAULT_TYPE_MATRIX,
    DEFAULT_CHARACTERS,
    RARITIES,
    DEFAULT_BANNERS,
    DEFAULT_EQUIPMENT,
    DEFAULT_ITEMS,
    ITEM_EFFECT_TYPES,
    DEFAULT_SHOP_LISTINGS,
    DEFAULT_DAILY_LOGIN_CYCLES,
    QUEST_TYPES,
    DEFAULT_DAILY_QUESTS,
    DEFAULT_WEEKLY_QUESTS,
    DEFAULT_TAG_CATEGORIES,
    DEFAULT_TAGS,
    PASSIVE_EFFECT_TYPES,
    DEFAULT_PASSIVES,
    DEFAULT_EQUIP_BANNERS,
    DEFAULT_EVENT_QUEST_TEMPLATES, DEFAULT_EVENT_COMBAT_CONFIG, DEFAULT_EVENT_LOGIN_CYCLE,
    DEFAULT_PLAYER,
    FUTURE_STUBS,

    /** Les 3 slots d'équipement valides, dans l'ordre (index 0, 1, 2) */
    EQUIP_SLOTS: ['weapon', 'armor', 'accessory'],

    /**
     * Résout le slot d'un équipement, avec repli sur l'ancien champ "category"
     * pour les équipements créés avant l'introduction du système de slots.
     * @param {object} equipDef
     * @returns {'weapon'|'armor'|'accessory'}
     */
    resolveEquipSlot(equipDef) {
      if (!equipDef) return 'accessory';
      if (['weapon', 'armor', 'accessory'].includes(equipDef.slot)) return equipDef.slot;
      const legacyMap = { ring: 'accessory', boots: 'armor', armor: 'armor', weapon: 'weapon', accessory: 'accessory' };
      return legacyMap[equipDef.category] || 'accessory';
    },

    /**
     * Calcule le total des bonus d'équipement pour un personnage, en résolvant
     * les exemplaires d'inventaire référencés par inst.equipment (IDs d'exemplaire,
     * pas IDs de définition — un exemplaire physique ne peut être équipé qu'une fois).
     * @param {Array<string|null>} equipmentRefs - inst.equipment (3 slots)
     * @param {Array<object>} equipInventory - player.equipInventory
     * @param {Array<object>} equipmentDefs  - état.equipment (définitions)
     * @returns {{hp:number, atk:number, def:number, spd:number}}
     */
    computeEquipBonus(equipmentRefs, equipInventory, equipmentDefs) {
      const bonus = { hp: 0, atk: 0, def: 0, spd: 0 };
      if (!equipmentRefs) return bonus;
      // equipment peut être un objet {slot: instanceId} ou un tableau [instanceId]
      const refs = Array.isArray(equipmentRefs)
        ? equipmentRefs
        : Object.values(equipmentRefs);
      refs.forEach(refId => {
        if (!refId) return;
        const invEntry = (equipInventory || []).find(ei => ei.instanceId === refId);
        const def = invEntry ? (equipmentDefs || []).find(e => e.id === invEntry.equipId) : null;
        if (def?.bonuses) {
          bonus.hp  += def.bonuses.hp  || 0;
          bonus.atk += def.bonuses.atk || 0;
          bonus.def += def.bonuses.def || 0;
          bonus.spd += def.bonuses.spd || 0;
        }
      });
      return bonus;
    },

    /**
     * Calcule le score de puissance "Aura" d'un personnage à partir de ses
     * stats totales finales (base + niveau + éveil + équipement + bonus joueur).
     * Dérivé de la VRAIE formule de combat (dégâts, crit) plutôt que d'une
     * simple somme pondérée arbitraire, pour refléter la puissance réelle en
     * combat : DPS effectif (ATK, DEF adverse de référence, crit via VIT) et
     * PV effectifs (PV amplifiés par sa propre DEF face à ce même adversaire
     * de référence), combinés en moyenne géométrique pour pénaliser les
     * profils déséquilibrés (un perso doit à la fois taper fort ET survivre).
     * @param {{hp:number, atk:number, def:number, spd:number}} stats
     * @param {object} combatCfg - config.combat (scoreDefReference, critDivisor, critMultiplier)
     * @returns {number}
     */
    /**
     * Score d'Aura — reflète directement la logique du Défilé plutôt que
     * l'ancien combat (plus de PV/critique/DPS) :
     * - Moyenne géométrique de Charisme/Prestance/Grâce (atk/def/spd), pour
     *   garder l'esprit "pénalise les profils déséquilibrés" : un personnage
     *   doit être polyvalente, pas juste excellente sur une seule stat.
     * - Multipliée par (1 + potentiel maximal de Bonus Forme), calculé
     *   exactement comme en jeu (Endurance max ÷ 100) — une personnage
     *   endurante vaut structurellement plus dans ce nouveau système.
     * @param {{hp:number, atk:number, def:number, spd:number}} stats
     * @returns {number}
     */
    computeAuraScore(stats) {
      const atk = Math.max(0, stats?.atk || 0);
      const def = Math.max(0, stats?.def || 0);
      const spd = Math.max(0, stats?.spd || 0);
      const hp  = Math.max(0, stats?.hp  || 0);

      return Math.round((atk + def + spd + (hp / 10)) * 5);
    },

    /**
     * Retourne le multiplicateur de type attaquant → défenseur
     * @param {string} attackType - ID type attaquant
     * @param {string} defType1   - ID type défenseur principal
     * @param {string|null} defType2 - ID type défenseur secondaire
     * @param {object} matrix - Matrice de types actuelle
     * @returns {number} Multiplicateur final
     */
    getTypeEffectiveness(attackType, defType1, defType2, matrix) {
      const m = matrix || DEFAULT_TYPE_MATRIX;
      let mult = (m[attackType]?.[defType1]) ?? 1.0;
      if (defType2 && defType2 !== defType1) {
        mult *= (m[attackType]?.[defType2]) ?? 1.0;
      }
      return mult;
    },

    /**
     * Variante double-type côté attaquant : si l'attaquant a deux types, les
     * effets des DEUX se CUMULENT (multiplication), exactement comme les deux
     * types du défenseur se cumulent déjà entre eux. Équivaut à
     * getTypeEffectiveness si atkType2 est null.
     */
    getBestTypeEffectiveness(atkType1, atkType2, defType1, defType2, matrix) {
      const m = matrix || DEFAULT_TYPE_MATRIX;
      const computeFor = (atkType) => {
        let mult = (m[atkType]?.[defType1]) ?? 1.0;
        if (defType2 && defType2 !== defType1) {
          mult *= (m[atkType]?.[defType2]) ?? 1.0;
        }
        return mult;
      };
      const mult1 = computeFor(atkType1);
      if (!atkType2 || atkType2 === atkType1) return mult1;
      const mult2 = computeFor(atkType2);
      return mult1 * mult2;
    },

    /**
     * Calcule l'XP requise pour atteindre un niveau donné
     * @param {number} level - Niveau cible
     * @param {object} config - Config de niveau
     * @returns {number} XP requise
     */
    xpForLevel(level, config) {
      const c = config || DEFAULT_CONFIG.level;
      return Math.floor(c.xpBase * Math.pow(level, c.xpExponent));
    },

    /**
     * Calcule l'XP nécessaire pour que le JOUEUR atteigne un niveau donné.
     * Formule identique à xpForLevel mais avec les paramètres config.playerLevel
     * (base/exposant entièrement séparés et paramétrables depuis l'administration).
     * @param {number} level
     * @param {object} config - config.playerLevel
     */
    xpForPlayerLevel(level, config) {
      const c = config || DEFAULT_CONFIG.playerLevel;
      return Math.floor(c.xpBase * Math.pow(level, c.xpExponent));
    },

    /**
     * Calcule les stats d'un personnage à un niveau donné
     * @param {object} char - Données du personnage (baseStats)
     * @param {number} level
     * @param {number} awakeningLevel
     * @param {object} awakeningConfig
     * @param {string} rarity
     * @returns {object} Stats calculées
     */
    computeStats(char, level, awakeningLevel, awakeningConfig, rarity, levelConfig) {
      const lc = levelConfig || DEFAULT_CONFIG.level;
      const ac = awakeningConfig || DEFAULT_CONFIG.awakening;
      const awk = ac.bonusPerLevel[rarity] || { hp:0, atk:0, def:0, spd:0 };

      // Croissance par niveau
      const grow = (base, stat) => Math.floor(base * (1 + lc.statGrowthPerLevel[stat] * (level - 1)));
      // Bonus awakening (% par niveau d'awakening)
      const awBonus = (val, stat) => Math.floor(val * (1 + (awk[stat] / 100) * awakeningLevel));

      const grown = {
        hp:  grow(char.baseStats.hp,  'hp'),
        atk: grow(char.baseStats.atk, 'atk'),
        def: grow(char.baseStats.def, 'def'),
        spd: grow(char.baseStats.spd, 'spd'),
      };

      return {
        hp:  Math.min(999999, awBonus(grown.hp,  'hp')),
        atk: Math.min(99999,  awBonus(grown.atk, 'atk')),
        def: Math.min(99999,  awBonus(grown.def, 'def')),
        spd: Math.min(99999,  awBonus(grown.spd, 'spd')),
      };
    },

    // ─── HELPERS RECADRAGE PORTRAITS ─────────────────────────────────────────
    // Valeurs par défaut et conversions CSS pour les trois zones de recadrage
    // (vignette collection, fiche personnage, portrait combat).

    /** Valeurs par défaut : vignette Collection (carré) */
    defaultPortraitCrop() { return { x: 50, y: 20, zoom: 1 }; },

    /** Valeurs par défaut : portrait Fiche personnage (grand rectangle tall) */
    defaultDetailCrop()   { return { x: 50, y: 30, zoom: 1 }; },

    /** Valeurs par défaut : portrait Combat (cercle) */
    defaultCombatCrop()   { return { cx: 50, cy: 38, r: 38 }; },

    /**
     * Convertit un crop {x,y,zoom} en valeur CSS object-position.
     * @param {{x:number,y:number,zoom:number}|null} crop
     * @returns {string}
     */
    cropToObjectPosition(crop) {
      if (!crop) return 'center 20%';
      return `${crop.x}% ${crop.y}%`;
    },

    /**
     * Convertit un combatCrop {cx,cy,r} en CSS object-position pour le cercle.
     * @param {{cx:number,cy:number,r:number}|null} crop
     * @returns {string}
     */
    combatCropToObjectPosition(crop) {
      if (!crop) return 'center 20%';
      return `${crop.cx}% ${crop.cy}%`;
    },
  };
})();
