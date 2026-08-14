/**
 * ============================================================
 * SAVE.JS — Système de sauvegarde
 * Gère la persistance locale (localStorage), import/export JSON
 * Architecture préparée pour migration vers une API distante
 * ============================================================
 */

'use strict';

const CWSaveSystem = (() => {

  const SAVE_KEY     = 'rpg_collection_save';
  const SETTINGS_KEY = 'rpg_collection_settings';
  const AUTOSAVE_INTERVAL = 30000; // 30 secondes

  let _autosaveTimer = null;
  let _onSaveCallback = null;

  // ─── SAUVEGARDE ──────────────────────────────────────────────────────────────

  /**
   * Sauvegarde l'état complet du jeu dans localStorage
   * @param {object} gameState - État complet du jeu
   * @returns {boolean} Succès
   */
  function save(gameState) {
    try {
      const payload = {
        version:     gameState.config?.game?.version || "1.0.0",
        timestamp:   Date.now(),
        player:      gameState.player,
        config:      gameState.config,
        types:       gameState.types,
        typeMatrix:  gameState.typeMatrix,
        tags:        gameState.tags,
        passives:    gameState.passives,
        characters:  gameState.characters,
        equipment:   gameState.equipment,
        items:       gameState.items,
        shopListings: gameState.shopListings,
        dailyLoginCycles: gameState.dailyLoginCycles,
        dailyQuests: gameState.dailyQuests,
        weeklyQuests: gameState.weeklyQuests,
        equipBanners: gameState.equipBanners,
        banners:     gameState.banners,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      if (_onSaveCallback) _onSaveCallback('success');
      return true;
    } catch (e) {
      console.error('[CWSaveSystem] Échec de sauvegarde:', e);
      if (_onSaveCallback) _onSaveCallback('error', e);
      return false;
    }
  }

  /**
   * Charge la sauvegarde depuis localStorage
   * @returns {object|null} Données sauvegardées ou null
   */
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('[CWSaveSystem] Échec de chargement:', e);
      return null;
    }
  }

  /**
   * Efface complètement la sauvegarde
   */
  function clear() {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(SETTINGS_KEY);
  }

  // ─── AUTOSAVE ────────────────────────────────────────────────────────────────

  /**
   * Démarre la sauvegarde automatique
   * @param {Function} getState - Fonction retournant l'état actuel du jeu
   * @param {Function} onSave   - Callback appelé après chaque sauvegarde
   */
  function startAutosave(getState, onSave) {
    _onSaveCallback = onSave;
    if (_autosaveTimer) clearInterval(_autosaveTimer);
    _autosaveTimer = setInterval(() => {
      const state = getState();
      if (state) save(state);
    }, AUTOSAVE_INTERVAL);
  }

  /** Arrête l'autosave */
  function stopAutosave() {
    if (_autosaveTimer) {
      clearInterval(_autosaveTimer);
      _autosaveTimer = null;
    }
  }

  // ─── EXPORT / IMPORT ─────────────────────────────────────────────────────────

  /**
   * Exporte la sauvegarde actuelle en fichier JSON téléchargeable
   * @param {object} gameState
   */
  function exportToFile(gameState) {
    try {
      const payload = {
        version:     gameState.config?.game?.version || "1.0.0",
        exportDate:  new Date().toISOString(),
        player:      gameState.player,
        config:      gameState.config,
        types:       gameState.types,
        typeMatrix:  gameState.typeMatrix,
        tags:        gameState.tags,
        passives:    gameState.passives,
        characters:  gameState.characters,
        equipment:   gameState.equipment,
        items:       gameState.items,
        shopListings: gameState.shopListings,
        dailyLoginCycles: gameState.dailyLoginCycles,
        dailyQuests: gameState.dailyQuests,
        weeklyQuests: gameState.weeklyQuests,
        equipBanners: gameState.equipBanners,
        banners:     gameState.banners,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `rpg_save_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[CWSaveSystem] Échec export:', e);
    }
  }

  /**
   * Importe une sauvegarde depuis un fichier JSON
   * @param {File} file
   * @returns {Promise<object>} Données importées
   */
  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          resolve(data);
        } catch (err) {
          reject(new Error('Fichier JSON invalide'));
        }
      };
      reader.onerror = () => reject(new Error('Erreur lecture fichier'));
      reader.readAsText(file);
    });
  }

  // ─── SETTINGS ────────────────────────────────────────────────────────────────

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  return { save, load, clear, startAutosave, stopAutosave, exportToFile, importFromFile, saveSettings, loadSettings };
})();
