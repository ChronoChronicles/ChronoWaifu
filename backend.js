/**
 * ============================================================
 * BACKEND.JS — Connexion au serveur (Supabase)
 * Centralise toute la communication avec Supabase : authentification
 * (email/mot de passe), chargement/sauvegarde des données de jeu
 * (partagées, "game_data") et des sauvegardes joueur ("player_saves").
 * Aucune logique de jeu ici — uniquement le transport des données.
 * ============================================================
 */

'use strict';

const CWBackend = (() => {

  // Project URL + clé publique (sûre à exposer côté client, cf. RLS pour la sécurité réelle)
  const SUPABASE_URL = 'https://edxahsgvqzxbctoeecni.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_qI2nltt3KyRZEyqTC1QyaQ_Eks70X_2';

  let _client = null;
  let _currentUserId = null;

  /** Mémorise l'utilisateur actuellement connecté (appelé une fois au démarrage) */
  function setCurrentUserId(id) { _currentUserId = id; }
  /** @returns {string|null} l'ID du compte actuellement connecté */
  function getCurrentUserId() { return _currentUserId; }

  /** Accès direct au client Supabase (utilisé par audio.js pour le Storage) */
  function storageClient() { return _client.storage; }

  /** Initialise le client Supabase. À appeler une seule fois, avant tout le reste. */
  function init() {
    if (_client) return _client;
    if (!window.supabase?.createClient) {
      throw new Error('[CWBackend] Librairie supabase-js introuvable (script CDN non chargé ?)');
    }
    _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return _client;
  }

  // ─── AUTHENTIFICATION ──────────────────────────────────────────────────────

  /** Session active, ou null si personne n'est connecté */
  async function getSession() {
    const { data, error } = await _client.auth.getSession();
    if (error) { console.error('[CWBackend] getSession:', error); return null; }
    return data.session;
  }

  /** Inscription par email/mot de passe. Lève une erreur lisible en cas d'échec. */
  async function signUp(email, password) {
    const { data, error } = await _client.auth.signUp({ email, password });
    if (error) throw new Error(_friendlyAuthError(error));
    return data;
  }

  /** Connexion par email/mot de passe. Lève une erreur lisible en cas d'échec. */
  async function signIn(email, password) {
    const { data, error } = await _client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(_friendlyAuthError(error));
    return data;
  }

  async function signOut() {
    await _client.auth.signOut();
  }

  /** Traduit les erreurs Supabase les plus courantes en français lisible */
  function _friendlyAuthError(error) {
    const msg = error?.message || '';
    if (/already registered|already exists/i.test(msg))   return 'Un compte existe déjà avec cet email.';
    if (/invalid login credentials/i.test(msg))            return 'Email ou mot de passe incorrect.';
    if (/password.*(least|short|6 characters)/i.test(msg)) return 'Le mot de passe doit faire au moins 6 caractères.';
    if (/invalid email/i.test(msg))                        return 'Adresse email invalide.';
    if (/rate limit/i.test(msg))                            return 'Trop de tentatives, réessaie dans quelques instants.';
    return msg || 'Une erreur est survenue.';
  }

  // ─── DONNÉES DE JEU (structurelles, partagées, admin uniquement en écriture) ─

  /**
   * Charge les données structurelles du jeu (personnages, équipements, config...).
   * @returns {object} objet vide {} UNIQUEMENT si l'admin n'a encore jamais
   *          rien sauvegardé (cas légitime, pas une erreur). En cas d'échec
   *          réel, lève une exception — jamais un objet vide silencieux, qui
   *          risquerait sinon d'être réécrit par-dessus la vraie config lors
   *          de la prochaine sauvegarde admin (cf. loadPlayerSave, même logique).
   */
  async function loadGameData() {
    const { data, error } = await _client
      .from('game_data').select('data').eq('id', 'main').maybeSingle();
    if (error) {
      console.error('[CWBackend] loadGameData:', error);
      throw new Error('Impossible de charger les données de jeu : ' + error.message);
    }
    return data?.data || {};
  }

  /** Sauvegarde les données structurelles (rejeté côté serveur si le compte n'est pas admin) */
  async function saveGameData(structuralData) {
    const { error } = await _client
      .from('game_data')
      .upsert({ id: 'main', data: structuralData, updated_at: new Date().toISOString() });
    if (error) { console.error('[CWBackend] saveGameData:', error); throw new Error(error.message || 'Échec de sauvegarde des données de jeu'); }
  }

  // ─── SAUVEGARDE JOUEUR (privée, une ligne par compte) ─────────────────────────

  /**
   * Charge la sauvegarde du joueur connecté.
   * @returns {object|null} null UNIQUEMENT si c'est un tout nouveau compte
   *          (aucune ligne trouvée, ce qui n'est pas une erreur). En cas
   *          d'échec réel (réseau, permissions...), lève une exception —
   *          jamais un null silencieux, pour ne jamais confondre "nouveau
   *          joueur" avec "erreur de chargement temporaire" (qui repartirait
   *          sinon sur un état vierge, avec le risque d'écraser la vraie
   *          progression à la sauvegarde automatique suivante).
   */
  async function loadPlayerSave(userId) {
    const { data, error } = await _client
      .from('player_saves').select('data').eq('user_id', userId).maybeSingle();
    if (error) {
      console.error('[CWBackend] loadPlayerSave:', error);
      throw new Error('Impossible de charger ta progression : ' + error.message);
    }
    return data?.data || null;
  }

  /** Sauvegarde (crée ou met à jour) la progression du joueur connecté */
  async function savePlayerData(userId, playerData) {
    const { error } = await _client
      .from('player_saves')
      .upsert({ user_id: userId, data: playerData, updated_at: new Date().toISOString() });
    if (error) { console.error('[CWBackend] savePlayerData:', error); throw new Error(error.message || 'Échec de sauvegarde de la progression joueur'); }
  }

  // ─── PROFIL / DROITS ADMIN ─────────────────────────────────────────────────

  /** @returns {boolean} true si ce compte a les droits d'administration */
  async function isCurrentUserAdmin(userId) {
    const { data, error } = await _client
      .from('profiles').select('is_admin').eq('id', userId).maybeSingle();
    if (error) { console.error('[CWBackend] isCurrentUserAdmin:', error); return false; }
    return !!data?.is_admin;
  }

  // ─── ADMIN : TOUS LES COMPTES JOUEURS ──────────────────────────────────────
  // Nécessite les droits admin (appliqué côté serveur par les policies RLS
  // ajoutées via supabase_setup_admin_accounts.sql — un compte non-admin
  // obtient simplement une liste vide, jamais une erreur qui casserait l'UI).

  /** @returns {Array<{id, display_name, is_admin, created_at}>} tous les profils joueurs */
  async function loadAllProfiles() {
    const { data, error } = await _client
      .from('profiles').select('id, display_name, is_admin, created_at');
    if (error) { console.error('[CWBackend] loadAllProfiles:', error); return []; }
    return data || [];
  }

  /** @returns {Array<{user_id, data, updated_at}>} la sauvegarde de TOUS les joueurs */
  async function loadAllPlayerSaves() {
    const { data, error } = await _client
      .from('player_saves').select('user_id, data, updated_at');
    if (error) { console.error('[CWBackend] loadAllPlayerSaves:', error); return []; }
    return data || [];
  }

  /** @returns {Array<{user_id, backed_up_at}>} la liste des sauvegardes de secours disponibles */
  async function loadBackupDates() {
    const { data, error } = await _client
      .from('player_saves_backup').select('user_id, backed_up_at');
    if (error) { console.error('[CWBackend] loadBackupDates:', error); return []; }
    return data || [];
  }

  /** Restaure la sauvegarde de secours d'un joueur (écrase sa sauvegarde actuelle) */
  async function restorePlayerFromBackup(userId) {
    const { data, error } = await _client
      .from('player_saves_backup').select('data').eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Aucune sauvegarde de secours trouvée pour ce joueur.');
    await savePlayerData(userId, data.data);
  }

  // ─── CLASSEMENTS (leaderboards) ────────────────────────────────────────────

  /**
   * Publie les chiffres de classement du joueur connecté (calculés localement,
   * cf. CWGameState.getLeaderboardSnapshot()). Chaque joueur ne peut publier
   * que sa propre ligne (cf. policies RLS).
   */
  async function saveLeaderboardStats(userId, displayName, stats) {
    const { error } = await _client.from('leaderboard_stats').upsert({
      user_id: userId,
      display_name: displayName,
      aura_total: stats.auraTotal,
      tournee_progress: stats.tourneeProgress,
      gallery_entries: stats.galleryEntries,
      record_best: stats.recordBest,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('[CWBackend] saveLeaderboardStats:', error);
  }

  /**
   * Charge le classement public, trié par la colonne demandée.
   * @param {'aura_total'|'tournee_progress'|'gallery_entries'} column
   * @param {number} [limit=100]
   */
  async function loadLeaderboard(column, limit = 100) {
    const { data, error } = await _client
      .from('leaderboard_stats')
      .select(`user_id, display_name, ${column}`)
      .order(column, { ascending: false })
      .limit(limit);
    if (error) { console.error('[CWBackend] loadLeaderboard:', error); return []; }
    return data || [];
  }

  return {
    init, getSession, signUp, signIn, signOut,
    loadGameData, saveGameData, loadPlayerSave, savePlayerData,
    isCurrentUserAdmin, setCurrentUserId, getCurrentUserId, storageClient,
    loadAllProfiles, loadAllPlayerSaves, loadBackupDates, restorePlayerFromBackup,
    saveLeaderboardStats, loadLeaderboard,
  };
})();
