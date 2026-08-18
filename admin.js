/**
 * ============================================================
 * ADMIN.JS — Interface d'administration du jeu
 * Gestion complète : personnages, types, équipements, gacha,
 * évolutions, awakening, joueurs, ressources, combat.
 * Architecture modulaire par onglets, prête pour migration online.
 * ============================================================
 */

'use strict';

const CWAdminPanel = (() => {

  // ─── ÉTAT INTERNE ────────────────────────────────────────────────────────────

  let _visible   = false;
  let _activeTab = 'characters';
  let _playerAccountsCache = {}; // { userId: {user_id, data, updated_at} } — cf. onglet Comptes joueurs
  let _playerAccountsProfileMap = {}; // { userId: {id, display_name, is_admin} }
  let _editingId = null;   // ID de l'entité en cours d'édition
  let _dragState = { kind: null, id: null, lineId: null };  // suivi du glisser-déposer en cours
  let _evoSortKey = 'name'; // 'name' | 'rarity' — ordre d'affichage des lignées dans l'onglet Évolutions

  // ─── CONSTANTES ──────────────────────────────────────────────────────────────

  const TABS = [
    // ── Contenu ──────────────────────────────────────────────────────────────
    { id: 'characters', label: '👤 Personnages', group: 'Contenu'    },
    { id: 'types',      label: '🔮 Types',       group: 'Contenu'    },
    { id: 'tags',       label: '🏷️ Tags',        group: 'Contenu'    },
    { id: 'evolutions', label: '🌀 Évolutions',  group: 'Contenu'    },
    { id: 'awakening',  label: '⭐ Awakening',   group: 'Contenu'    },
    // ── Inventaire ───────────────────────────────────────────────────────────
    { id: 'equipment',  label: '⚙️ Équipements', group: 'Inventaire' },
    { id: 'items',      label: '🎒 Objets',       group: 'Inventaire' },
    { id: 'shop',       label: '🛒 Boutique',     group: 'Inventaire' },
    // ── Mécanique ────────────────────────────────────────────────────────────
    { id: 'gacha',      label: '🎲 Gacha',       group: 'Mécanique'  },
    { id: 'event',      label: '✨ Event',        group: 'Mécanique'  },
    { id: 'daily',      label: '📅 Quotidien',   group: 'Mécanique'  },
    { id: 'attacks',    label: '💥 Passifs',      group: 'Mécanique'  },
    { id: 'combat',     label: '⚔️ Combat',       group: 'Mécanique'  },
    // ── Système ──────────────────────────────────────────────────────────────
    { id: 'player',     label: '🎮 Joueur',      group: 'Système'    },
    { id: 'resources',  label: '💎 Ressources',  group: 'Système'    },
    { id: 'audio',      label: '🎵 Audio',        group: 'Système'    },
    { id: 'backgrounds',label: '🖼️ Fonds d\'écran', group: 'Système'  },
    { id: 'cloud-import',label: '📥 Import vers Supabase', group: 'Système' },
    { id: 'player-accounts', label: '👥 Comptes joueurs', group: 'Système' },
    // ── Contenu narratif ──────────────────────────────────────────────────────
    { id: 'tutorial',   label: '🎓 Tutoriel',    group: 'Narration'  },
    { id: 'story',      label: '📖 Mode Histoire', group: 'Narration' },
  ];

  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const RARITY_LABELS = {
    common: 'Commune', uncommon: 'Peu Commune', rare: 'Rare',
    epic: 'Épique', legendary: 'Légendaire', mythic: 'Mythique',
  };
  const EQUIP_SLOT_LABELS = { weapon: '⚔️ Arme', armor: '🛡️ Armure', accessory: '💍 Accessoire' };
  const EQUIP_SLOT_ORDER_ADMIN = ['weapon', 'armor', 'accessory'];

  // ─── INITIALISATION ──────────────────────────────────────────────────────────

  /**
   * Initialise le panneau admin et injecte le HTML dans le DOM
   */
  function init() {
    _buildPanel();
    _bindGlobalEvents();
  }

  /**
   * Construit la structure HTML du panneau admin
   */
  function _buildPanel() {
    const existing = document.getElementById('admin-panel');
    if (existing) existing.remove();

    // Construire les groupes de tabs
    const groups = [];
    let lastGroup = null;
    for (const t of TABS) {
      if (t.group !== lastGroup) { groups.push({ name: t.group, tabs: [] }); lastGroup = t.group; }
      groups[groups.length - 1].tabs.push(t);
    }

    const tabsHtml = groups.map(g => `
      <div class="admin-tab-group">
        <span class="admin-tab-group-label">${g.name}</span>
        <div class="admin-tab-group-btns">
          ${g.tabs.map(t => `
            <button class="admin-tab ${t.id === _activeTab ? 'active' : ''}"
                    data-tab="${t.id}" onclick="CWAdminPanel.switchTab('${t.id}')">
              ${t.label}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    const panel = document.createElement('div');
    panel.id = 'admin-panel';
    panel.innerHTML = `
      <div id="admin-overlay"></div>
      <div id="admin-container">
        <div id="admin-header">
          <div id="admin-header-left">
            <span id="admin-header-icon">⚙️</span>
            <div>
              <div id="admin-header-title">Administration</div>
              <div id="admin-header-sub">ChronoWaifu Chronicles</div>
            </div>
          </div>
          <div id="admin-header-actions">
            <button class="admin-btn admin-btn-success" onclick="CWAdminPanel.exportSave()">📤 Export</button>
            <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel.importSave()">📥 Import</button>
            <button class="admin-btn admin-btn-danger"  onclick="CWAdminPanel.hide()">✕ Fermer</button>
          </div>
        </div>
        <div id="admin-tabs">${tabsHtml}</div>
        <div id="admin-impersonation-banner" style="display:none;"></div>
        <div id="admin-content">
          <div id="admin-loading">Chargement...</div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    _injectStyles();
  }

  /**
   * Injecte les styles CSS dédiés à l'admin
   */
  function _injectStyles() {
    const existing = document.getElementById('admin-styles');
    if (existing) return;
    const style = document.createElement('style');
    style.id = 'admin-styles';
    style.textContent = `
      /* ── PANEL ── */
      #admin-panel { display:none; position:fixed; inset:0; z-index:9999; }
      #admin-panel.visible { display:flex; }
      #admin-overlay { position:absolute; inset:0; background:rgba(0,0,0,0.8); backdrop-filter:blur(2px); }
      #admin-container {
        position:relative; z-index:1; margin:auto;
        width:95vw; max-width:1200px; height:92vh;
        background:#13111f; border:1px solid #2a2540; border-radius:14px;
        display:flex; flex-direction:column; overflow:hidden;
        box-shadow:0 0 60px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.04);
      }
      /* ── HEADER ── */
      #admin-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:12px 18px; background:#0e0c1a;
        border-bottom:1px solid #2a2540; flex-shrink:0;
      }
      #admin-header-left { display:flex; align-items:center; gap:10px; }
      #admin-header-icon { font-size:1.5rem; }
      #admin-header-title { font-size:.95rem; font-weight:700; color:#e8d5b7; letter-spacing:.3px; }
      #admin-header-sub   { font-size:.68rem; color:#665; letter-spacing:.5px; margin-top:1px; }
      #admin-header-actions { display:flex; gap:8px; }
      /* ── TABS GROUPÉS ── */
      #admin-tabs {
        display:flex; flex-wrap:wrap; gap:0; padding:8px 14px 0;
        background:#0e0c1a; border-bottom:1px solid #2a2540; flex-shrink:0;
      }
      .admin-tab-group {
        display:flex; flex-direction:column; margin-right:16px; margin-bottom:8px;
      }
      .admin-tab-group-label {
        font-size:.6rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase;
        color:#554; padding:0 2px 4px; line-height:1;
      }
      .admin-tab-group-btns { display:flex; gap:3px; }
      .admin-tab {
        padding:5px 11px; border:1px solid transparent; border-radius:6px 6px 0 0; cursor:pointer;
        font-size:.78rem; background:transparent; color:#776; transition:all .15s;
        border-bottom:none; margin-bottom:-1px;
      }
      .admin-tab:hover { background:#1e1a30; color:#bbb; }
      .admin-tab.active {
        background:#13111f; color:#e8d5b7; font-weight:700;
        border-color:#2a2540 #2a2540 #13111f; 
      }
      /* ── CONTENU ── */
      #admin-content { flex:1; overflow-y:auto; padding:20px; }
      /* ── BANDEAU D'ÉDITION D'UN AUTRE JOUEUR ── */
      #admin-impersonation-banner{
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        flex-wrap:wrap; flex-shrink:0;
        background:linear-gradient(90deg, rgba(251,191,36,.18), rgba(244,63,94,.14));
        border-bottom:2px solid #fbbf24; padding:8px 16px;
        font-size:.82rem;
      }
      /* ── SECTIONS ── */
      .admin-section { margin-bottom:24px; }
      .admin-section-title {
        font-size:.88rem; font-weight:700; color:#c4b5fd;
        padding-bottom:8px; margin-bottom:14px;
        border-bottom:1px solid #2a2540;
        display:flex; align-items:center; gap:8px;
      }
      .admin-section-title .count-badge {
        font-size:.7rem; background:#2a2540; color:#888; 
        padding:1px 7px; border-radius:99px; font-weight:500;
      }
      /* ── SOUS-SECTIONS dans un formulaire ── */
      .admin-form-block {
        background:#0e0c1a; border:1px solid #2a2540; border-radius:8px;
        padding:12px 14px; margin-bottom:12px;
      }
      .admin-form-block-title {
        font-size:.7rem; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
        color:#665; margin-bottom:10px;
      }
      /* ── GRILLES ── */
      .admin-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px,1fr)); gap:10px; }
      .admin-grid-3 { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px,1fr)); gap:10px; }
      .admin-grid-5 { display:grid; grid-template-columns:repeat(5, 1fr); gap:10px; }
      @media (max-width:900px) {
        .admin-grid-5 { grid-template-columns:repeat(3,1fr); }
      }
      /* ── CHAMPS ── */
      .admin-field { display:flex; flex-direction:column; gap:4px; }
      .admin-field label { font-size:.72rem; color:#665; font-weight:600; letter-spacing:.02em; }
      .admin-field input, .admin-field select, .admin-field textarea {
        background:#1a1630; border:1px solid #2a2540; border-radius:6px;
        color:#e8d5b7; padding:7px 10px; font-size:.83rem; outline:none;
        transition:border-color .15s, background .15s;
      }
      .admin-field input:focus, .admin-field select:focus, .admin-field textarea:focus {
        border-color:#7c3aed; background:#1e1a38;
      }
      .admin-field textarea { min-height:70px; resize:vertical; }
      /* ── BOUTONS ── */
      .admin-btn {
        padding:6px 14px; border:none; border-radius:6px; cursor:pointer;
        font-size:.78rem; font-weight:700; transition:all .15s; letter-spacing:.02em;
      }
      .admin-btn-primary   { background:#1e1a38; color:#c4b5fd; border:1px solid #3b2f70; }
      .admin-btn-primary:hover   { background:#2a2354; }
      .admin-btn-success   { background:#166534; color:#bbf7d0; border:1px solid #16a34a; }
      .admin-btn-success:hover   { background:#15803d; }
      .admin-btn-warning   { background:#92400e; color:#fde68a; border:1px solid #d97706; }
      .admin-btn-warning:hover   { background:#b45309; }
      .admin-btn-danger    { background:#7f1d1d; color:#fca5a5; border:1px solid #dc2626; }
      .admin-btn-danger:hover    { background:#991b1b; }
      .admin-btn-secondary { background:#1e1632; color:#a78bfa; border:1px solid #4c2a8a; }
      .admin-btn-secondary:hover { background:#2a1f4a; }
      .admin-btn-sm { padding:4px 9px; font-size:.72rem; }
      .admin-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
      /* ── BANNER ÉDITION ── */
      #char-edit-banner {
        display:none; align-items:center; justify-content:space-between;
        background:#1a0a2e; border:1px solid #7c3aed; border-radius:8px;
        padding:9px 14px; margin-bottom:14px;
        font-size:.82rem; color:#c4b5fd;
      }
      #char-edit-banner.visible { display:flex; }
      #char-edit-banner strong { color:#e8d5b7; }
      #char-edit-banner-cancel {
        background:transparent; border:none; color:#7c3aed; cursor:pointer;
        font-size:.78rem; font-weight:700; padding:4px 8px; border-radius:5px;
        transition:background .15s;
      }
      #char-edit-banner-cancel:hover { background:rgba(124,58,237,.15); }
      /* ── RECHERCHE ── */
      .admin-search-wrap { position:relative; margin-bottom:12px; }
      .admin-search-wrap input {
        width:100%; padding:8px 12px 8px 32px; box-sizing:border-box;
        background:#0e0c1a; border:1px solid #2a2540; border-radius:7px;
        color:#e8d5b7; font-size:.82rem; outline:none; transition:border-color .15s;
      }
      .admin-search-wrap input:focus { border-color:#7c3aed; }
      .admin-search-wrap::before {
        content:'🔍'; position:absolute; left:9px; top:50%; transform:translateY(-50%);
        font-size:.75rem; pointer-events:none;
      }
      /* ── DRAG & DROP ── */
      .drag-handle {
        cursor:grab; color:#443; font-size:1.1rem; flex-shrink:0;
        padding:0 4px; user-select:none; touch-action:none;
      }
      .drag-handle:active { cursor:grabbing; }
      .admin-list-item.dragging { opacity:.3; }
      .admin-list-item.drag-over { border-color:#7c3aed; box-shadow:0 0 0 1px #7c3aed inset; }
      .admin-list-item.just-saved, .evo-chain-member.just-saved {
        animation: adminJustSaved 1.5s ease;
      }
      @keyframes adminJustSaved {
        0%   { box-shadow:0 0 0 2px #7c3aed, 0 0 16px 2px rgba(124,58,237,.5); background:rgba(124,58,237,.1); }
        100% { box-shadow:0 0 0 0 transparent; background:transparent; }
      }
      .evo-chain-member.dragging { opacity:.3; }
      .evo-chain-member.drag-over { box-shadow:0 0 0 2px #7c3aed; border-radius:6px; }
      /* ── LISTES ── */
      .admin-list { display:flex; flex-direction:column; gap:6px; }
      .admin-list-item {
        background:#0e0c1a; border:1px solid #2a2540; border-radius:8px;
        padding:10px 14px; display:flex; align-items:center; gap:10px;
        transition:border-color .15s, background .15s;
      }
      .admin-list-item:hover { border-color:#3b2f70; background:#110f1e; }
      .admin-list-item.is-editing {
        border-color:#7c3aed; background:#1a0a2e;
        box-shadow:0 0 0 2px rgba(124,58,237,.25);
      }
      .admin-list-item-info { flex:1; min-width:0; }
      .admin-list-item-name { font-weight:700; color:#e8d5b7; font-size:.85rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .admin-list-item-sub  { font-size:.72rem; color:#554; margin-top:3px; }
      .admin-list-item-actions { display:flex; gap:5px; flex-shrink:0; }
      /* ── FEATURED GACHA ── */
      .banner-featured-list {
        max-height:220px; overflow-y:auto;
        background:#0e0c1a; border:1px solid #2a2540; border-radius:6px;
        padding:4px;
      }
      .banner-featured-item {
        display:flex; align-items:center; gap:8px;
        padding:7px 8px; border-radius:5px; cursor:pointer;
        font-size:.82rem; color:#ddd; transition:background .15s;
      }
      .banner-featured-item:hover { background:rgba(124,58,237,.12); }
      .banner-featured-item input[type="checkbox"] {
        width:17px; height:17px; flex-shrink:0; cursor:pointer; accent-color:#7c3aed;
      }
      .banner-featured-id { color:#554; font-size:.72rem; }
      /* ── QUOTIDIEN ── */
      .reward-editor{ display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
      .reward-editor .reward-type-select{ flex:1 1 140px; }
      .reward-editor .reward-amount-input{ width:80px; }
      .reward-editor .reward-ref-select{ flex:1 1 160px; }
      .cycle-day-row{
        display:flex; align-items:center; gap:10px; flex-wrap:wrap;
        padding:8px 10px; background:#0e0c1a; border-radius:6px; margin-bottom:6px;
        border:1px solid #2a2540;
      }
      .cycle-day-label{ font-size:.74rem; font-weight:700; color:#665; flex:0 0 56px; }
      /* ── BADGES ── */
      .badge {
        display:inline-block; padding:2px 7px; border-radius:10px;
        font-size:.68rem; font-weight:700;
      }
      .badge-common    { background:#1f2937; color:#9ca3af; }
      .badge-uncommon  { background:#064e3b; color:#6ee7b7; }
      .badge-rare      { background:#1e3a5f; color:#93c5fd; }
      .badge-epic      { background:#3b1d6e; color:#c4b5fd; }
      .badge-legendary { background:#78350f; color:#fcd34d; }
      .badge-mythic    { background:#7f1d1d; color:#fca5a5; }
      /* ── TAGS ── */
      .tag-chip {
        display:inline-flex; align-items:center; gap:5px;
        padding:3px 6px 3px 10px; border-radius:999px;
        font-size:.72rem; font-weight:700; color:#fff;
      }
      .tag-chip-remove {
        background:rgba(0,0,0,.25); border:none; border-radius:50%;
        color:#fff; width:16px; height:16px; line-height:1; font-size:.62rem;
        cursor:pointer; display:flex; align-items:center; justify-content:center; padding:0;
      }
      .tag-chip-remove:hover { background:rgba(0,0,0,.45); }
      .tag-add-select {
        background:#0e0c1a; border:1px solid #2a2540; color:#e8d5b7;
        border-radius:6px; font-size:.74rem; padding:4px 6px;
      }
      /* Tag categories in tag tab */
      .tag-cat-block {
        border:1px solid #2a2540; border-radius:var(--radius,12px);
        overflow:hidden; margin-bottom:8px; background:#0e0c1a;
      }
      .tag-cat-block-header {
        display:flex; align-items:center; gap:8px; padding:10px 14px;
        background:rgba(255,255,255,.03); border-bottom:1px solid #2a2540;
      }
      .tag-cat-block-icon { font-size:1.1rem; }
      .tag-cat-block-name { font-weight:700; font-size:.9rem; flex:1; }
      .tag-cat-block-id   { font-size:.68rem; color:#555; font-family:monospace; }
      .tag-cat-block-tags { display:flex; flex-wrap:wrap; gap:6px; padding:10px 14px; min-height:32px; }
      .tag-cat-block-empty { font-size:.75rem; color:#555; font-style:italic; }
      /* Per-category tag zone in evolution lines */
      .tag-by-cat-zone  { display:flex; flex-direction:column; gap:5px; margin-top:4px; }
      .tag-by-cat-row   { display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-height:26px; }
      .tag-by-cat-label {
        font-size:.68rem; font-weight:700; color:#888; letter-spacing:.04em;
        min-width:75px; flex-shrink:0; white-space:nowrap;
      }
      .tag-by-cat-chips { display:flex; flex-wrap:wrap; gap:4px; align-items:center; }
      /* ── MATRICES ── */
      .type-matrix-table { border-collapse:collapse; font-size:.72rem; width:100%; overflow-x:auto; display:block; }
      .type-matrix-table th, .type-matrix-table td { padding:4px 6px; border:1px solid #2a2540; text-align:center; }
      .type-matrix-table th { background:#0e0c1a; color:#665; position:sticky; top:0; }
      .type-matrix-table td input {
        width:45px; text-align:center; background:transparent; border:none;
        color:#e8d5b7; font-size:.72rem;
      }
      .mult-super   { color:#4ade80; font-weight:700; }
      .mult-low     { color:#f87171; }
      .mult-immune  { color:#6b7280; }
      /* ── PORTRAIT ── */
      .admin-portrait-preview {
        width:80px; height:100px; object-fit:cover; border-radius:6px;
        border:1px solid #2a2540; background:#0e0c1a;
      }
      /* ── STATS ── */
      .admin-stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .stat-row { display:flex; align-items:center; gap:8px; }
      .stat-row label { width:34px; font-size:.74rem; color:#665; font-weight:700; flex-shrink:0; }
      .stat-row input { flex:1; }
      .stat-row .stat-max { font-size:.66rem; color:#443; white-space:nowrap; }
      /* ── NOTIFICATION ── */
      #admin-notification {
        position:fixed; bottom:20px; right:20px; z-index:99999;
        background:#166534; color:#bbf7d0; padding:10px 18px; border-radius:8px;
        font-size:.82rem; font-weight:600; opacity:0; transition:opacity .3s;
        pointer-events:none; border:1px solid #16a34a;
        box-shadow:0 4px 20px rgba(0,0,0,.4);
      }
      #admin-notification.show { opacity:1; }
      #admin-notification.error { background:#7f1d1d; color:#fca5a5; border-color:#dc2626; }
      /* ── SCROLLBAR ── */
      #admin-content::-webkit-scrollbar { width:5px; }
      #admin-content::-webkit-scrollbar-track { background:transparent; }
      #admin-content::-webkit-scrollbar-thumb { background:#2a2540; border-radius:3px; }
      /* ── SÉPARATEUR ── */
      .admin-sep { border:none; border-top:1px solid #2a2540; margin:18px 0; }
      /* ── STAT INLINE (liste des persos) ── */
      .stat-pills { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; }
      .stat-pill {
        font-size:.66rem; font-weight:700; padding:1px 6px; border-radius:5px;
        background:#1a1630; color:#776; border:1px solid #2a2540;
      }
      .sort-select {
        background:#0e0c1a; border:1px solid #2a2540; color:#e8d5b7;
        border-radius:6px; font-size:.75rem; padding:4px 8px; cursor:pointer;
      }
    `;
    document.head.appendChild(style);

    // Conteneur de notification
    const notif = document.createElement('div');
    notif.id = 'admin-notification';
    document.body.appendChild(notif);
  }

  // ─── GLISSER-DÉPOSER (réorganisation des listes) ──────────────────────────────

  /**
   * Démarre un glissement. `kind` identifie le type de liste ('char' | 'equip' | 'evo'),
   * `lineId` n'est utilisé que pour 'evo' (réorganisation au sein d'une même lignée).
   */
  function _dragStart(e, kind, id, lineId = null) {
    _dragState = { kind, id, lineId };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch (err) { /* ignoré (ex. environnement de test) */ }
    }
    e.currentTarget.classList.add('dragging');
  }

  function _dragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  function _dragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
  }

  function _dragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  }

  /** Dépose sur un personnage : réordonne la liste complète des personnages */
  function _dragDropChar(e, targetId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (_dragState.kind !== 'char' || !_dragState.id || _dragState.id === targetId) return;

    const ids = CWGameState.get().characters.map(c => c.id);
    const fromIdx = ids.indexOf(_dragState.id);
    const toIdx   = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(ids.indexOf(targetId) + (fromIdx < toIdx ? 1 : 0), 0, _dragState.id);
    CWGameState.reorderCharDefs(ids);
    switchTab('characters');
  }

  /** Dépose sur un équipement : réordonne la liste complète des équipements */
  function _dragDropEquip(e, targetId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (_dragState.kind !== 'equip' || !_dragState.id || _dragState.id === targetId) return;

    const ids = CWGameState.get().equipment.map(eq => eq.id);
    const fromIdx = ids.indexOf(_dragState.id);
    const toIdx   = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(ids.indexOf(targetId) + (fromIdx < toIdx ? 1 : 0), 0, _dragState.id);
    CWGameState.reorderEquipDefs(ids);
    switchTab('equipment');
  }

  /** Dépose sur un type : réordonne la liste complète des types */
  function _dragDropType(e, targetId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (_dragState.kind !== 'type' || !_dragState.id || _dragState.id === targetId) return;

    const ids = CWGameState.get().types.map(t => t.id);
    const fromIdx = ids.indexOf(_dragState.id);
    const toIdx   = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(ids.indexOf(targetId) + (fromIdx < toIdx ? 1 : 0), 0, _dragState.id);
    CWGameState.reorderTypes(ids);
    switchTab('types');
  }

  /**
   * Dépose au sein d'une chaîne d'évolution : réordonne les stades de cette lignée
   * (renumérote evolutionStage et reconstruit les pointeurs evolvesTo en conséquence).
   * Refuse silencieusement si les deux éléments n'appartiennent pas à la même lignée.
   */
  function _dragDropEvoStage(e, lineId, targetCharId) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if (_dragState.kind !== 'evo' || !_dragState.id || _dragState.id === targetCharId) return;
    if (_dragState.lineId !== lineId) {
      _notify("❌ Impossible de mélanger deux lignées évolutives différentes.", 'error');
      return;
    }

    const state = CWGameState.get();
    const members = state.characters
      .filter(c => (c.evolutionLine || c.id) === lineId)
      .sort((a, b) => (a.evolutionStage || 0) - (b.evolutionStage || 0));
    const ids = members.map(c => c.id);
    const fromIdx = ids.indexOf(_dragState.id);
    const toIdx   = ids.indexOf(targetCharId);
    if (fromIdx === -1 || toIdx === -1) return;

    ids.splice(fromIdx, 1);
    ids.splice(ids.indexOf(targetCharId) + (fromIdx < toIdx ? 1 : 0), 0, _dragState.id);

    // Renumérote les stades dans le nouvel ordre et reconstruit la chaîne evolvesTo
    ids.forEach((id, i) => {
      const isLast = i === ids.length - 1;
      CWGameState.updateCharDef(id, { evolutionStage: i, evolvesTo: isLast ? null : ids[i + 1] });
    });

    _notify('✅ Ordre de la lignée mis à jour.');
    switchTab('evolutions');
  }

  // ─── UPGRADE ──────────────────────────────────────────────────────────────────

  /**
   * Incrémente le nombre final d'une chaîne (ex: "Ours1" → "Ours2", "char_001" → "char_002"),
   * en conservant le même nombre de chiffres (zero-padding préservé). Si la chaîne ne se
   * termine pas par un nombre, ajoute "2" à la fin.
   * @param {string} str
   * @returns {string}
   */
  function _incrementTrailingNumber(str) {
    if (!str) return str;
    const match = String(str).match(/^(.*?)(\d+)$/);
    if (!match) return `${str}2`;
    const [, prefix, numStr] = match;
    const incremented = String(parseInt(numStr, 10) + 1).padStart(numStr.length, '0');
    return prefix + incremented;
  }

  /**
   * Crée la fiche "stade suivant" d'un personnage : ID, Stade d'évolution et Evolue
   * vers sont incrémentés de 1 ; Nom, Rareté, Types, Lignée évolutive, Condition
   * d'évolution, portrait et description sont copiés à l'identique ; les stats de
   * base sont chacune augmentées de 6% (arrondi à l'unité supérieure).
   */
  function _upgradeCharacter(charId) {
    const c = CWGameState.getCharDef(charId);
    if (!c) return;

    const newId = _incrementTrailingNumber(c.id);
    if (CWGameState.getCharDef(newId)) {
      _notify(`❌ Un personnage avec l'ID "${newId}" existe déjà.`, 'error');
      return;
    }

    const upgraded = JSON.parse(JSON.stringify(c));
    upgraded.id             = newId;
    upgraded.evolutionStage = (c.evolutionStage || 0) + 1;
    upgraded.evolvesTo      = c.evolvesTo ? _incrementTrailingNumber(c.evolvesTo) : c.evolvesTo;
    upgraded.baseStats = {
      hp:  Math.ceil((c.baseStats?.hp  || 0) * 1.06),
      atk: Math.ceil((c.baseStats?.atk || 0) * 1.06),
      def: Math.ceil((c.baseStats?.def || 0) * 1.06),
      spd: Math.ceil((c.baseStats?.spd || 0) * 1.06),
    };
    // Nom, Rareté, Type principal/secondaire, Lignée évolutive, Cond. d'évol,
    // portrait et tags restent identiques (déjà copiés via le clone ci-dessus).

    CWGameState.addCharDef(upgraded);
    _notify(`✅ "${c.name}" upgradé : nouvelle fiche "${newId}" créée (stats +6%).`);
    switchTab('characters');
    // _renderTab() différé son rendu de 10ms en interne : on attend qu'il soit posé
    // avant de pré-remplir le formulaire d'édition, sinon les champs n'existent pas encore.
    setTimeout(() => _editCharacter(newId), 30);
  }

  /** Duplique un équipement à l'identique sous un nouvel ID, prêt à être ajusté */
  function _duplicateEquip(equipId) {
    const e = CWGameState.get().equipment.find(x => x.id === equipId);
    if (!e) return;
    const suffix = Date.now().toString(36);
    const copy = JSON.parse(JSON.stringify(e));
    copy.id   = `${equipId}_copy${suffix}`;
    copy.name = `${e.name} (copie)`;

    CWGameState.addEquipDef(copy);
    _notify(`✅ "${e.name}" dupliqué sous le nom "${copy.name}".`);
    switchTab('equipment');
    _editEquip(copy.id);
  }

  // ─── NAVIGATION PAR ONGLETS ───────────────────────────────────────────────────

  /**
   * Change l'onglet actif et recharge le contenu
   * @param {string} tabId
   */
  function switchTab(tabId) {
    _activeTab = tabId;

    // Mise à jour visuelle des onglets
    document.querySelectorAll('.admin-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    _renderTab(tabId);
  }

  /**
   * Affiche le contenu du bon onglet
   * @param {string} tabId
   */
  function _renderTab(tabId) {
    const content = document.getElementById('admin-content');
    if (!content) return;
    content.innerHTML = '<div id="admin-loading">Chargement...</div>';

    // Timeout minimal pour éviter le freeze sur gros états
    setTimeout(() => {
      try {
        switch (tabId) {
          case 'characters': content.innerHTML = _renderCharactersTab(); break;
          case 'types':      content.innerHTML = _renderTypesTab();      break;
          case 'tags':       content.innerHTML = _renderTagsTab();       break;
          case 'equipment':  content.innerHTML = _renderEquipmentTab();  break;
          case 'gacha':      content.innerHTML = _renderGachaTab();      break;
          case 'event':      content.innerHTML = _renderEventTab();      break;
          case 'evolutions': content.innerHTML = _renderEvolutionsTab(); break;
          case 'awakening':  content.innerHTML = _renderAwakeningTab();  break;
          case 'player':     content.innerHTML = _renderPlayerTab();     break;
          case 'resources':  content.innerHTML = _renderResourcesTab();  break;
          case 'combat':     content.innerHTML = _renderCombatTab();     break;
          case 'items':      content.innerHTML = _renderItemsTab();      break;
          case 'shop':       content.innerHTML = _renderShopTab();       break;
          case 'daily':      content.innerHTML = _renderDailyTab();      _rebuildCycleDayRows();      break;
          case 'attacks':    content.innerHTML = _renderAttacksTab();    break;
          case 'audio':      content.innerHTML = _renderAudioTab();      break;
          case 'backgrounds':content.innerHTML = _renderBackgroundsTab();break;
          case 'cloud-import':content.innerHTML = _renderCloudImportTab();break;
          case 'player-accounts':content.innerHTML = _renderPlayerAccountsTab();break;
          case 'tutorial':   content.innerHTML = _renderTutorialTab();   break;
          case 'story':      content.innerHTML = _renderStoryTab();      break;
          default:           content.innerHTML = '<p style="color:#888">Onglet inconnu.</p>';
        }
      } catch (e) {
        content.innerHTML = `<p style="color:#e94560">Erreur : ${e.message}</p>`;
        console.error('[CWAdminPanel] Render error:', e);
      }
    }, 10);
  }

  // ─── ONGLET PERSONNAGES ───────────────────────────────────────────────────────

  function _renderCharactersTab() {
    const state = CWGameState.get();
    const chars = state.characters;
    const types = state.types;

    const typeOptions = types.map(t => `<option value="${t.id}">${t.icon} ${t.name}</option>`).join('');
    const rarityOptions = RARITIES.map(r => `<option value="${r}">${RARITY_LABELS[r]}</option>`).join('');

    return `
      <!-- ── Banner édition (caché par défaut) ─────────────────────────── -->
      <div id="char-edit-banner">
        <span>✏️ Modification en cours : <strong id="char-edit-name">—</strong></span>
        <button id="char-edit-banner-cancel" onclick="CWAdminPanel._clearCharForm()">✕ Nouveau personnage</button>
      </div>

      <div class="admin-section">
        <div class="admin-section-title">
          ${_editingId ? `✏️ Modifier le personnage` : '➕ Nouveau personnage'}
        </div>

        <!-- Identité -->
        <div class="admin-form-block">
          <div class="admin-form-block-title">🪪 Identité</div>
          <div class="admin-grid-5">
            <div class="admin-field">
              <label>ID (auto si vide)</label>
              <input type="text" id="char-id" placeholder="char_001" />
            </div>
            <div class="admin-field">
              <label>Nom *</label>
              <input type="text" id="char-name" placeholder="Ex: Ignis" />
            </div>
            <div class="admin-field">
              <label>Rareté *</label>
              <select id="char-rarity">${rarityOptions}</select>
            </div>
            <div class="admin-field">
              <label>Type principal *</label>
              <select id="char-type1"><option value="">— Choisir —</option>${typeOptions}</select>
            </div>
            <div class="admin-field">
              <label>Type secondaire</label>
              <select id="char-type2"><option value="">— Aucun —</option>${typeOptions}</select>
            </div>
          </div>
        </div>

        <!-- Évolution -->
        <div class="admin-form-block">
          <div class="admin-form-block-title">🌀 Évolution</div>
          <div class="admin-grid-5">
            <div class="admin-field">
              <label>Lignée évolutive (ID)</label>
              <input type="text" id="char-evo-line" placeholder="line_001" />
            </div>
            <div class="admin-field">
              <label>Stade (0 = base)</label>
              <input type="number" id="char-evo-stage" value="0" min="0" max="4" />
            </div>
            <div class="admin-field">
              <label>Évolue vers (ID)</label>
              <input type="text" id="char-evolves-to" placeholder="char_002" />
            </div>
            <div class="admin-field">
              <label>Condition (type)</label>
              <select id="char-evo-cond-type">
                <option value="level">Niveau</option>
                <option value="item">Objet</option>
              </select>
            </div>
            <div class="admin-field">
              <label>Condition (valeur)</label>
              <input type="number" id="char-evo-cond-value" placeholder="15" min="1" />
            </div>
          </div>
        </div>

        <!-- Stats & Portrait -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="admin-form-block">
            <div class="admin-form-block-title">📊 Statistiques de base</div>
            <div class="admin-stats-grid">
              <div class="stat-row">
                <label>♥ PV</label>
                <input type="number" id="char-hp" value="350" min="1" max="99999" />
                <span class="stat-max">99 999</span>
              </div>
              <div class="stat-row">
                <label>× ATK</label>
                <input type="number" id="char-atk" value="50" min="1" max="9999" />
                <span class="stat-max">9 999</span>
              </div>
              <div class="stat-row">
                <label>◇ DEF</label>
                <input type="number" id="char-def" value="40" min="1" max="9999" />
                <span class="stat-max">9 999</span>
              </div>
              <div class="stat-row">
                <label>⚡ VIT</label>
                <input type="number" id="char-spd" value="50" min="1" max="9999" />
                <span class="stat-max">9 999</span>
              </div>
            </div>
          </div>
          <div class="admin-form-block">
            <div class="admin-form-block-title">🖼 Portrait</div>
            <div class="admin-field">
              <label>URL ou base64</label>
              <input type="text" id="char-portrait" placeholder="https://..." oninput="CWAdminPanel._previewPortrait(this.value)" />
            </div>
            <div id="char-portrait-preview-wrap" style="display:none;margin-top:10px">
              <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
                <img id="char-portrait-preview" src="" alt="Aperçu"
                     style="width:100px;height:150px;object-fit:cover;object-position:center 20%;
                            border-radius:8px;border:1px solid #2a2540;flex-shrink:0;display:block" />
                <button class="admin-btn admin-btn-secondary" onclick="CWAdminPanel._openCropEditor()">
                  ✂️ Recadrer
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveCharacter()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearCharForm()">🗑️ Vider</button>
        </div>
      </div>

      <hr class="admin-sep" />

      <div class="admin-section">
        <div class="admin-section-title" style="justify-content:space-between">
          <span>Liste des personnages <span class="count-badge">${chars.length}</span></span>
          <div style="display:flex;gap:8px;align-items:center">
            <select class="sort-select" id="char-list-sort" onchange="CWAdminPanel._sortCharList(this.value)">
              <option value="">Trier…</option>
              <option value="name">Nom A→Z</option>
              <option value="rarity">Rareté ↓</option>
            </select>
          </div>
        </div>
        <div class="admin-search-wrap">
          <input type="text" id="char-search" placeholder="Filtrer par nom, ID, type, rareté…"
                 oninput="CWAdminPanel._filterCharList(this.value)">
        </div>
        <div class="admin-list" id="char-list">
          ${chars.map(c => _renderCharListItem(c)).join('')}
        </div>
      </div>
    `;
  }

  /** Trie la liste des personnages par nom ou rareté (persiste l'ordre, comme le drag&drop) */
  function _sortCharList(key) {
    if (!key) return;
    const state = CWGameState.get();
    const rarityIndex = (r) => { const idx = RARITIES.indexOf(r); return idx === -1 ? 0 : idx; };
    const sorted = [...state.characters];
    if (key === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (key === 'rarity') sorted.sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || a.name.localeCompare(b.name));
    CWGameState.reorderCharDefs(sorted.map(c => c.id));
    switchTab('characters');
  }

  /** Filtre la liste des personnages sans rechargement */
  function _filterCharList(query) {
    const items = document.querySelectorAll('#char-list .admin-list-item');
    const q = query.trim().toLowerCase();
    items.forEach(item => {
      item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  function _renderCharListItem(c) {
    const state = CWGameState.get();
    const types = state.types;
    const t1 = types.find(t => t.id === c.type1);
    const t2 = types.find(t => t.id === c.type2);
    const rarityLabel = RARITY_LABELS[c.rarity] || c.rarity;
    const isEditing = c.id === _editingId;

    return `
      <div class="admin-list-item ${isEditing ? 'is-editing' : ''}" draggable="true" data-drag-id="${c.id}"
           ondragstart="CWAdminPanel._dragStart(event,'char','${c.id}')"
           ondragover="CWAdminPanel._dragOver(event)"
           ondragleave="CWAdminPanel._dragLeave(event)"
           ondrop="CWAdminPanel._dragDropChar(event,'${c.id}')"
           ondragend="CWAdminPanel._dragEnd(event)">
        <span class="drag-handle" title="Glisser pour réorganiser">⠿</span>
        ${c.portrait
          ? `<img src="${c.portrait}" style="width:36px;height:52px;object-fit:cover;border-radius:5px;flex-shrink:0;object-position:center 20%;" />`
          : `<div style="width:36px;height:52px;background:#1a1630;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#443;font-size:.7rem;flex-shrink:0;">?</div>`}
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">
            ${isEditing ? '✏️ ' : ''}${c.name}
            <span class="badge badge-${c.rarity}">${rarityLabel}</span>
            ${t1 ? `<span style="font-size:.72rem;background:${t1.color}20;color:${t1.color};padding:1px 6px;border-radius:5px;">${t1.icon} ${t1.name}</span>` : ''}
            ${t2 ? `<span style="font-size:.72rem;background:${t2.color}20;color:${t2.color};padding:1px 6px;border-radius:5px;">${t2.icon} ${t2.name}</span>` : ''}
          </div>
          <div class="admin-list-item-sub">
            <span style="color:#443">ID:</span> ${c.id}
            ${c.evolutionLine ? ` · <span style="color:#443">Lignée:</span> ${c.evolutionLine} <span style="color:#443">Stade</span> ${c.evolutionStage ?? 0}` : ''}
            ${c.evolvesTo ? ` · <span style="color:#443">→</span> ${c.evolvesTo} <span style="color:#443">niv.</span>${c.evolutionCondition?.value || '?'}` : ''}
          </div>
          <div class="stat-pills">
            <span class="stat-pill">♥ ${c.baseStats.hp}</span>
            <span class="stat-pill">× ${c.baseStats.atk}</span>
            <span class="stat-pill">◇ ${c.baseStats.def}</span>
            <span class="stat-pill">⚡ ${c.baseStats.spd}</span>
          </div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editCharacter('${c.id}')">✏️ Éditer</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._upgradeCharacter('${c.id}')" title="Créer le stade d'évolution suivant (+6% stats)">⬆️</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm"  onclick="CWAdminPanel._deleteCharacter('${c.id}')" title="Supprimer">🗑️</button>
        </div>
      </div>
    `;
  }

  /** Prévisualise le portrait */
  function _previewPortrait(url) {
    const wrap    = document.getElementById('char-portrait-preview-wrap');
    const preview = document.getElementById('char-portrait-preview');
    if (!wrap || !preview) return;
    if (url) {
      preview.src = url;
      wrap.style.display = 'block';
      _cropEditor.setImage(url);
    } else {
      wrap.style.display = 'none';
    }
  }

  /** Enregistre ou crée un personnage */
  function _saveCharacter() {
    const id       = document.getElementById('char-id')?.value.trim() || `char_${Date.now()}`;
    const name     = document.getElementById('char-name')?.value.trim();
    const rarity   = document.getElementById('char-rarity')?.value;
    const type1    = document.getElementById('char-type1')?.value;
    const type2    = document.getElementById('char-type2')?.value || null;
    const portrait = document.getElementById('char-portrait')?.value.trim() || null;
    const evoLine  = document.getElementById('char-evo-line')?.value.trim() || `line_${id}`;
    const evoStage = parseInt(document.getElementById('char-evo-stage')?.value || '0');
    const evolvesTo = document.getElementById('char-evolves-to')?.value.trim() || null;
    const condType  = document.getElementById('char-evo-cond-type')?.value;
    const condVal   = parseInt(document.getElementById('char-evo-cond-value')?.value || '0');

    if (!name) { _notify('❌ Le nom est obligatoire.', 'error'); return; }
    if (!type1) { _notify('❌ Le type principal est obligatoire.', 'error'); return; }

    const charData = {
      id,
      name,
      portrait,
      rarity,
      evolutionLine: evoLine,
      evolutionStage: evoStage,
      type1,
      type2,
      baseStats: {
        hp:  Math.min(99999, parseInt(document.getElementById('char-hp')?.value  || '350')),
        atk: Math.min(9999,  parseInt(document.getElementById('char-atk')?.value || '50')),
        def: Math.min(9999,  parseInt(document.getElementById('char-def')?.value || '40')),
        spd: Math.min(9999,  parseInt(document.getElementById('char-spd')?.value || '50')),
      },
      evolutionCondition: condVal > 0 ? { type: condType, value: condVal } : null,
      evolvesTo: evolvesTo || null,
      portraitCrop: _cropEditor.getPortraitCrop(),
      detailCrop:   _cropEditor.getDetailCrop(),
      combatCrop:   _cropEditor.getCombatCrop(),
    };

    const existing = CWGameState.getCharDef(id);
    if (existing) {
      CWGameState.updateCharDef(id, charData);
      _notify(`✅ Personnage "${name}" mis à jour.`);
    } else {
      CWGameState.addCharDef(charData);
      _notify(`✅ Personnage "${name}" créé.`);
    }

    _clearCharForm();
    // Rafraîchir juste la liste
    const list = document.getElementById('char-list');
    if (list) {
      const chars = CWGameState.get().characters;
      list.innerHTML = chars.map(c => _renderCharListItem(c)).join('');
    }
    _scrollToListItem(id);
  }

  /** Remplit le formulaire pour éditer un personnage */
  function _editCharacter(charId) {
    const c = CWGameState.getCharDef(charId);
    if (!c) return;

    _setVal('char-id', c.id);
    _setVal('char-name', c.name);
    _setVal('char-rarity', c.rarity);
    _setVal('char-type1', c.type1);
    _setVal('char-type2', c.type2 || '');
    _setVal('char-portrait', c.portrait || '');
    _setVal('char-evo-line', c.evolutionLine || '');
    _setVal('char-evo-stage', c.evolutionStage ?? 0);
    _setVal('char-evolves-to', c.evolvesTo || '');
    _setVal('char-evo-cond-type', c.evolutionCondition?.type || 'level');
    _setVal('char-evo-cond-value', c.evolutionCondition?.value || '');
    _setVal('char-hp', c.baseStats.hp);
    _setVal('char-atk', c.baseStats.atk);
    _setVal('char-def', c.baseStats.def);
    _setVal('char-spd', c.baseStats.spd);

    if (c.portrait) {
      _previewPortrait(c.portrait);
      _cropEditor.setPortraitCrop(c.portraitCrop || null);
      _cropEditor.setDetailCrop(c.detailCrop || null);
      _cropEditor.setCombatCrop(c.combatCrop || null);
    }
    _cropCurrentCharId = charId; // pour que Confirmer sauvegarde directement

    // Bannière d'édition
    const banner = document.getElementById('char-edit-banner');
    const bannerName = document.getElementById('char-edit-name');
    if (banner)     { banner.classList.add('visible'); }
    if (bannerName) { bannerName.textContent = `${c.name} (${charId})`; }

    // Mettre en évidence l'item de la liste
    document.querySelectorAll('.admin-list-item.is-editing').forEach(el => el.classList.remove('is-editing'));
    document.querySelector(`.admin-list-item[data-drag-id="${charId}"]`)?.classList.add('is-editing');

    // Scroll vers le formulaire
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
    _notify(`✏️ Édition de "${c.name}"`);
  }

  /** Supprime un personnage */
  function _deleteCharacter(charId) {
    const c = CWGameState.getCharDef(charId);
    if (!c) return;
    if (!confirm(`Supprimer "${c.name}" (${charId}) ? Cette action est irréversible.`)) return;
    CWGameState.removeCharDef(charId);
    _notify(`🗑️ Personnage supprimé.`);
    switchTab('characters');
  }

  /** Vide le formulaire personnage */
  function _clearCharForm() {
    ['char-id','char-name','char-portrait','char-evo-line',
     'char-evolves-to','char-evo-cond-value'].forEach(id => _setVal(id, ''));
    _setVal('char-rarity', 'common');
    _setVal('char-type1', '');
    _setVal('char-type2', '');
    _setVal('char-evo-stage', '0');
    _setVal('char-hp', '350');
    _setVal('char-atk', '50');
    _setVal('char-def', '40');
    _setVal('char-spd', '50');
    const wrap = document.getElementById('char-portrait-preview-wrap');
    if (wrap) wrap.style.display = 'none';
    _cropEditor.reset();
    _cropCurrentCharId = null;
    // Cacher le banner d'édition
    document.getElementById('char-edit-banner')?.classList.remove('visible');
    document.querySelectorAll('.admin-list-item.is-editing').forEach(el => el.classList.remove('is-editing'));
  }

  // ─── ÉDITEUR DE RECADRAGE DES PORTRAITS ─────────────────────────────────────
  // Approche CSS pure (pas de canvas → pas de CORS). 3 zones indépendantes.
  // CORRECTIFS :
  //  • Persistance  : Confirmer écrit directement dans le state (pas besoin de 💾 Enregistrer pour le crop)
  //  • Zoom         : agrandit l'IMAGE à l'intérieur du cadre fixe (pas le cadre lui-même)
  //  • Cercle       : ne peut pas sortir de l'image (boundary clamping)
  //  • Fiche        : aperçu proportionnel à la hauteur réelle de la fiche

  let _cropCurrentCharId = null;   // ID du personnage en cours d'édition dans l'éditeur

  const _cropEditor = (() => {
    let _imgSrc = null;
    let _pCrop  = null;   // portraitCrop  { x, y, zoom }
    let _dCrop  = null;   // detailCrop    { x, y, zoom }
    let _cCrop  = null;   // combatCrop    { cx, cy, r }

    const _pDef = () => CWGameDatabase.defaultPortraitCrop();
    const _dDef = () => CWGameDatabase.defaultDetailCrop();
    const _cDef = () => CWGameDatabase.defaultCombatCrop();

    function setImage(src)        { _imgSrc = src || null; }
    function setPortraitCrop(c)   { _pCrop = c ? { ..._pDef(), ...c } : _pDef(); }
    function setDetailCrop(c)     { _dCrop = c ? { ..._dDef(), ...c } : _dDef(); }
    function setCombatCrop(c)     { _cCrop = c ? { ..._cDef(), ...c } : _cDef(); }
    function getPortraitCrop()    { return { ...(_pCrop || _pDef()) }; }
    function getDetailCrop()      { return { ...(_dCrop || _dDef()) }; }
    function getCombatCrop()      { return { ...(_cCrop || _cDef()) }; }
    function reset() { _imgSrc = null; _pCrop = null; _dCrop = null; _cCrop = null; }

    // ── Rendu d'une zone "image avec zoom" ───────────────────────────────────
    // ZOOM CORRECT : le cadre (wrapper) reste fixe, l'image grossit ou rétrécit
    // à l'intérieur via un élément enfant positionné en absolu.
    // Formule : left = crop.x*(1-zoom)%, top = crop.y*(1-zoom)%
    // Ce calcul garantit que le point focal (crop.x%, crop.y%) reste à la même
    // position dans le cadre quel que soit le niveau de zoom.

    function _imgStyle(imgSrc, crop) {
      const c    = crop || _pDef();
      const zoom = Math.max(1, Math.min(5, c.zoom ?? 1));
      const x = c.x ?? 50, y = c.y ?? 20;
      return `position:absolute;
        width:${zoom*100}%;height:${zoom*100}%;
        max-width:none;max-height:none;
        object-fit:cover;object-position:${x}% ${y}%;
        left:${(1-zoom)*x}%;top:${(1-zoom)*y}%;
        display:block;pointer-events:none;user-select:none`;
    }

    function _updateZoneImg(imgId, crop) {
      const img = document.getElementById(imgId);
      if (!img) return;
      const c = crop || _pDef();
      const zoom = Math.max(1, Math.min(5, c.zoom ?? 1));
      const x = c.x ?? 50, y = c.y ?? 20;
      img.style.cssText = img.style.cssText.replace(/;?$/, '');
      img.style.width = `${zoom * 100}%`;
      img.style.height = `${zoom * 100}%`;
      img.style.objectPosition = `${x}% ${y}%`;
      img.style.left = `${(1 - zoom) * x}%`;
      img.style.top  = `${(1 - zoom) * y}%`;
    }

    function _applyCollection() {
      _updateZoneImg('ce-col-img', _pCrop);
      _updateZoneImg('ce-prev-col', _pCrop);
      const lbl = document.getElementById('ce-zoom-lbl-col');
      if (lbl) lbl.textContent = `×${Number(_pCrop?.zoom || 1).toFixed(1)}`;
    }

    function _applyDetail() {
      _updateZoneImg('ce-det-img', _dCrop);
      _updateZoneImg('ce-prev-det', _dCrop);
      const lbl = document.getElementById('ce-zoom-lbl-det');
      if (lbl) lbl.textContent = `×${Number(_dCrop?.zoom || 1).toFixed(1)}`;
    }

    function _applyCombat() {
      const svg = document.getElementById('ce-svg');
      if (!svg || !_cCrop) return;
      const W = 260, H = 260;
      const cx = W * _cCrop.cx / 100;
      const cy = H * _cCrop.cy / 100;
      const r  = Math.min(W, H) * _cCrop.r / 100;
      svg.getElementById('ce-circle')?.setAttribute('cx', cx);
      svg.getElementById('ce-circle')?.setAttribute('cy', cy);
      svg.getElementById('ce-circle')?.setAttribute('r',  r);
      svg.getElementById('ce-mask-c')?.setAttribute('cx', cx);
      svg.getElementById('ce-mask-c')?.setAttribute('cy', cy);
      svg.getElementById('ce-mask-c')?.setAttribute('r',  r);
      svg.getElementById('ce-handle')?.setAttribute('cx', cx + r * 0.707);
      svg.getElementById('ce-handle')?.setAttribute('cy', cy + r * 0.707);
      // Aperçu combat : montre EXACTEMENT le contenu visible dans le grand cercle
      // scale = 90px_container / diamètre_cercle_en_px → la zone du cercle remplit l'aperçu
      const prev = document.getElementById('ce-prev-com');
      if (prev) {
        const scale = 90 / (2 * r);
        const pw = Math.round(260 * scale);
        prev.style.position      = 'absolute';
        prev.style.width         = `${pw}px`;
        prev.style.height        = `${pw}px`;
        prev.style.left          = `${Math.round(45 - cx * scale)}px`;
        prev.style.top           = `${Math.round(45 - cy * scale)}px`;
        prev.style.maxWidth      = 'none';
        prev.style.maxHeight     = 'none';
        prev.style.objectFit     = 'cover';
        prev.style.objectPosition= '50% 0%';
        prev.style.transform     = '';
        prev.style.clipPath      = '';
      }
    }

    // ── Drag pour les zones carrées ───────────────────────────────────────────

    function _bindSquareZone(wrapId, getCrop, setCropFn, applyFn) {
      const wrap = document.getElementById(wrapId);
      if (!wrap) return;
      let drag = null;
      const down = (x, y) => {
        const c = getCrop();
        drag = { sx: x, sy: y, ox: c.x, oy: c.y };
      };
      const move = (x, y) => {
        if (!drag) return;
        const c = getCrop();
        const z = Math.max(1, c.zoom);
        setCropFn({
          ...c,
          x: Math.max(0, Math.min(100, drag.ox - (x - drag.sx) / wrap.offsetWidth  * 100 / z)),
          y: Math.max(0, Math.min(100, drag.oy - (y - drag.sy) / wrap.offsetHeight * 100 / z)),
        });
        applyFn();
      };
      const up = () => { drag = null; wrap.style.cursor = 'grab'; };

      wrap.addEventListener('mousedown', e => { e.preventDefault(); down(e.clientX, e.clientY); wrap.style.cursor = 'grabbing'; });
      window.addEventListener('mousemove', e => move(e.clientX, e.clientY));
      window.addEventListener('mouseup', up);
      wrap.addEventListener('touchstart', e => { const t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
      wrap.addEventListener('touchmove',  e => { const t = e.touches[0]; move(t.clientX, t.clientY); }, { passive: true });
      wrap.addEventListener('touchend', up);
      wrap.addEventListener('wheel', e => {
        e.preventDefault();
        const c = getCrop();
        setCropFn({ ...c, zoom: Math.max(1, Math.min(5, (c.zoom || 1) - e.deltaY * 0.005)) });
        applyFn();
      }, { passive: false });
      wrap.style.cursor = 'grab';
    }

    // ── Drag pour le cercle combat + clamping aux bords ────────────────────────

    function _bindCombatZone(wrapId) {
      const wrap = document.getElementById(wrapId);
      const svg  = document.getElementById('ce-svg');
      if (!wrap || !svg) return;
      let mode = null, start = null;

      const pct = (ex, ey) => {
        const r = wrap.getBoundingClientRect();
        return { px: (ex - r.left) / r.width * 100, py: (ey - r.top) / r.height * 100 };
      };
      const dist = (ax, ay, bx, by) => Math.sqrt((ax-bx)**2 + (ay-by)**2);

      const clampCircle = (cx, cy, r) => {
        // Le cercle ne peut pas sortir du cadre (0-100% dans chaque dimension)
        const clamped_cx = Math.max(r, Math.min(100 - r, cx));
        const clamped_cy = Math.max(r, Math.min(100 - r, cy));
        return { cx: clamped_cx, cy: clamped_cy };
      };

      const onDown = (ex, ey) => {
        if (!_cCrop) _cCrop = _cDef();
        const { px, py } = pct(ex, ey);
        const handleX = _cCrop.cx + _cCrop.r * 0.707;
        const handleY = _cCrop.cy + _cCrop.r * 0.707;
        if (dist(px, py, handleX, handleY) < 8) {
          mode = 'resize'; start = { px, py, origR: _cCrop.r };
        } else if (dist(px, py, _cCrop.cx, _cCrop.cy) < _cCrop.r + 6) {
          mode = 'move'; start = { px, py, origCx: _cCrop.cx, origCy: _cCrop.cy };
        }
      };

      const onMove = (ex, ey) => {
        if (!mode || !start || !_cCrop) return;
        const { px, py } = pct(ex, ey);
        if (mode === 'move') {
          const newCx = start.origCx + (px - start.px);
          const newCy = start.origCy + (py - start.py);
          const clamped = clampCircle(newCx, newCy, _cCrop.r);
          _cCrop.cx = clamped.cx;
          _cCrop.cy = clamped.cy;
        } else {
          const d = dist(px, py, _cCrop.cx, _cCrop.cy);
          // Rayon max limité pour ne pas dépasser les bords avec la position actuelle
          const maxR = Math.min(50, _cCrop.cx, _cCrop.cy, 100 - _cCrop.cx, 100 - _cCrop.cy);
          _cCrop.r = Math.max(5, Math.min(maxR, d));
        }
        _applyCombat();
      };

      const onUp = () => { mode = null; start = null; };

      svg.addEventListener('mousedown',  e => { e.preventDefault(); onDown(e.clientX, e.clientY); });
      window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
      window.addEventListener('mouseup',   onUp);
      svg.addEventListener('touchstart', e => { const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
      svg.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: false });
      svg.addEventListener('touchend', onUp);
    }

    // ── Ouvrir la modale ──────────────────────────────────────────────────────

    function open() {
      if (!_imgSrc) { _notify('❌ Saisis d\'abord l\'URL du portrait.', 'error'); return; }
      if (!_pCrop) _pCrop = _pDef();
      if (!_dCrop) _dCrop = _dDef();
      if (!_cCrop) _cCrop = _cDef();

      document.getElementById('crop-overlay')?.remove();

      const W = 260;                // largeur des zones Collection et Combat
      const DW = 140, DH = 420;    // dimensions de la zone Fiche (portrait tall ~1:3)
      const p = _pCrop, d = _dCrop, c = _cCrop;
      const p_zoom = Math.max(1, p.zoom), d_zoom = Math.max(1, d.zoom);
      const cx_px = W * c.cx / 100, cy_px = W * c.cy / 100;
      const r_px  = W * c.r / 100;
      const hx = cx_px + r_px * 0.707, hy = cy_px + r_px * 0.707;

      const imgStyleFor = (crop, wPx, hPx) => {
        const zoom = Math.max(1, Math.min(5, crop.zoom ?? 1));
        const x = crop.x ?? 50, y = crop.y ?? 20;
        return `position:absolute;width:${zoom*100}%;height:${zoom*100}%;max-width:none;max-height:none;object-fit:cover;object-position:${x}% ${y}%;left:${(1-zoom)*x}%;top:${(1-zoom)*y}%;display:block;pointer-events:none`;
      };

      const overlay = document.createElement('div');
      overlay.id = 'crop-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:99999;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;overflow-y:auto';

      overlay.innerHTML = `
        <div style="background:#1c1730;border:1px solid #342a56;border-radius:14px;max-width:1040px;width:100%;display:flex;flex-direction:column">

          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px 10px;border-bottom:1px solid #342a56;background:#1c1730;border-radius:14px 14px 0 0">
            <h3 style="margin:0;font-family:var(--font-display);font-size:1rem">✂️ Recadrage des portraits</h3>
            <button onclick="document.getElementById('crop-overlay').remove()"
              style="background:transparent;border:none;color:#aaa;font-size:1.4rem;cursor:pointer;padding:2px 8px;border-radius:6px">✕</button>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:16px;padding:16px;overflow-y:auto">

            <!-- Zone 1 : Vignette Collection -->
            <div style="flex:1 1 260px;display:flex;flex-direction:column;gap:8px">
              <div style="font-weight:800;font-size:.82rem;color:#a99cd1">🗂 Vignette Collection</div>
              <div style="font-size:.68rem;color:#666">Petite carte — glisser / molette pour zoomer</div>
              <div id="ce-col-wrap"
                style="width:${W}px;height:${W}px;border-radius:10px;overflow:hidden;border:1.5px solid #342a56;background:#0c0a16;cursor:grab;user-select:none;position:relative;flex-shrink:0">
                <img id="ce-col-img" src="${_imgSrc}" style="${imgStyleFor(p, W, W)}">
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:#aaa;font-family:monospace">
                <button onclick="CWAdminPanel._cropZoom('col',-0.2)"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:1rem;line-height:1">−</button>
                <span id="ce-zoom-lbl-col" style="min-width:36px;text-align:center">×${Number(p_zoom).toFixed(1)}</span>
                <button onclick="CWAdminPanel._cropZoom('col',0.2)"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:1rem;line-height:1">+</button>
                <button onclick="CWAdminPanel._cropReset('col')"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 10px;cursor:pointer;margin-left:4px;font-size:.8rem" title="Réinitialiser">⟲</button>
              </div>
            </div>

            <!-- Zone 2 : Fiche personnage (tall) -->
            <div style="flex:0 1 ${DW+20}px;display:flex;flex-direction:column;gap:8px">
              <div style="font-weight:800;font-size:.82rem;color:#a99cd1">🖼 Fiche personnage</div>
              <div style="font-size:.68rem;color:#666">Grand portrait dans la fiche — glisser / molette</div>
              <div id="ce-det-wrap"
                style="width:${DW}px;height:${DH}px;border-radius:10px;overflow:hidden;border:1.5px solid #342a56;background:#0c0a16;cursor:grab;user-select:none;position:relative;flex-shrink:0">
                <img id="ce-det-img" src="${_imgSrc}" style="${imgStyleFor(d, DW, DH)}">
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:#aaa;font-family:monospace">
                <button onclick="CWAdminPanel._cropZoom('det',-0.2)"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:1rem;line-height:1">−</button>
                <span id="ce-zoom-lbl-det" style="min-width:36px;text-align:center">×${Number(d_zoom).toFixed(1)}</span>
                <button onclick="CWAdminPanel._cropZoom('det',0.2)"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:1rem;line-height:1">+</button>
                <button onclick="CWAdminPanel._cropReset('det')"
                  style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:4px 10px;cursor:pointer;margin-left:4px;font-size:.8rem" title="Réinitialiser">⟲</button>
              </div>
            </div>

            <!-- Zone 3 : Combat -->
            <div style="flex:1 1 260px;display:flex;flex-direction:column;gap:8px">
              <div style="font-weight:800;font-size:.82rem;color:#a99cd1">⚔️ Combat (cercle)</div>
              <div style="font-size:.68rem;color:#666">Glisser le cercle · poignée pour redimensionner · cercle limité au cadre</div>
              <div id="ce-com-wrap"
                style="width:${W}px;height:${W}px;border-radius:10px;overflow:hidden;border:1.5px solid #342a56;background:#0c0a16;position:relative;flex-shrink:0;user-select:none">
                <img id="ce-com-bg" src="${_imgSrc}"
                  style="position:absolute;inset:0;width:100%;height:100%;max-width:none;max-height:none;object-fit:cover;object-position:50% 0%;display:block;pointer-events:none;">
                <svg id="ce-svg" width="${W}" height="${W}"
                  style="position:absolute;inset:0;cursor:move;touch-action:none">
                  <defs>
                    <mask id="ce-mask">
                      <rect width="${W}" height="${W}" fill="white"/>
                      <circle id="ce-mask-c" cx="${cx_px}" cy="${cy_px}" r="${r_px}" fill="black"/>
                    </mask>
                  </defs>
                  <rect width="${W}" height="${W}" fill="rgba(0,0,0,.6)" mask="url(#ce-mask)"/>
                  <circle id="ce-circle" cx="${cx_px}" cy="${cy_px}" r="${r_px}"
                    fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2"/>
                  <circle id="ce-handle" cx="${hx}" cy="${hy}" r="8"
                    fill="white" stroke="#333" stroke-width="1.5" style="cursor:nw-resize"/>
                </svg>
              </div>
              <button onclick="CWAdminPanel._cropReset('com')"
                style="background:#271f42;border:1px solid #342a56;color:#ccc;border-radius:6px;padding:5px 12px;cursor:pointer;font-size:.82rem;align-self:flex-start">⟲ Réinitialiser</button>
            </div>

            <!-- Aperçus -->
            <div style="flex:0 1 110px;display:flex;flex-direction:column;gap:10px;min-width:90px">
              <div style="font-weight:800;font-size:.82rem;color:#a99cd1">👁 Aperçu</div>
              <div>
                <div style="font-size:.65rem;color:#888;margin-bottom:4px;text-align:center">Vignette</div>
                <div style="width:90px;height:90px;border-radius:8px;border:1.5px solid #342a56;overflow:hidden;position:relative;background:#0c0a16">
                  <img id="ce-prev-col" src="${_imgSrc}" style="${imgStyleFor(p, 90, 90)}">
                </div>
              </div>
              <div>
                <div style="font-size:.65rem;color:#888;margin-bottom:4px;text-align:center">Fiche</div>
                <div style="width:90px;height:180px;border-radius:8px;border:1.5px solid #342a56;overflow:hidden;position:relative;background:#0c0a16">
                  <img id="ce-prev-det" src="${_imgSrc}" style="${imgStyleFor(d, 90, 180)}">
                </div>
              </div>
              <div>
                <div style="font-size:.65rem;color:#888;margin-bottom:4px;text-align:center">Combat</div>
                <div style="width:90px;height:90px;border-radius:50%;border:1.5px solid #342a56;overflow:hidden;position:relative;background:#0c0a16">
                  <img id="ce-prev-com" src="${_imgSrc}"
                    style="position:absolute;width:${Math.round(260*90/(2*r_px))}px;height:${Math.round(260*90/(2*r_px))}px;left:${Math.round(45-cx_px*90/(2*r_px))}px;top:${Math.round(45-cy_px*90/(2*r_px))}px;max-width:none;max-height:none;object-fit:cover;object-position:50% 0%;display:block;">
                </div>
              </div>
            </div>

          </div>

          <div style="display:flex;gap:10px;padding:12px 18px;border-top:1px solid #342a56;flex-wrap:wrap">
            <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._cropConfirm()">✅ Confirmer et enregistrer</button>
            <button class="admin-btn admin-btn-primary" onclick="document.getElementById('crop-overlay').remove()">Annuler</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      _bindSquareZone('ce-col-wrap',
        () => _pCrop || _pDef(),
        c => { _pCrop = c; const lbl = document.getElementById('ce-zoom-lbl-col'); if (lbl) lbl.textContent = `×${Number(c.zoom||1).toFixed(1)}`; },
        _applyCollection);
      _bindSquareZone('ce-det-wrap',
        () => _dCrop || _dDef(),
        c => { _dCrop = c; const lbl = document.getElementById('ce-zoom-lbl-det'); if (lbl) lbl.textContent = `×${Number(c.zoom||1).toFixed(1)}`; },
        _applyDetail);
      _bindCombatZone('ce-com-wrap');
    }

    return {
      open, reset,
      setImage, setPortraitCrop, setDetailCrop, setCombatCrop,
      getPortraitCrop, getDetailCrop, getCombatCrop,
      zoomBy(zone, delta) {
        if (zone === 'col') { if (!_pCrop) _pCrop = _pDef(); _pCrop.zoom = Math.max(1, Math.min(5, (_pCrop.zoom||1) + delta)); _applyCollection(); }
        if (zone === 'det') { if (!_dCrop) _dCrop = _dDef(); _dCrop.zoom = Math.max(1, Math.min(5, (_dCrop.zoom||1) + delta)); _applyDetail(); }
      },
      resetZone(zone) {
        if (zone === 'col') { _pCrop = _pDef(); _applyCollection(); }
        if (zone === 'det') { _dCrop = _dDef(); _applyDetail(); }
        if (zone === 'com') { _cCrop = _cDef(); _applyCombat(); }
      },
    };
  })();

  function _openCropEditor() {
    const url = document.getElementById('char-portrait')?.value?.trim();
    if (!url) { _notify('❌ Saisis d\'abord l\'URL du portrait.', 'error'); return; }
    _cropEditor.setImage(url);
    _cropEditor.open();
  }

  function _cropZoom(zone, delta) { _cropEditor.zoomBy(zone, delta); }
  function _cropReset(zone)        { _cropEditor.resetZone(zone); }

  /**
   * Confirme le recadrage ET l'enregistre IMMÉDIATEMENT dans le state.
   * L'utilisateur n'a pas besoin de cliquer "💾 Enregistrer" séparément
   * pour que les crops soient persistés.
   */
  function _cropConfirm() {
    document.getElementById('crop-overlay')?.remove();
    // Écriture immédiate des crops dans le state (sans attendre "💾 Enregistrer")
    if (_cropCurrentCharId) {
      const existing = CWGameState.getCharDef(_cropCurrentCharId);
      if (existing) {
        CWGameState.updateCharDef(_cropCurrentCharId, {
          portraitCrop: _cropEditor.getPortraitCrop(),
          detailCrop:   _cropEditor.getDetailCrop(),
          combatCrop:   _cropEditor.getCombatCrop(),
        });
        _notify('✅ Recadrage enregistré automatiquement. Modifie les autres champs si besoin puis clique 💾 Enregistrer.');
        return;
      }
    }
    _notify('✅ Recadrage prêt — clique 💾 Enregistrer pour tout sauvegarder.');
  }

  // ─── ONGLET TYPES ────────────────────────────────────────────────────────────

  function _renderTypesTab() {
    const state  = CWGameState.get();
    const types  = state.types;
    const matrix = state.typeMatrix;
    const tags   = state.tags;

    const typesList = types.map(t => {
      const passive = t.passiveId ? state.passives.find(p => p.id === t.passiveId) : null;
      return `
      <div class="admin-list-item" draggable="true" data-drag-id="${t.id}"
           ondragstart="CWAdminPanel._dragStart(event,'type','${t.id}')"
           ondragover="CWAdminPanel._dragOver(event)"
           ondragleave="CWAdminPanel._dragLeave(event)"
           ondrop="CWAdminPanel._dragDropType(event,'${t.id}')"
           ondragend="CWAdminPanel._dragEnd(event)">
        <span class="drag-handle" title="Glisser pour réorganiser">⠿</span>
        <div style="font-size:1.5rem;">${t.icon}</div>
        <div class="admin-list-item-info">
          <div class="admin-list-item-name" style="color:${t.color}">${t.name}</div>
          <div class="admin-list-item-sub">ID: ${t.id}${passive ? ` — Passif : <strong>${passive.name}</strong>` : ' — Aucun passif'}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editType('${t.id}')">✏️</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteType('${t.id}')">🗑️</button>
        </div>
      </div>
    `;
    }).join('');

    // Matrice des types interactive
    const matrixHtml = _buildTypeMatrix(types, matrix);

    return `
      <div class="admin-section">
        <div class="admin-section-title">Créer / Modifier un type</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>ID (slug, ex: fire)</label>
            <input type="text" id="type-id" placeholder="fire" />
          </div>
          <div class="admin-field">
            <label>Nom affiché</label>
            <input type="text" id="type-name" placeholder="Feu" />
          </div>
          <div class="admin-field">
            <label>Couleur</label>
            <input type="color" id="type-color" value="#FF4500" />
          </div>
          <div class="admin-field">
            <label>Icône (emoji)</label>
            <input type="text" id="type-icon" placeholder="🔥" maxlength="4" />
          </div>
          <div class="admin-field">
            <label>Passif lié (optionnel)</label>
            <select id="type-passive">
              <option value="">— Aucun —</option>
              ${state.passives.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveType()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearTypeForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Types existants</div>
        <div class="admin-list">${typesList}</div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Matrice des types (cliquer pour modifier)</div>
        <p style="font-size:.78rem; color:#888; margin-bottom:10px;">
          Valeurs : 2.0 = super efficace 🟢 | 0.5 = peu efficace 🔴 | 0 = immunité ⚫ | 1.0 = normal
        </p>
        <div style="overflow-x:auto;">${matrixHtml}</div>
        <div class="admin-actions" style="margin-top:12px;">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveMatrix()">💾 Sauver la matrice</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <p style="font-size:.82rem; color:#a99cd1; margin:0;">
          🏷️ Les tags sont désormais gérés dans l'onglet <strong>Tags</strong>
          — catégories et tags sont regroupés dans une interface dédiée.
          <button class="admin-btn admin-btn-primary admin-btn-sm" style="margin-left:8px;"
            onclick="CWAdminPanel.switchTab('tags')">Aller aux Tags →</button>
        </p>
      </div>
    `;
  }

  // ─── TAGS TAB ────────────────────────────────────────────────────────────────

  function _renderTagsTab() {
    const state = CWGameState.get();
    const cats  = (state.tagCategories || []);
    const tags  = (state.tags || []);

    // ── Catégories ──
    const catFormHtml = `
      <div class="admin-section">
        <div class="admin-section-title">Catégories de tags</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:10px;">
          Chaque catégorie regroupe des tags du même type (ex : Continent, Ethnie…).
          Elle apparaît comme section dans le sélecteur des lignées évolutives.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>ID (slug, ex: continent)</label>
            <input type="text" id="tagcat-id" placeholder="continent" />
          </div>
          <div class="admin-field">
            <label>Nom affiché</label>
            <input type="text" id="tagcat-name" placeholder="Continent" />
          </div>
          <div class="admin-field">
            <label>Icône (emoji)</label>
            <input type="text" id="tagcat-icon" placeholder="🌍" maxlength="4" style="width:60px;" />
          </div>
          <div class="admin-field">
            <label>Couleur</label>
            <input type="color" id="tagcat-color" value="#4a9eff" />
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveTagCategory()">💾 Enregistrer catégorie</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearTagCategoryForm()">🗑️ Vider</button>
        </div>
      </div>
    `;

    // ── Liste des catégories avec leurs tags ──
    const catListHtml = cats.length === 0
      ? `<p style="color:#888;font-size:.85rem;">Aucune catégorie créée.</p>`
      : cats.map(cat => {
          const catTags = tags.filter(t => t.categoryId === cat.id);
          const tagsHtml = catTags.length === 0
            ? `<span class="tag-cat-block-empty">Aucun tag dans cette catégorie.</span>`
            : catTags.map(t => `
                <span class="tag-chip" style="background:${t.color || cat.color}">
                  ${t.name}
                  <span style="font-size:.62rem;opacity:.7;margin-left:2px;">·</span>
                  <button class="admin-btn admin-btn-primary admin-btn-sm" style="padding:1px 5px;font-size:.6rem;"
                    onclick="CWAdminPanel._editTag('${t.id}')">✏️</button>
                  <button class="admin-btn admin-btn-danger admin-btn-sm" style="padding:1px 5px;font-size:.6rem;"
                    onclick="CWAdminPanel._deleteTag('${t.id}')">🗑️</button>
                </span>
              `).join('');
          return `
            <div class="tag-cat-block">
              <div class="tag-cat-block-header">
                <span class="tag-cat-block-icon">${cat.icon || '🏷️'}</span>
                <span class="tag-cat-block-name" style="color:${cat.color}">${cat.name}</span>
                <span class="tag-cat-block-id">ID: ${cat.id}</span>
                <div class="admin-list-item-actions" style="margin-left:auto;">
                  <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editTagCategory('${cat.id}')">✏️</button>
                  <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteTagCategory('${cat.id}')">🗑️</button>
                </div>
              </div>
              <div class="tag-cat-block-tags">${tagsHtml}</div>
            </div>
          `;
        }).join('');

    // ── Formulaire tag ──
    const tagCatOptions = cats.map(cat =>
      `<option value="${cat.id}">${cat.icon || '🏷️'} ${cat.name}</option>`
    ).join('');

    const tagFormHtml = `
      <div class="admin-section">
        <div class="admin-section-title">Créer / Modifier un tag</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Catégorie</label>
            <select id="tag-category-id" style="background:#0e0c1a;border:1px solid #2a2540;color:#e8d5b7;border-radius:6px;padding:6px 8px;">
              <option value="">— Choisir une catégorie —</option>
              ${tagCatOptions}
            </select>
          </div>
          <div class="admin-field">
            <label>ID (slug, ex: europe)</label>
            <input type="text" id="tag-id" placeholder="europe" />
          </div>
          <div class="admin-field">
            <label>Nom affiché</label>
            <input type="text" id="tag-name" placeholder="Europe" />
          </div>
          <div class="admin-field">
            <label>Couleur</label>
            <input type="color" id="tag-color" value="#4a9eff" />
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveTag()">💾 Enregistrer tag</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearTagForm()">🗑️ Vider</button>
        </div>
      </div>
    `;

    return `
      ${catFormHtml}
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Catégories & tags existants (${cats.length} catégorie${cats.length > 1 ? 's' : ''}, ${tags.length} tag${tags.length > 1 ? 's' : ''})</div>
        ${catListHtml}
      </div>
      <hr class="admin-sep" />
      ${tagFormHtml}
    `;
  }

  // ─── TAG CATEGORY CRUD ───────────────────────────────────────────────────────

  function _saveTagCategory() {
    const id    = document.getElementById('tagcat-id')?.value.trim().replace(/\s+/g, '_').toLowerCase();
    const name  = document.getElementById('tagcat-name')?.value.trim();
    const icon  = document.getElementById('tagcat-icon')?.value.trim() || '🏷️';
    const color = document.getElementById('tagcat-color')?.value || '#4a9eff';
    if (!id || !name) { _notify('❌ ID et Nom sont obligatoires.', 'error'); return; }
    const state = CWGameState.get();
    if (state.tagCategories?.find(c => c.id === id)) {
      CWGameState.updateTagCategory(id, { name, icon, color });
      _notify(`✅ Catégorie "${name}" mise à jour.`);
    } else {
      CWGameState.addTagCategory({ id, name, icon, color });
      _notify(`✅ Catégorie "${name}" créée.`);
    }
    _clearTagCategoryForm();
    switchTab('tags');
  }

  function _editTagCategory(catId) {
    const state = CWGameState.get();
    const cat = (state.tagCategories || []).find(c => c.id === catId);
    if (!cat) return;
    _setVal('tagcat-id', cat.id);
    _setVal('tagcat-name', cat.name);
    _setVal('tagcat-icon', cat.icon || '🏷️');
    _setVal('tagcat-color', cat.color || '#4a9eff');
    document.getElementById('tagcat-id').focus();
  }

  function _deleteTagCategory(catId) {
    const state = CWGameState.get();
    const cat = (state.tagCategories || []).find(c => c.id === catId);
    const tagCount = (state.tags || []).filter(t => t.categoryId === catId).length;
    if (!confirm(`Supprimer la catégorie "${cat?.name || catId}" et ses ${tagCount} tag(s) ? Ils seront retirés de tous les personnages.`)) return;
    CWGameState.removeTagCategory(catId);
    _notify('🗑️ Catégorie supprimée.');
    switchTab('tags');
  }

  function _clearTagCategoryForm() {
    ['tagcat-id', 'tagcat-name', 'tagcat-icon'].forEach(id => _setVal(id, ''));
    _setVal('tagcat-icon', '');
    _setVal('tagcat-color', '#4a9eff');
  }

    function _buildTypeMatrix(types, matrix) {
    const ids = types.map(t => t.id);
    let html = `<table class="type-matrix-table"><thead><tr><th>ATK ↓ / DEF →</th>`;
    types.forEach(t => { html += `<th title="${t.name}">${t.icon}</th>`; });
    html += '</tr></thead><tbody>';

    ids.forEach(atk => {
      const atkType = types.find(t => t.id === atk);
      html += `<tr><th>${atkType?.icon || ''} ${atkType?.name || atk}</th>`;
      ids.forEach(def => {
        const val = matrix[atk]?.[def] ?? 1.0;
        let cls = '';
        if (val >= 2.0) cls = 'mult-super';
        else if (val <= 0) cls = 'mult-immune';
        else if (val < 1.0) cls = 'mult-low';
        html += `<td class="${cls}"><input type="number" step="0.5" min="0" max="4"
                   value="${val}" data-atk="${atk}" data-def="${def}"
                   style="width:45px;background:transparent;border:none;color:inherit;text-align:center;font-size:.72rem;"
                   onchange="CWAdminPanel._matrixCellChanged(this)" /></td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  function _matrixCellChanged(input) {
    // Feedback visuel immédiat
    const val = parseFloat(input.value);
    input.parentElement.className = val >= 2.0 ? 'mult-super' : val <= 0 ? 'mult-immune' : val < 1.0 ? 'mult-low' : '';
  }

  function _saveMatrix() {
    const state  = CWGameState.get();
    const types  = state.types;
    const ids    = types.map(t => t.id);
    const matrix = {};

    ids.forEach(atk => {
      matrix[atk] = {};
      ids.forEach(def => {
        const input = document.querySelector(`input[data-atk="${atk}"][data-def="${def}"]`);
        matrix[atk][def] = input ? parseFloat(input.value) || 1.0 : 1.0;
      });
    });

    CWGameState.updateTypeMatrix(matrix);
    _notify('✅ Matrice des types sauvegardée.');
  }

  function _saveType() {
    const id   = document.getElementById('type-id')?.value.trim();
    const name = document.getElementById('type-name')?.value.trim();
    const color = document.getElementById('type-color')?.value;
    const icon  = document.getElementById('type-icon')?.value.trim();
    const passiveId = document.getElementById('type-passive')?.value || null;

    if (!id || !name) { _notify('❌ ID et Nom sont obligatoires.', 'error'); return; }

    const state = CWGameState.get();
    const existing = state.types.find(t => t.id === id);
    const newTypes = existing
      ? state.types.map(t => t.id === id ? { ...t, name, color, icon, passiveId } : t)
      : [...state.types, { id, name, color, icon, passiveId }];

    CWGameState.updateTypes(newTypes);
    _notify(`✅ Type "${name}" enregistré.`);
    _clearTypeForm();
    switchTab('types');
  }

  function _editType(typeId) {
    const state = CWGameState.get();
    const t = state.types.find(x => x.id === typeId);
    if (!t) return;
    _setVal('type-id', t.id);
    _setVal('type-name', t.name);
    _setVal('type-color', t.color);
    _setVal('type-icon', t.icon);
    _setVal('type-passive', t.passiveId || '');
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _deleteType(typeId) {
    if (!confirm(`Supprimer le type "${typeId}" ? Cela peut casser des personnages.`)) return;
    const state = CWGameState.get();
    CWGameState.updateTypes(state.types.filter(t => t.id !== typeId));
    _notify('🗑️ Type supprimé.');
    switchTab('types');
  }

  function _clearTypeForm() {
    ['type-id', 'type-name', 'type-icon'].forEach(id => _setVal(id, ''));
    _setVal('type-color', '#FF4500');
    _setVal('type-passive', '');
  }

  // ─── TAGS ───────────────────────────────────────────────────────────────────

  function _saveTag() {
    const id         = document.getElementById('tag-id')?.value.trim();
    const name       = document.getElementById('tag-name')?.value.trim();
    const color      = document.getElementById('tag-color')?.value;
    const categoryId = document.getElementById('tag-category-id')?.value || '';
    if (!id || !name) { _notify('❌ ID et Nom sont obligatoires.', 'error'); return; }
    if (!categoryId)  { _notify('❌ Veuillez choisir une catégorie.', 'error'); return; }
    const state = CWGameState.get();
    if (state.tags.find(t => t.id === id)) {
      CWGameState.updateTag(id, { name, color, categoryId });
      _notify(`✅ Tag "${name}" mis à jour.`);
    } else {
      CWGameState.addTag({ id, name, color, categoryId });
      _notify(`✅ Tag "${name}" créé.`);
    }
    _clearTagForm();
    switchTab('tags');
  }

  function _editTag(tagId) {
    const state = CWGameState.get();
    const t = state.tags.find(x => x.id === tagId);
    if (!t) return;
    switchTab('tags');
    setTimeout(() => {
      _setVal('tag-id', t.id);
      _setVal('tag-name', t.name);
      _setVal('tag-color', t.color || '#4a9eff');
      const sel = document.getElementById('tag-category-id');
      if (sel) sel.value = t.categoryId || '';
      document.getElementById('tag-id')?.focus();
    }, 50);
  }

  function _deleteTag(tagId) {
    if (!confirm(`Supprimer le tag "${tagId}" ? Il sera retiré de tous les personnages qui le portent.`)) return;
    CWGameState.removeTag(tagId);
    _notify('🗑️ Tag supprimé.');
    switchTab('tags');
  }

  function _clearTagForm() {
    ['tag-id', 'tag-name'].forEach(id => _setVal(id, ''));
    _setVal('tag-color', '#4a9eff');
    const sel = document.getElementById('tag-category-id');
    if (sel) sel.value = '';
  }

  // ─── ONGLET ÉQUIPEMENTS ───────────────────────────────────────────────────────

  function _renderEquipmentTab() {
    const state  = CWGameState.get();
    const equips = state.equipment;
    const rarityOptions = RARITIES.map(r => `<option value="${r}">${RARITY_LABELS[r]}</option>`).join('');
    const slotLabel = (e) => EQUIP_SLOT_LABELS[CWGameDatabase.resolveEquipSlot(e)];

    const list = equips.map(e => `
      <div class="admin-list-item" draggable="true" data-drag-id="${e.id}"
           ondragstart="CWAdminPanel._dragStart(event,'equip','${e.id}')"
           ondragover="CWAdminPanel._dragOver(event)"
           ondragleave="CWAdminPanel._dragLeave(event)"
           ondrop="CWAdminPanel._dragDropEquip(event,'${e.id}')"
           ondragend="CWAdminPanel._dragEnd(event)">
        <span class="drag-handle" title="Glisser pour réorganiser">⠿</span>
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">
            ${e.name}
            <span class="badge badge-${e.rarity}">${RARITY_LABELS[e.rarity] || e.rarity}</span>
          </div>
          <div class="admin-list-item-sub">ID: ${e.id} | Slot: ${slotLabel(e)}</div>
          <div class="admin-list-item-sub">
            PV:+${e.bonuses.hp} ATK:+${e.bonuses.atk} DEF:+${e.bonuses.def} VIT:+${e.bonuses.spd}
          </div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editEquip('${e.id}')">✏️</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._duplicateEquip('${e.id}')">📋</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteEquip('${e.id}')">🗑️</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Créer / Modifier un équipement</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>ID</label>
            <input type="text" id="eq-id" placeholder="equip_001" />
          </div>
          <div class="admin-field">
            <label>Nom *</label>
            <input type="text" id="eq-name" placeholder="Anneau de Rubis" />
          </div>
          <div class="admin-field">
            <label>Rareté</label>
            <select id="eq-rarity">${rarityOptions}</select>
          </div>
          <div class="admin-field">
            <label>Slot</label>
            <select id="eq-slot">
              <option value="weapon">⚔️ Arme</option>
              <option value="armor">🛡️ Armure</option>
              <option value="accessory">💍 Accessoire</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Niveau max</label>
            <input type="number" id="eq-maxlevel" value="10" min="1" max="100" />
          </div>
        </div>
        <p style="font-size:.8rem; color:#aaa; margin:12px 0 6px;">Bonus</p>
        <div class="admin-grid">
          <div class="admin-field"><label>+PV</label><input type="number" id="eq-hp" value="0" min="0" /></div>
          <div class="admin-field"><label>+ATK</label><input type="number" id="eq-atk" value="0" min="0" /></div>
          <div class="admin-field"><label>+DEF</label><input type="number" id="eq-def" value="0" min="0" /></div>
          <div class="admin-field"><label>+VIT</label><input type="number" id="eq-spd" value="0" min="0" /></div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEquip()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearEquipForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span>Équipements (${equips.length})</span>
          <select class="sort-select" id="eq-list-sort" onchange="CWAdminPanel._sortEquipList(this.value)">
            <option value="">Trier par...</option>
            <option value="name">Nom (A-Z)</option>
            <option value="rarity">Rareté</option>
            <option value="slot">Type d'équipement</option>
          </select>
        </div>
        <div class="admin-list">${list}</div>
      </div>
    `;
  }

  /** Trie la liste des équipements par nom, rareté ou type de slot (persiste l'ordre) */
  function _sortEquipList(key) {
    if (!key) return;
    const state = CWGameState.get();
    const rarityIndex = (r) => { const idx = RARITIES.indexOf(r); return idx === -1 ? 0 : idx; };
    const slotIndex = (e) => EQUIP_SLOT_ORDER_ADMIN.indexOf(CWGameDatabase.resolveEquipSlot(e));
    const sorted = [...state.equipment];
    if (key === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (key === 'rarity') sorted.sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || a.name.localeCompare(b.name));
    else if (key === 'slot') sorted.sort((a, b) => slotIndex(a) - slotIndex(b) || a.name.localeCompare(b.name));
    CWGameState.reorderEquipDefs(sorted.map(e => e.id));
    switchTab('equipment');
  }

  function _saveEquip() {
    const id   = document.getElementById('eq-id')?.value.trim() || `equip_${Date.now()}`;
    const name = document.getElementById('eq-name')?.value.trim();
    if (!name) { _notify('❌ Nom obligatoire.', 'error'); return; }

    const data = {
      id,
      name,
      rarity:    document.getElementById('eq-rarity')?.value,
      slot:      document.getElementById('eq-slot')?.value,
      level: 1,
      maxLevel: parseInt(document.getElementById('eq-maxlevel')?.value || '10'),
      bonuses: {
        hp:  parseInt(document.getElementById('eq-hp')?.value  || '0'),
        atk: parseInt(document.getElementById('eq-atk')?.value || '0'),
        def: parseInt(document.getElementById('eq-def')?.value || '0'),
        spd: parseInt(document.getElementById('eq-spd')?.value || '0'),
      },
    };

    const state = CWGameState.get();
    if (state.equipment.find(e => e.id === id)) {
      CWGameState.updateEquipDef(id, data);
      _notify(`✅ Équipement "${name}" mis à jour.`);
    } else {
      CWGameState.addEquipDef(data);
      _notify(`✅ Équipement "${name}" créé.`);
    }
    _clearEquipForm();
    switchTab('equipment');
    // _renderTab() differe son rendu de 10ms en interne : on attend qu'il soit posé
    setTimeout(() => _scrollToListItem(id), 20);
  }

  function _editEquip(id) {
    const state = CWGameState.get();
    const e = state.equipment.find(x => x.id === id);
    if (!e) return;
    _setVal('eq-id', e.id);
    _setVal('eq-name', e.name);
    _setVal('eq-rarity', e.rarity);
    _setVal('eq-slot', CWGameDatabase.resolveEquipSlot(e));
    _setVal('eq-maxlevel', e.maxLevel || 10);
    _setVal('eq-hp',  e.bonuses.hp);
    _setVal('eq-atk', e.bonuses.atk);
    _setVal('eq-def', e.bonuses.def);
    _setVal('eq-spd', e.bonuses.spd);
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _deleteEquip(id) {
    if (!confirm(`Supprimer l'équipement "${id}" ?`)) return;
    CWGameState.removeEquipDef(id);
    _notify('🗑️ Équipement supprimé.');
    switchTab('equipment');
  }

  function _clearEquipForm() {
    ['eq-id','eq-name'].forEach(id => _setVal(id, ''));
    _setVal('eq-rarity', 'common');
    _setVal('eq-slot', 'weapon');
    _setVal('eq-maxlevel', '10');
    ['eq-hp','eq-atk','eq-def','eq-spd'].forEach(id => _setVal(id, '0'));
  }

  // ─── ONGLET OBJETS ───────────────────────────────────────────────────────────

  function _renderItemsTab() {
    const state = CWGameState.get();
    const items = state.items;
    const effectTypes = CWGameDatabase.ITEM_EFFECT_TYPES;

    const effectOptions = `<option value="">Aucun effet</option>` +
      Object.entries(effectTypes).map(([key, def]) => `<option value="${key}">${def.label}</option>`).join('');

    const list = items.map(it => {
      const eff = it.effect && effectTypes[it.effect.type];
      const effText = eff ? `${eff.label} ×${it.effect.amount}` : 'Aucun effet';
      return `
      <div class="admin-list-item" data-drag-id="${it.id}">
        <div style="font-size:1.6rem;">${it.icon || '📦'}</div>
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">${it.name}</div>
          <div class="admin-list-item-sub">ID: ${it.id} | Effet: ${effText} | ${it.stackable ? 'Empilable' : 'Non empilable'}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editItem('${it.id}')">✏️</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteItem('${it.id}')">🗑️</button>
        </div>
      </div>
    `;
    }).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Créer / Modifier un objet</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>ID</label>
            <input type="text" id="item-id" placeholder="item_xxx" />
          </div>
          <div class="admin-field">
            <label>Nom *</label>
            <input type="text" id="item-name" placeholder="Élixir de Sagesse" />
          </div>
          <div class="admin-field">
            <label>Icône (emoji)</label>
            <input type="text" id="item-icon" placeholder="✨" maxlength="4" />
          </div>
          <div class="admin-field">
            <label>Empilable</label>
            <select id="item-stackable">
              <option value="1">Oui</option>
              <option value="0">Non</option>
            </select>
          </div>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Description</label>
          <textarea id="item-desc" placeholder="Description de l'objet..."></textarea>
        </div>
        <hr class="admin-sep" />
        <div class="admin-grid">
          <div class="admin-field">
            <label>Effet</label>
            <select id="item-effect-type" onchange="CWAdminPanel._updateItemEffectAmountLabel()">${effectOptions}</select>
          </div>
          <div class="admin-field">
            <label id="item-effect-amount-label">Quantité</label>
            <input type="number" id="item-effect-amount" value="1" min="1" />
          </div>
        </div>
        <p id="item-effect-desc" style="font-size:.74rem;color:#888;margin:4px 0 0;"></p>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveItem()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearItemForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Objets (${items.length})</div>
        <div class="admin-list">${list}</div>
      </div>
    `;
  }

  /** Met à jour le libellé/la description sous le champ "quantité" selon l'effet choisi */
  function _updateItemEffectAmountLabel() {
    const type = document.getElementById('item-effect-type')?.value;
    const def  = type ? CWGameDatabase.ITEM_EFFECT_TYPES[type] : null;
    const labelEl = document.getElementById('item-effect-amount-label');
    const descEl  = document.getElementById('item-effect-desc');
    if (labelEl) labelEl.textContent = def ? def.amountLabel : 'Quantité';
    if (descEl)  descEl.textContent  = def ? def.description : '';
  }

  function _saveItem() {
    const id   = document.getElementById('item-id')?.value.trim() || `item_${Date.now()}`;
    const name = document.getElementById('item-name')?.value.trim();
    if (!name) { _notify('❌ Nom obligatoire.', 'error'); return; }

    const effectType = document.getElementById('item-effect-type')?.value || '';
    const data = {
      id,
      name,
      icon: document.getElementById('item-icon')?.value.trim() || '📦',
      description: document.getElementById('item-desc')?.value.trim() || '',
      stackable: document.getElementById('item-stackable')?.value === '1',
      effect: effectType
        ? { type: effectType, amount: Math.max(1, parseInt(document.getElementById('item-effect-amount')?.value || '1')) }
        : null,
    };

    const state = CWGameState.get();
    if (state.items.find(i => i.id === id)) {
      CWGameState.updateItemDef(id, data);
      _notify(`✅ Objet "${name}" mis à jour.`);
    } else {
      CWGameState.addItemDef(data);
      _notify(`✅ Objet "${name}" créé.`);
    }
    _clearItemForm();
    switchTab('items');
    setTimeout(() => _scrollToListItem(id), 20);
  }

  function _editItem(id) {
    const state = CWGameState.get();
    const it = state.items.find(x => x.id === id);
    if (!it) return;
    _setVal('item-id', it.id);
    _setVal('item-name', it.name);
    _setVal('item-icon', it.icon || '');
    _setVal('item-desc', it.description || '');
    _setVal('item-stackable', it.stackable ? '1' : '0');
    _setVal('item-effect-type', it.effect?.type || '');
    _setVal('item-effect-amount', it.effect?.amount || 1);
    _updateItemEffectAmountLabel();
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _deleteItem(id) {
    if (!confirm(`Supprimer l'objet "${id}" ? Les exemplaires déjà possédés par le joueur resteront dans son inventaire mais deviendront inutilisables.`)) return;
    CWGameState.removeItemDef(id);
    _notify('🗑️ Objet supprimé.');
    switchTab('items');
  }

  function _clearItemForm() {
    ['item-id','item-name','item-icon','item-desc'].forEach(id => _setVal(id, ''));
    _setVal('item-stackable', '1');
    _setVal('item-effect-type', '');
    _setVal('item-effect-amount', '1');
    _updateItemEffectAmountLabel();
  }

  // ─── ONGLET BOUTIQUE ─────────────────────────────────────────────────────────

  const SHOP_KIND_LABELS = { character: '🧝 Créature', equipment: '⚔️ Équipement', item: '🎒 Objet' };

  /** Construit les <option> de référence (créature/équipement/objet) pour le type donné */
  function _buildShopRefOptions(kind, selectedId) {
    const state = CWGameState.get();
    let entries = [];
    if (kind === 'character') entries = state.characters.map(c => ({ id: c.id, label: `${c.name} (${c.id})` }));
    else if (kind === 'equipment') entries = state.equipment.map(e => ({ id: e.id, label: `${e.name} (${e.id})` }));
    else if (kind === 'item') entries = state.items.map(i => ({ id: i.id, label: `${i.name} (${i.id})` }));
    if (entries.length === 0) return `<option value="">Aucune entrée disponible</option>`;
    return entries.map(e => `<option value="${e.id}" ${e.id === selectedId ? 'selected' : ''}>${e.label}</option>`).join('');
  }

  /** Rafraîchit le menu "Référence" lorsque le type d'article change */
  function _updateShopRefOptions() {
    const kind = document.getElementById('shop-kind')?.value || 'character';
    const sel  = document.getElementById('shop-ref');
    if (sel) sel.innerHTML = _buildShopRefOptions(kind, null);
  }

  function _renderShopTab() {
    const state    = CWGameState.get();
    let listings   = [...state.shopListings];

    // Tri actuel
    const sortKey = _shopSortKey || 'none';

    const resolveRefName = (listing) => {
      if (listing.kind === 'character') return state.characters.find(c => c.id === listing.refId)?.name || listing.refId;
      if (listing.kind === 'equipment') return state.equipment.find(e => e.id === listing.refId)?.name || listing.refId;
      if (listing.kind === 'item')      return state.items.find(i => i.id === listing.refId)?.name || listing.refId;
      return listing.refId;
    };

    const resolveRarity = (listing) => {
      if (listing.kind === 'character') return state.characters.find(c => c.id === listing.refId)?.rarity || '';
      if (listing.kind === 'equipment') return state.equipment.find(e => e.id === listing.refId)?.rarity || '';
      return '';
    };

    // Appliquer le tri
    if (sortKey === 'alpha') {
      listings.sort((a, b) => resolveRefName(a).localeCompare(resolveRefName(b)));
    } else if (sortKey === 'type') {
      const kindOrder = { character: 0, equipment: 1, item: 2 };
      listings.sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || resolveRefName(a).localeCompare(resolveRefName(b)));
    } else if (sortKey === 'rarity') {
      const rarityOrder = { common:0, uncommon:1, rare:2, epic:3, legendary:4, mythic:5 };
      listings.sort((a, b) => (rarityOrder[resolveRarity(b)] ?? -1) - (rarityOrder[resolveRarity(a)] ?? -1));
    }

    const list = listings.map(l => `
      <div class="admin-list-item" data-drag-id="${l.id}">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">
            ${SHOP_KIND_LABELS[l.kind] || l.kind} — ${resolveRefName(l)}
            ${l.enabled === false ? '<span class="badge" style="background:#555;color:#ccc;">Désactivé</span>' : ''}
          </div>
          <div class="admin-list-item-sub">Prix : ${l.price} ${l.currency === 'crystals' ? '💎' : '💵'} | ID article : ${l.id}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editShopListing('${l.id}')">✏️</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._toggleShopListing('${l.id}')">${l.enabled === false ? '✅' : '🚫'}</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteShopListing('${l.id}')">🗑️</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Ajouter / Modifier un article</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Type d'article</label>
            <select id="shop-kind" onchange="CWAdminPanel._updateShopRefOptions()">
              <option value="character">🧝 Créature</option>
              <option value="equipment">⚔️ Équipement</option>
              <option value="item">🎒 Objet</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Référence</label>
            <select id="shop-ref">${_buildShopRefOptions('character', null)}</select>
          </div>
          <div class="admin-field">
            <label>Prix</label>
            <input type="number" id="shop-price" value="100" min="0" />
          </div>
          <div class="admin-field">
            <label>Devise</label>
            <select id="shop-currency">
              <option value="gold">💵 Dollars</option>
              <option value="crystals">💎 Diamants</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Disponible</label>
            <select id="shop-enabled">
              <option value="1">Oui</option>
              <option value="0">Non</option>
            </select>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveShopListing()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearShopForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
          <div class="admin-section-title" style="margin:0">Articles en vente (${listings.length})</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <!-- Tri -->
            <select onchange="CWAdminPanel._setShopSort(this.value)" style="font-size:.8rem;padding:4px 8px">
              <option value="none"   ${sortKey==='none'   ?'selected':''}>Ordre original</option>
              <option value="type"   ${sortKey==='type'   ?'selected':''}>Par type</option>
              <option value="alpha"  ${sortKey==='alpha'  ?'selected':''}>Alphabétique</option>
              <option value="rarity" ${sortKey==='rarity' ?'selected':''}>Par rareté</option>
            </select>
            <!-- Remplissage automatique -->
            <button class="admin-btn admin-btn-danger" onclick="CWAdminPanel._autoPopulateShop()"
              title="Efface créatures + équipements et les recrée avec les prix par défaut">
              🔄 Remplissage auto
            </button>
          </div>
        </div>
        <div class="admin-list">${list || '<p style="color:#888;font-size:.85rem;">Aucun article pour le moment.</p>'}</div>
      </div>
    `;
  }

  let _shopSortKey = 'none';

  function _setShopSort(key) {
    _shopSortKey = key;
    switchTab('shop');
  }

  function _autoPopulateShop() {
    if (!confirm('Cette action va effacer toutes les créatures et tous les équipements du shop, puis les recréer avec les prix définis. Les objets spéciaux (items) seront conservés. Continuer ?')) return;

    const state = CWGameState.get();

    // Prix par rareté
    const charPrices = { common:80, uncommon:200, rare:500, epic:1500, legendary:4000, mythic:10000 };
    const equipPrices = { common:150, uncommon:400, rare:1000, epic:3000, legendary:8000, mythic:20000 };

    // 1 — Supprimer tous les listings créature et équipement existants
    const toDelete = state.shopListings
      .filter(l => l.kind === 'character' || l.kind === 'equipment')
      .map(l => l.id);
    toDelete.forEach(id => CWGameState.removeShopListing(id));

    // 2 — Ajouter toutes les formes de base des créatures
    const baseChars = state.characters.filter(c => (c.evolutionStage ?? 0) === 0);
    baseChars.forEach(c => {
      const price = charPrices[c.rarity] ?? 100;
      CWGameState.addShopListing({
        id:       `shop_char_${c.id}`,
        kind:     'character',
        refId:    c.id,
        price,
        currency: 'crystals',
        enabled:  true,
      });
    });

    // 3 — Ajouter tous les équipements
    state.equipment.forEach(e => {
      const price = equipPrices[e.rarity] ?? 150;
      CWGameState.addShopListing({
        id:       `shop_equip_${e.id}`,
        kind:     'equipment',
        refId:    e.id,
        price,
        currency: 'gold',
        enabled:  true,
      });
    });

    _notify(`✅ Shop mis à jour : ${baseChars.length} créatures + ${state.equipment.length} équipements.`);
    switchTab('shop');
  }

  let _shopEditingId = null;

  function _saveShopListing() {
    const kind  = document.getElementById('shop-kind')?.value;
    const refId = document.getElementById('shop-ref')?.value;
    if (!refId) { _notify('❌ Sélectionnez une référence valide.', 'error'); return; }

    const data = {
      id: _shopEditingId || `shop_${Date.now()}`,
      kind,
      refId,
      price: Math.max(0, parseInt(document.getElementById('shop-price')?.value || '0')),
      currency: document.getElementById('shop-currency')?.value === 'crystals' ? 'crystals' : 'gold',
      enabled: document.getElementById('shop-enabled')?.value === '1',
    };

    const state = CWGameState.get();
    if (_shopEditingId && state.shopListings.find(l => l.id === _shopEditingId)) {
      CWGameState.updateShopListing(_shopEditingId, data);
      _notify('✅ Article mis à jour.');
    } else {
      CWGameState.addShopListing(data);
      _notify('✅ Article ajouté à la boutique.');
    }
    _clearShopForm();
    switchTab('shop');
  }

  function _editShopListing(id) {
    const state = CWGameState.get();
    const l = state.shopListings.find(x => x.id === id);
    if (!l) return;
    _shopEditingId = id;
    _setVal('shop-kind', l.kind);
    document.getElementById('shop-ref').innerHTML = _buildShopRefOptions(l.kind, l.refId);
    _setVal('shop-price', l.price);
    _setVal('shop-currency', l.currency);
    _setVal('shop-enabled', l.enabled === false ? '0' : '1');
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _toggleShopListing(id) {
    const state = CWGameState.get();
    const l = state.shopListings.find(x => x.id === id);
    if (!l) return;
    CWGameState.updateShopListing(id, { enabled: l.enabled === false });
    switchTab('shop');
  }

  function _deleteShopListing(id) {
    if (!confirm('Retirer cet article de la boutique ?')) return;
    CWGameState.removeShopListing(id);
    _notify('🗑️ Article retiré de la boutique.');
    switchTab('shop');
  }

  function _clearShopForm() {
    _shopEditingId = null;
    _setVal('shop-kind', 'character');
    document.getElementById('shop-ref').innerHTML = _buildShopRefOptions('character', null);
    _setVal('shop-price', '100');
    _setVal('shop-currency', 'gold');
    _setVal('shop-enabled', '1');
  }

  // ─── ONGLET QUOTIDIEN (connexion + quêtes) ──────────────────────────────────────

  /** Construit les 3 champs d'un éditeur de récompense générique (type/quantité/référence) */
  function _buildRewardEditorHtml(prefix, reward) {
    reward = reward || { type: 'gold', amount: 100 };
    const refVisible = ['item', 'equipment', 'character'].includes(reward.type);
    return `
      <div class="reward-editor" data-prefix="${prefix}">
        <select class="reward-type-select" id="${prefix}-type" onchange="CWAdminPanel._updateRewardRefVisibility('${prefix}')">
          <option value="gold"      ${reward.type === 'gold'      ? 'selected' : ''}>💵 Or</option>
          <option value="crystals"  ${reward.type === 'crystals'  ? 'selected' : ''}>💎 Diamants</option>
          <option value="item"      ${reward.type === 'item'      ? 'selected' : ''}>🎒 Objet</option>
          <option value="equipment" ${reward.type === 'equipment' ? 'selected' : ''}>⚔️ Équipement</option>
          <option value="character" ${reward.type === 'character' ? 'selected' : ''}>🧝 Créature</option>
        </select>
        <input type="number" class="reward-amount-input" id="${prefix}-amount" value="${reward.amount || 1}" min="1">
        <select class="reward-ref-select" id="${prefix}-ref" style="${refVisible ? '' : 'display:none'}">
          ${refVisible ? _buildShopRefOptions(reward.type, reward.refId) : ''}
        </select>
      </div>
    `;
  }

  /** Affiche/masque le menu de référence selon le type de récompense choisi */
  function _updateRewardRefVisibility(prefix) {
    const typeSel = document.getElementById(`${prefix}-type`);
    const refSel  = document.getElementById(`${prefix}-ref`);
    if (!typeSel || !refSel) return;
    const type = typeSel.value;
    const visible = ['item', 'equipment', 'character'].includes(type);
    refSel.style.display = visible ? '' : 'none';
    if (visible) refSel.innerHTML = _buildShopRefOptions(type, null);
  }

  /** Lit une récompense saisie dans un éditeur générique */
  function _readRewardFromEditor(prefix) {
    const type = document.getElementById(`${prefix}-type`)?.value || 'gold';
    const amount = Math.max(1, parseInt(document.getElementById(`${prefix}-amount`)?.value || '1'));
    const reward = { type, amount };
    if (['item', 'equipment', 'character'].includes(type)) {
      reward.refId = document.getElementById(`${prefix}-ref`)?.value || null;
    }
    return reward;
  }

  /** Résume une récompense en texte court pour l'affichage en liste */
  function _summarizeReward(reward, state) {
    if (!reward) return '?';
    if (reward.type === 'gold') return `💵 ${reward.amount}`;
    if (reward.type === 'crystals') return `💎 ${reward.amount}`;
    if (reward.type === 'item') return `🎒 ${state.items.find(i => i.id === reward.refId)?.name || reward.refId} ×${reward.amount}`;
    if (reward.type === 'equipment') return `⚔️ ${state.equipment.find(e => e.id === reward.refId)?.name || reward.refId} ×${reward.amount}`;
    if (reward.type === 'character') return `🧝 ${state.characters.find(c => c.id === reward.refId)?.name || reward.refId} ×${reward.amount}`;
    return '?';
  }

  function _renderDailyTab() {
    const state  = CWGameState.get();
    const cycles = state.dailyLoginCycles;
    const quests = state.dailyQuests;
    const wQuests = state.weeklyQuests || [];
    const QUEST_TYPES = CWGameDatabase.QUEST_TYPES;

    // Onglets internes
    const subTab = _dailySubTab || 'daily';

    const subTabHtml = `
      <div style="display:flex;gap:6px;margin-bottom:16px">
        <button class="admin-btn ${subTab==='daily'?'admin-btn-primary':'admin-btn-secondary'}" onclick="CWAdminPanel._setDailySubTab('daily')">📅 Quotidien</button>
        <button class="admin-btn ${subTab==='weekly'?'admin-btn-primary':'admin-btn-secondary'}" onclick="CWAdminPanel._setDailySubTab('weekly')">📆 Hebdomadaire</button>
      </div>`;

    if (subTab === 'weekly') {
      return subTabHtml + _renderWeeklyQuestSection(wQuests, QUEST_TYPES);
    }

    // ── Section Quotidien ──
    const cycleList = cycles.map(c => `
      <div class="admin-list-item">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">
            ${c.name}
            ${c.enabled === false ? '<span class="badge" style="background:#555;color:#ccc;">Désactivé</span>' : ''}
          </div>
          <div class="admin-list-item-sub">${c.length} jours, ${c.loop !== false ? 'boucle' : 'une fois'} — ID: ${c.id}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editCycle('${c.id}')">✏️</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._toggleCycle('${c.id}')">${c.enabled === false ? '✅' : '🚫'}</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._deleteCycle('${c.id}')">🗑️</button>
        </div>
      </div>`).join('');

    const questList = quests.map(q => `
      <div class="admin-list-item">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">${q.name} ${q.enabled === false ? '<span class="badge" style="background:#555;color:#ccc;">Désactivée</span>' : ''}</div>
          <div class="admin-list-item-sub">${QUEST_TYPES[q.type]?.label || q.type} — Objectif : ${q.target} — ${_summarizeReward(q.reward, state)}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editQuest('${q.id}')">✏️</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._toggleQuest('${q.id}')">${q.enabled === false ? '✅' : '🚫'}</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._deleteQuest('${q.id}')">🗑️</button>
        </div>
      </div>`).join('');

    return `
      ${subTabHtml}
      <div class="admin-section">
        <div class="admin-section-title">🎁 Cycle de connexion quotidienne</div>
        <div class="admin-grid">
          <div class="admin-field"><label>ID</label><input type="text" id="cycle-id" placeholder="cycle_xxx" /></div>
          <div class="admin-field"><label>Nom</label><input type="text" id="cycle-name" placeholder="Connexion 7 jours" /></div>
          <div class="admin-field"><label>Nombre de jours</label><input type="number" id="cycle-length" value="7" min="1" max="31" onchange="CWAdminPanel._rebuildCycleDayRows()" /></div>
          <div class="admin-field"><label>Boucle après le dernier jour</label>
            <select id="cycle-loop"><option value="1">Oui</option><option value="0">Non</option></select>
          </div>
          <div class="admin-field"><label>Actif</label>
            <select id="cycle-enabled"><option value="1">Oui</option><option value="0">Non</option></select>
          </div>
        </div>
        <div id="cycle-day-rows" style="margin-top:10px;"></div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveCycle()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearCycleForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Cycles existants (${cycles.length})</div>
        <div class="admin-list">${cycleList || '<p style="color:#888;font-size:.85rem;">Aucun cycle.</p>'}</div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">📜 Quête quotidienne</div>
        <div class="admin-grid">
          <div class="admin-field"><label>Mécanique trackée</label>
            <select id="quest-type">
              ${Object.entries(QUEST_TYPES).map(([key, def]) => `<option value="${key}">${def.label}</option>`).join('')}
            </select>
          </div>
          <div class="admin-field"><label>Nom affiché</label><input type="text" id="quest-name" placeholder="Capturer 5 créatures" /></div>
          <div class="admin-field"><label>Objectif</label><input type="number" id="quest-target" value="1" min="1" /></div>
          <div class="admin-field"><label>Activée</label>
            <select id="quest-enabled"><option value="1">Oui</option><option value="0">Non</option></select>
          </div>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Récompense</label>
          <div id="quest-reward-editor">${_buildRewardEditorHtml('quest-reward', null)}</div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveQuest()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearQuestForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Quêtes quotidiennes (${quests.length})</div>
        <div class="admin-list">${questList || '<p style="color:#888;font-size:.85rem;">Aucune quête.</p>'}</div>
      </div>`;
  }

  let _dailySubTab = 'daily';
  function _setDailySubTab(tab) { _dailySubTab = tab; switchTab('daily'); }

  function _renderWeeklyQuestSection(wQuests, QUEST_TYPES) {
    const state = CWGameState.get();
    const questList = wQuests.map(q => `
      <div class="admin-list-item">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">${q.name} ${q.enabled === false ? '<span class="badge" style="background:#555;color:#ccc;">Désactivée</span>' : ''}</div>
          <div class="admin-list-item-sub">${QUEST_TYPES[q.type]?.label || q.type} — Objectif : ${q.target} — ${_summarizeReward(q.reward, state)}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editWeeklyQuest('${q.id}')">✏️</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._toggleWeeklyQuest('${q.id}')">${q.enabled === false ? '✅' : '🚫'}</button>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._deleteWeeklyQuest('${q.id}')">🗑️</button>
        </div>
      </div>`).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">📆 Quête hebdomadaire</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Chaque lundi à minuit, 5 quêtes sont tirées au sort parmi celles-ci.
        </p>
        <div class="admin-grid">
          <div class="admin-field"><label>Mécanique trackée</label>
            <select id="wquest-type">
              ${Object.entries(QUEST_TYPES).map(([key, def]) => `<option value="${key}">${def.label}</option>`).join('')}
            </select>
          </div>
          <div class="admin-field"><label>Nom affiché</label><input type="text" id="wquest-name" placeholder="Remporter 25 duels" /></div>
          <div class="admin-field"><label>Objectif</label><input type="number" id="wquest-target" value="5" min="1" /></div>
          <div class="admin-field"><label>Activée</label>
            <select id="wquest-enabled"><option value="1">Oui</option><option value="0">Non</option></select>
          </div>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Récompense</label>
          <div id="wquest-reward-editor">${_buildRewardEditorHtml('wquest-reward', null)}</div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveWeeklyQuest()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearWeeklyQuestForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Quêtes hebdomadaires (${wQuests.length})</div>
        <div class="admin-list">${questList || '<p style="color:#888;font-size:.85rem;">Aucune quête hebdomadaire.</p>'}</div>
      </div>`;
  }

  // ── Cycles de connexion quotidienne ──

  let _cycleEditingId = null;
  let _cycleDayRewards = {}; // mémoire tampon { day: reward } pendant l'édition (survit au redimensionnement)

  function _captureCycleDayRowsIntoCache() {
    document.querySelectorAll('#cycle-day-rows .cycle-day-row').forEach(row => {
      const day = parseInt(row.dataset.day);
      const prefix1 = `cycle-day-${day}-r1`;
      const prefix2 = `cycle-day-${day}-r2`;
      const zone2 = document.getElementById(`cycle-day-${day}-r2-zone`);
      if (document.getElementById(`${prefix1}-type`)) {
        const r1 = _readRewardFromEditor(prefix1);
        const has2 = zone2 && zone2.style.display !== 'none' && document.getElementById(`${prefix2}-type`);
        const r2 = has2 ? _readRewardFromEditor(prefix2) : null;
        _cycleDayRewards[day] = r2 ? [r1, r2] : [r1];
      }
    });
  }

  /** Reconstruit les rangées "Jour N" selon le nombre de jours saisi, en préservant ce qui était déjà rempli */
  function _rebuildCycleDayRows() {
    _captureCycleDayRowsIntoCache();
    const length = Math.max(1, Math.min(31, parseInt(document.getElementById('cycle-length')?.value || '7')));
    const container = document.getElementById('cycle-day-rows');
    if (!container) return;

    let html = '';
    for (let day = 1; day <= length; day++) {
      const rewards = _cycleDayRewards[day];
      // Supporte ancien format (objet simple) et nouveau (tableau)
      const r1 = Array.isArray(rewards) ? (rewards[0] || { type: 'gold', amount: 100 * day }) : (rewards || { type: 'gold', amount: 100 * day });
      const r2 = Array.isArray(rewards) ? (rewards[1] || null) : null;
      const has2 = !!r2;
      html += `
        <div class="cycle-day-row" data-day="${day}" style="margin-bottom:8px;padding:8px;background:#1a1630;border-radius:6px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="cycle-day-label" style="min-width:50px;font-weight:700">Jour ${day}</span>
            ${_buildRewardEditorHtml(`cycle-day-${day}-r1`, r1)}
            <button class="admin-btn admin-btn-secondary admin-btn-sm" title="Ajouter une 2e récompense"
              onclick="CWAdminPanel._toggleSecondReward(${day}, ${has2})" id="cycle-day-${day}-toggle2">
              ${has2 ? '➖ 2e récompense' : '➕ 2e récompense'}
            </button>
          </div>
          <div id="cycle-day-${day}-r2-zone" style="${has2 ? '' : 'display:none'}; margin-top:6px; margin-left:58px">
            ${_buildRewardEditorHtml(`cycle-day-${day}-r2`, r2 || { type: 'crystals', amount: 10 })}
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  function _toggleSecondReward(day, currentlyVisible) {
    _captureCycleDayRowsIntoCache();
    const zone = document.getElementById(`cycle-day-${day}-r2-zone`);
    const btn  = document.getElementById(`cycle-day-${day}-toggle2`);
    if (currentlyVisible) {
      zone.style.display = 'none';
      if (btn) btn.textContent = '➕ 2e récompense';
      // Supprimer la 2e récompense du cache
      if (Array.isArray(_cycleDayRewards[day])) _cycleDayRewards[day] = [_cycleDayRewards[day][0]];
    } else {
      zone.style.display = 'block';
      if (btn) btn.textContent = '➖ 2e récompense';
    }
  }

  function _saveCycle() {
    const id = document.getElementById('cycle-id')?.value.trim() || `cycle_${Date.now()}`;
    const name = document.getElementById('cycle-name')?.value.trim();
    if (!name) { _notify('❌ Le nom est obligatoire.', 'error'); return; }

    const length  = Math.max(1, Math.min(31, parseInt(document.getElementById('cycle-length')?.value || '7')));
    const loop    = document.getElementById('cycle-loop')?.value === '1';
    const enabled = document.getElementById('cycle-enabled')?.value === '1';

    _captureCycleDayRowsIntoCache();
    const rewards = [];
    for (let day = 1; day <= length; day++) {
      const dayRewards = _cycleDayRewards[day];
      if (dayRewards) {
        // Normaliser en tableau (compat ancien format)
        const arr = Array.isArray(dayRewards) ? dayRewards : [dayRewards];
        rewards.push({ day, reward: arr[0], reward2: arr[1] || null });
      }
    }

    const data = { id, name, length, loop, enabled, rewards };
    const state = CWGameState.get();
    if (state.dailyLoginCycles.find(c => c.id === id)) {
      CWGameState.updateDailyLoginCycle(id, data);
      _notify(`✅ Cycle "${name}" mis à jour.`);
    } else {
      CWGameState.addDailyLoginCycle(data);
      _notify(`✅ Cycle "${name}" créé.`);
    }
    _clearCycleForm();
    switchTab('daily');
  }

  function _editCycle(id) {
    const state = CWGameState.get();
    const c = state.dailyLoginCycles.find(x => x.id === id);
    if (!c) return;
    _cycleEditingId = id;
    _setVal('cycle-id', c.id);
    _setVal('cycle-name', c.name);
    _setVal('cycle-length', c.length);
    _setVal('cycle-loop', c.loop !== false ? '1' : '0');
    _setVal('cycle-enabled', c.enabled !== false ? '1' : '0');
    _cycleDayRewards = {};
    (c.rewards || []).forEach(r => {
      // Supporte ancien format (reward seul) et nouveau (reward + reward2)
      _cycleDayRewards[r.day] = r.reward2 ? [r.reward, r.reward2] : [r.reward];
    });
    _rebuildCycleDayRows();
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _toggleCycle(id) {
    const state = CWGameState.get();
    const c = state.dailyLoginCycles.find(x => x.id === id);
    if (!c) return;
    CWGameState.updateDailyLoginCycle(id, { enabled: c.enabled === false });
    switchTab('daily');
  }

  function _deleteCycle(id) {
    if (!confirm('Supprimer ce cycle de connexion quotidienne ?')) return;
    CWGameState.removeDailyLoginCycle(id);
    _notify('🗑️ Cycle supprimé.');
    switchTab('daily');
  }

  function _clearCycleForm() {
    _cycleEditingId = null;
    _cycleDayRewards = {};
    ['cycle-id', 'cycle-name'].forEach(id => _setVal(id, ''));
    _setVal('cycle-length', '7');
    _setVal('cycle-loop', '1');
    _setVal('cycle-enabled', '1');
    _rebuildCycleDayRows();
  }

  // ── Quêtes hebdomadaires ──

  let _weeklyQuestEditingId = null;

  function _saveWeeklyQuest() {
    const type    = document.getElementById('wquest-type')?.value;
    const name    = document.getElementById('wquest-name')?.value.trim();
    if (!name) { _notify('❌ Le nom est obligatoire.', 'error'); return; }
    const target  = Math.max(1, parseInt(document.getElementById('wquest-target')?.value || '1'));
    const enabled = document.getElementById('wquest-enabled')?.value === '1';
    const reward  = _readRewardFromEditor('wquest-reward');
    const id      = _weeklyQuestEditingId || `wq_${Date.now()}`;
    const data    = { id, type, name, target, enabled, reward };
    const state   = CWGameState.get();
    if (_weeklyQuestEditingId && (state.weeklyQuests || []).find(q => q.id === _weeklyQuestEditingId)) {
      CWGameState.updateWeeklyQuest(_weeklyQuestEditingId, data);
      _notify(`✅ Quête hebdo "${name}" mise à jour.`);
    } else {
      CWGameState.addWeeklyQuest(data);
      _notify(`✅ Quête hebdo "${name}" créée.`);
    }
    _weeklyQuestEditingId = null;
    switchTab('daily');
  }

  function _editWeeklyQuest(id) {
    const q = (CWGameState.get().weeklyQuests || []).find(x => x.id === id);
    if (!q) return;
    _weeklyQuestEditingId = id;
    _dailySubTab = 'weekly';
    switchTab('daily');
    setTimeout(() => {
      _setVal('wquest-type', q.type);
      _setVal('wquest-name', q.name);
      _setVal('wquest-target', q.target);
      _setVal('wquest-enabled', q.enabled !== false ? '1' : '0');
      const ed = document.getElementById('wquest-reward-editor');
      if (ed) ed.innerHTML = _buildRewardEditorHtml('wquest-reward', q.reward);
    }, 50);
  }

  function _toggleWeeklyQuest(id) {
    const q = (CWGameState.get().weeklyQuests || []).find(x => x.id === id);
    if (!q) return;
    CWGameState.updateWeeklyQuest(id, { enabled: q.enabled === false });
    switchTab('daily');
  }

  function _deleteWeeklyQuest(id) {
    if (!confirm('Supprimer cette quête hebdomadaire ?')) return;
    CWGameState.removeWeeklyQuest(id);
    _notify('🗑️ Quête hebdo supprimée.');
    switchTab('daily');
  }

  function _clearWeeklyQuestForm() {
    _weeklyQuestEditingId = null;
    ['wquest-name'].forEach(i => _setVal(i, ''));
    _setVal('wquest-target', '5');
    _setVal('wquest-enabled', '1');
    const ed = document.getElementById('wquest-reward-editor');
    if (ed) ed.innerHTML = _buildRewardEditorHtml('wquest-reward', null);
  }

  function _saveQuest() {
    const type = document.getElementById('quest-type')?.value;
    const name = document.getElementById('quest-name')?.value.trim();
    if (!name) { _notify('❌ Le nom est obligatoire.', 'error'); return; }
    const target  = Math.max(1, parseInt(document.getElementById('quest-target')?.value || '1'));
    const enabled = document.getElementById('quest-enabled')?.value === '1';
    const reward  = _readRewardFromEditor('quest-reward');

    const id = _questEditingId || `quest_${Date.now()}`;
    const data = { id, type, name, target, enabled, reward };

    const state = CWGameState.get();
    if (_questEditingId && state.dailyQuests.find(q => q.id === _questEditingId)) {
      CWGameState.updateDailyQuest(_questEditingId, data);
      _notify(`✅ Quête "${name}" mise à jour.`);
    } else {
      CWGameState.addDailyQuest(data);
      _notify(`✅ Quête "${name}" créée.`);
    }
    _clearQuestForm();
    switchTab('daily');
  }

  function _editQuest(id) {
    const state = CWGameState.get();
    const q = state.dailyQuests.find(x => x.id === id);
    if (!q) return;
    _questEditingId = id;
    _setVal('quest-type', q.type);
    _setVal('quest-name', q.name);
    _setVal('quest-target', q.target);
    _setVal('quest-enabled', q.enabled !== false ? '1' : '0');
    document.getElementById('quest-reward-editor').innerHTML = _buildRewardEditorHtml('quest-reward', q.reward);
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _toggleQuest(id) {
    const state = CWGameState.get();
    const q = state.dailyQuests.find(x => x.id === id);
    if (!q) return;
    CWGameState.updateDailyQuest(id, { enabled: q.enabled === false });
    switchTab('daily');
  }

  function _deleteQuest(id) {
    if (!confirm('Supprimer cette quête ?')) return;
    CWGameState.removeDailyQuest(id);
    _notify('🗑️ Quête supprimée.');
    switchTab('daily');
  }

  function _clearQuestForm() {
    _questEditingId = null;
    _setVal('quest-type', 'capture_character');
    _setVal('quest-name', '');
    _setVal('quest-target', '1');
    _setVal('quest-enabled', '1');
    document.getElementById('quest-reward-editor').innerHTML = _buildRewardEditorHtml('quest-reward', null);
  }

  // ─── ONGLET ATTAQUES (passifs ; futures attaques actives) ───────────────────────

  const PASSIVE_PARAM_LABELS = {
    percent: 'Pourcentage (%)',
    chance: 'Chance de déclenchement (%)',
    damagePercentMaxHp: 'Dégâts (% des PV Max)',
    healPercentMaxHp: 'Soin (% des PV Max)',
    duration: 'Durée (tours)',
  };

  /** Construit les champs de paramètres propres à un effet de passif donné */
  function _buildPassiveParamsHtml(effectType, params) {
    const effectDef = CWGameDatabase.PASSIVE_EFFECT_TYPES[effectType];
    if (!effectDef || effectDef.params.length === 0) {
      return '<p style="font-size:.74rem;color:#888;margin:4px 0 0;">Aucun paramètre pour cet effet.</p>';
    }
    return `<div class="admin-grid">` + effectDef.params.map(key => `
      <div class="admin-field">
        <label>${PASSIVE_PARAM_LABELS[key] || key}</label>
        <input type="number" class="passive-param-input" data-param-key="${key}" id="passive-param-${key}" value="${params?.[key] ?? 0}" min="0" step="1">
      </div>
    `).join('') + `</div>`;
  }

  /** Reconstruit les champs de paramètres quand le type d'effet change */
  function _updatePassiveParamsFields() {
    const effectType = document.getElementById('passive-effect-type')?.value;
    const container = document.getElementById('passive-params-container');
    if (container) container.innerHTML = _buildPassiveParamsHtml(effectType, {});
  }

  function _readPassiveParams() {
    const params = {};
    document.querySelectorAll('.passive-param-input').forEach(input => {
      params[input.dataset.paramKey] = parseFloat(input.value) || 0;
    });
    return params;
  }

  function _renderAttacksTab() {
    const state    = CWGameState.get();
    const passives = state.passives;
    const EFFECT_TYPES = CWGameDatabase.PASSIVE_EFFECT_TYPES;

    const usedByMap = {}; // passiveId -> [type names]
    state.types.forEach(t => {
      if (!t.passiveId) return;
      (usedByMap[t.passiveId] = usedByMap[t.passiveId] || []).push(`${t.icon} ${t.name}`);
    });

    const list = passives.map(p => `
      <div class="admin-list-item">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">${p.name}</div>
          <div class="admin-list-item-sub">
            ${EFFECT_TYPES[p.effectType]?.label || p.effectType}
            ${usedByMap[p.id] ? ` — Lié à : ${usedByMap[p.id].join(', ')}` : ' — Non assigné à un type'}
          </div>
          <div class="admin-list-item-sub" style="margin-top:2px;">${p.description}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editPassive('${p.id}')">✏️</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deletePassive('${p.id}')">🗑️</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">⚔️ Passifs</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Chaque passif se rattache à un <strong>type</strong> (onglet Types) : tout
          personnage de ce type l'hérite automatiquement en combat. Un personnage à
          2 types cumule les 2 passifs. Les attaques actives viendront s'ajouter à
          cet onglet plus tard.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Nom</label>
            <input type="text" id="passive-name" placeholder="Adorable" />
          </div>
          <div class="admin-field">
            <label>Mécanisme</label>
            <select id="passive-effect-type" onchange="CWAdminPanel._updatePassiveParamsFields()">
              ${Object.entries(EFFECT_TYPES).map(([key, def]) => `<option value="${key}">${def.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Description (affichée au joueur)</label>
          <textarea id="passive-description" placeholder="Augmente l'esquive de 7%."></textarea>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Paramètres</label>
          <div id="passive-params-container">${_buildPassiveParamsHtml(Object.keys(EFFECT_TYPES)[0], {})}</div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._savePassive()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearPassiveForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Passifs existants (${passives.length})</div>
        <div class="admin-list">${list}</div>
      </div>
    `;
  }

  let _passiveEditingId = null;

  function _savePassive() {
    const name = document.getElementById('passive-name')?.value.trim();
    if (!name) { _notify('❌ Le nom est obligatoire.', 'error'); return; }
    const effectType  = document.getElementById('passive-effect-type')?.value;
    const description = document.getElementById('passive-description')?.value.trim() || '';
    const params = _readPassiveParams();

    const id = _passiveEditingId || `passive_${Date.now()}`;
    const data = { id, name, description, effectType, params };

    const state = CWGameState.get();
    if (_passiveEditingId && state.passives.find(p => p.id === _passiveEditingId)) {
      CWGameState.updatePassive(_passiveEditingId, data);
      _notify(`✅ Passif "${name}" mis à jour.`);
    } else {
      CWGameState.addPassive(data);
      _notify(`✅ Passif "${name}" créé.`);
    }
    _clearPassiveForm();
    switchTab('attacks');
  }

  function _editPassive(id) {
    const state = CWGameState.get();
    const p = state.passives.find(x => x.id === id);
    if (!p) return;
    _passiveEditingId = id;
    _setVal('passive-name', p.name);
    _setVal('passive-description', p.description);
    _setVal('passive-effect-type', p.effectType);
    document.getElementById('passive-params-container').innerHTML = _buildPassiveParamsHtml(p.effectType, p.params);
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _deletePassive(id) {
    if (!confirm('Supprimer ce passif ? Il sera détaché de tout type qui le référence.')) return;
    CWGameState.removePassive(id);
    _notify('🗑️ Passif supprimé.');
    switchTab('attacks');
  }

  function _clearPassiveForm() {
    _passiveEditingId = null;
    _setVal('passive-name', '');
    _setVal('passive-description', '');
    const firstEffect = Object.keys(CWGameDatabase.PASSIVE_EFFECT_TYPES)[0];
    _setVal('passive-effect-type', firstEffect);
    document.getElementById('passive-params-container').innerHTML = _buildPassiveParamsHtml(firstEffect, {});
  }

  // ─── ONGLET GACHA ────────────────────────────────────────────────────────────

  function _renderGachaTab() {
    const state   = CWGameState.get();
    const cfg     = state.config.gacha || {};
    const banners = state.banners;
    const chars   = state.characters;

    // Taux de drop actuels (config ou fallback database)
    const dropRates = cfg.dropRates || {
      common:50, uncommon:30, rare:12, epic:5, legendary:2, mythic:0.5
    };
    const totalWeight = Object.values(dropRates).reduce((a,b) => a+b, 0);

    const rarityMeta = {
      common:    { label:'Commune',    color:'#9CA3AF' },
      uncommon:  { label:'Peu commune',color:'#34D399' },
      rare:      { label:'Rare',       color:'#60A5FA' },
      epic:      { label:'Épique',     color:'#A78BFA' },
      legendary: { label:'Légendaire', color:'#F59E0B' },
      mythic:    { label:'Mythique',   color:'#F43F5E' },
    };

    const dropRateRows = RARITIES.map(r => {
      const meta   = rarityMeta[r] || { label:r, color:'#fff' };
      const weight = dropRates[r] !== undefined ? dropRates[r] : 0;
      const pct    = totalWeight > 0 ? (weight / totalWeight * 100).toFixed(2) : '0.00';
      return `
        <tr>
          <td style="padding:8px 12px;">
            <span class="badge badge-${r}" style="color:${meta.color}">${meta.label}</span>
          </td>
          <td style="padding:8px 12px; text-align:center;">
            <input type="number" id="drop-${r}" value="${weight}"
              min="0" max="9999" step="0.1"
              style="width:80px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:5px;text-align:center;font-size:.85rem;"
              oninput="CWAdminPanel._updateDropTotal()" />
          </td>
          <td style="padding:8px 12px; text-align:right;">
            <span id="drop-pct-${r}" style="color:${meta.color};font-family:monospace;font-weight:700;">${pct}%</span>
          </td>
          <td style="padding:8px 12px; width:200px;">
            <div style="background:#1a1a2e;border-radius:4px;height:10px;overflow:hidden;">
              <div id="drop-bar-${r}" style="height:100%;width:${pct}%;background:${meta.color};transition:width .3s ease;"></div>
            </div>
          </td>
        </tr>`;
    }).join('');

    const bannerList = banners.map(b => `
      <div class="admin-list-item">
        <div class="admin-list-item-info">
          <div class="admin-list-item-name">
            ${b.name}
            <span style="font-size:.72rem; color:${b.active ? '#4ade80' : '#f87171'}">${b.active ? '● Actif' : '○ Inactif'}</span>
          </div>
          <div class="admin-list-item-sub">${b.description}</div>
          <div class="admin-list-item-sub">Featured: ${b.featured?.join(', ') || 'Aucun'} | Pool: ${b.pool} | Boost: ×${b.featuredRateBoost}</div>
        </div>
        <div class="admin-list-item-actions">
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editBanner('${b.id}')">✏️</button>
          <button class="admin-btn admin-btn-danger  admin-btn-sm" onclick="CWAdminPanel._deleteBanner('${b.id}')">🗑️</button>
        </div>
      </div>
    `).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Configuration Gacha</div>
        <div class="admin-grid">
          <div class="admin-field"><label>Nom de la monnaie</label><input type="text" id="gacha-currency" value="${cfg.currencyName}" /></div>
          <div class="admin-field"><label>Coût invocation simple</label><input type="number" id="gacha-cost-single" value="${cfg.singlePullCost}" min="0" /></div>
          <div class="admin-field"><label>Coût invocation ×10</label><input type="number" id="gacha-cost-ten" value="${cfg.tenPullCost}" min="0" /></div>
          <div class="admin-field"><label>Garantie Rare après (pulls)</label><input type="number" id="gacha-pity-rare" value="${cfg.guaranteedRareAfter}" min="1" /></div>
          <div class="admin-field"><label>Garantie Épique après (pulls)</label><input type="number" id="gacha-pity-epic" value="${cfg.guaranteedEpicAfter}" min="1" /></div>
          <div class="admin-field"><label>Garantie Légendaire après (pulls)</label><input type="number" id="gacha-pity-legendary" value="${cfg.guaranteedLegendaryAfter}" min="1" /></div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveGachaConfig()">💾 Sauver config</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">🎲 Taux de drop par rareté</div>
        <p style="font-size:.78rem; color:#888; margin-bottom:12px;">
          Les poids sont relatifs. Le taux réel (%) est calculé automatiquement selon le total.
          La pitié garantit un minimum quelle que soit la configuration.
        </p>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="font-size:.78rem; color:#aaa; border-bottom:1px solid #333;">
              <th style="padding:8px 12px;text-align:left;">Rareté</th>
              <th style="padding:8px 12px;text-align:center;">Poids</th>
              <th style="padding:8px 12px;text-align:right;">Taux réel</th>
              <th style="padding:8px 12px;">Répartition</th>
            </tr>
          </thead>
          <tbody>${dropRateRows}</tbody>
          <tfoot>
            <tr style="border-top:1px solid #333;">
              <td colspan="2" style="padding:8px 12px; font-size:.8rem; color:#aaa;">
                Total des poids : <strong id="drop-total" style="color:#e8d5b7">${totalWeight.toFixed(1)}</strong>
              </td>
              <td colspan="2" style="padding:8px 12px; font-size:.75rem; color:#888; text-align:right;">
                (total ≠ 100 : les % sont normalisés automatiquement)
              </td>
            </tr>
          </tfoot>
        </table>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveDropRates()">💾 Sauver les taux</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._resetDropRates()">↩ Réinitialiser</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Créer / Modifier une bannière</div>
        <div class="admin-grid">
          <div class="admin-field"><label>ID</label><input type="text" id="banner-id" placeholder="banner_fire" /></div>
          <div class="admin-field"><label>Nom</label><input type="text" id="banner-name" placeholder="Bannière Flamme" /></div>
          <div class="admin-field">
            <label>Active</label>
            <select id="banner-active"><option value="1">Oui</option><option value="0">Non</option></select>
          </div>
          <div class="admin-field"><label>Pool</label>
            <select id="banner-pool" onchange="CWAdminPanel._updateBannerPoolFields()">
              <option value="all">Tous</option>
              <option value="featured">Featured uniquement</option>
              <option value="type">Type prédéfini</option>
              <option value="tag">Tag prédéfini</option>
            </select>
          </div>
          <div class="admin-field" id="banner-pool-type-field" style="display:none;">
            <label>Type du pool</label>
            <select id="banner-pool-type">
              ${state.types.map(t => `<option value="${t.id}">${t.icon} ${t.name}</option>`).join('')}
            </select>
          </div>
          <div class="admin-field" id="banner-pool-tag-field" style="display:none;">
            <label>Tag du pool</label>
            <select id="banner-pool-tag">
              <option value="">— Sélectionner un tag —</option>
              ${(() => {
                const cats = state.tagCategories || [];
                const tags = state.tags || [];
                if (cats.length === 0) return tags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
                return cats.map(cat => {
                  const catTags = tags.filter(t => t.categoryId === cat.id);
                  if (catTags.length === 0) return '';
                  return `<optgroup label="${cat.icon || '🏷️'} ${cat.name}">${catTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>`;
                }).join('');
              })()}
            </select>
          </div>
          <div class="admin-field"><label>Boost featured (×)</label><input type="number" id="banner-boost" value="2.0" step="0.1" min="1" /></div>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Description</label>
          <textarea id="banner-desc" placeholder="Description de la bannière..."></textarea>
        </div>
        <div class="admin-field" style="margin-top:10px;">
          <label>Personnages featured (sélection multiple)</label>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
            <input type="text" id="banner-featured-search" class="search-input" placeholder="🔍 Filtrer par nom..." style="flex:1;min-width:160px;box-sizing:border-box;" oninput="CWAdminPanel._filterBannerFeaturedList(this.value)">
            <select id="banner-auto-tag-select" style="background:#0e0c1a;border:1px solid #2a2540;color:#e8d5b7;border-radius:6px;padding:6px 8px;font-size:.78rem;">
              <option value="">➕ Sélectionner par tag…</option>
              ${(() => {
                const cats = state.tagCategories || [];
                const tags = state.tags || [];
                if (cats.length === 0) return tags.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
                return cats.map(cat => {
                  const catTags = tags.filter(t => t.categoryId === cat.id);
                  if (catTags.length === 0) return '';
                  return `<optgroup label="${cat.icon || '🏷️'} ${cat.name}">${catTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</optgroup>`;
                }).join('');
              })()}
            </select>
            <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._addFeaturedByTag()" title="Cocher tous les personnages ayant ce tag">✓ Tout sélectionner</button>
          </div>
          <div id="banner-featured-list" class="banner-featured-list">
            ${chars.map(c => `
              <label class="banner-featured-item" data-name="${c.name.toLowerCase()}">
                <input type="checkbox" class="banner-featured-checkbox" value="${c.id}">
                <span>${c.name} <span class="banner-featured-id">(${c.id})</span></span>
              </label>
            `).join('')}
          </div>
          <span style="font-size:.72rem; color:#888;">Cochez un ou plusieurs personnages à mettre en avant dans cette bannière.</span>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveBanner()">💾 Enregistrer</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._clearBannerForm()">🗑️ Vider</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Bannières (${banners.length})</div>
        <div class="admin-list">${bannerList}</div>
      </div>
    `;
  }

  function _saveGachaConfig() {
    const state  = CWGameState.get();
    const newCfg = {
      ...state.config,
      gacha: {
        ...state.config.gacha,
        currencyName: document.getElementById('gacha-currency')?.value.trim() || 'Cristaux',
        singlePullCost: parseInt(document.getElementById('gacha-cost-single')?.value || '100'),
        tenPullCost: parseInt(document.getElementById('gacha-cost-ten')?.value || '900'),
        guaranteedRareAfter: parseInt(document.getElementById('gacha-pity-rare')?.value || '10'),
        guaranteedEpicAfter: parseInt(document.getElementById('gacha-pity-epic')?.value || '50'),
        guaranteedLegendaryAfter: parseInt(document.getElementById('gacha-pity-legendary')?.value || '100'),
      },
    };
    CWGameState.updateConfig(newCfg);
    _notify('✅ Configuration Gacha sauvegardée.');
  }

  /** Sauvegarde les taux de drop */
  function _saveDropRates() {
    const state = CWGameState.get();
    const dropRates = {};
    RARITIES.forEach(r => {
      dropRates[r] = parseFloat(document.getElementById(`drop-${r}`)?.value || '0');
    });
    const total = Object.values(dropRates).reduce((a, b) => a + b, 0);
    if (total <= 0) { _notify('❌ Le total des poids doit être > 0.', 'error'); return; }
    const newCfg = {
      ...state.config,
      gacha: { ...state.config.gacha, dropRates },
    };
    CWGameState.updateConfig(newCfg);
    _notify('✅ Taux de drop sauvegardés.');
  }

  /** Réinitialise les taux de drop aux valeurs par défaut */
  function _resetDropRates() {
    const defaults = { common:50, uncommon:30, rare:12, epic:5, legendary:2, mythic:0.5 };
    RARITIES.forEach(r => {
      const inp = document.getElementById(`drop-${r}`);
      if (inp) inp.value = defaults[r];
    });
    _updateDropTotal();
    _notify('↩ Taux de drop réinitialisés (non sauvegardés).');
  }

  /** Met à jour en temps réel le total et les % affichés dans le tableau */
  function _updateDropTotal() {
    const rarityMeta = {
      common:    '#9CA3AF', uncommon: '#34D399', rare:      '#60A5FA',
      epic:      '#A78BFA', legendary:'#F59E0B', mythic:    '#F43F5E',
    };
    let total = 0;
    const vals = {};
    RARITIES.forEach(r => {
      const v = parseFloat(document.getElementById(`drop-${r}`)?.value || '0');
      vals[r] = v;
      total += v;
    });
    const totalEl = document.getElementById('drop-total');
    if (totalEl) totalEl.textContent = total.toFixed(1);
    RARITIES.forEach(r => {
      const pct    = total > 0 ? (vals[r] / total * 100).toFixed(2) : '0.00';
      const pctEl  = document.getElementById(`drop-pct-${r}`);
      const barEl  = document.getElementById(`drop-bar-${r}`);
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (barEl) barEl.style.width = `${pct}%`;
    });
  }

  /** Sauvegarde les poids de fréquence d'apparition des ennemis par rareté */
  function _saveEnemyRarityWeights() {
    const state = CWGameState.get();
    const enemyRarityWeights = {};
    RARITIES.forEach(r => {
      enemyRarityWeights[r] = parseFloat(document.getElementById(`enemy-weight-${r}`)?.value || '0');
    });
    const total = Object.values(enemyRarityWeights).reduce((a, b) => a + b, 0);
    if (total <= 0) { _notify('❌ Le total des poids doit être > 0.', 'error'); return; }
    CWGameState.updateConfig({
      ...state.config,
      combat: { ...state.config.combat, enemyRarityWeights },
    });
    _notify('✅ Fréquence d\'apparition des ennemis sauvegardée.');
  }

  /** Réinitialise les poids de fréquence d'apparition des ennemis aux valeurs par défaut */
  function _resetEnemyRarityWeights() {
    const defaults = { common:50, uncommon:30, rare:12, epic:5, legendary:2, mythic:0.5 };
    RARITIES.forEach(r => {
      const inp = document.getElementById(`enemy-weight-${r}`);
      if (inp) inp.value = defaults[r];
    });
    _updateEnemyWeightTotal();
    _notify('↩ Fréquences réinitialisées (non sauvegardées).');
  }

  /** Met à jour en temps réel les % et barres du tableau de fréquence d'apparition */
  function _updateEnemyWeightTotal() {
    let total = 0;
    const vals = {};
    RARITIES.forEach(r => {
      const v = parseFloat(document.getElementById(`enemy-weight-${r}`)?.value || '0');
      vals[r] = v;
      total += v;
    });
    RARITIES.forEach(r => {
      const pct   = total > 0 ? (vals[r] / total * 100).toFixed(2) : '0.00';
      const pctEl = document.getElementById(`enemy-weight-pct-${r}`);
      const barEl = document.getElementById(`enemy-weight-bar-${r}`);
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (barEl) barEl.style.width = `${pct}%`;
    });
  }

  /** Sauvegarde les bonus d'XP par rareté d'ennemi */
  /** Construit le texte d'exemple montrant la réduction de poids stade par stade */
  function _buildEvolvedFormWeightPreview(factor) {
    const f = Math.max(0, Math.min(1, parseFloat(factor) || 0));
    const stages = [1, 2, 3].map(s => `stade ${s} → ×${Math.pow(f, s).toFixed(3)}`);
    return `Exemple : ${stages.join('  |  ')}`;
  }

  /** Met à jour l'aperçu en direct pendant la saisie */
  function _previewEvolvedFormWeight(value) {
    const el = document.getElementById('evolved-form-weight-preview');
    if (el) el.textContent = _buildEvolvedFormWeightPreview(value);
  }

  /** Sauvegarde le facteur de réduction de fréquence des formes évoluées */
  function _saveEvolvedFormWeightFactor() {
    const state = CWGameState.get();
    const factor = Math.max(0, Math.min(1, parseFloat(document.getElementById('evolved-form-weight-factor')?.value ?? '0.5')));
    CWGameState.updateConfig({
      ...state.config,
      combat: { ...state.config.combat, evolvedFormWeightFactor: factor },
    });
    _notify(`✅ Réduction des formes évoluées sauvegardée (×${factor}).`);
    switchTab('combat');
  }

  function _saveEnemyXpBonus() {
    const state = CWGameState.get();
    const enemyXpBonusByRarity = {};
    RARITIES.forEach(r => {
      enemyXpBonusByRarity[r] = Math.max(0, parseFloat(document.getElementById(`enemy-xpbonus-${r}`)?.value || '0'));
    });
    CWGameState.updateConfig({
      ...state.config,
      combat: { ...state.config.combat, enemyXpBonusByRarity },
    });
    _notify('✅ Bonus d\'XP par rareté sauvegardés.');
  }

  function _saveBanner() {
    const id   = document.getElementById('banner-id')?.value.trim() || `banner_${Date.now()}`;
    const name = document.getElementById('banner-name')?.value.trim();
    if (!name) { _notify('❌ Nom obligatoire.', 'error'); return; }

    const featured = Array.from(document.querySelectorAll('.banner-featured-checkbox:checked')).map(cb => cb.value);

    const bannerData = {
      id,
      name,
      description: document.getElementById('banner-desc')?.value.trim() || '',
      active: document.getElementById('banner-active')?.value === '1',
      pool: document.getElementById('banner-pool')?.value || 'all',
      poolTypeId: document.getElementById('banner-pool-type')?.value || null,
      poolTagId:  document.getElementById('banner-pool-tag')?.value || null,
      featured,
      featuredRateBoost: parseFloat(document.getElementById('banner-boost')?.value || '2.0'),
    };

    const state = CWGameState.get();
    const existing = state.banners.find(b => b.id === id);
    const newBanners = existing
      ? state.banners.map(b => b.id === id ? bannerData : b)
      : [...state.banners, bannerData];

    CWGameState.updateBanners(newBanners);
    _notify(`✅ Bannière "${name}" enregistrée.`);
    _clearBannerForm();
    switchTab('gacha');
  }

  /** Affiche/masque les sélecteurs de type ou de tag selon le mode de pool choisi */
  function _updateBannerPoolFields() {
    const mode = document.getElementById('banner-pool')?.value;
    const typeField = document.getElementById('banner-pool-type-field');
    const tagField  = document.getElementById('banner-pool-tag-field');
    if (typeField) typeField.style.display = mode === 'type' ? '' : 'none';
    if (tagField)  tagField.style.display  = mode === 'tag'  ? '' : 'none';
  }

  /** Filtre la liste des personnages featured par nom (insensible à la casse) */
  function _addFeaturedByTag() {
    const tagId = document.getElementById('banner-auto-tag-select')?.value;
    if (!tagId) return;
    const state = CWGameState.get();
    const charIdsWithTag = new Set(
      state.characters
        .filter(c => c.evolutionStage === 0 && c.tags?.includes(tagId))
        .map(c => c.id)
    );
    if (charIdsWithTag.size === 0) { _notify('Aucun personnage (forme de base) trouvé avec ce tag.', 'error'); return; }
    let checked = 0;
    document.querySelectorAll('.banner-featured-checkbox').forEach(cb => {
      if (charIdsWithTag.has(cb.value)) { cb.checked = true; checked++; }
    });
    _notify(`✅ ${checked} personnage(s) sélectionné(s) avec ce tag.`);
  }

  function _filterBannerFeaturedList(query) {
    const q = (query || '').trim().toLowerCase();
    document.querySelectorAll('.banner-featured-item').forEach(item => {
      item.style.display = !q || item.dataset.name.includes(q) ? '' : 'none';
    });
  }

  function _editBanner(id) {
    const state = CWGameState.get();
    const b = state.banners.find(x => x.id === id);
    if (!b) return;
    _setVal('banner-id', b.id);
    _setVal('banner-name', b.name);
    _setVal('banner-desc', b.description || '');
    _setVal('banner-active', b.active ? '1' : '0');
    _setVal('banner-pool', b.pool || 'all');
    _setVal('banner-pool-type', b.poolTypeId || '');
    _setVal('banner-pool-tag', b.poolTagId || '');
    _updateBannerPoolFields();
    _setVal('banner-boost', b.featuredRateBoost);
    // Sélectionner les featured
    document.querySelectorAll('.banner-featured-checkbox').forEach(cb => {
      cb.checked = !!b.featured?.includes(cb.value);
    });
    document.getElementById('admin-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _deleteBanner(id) {
    if (!confirm(`Supprimer la bannière "${id}" ?`)) return;
    const state = CWGameState.get();
    CWGameState.updateBanners(state.banners.filter(b => b.id !== id));
    _notify('🗑️ Bannière supprimée.');
    switchTab('gacha');
  }

  function _clearBannerForm() {
    ['banner-id','banner-name','banner-desc'].forEach(id => _setVal(id, ''));
    _setVal('banner-active', '1');
    _setVal('banner-pool', 'all');
    _updateBannerPoolFields();
    _setVal('banner-boost', '2.0');
    document.querySelectorAll('.banner-featured-checkbox').forEach(cb => { cb.checked = false; });
    _setVal('banner-featured-search', '');
    document.querySelectorAll('.banner-featured-item').forEach(item => { item.style.display = ''; });
  }

  // ─── ONGLET ÉVOLUTIONS ───────────────────────────────────────────────────────

  function _renderEvolutionsTab() {
    const state = CWGameState.get();
    const chars = state.characters;

    // Grouper par evolutionLine
    const lines = {};
    chars.forEach(c => {
      const line = c.evolutionLine || c.id;
      if (!lines[line]) lines[line] = [];
      lines[line].push(c);
    });

    // Trier chaque ligne par evolutionStage
    Object.values(lines).forEach(arr => arr.sort((a, b) => (a.evolutionStage || 0) - (b.evolutionStage || 0)));

    // Trier l'ordre d'affichage des lignées elles-mêmes (Nom ou Rareté de la forme de base)
    const rarityIndex = (r) => { const idx = RARITIES.indexOf(r); return idx === -1 ? 0 : idx; };
    const sortedLineEntries = Object.entries(lines).sort(([, membersA], [, membersB]) => {
      if (_evoSortKey === 'rarity') {
        return rarityIndex(membersB[0].rarity) - rarityIndex(membersA[0].rarity) || membersA[0].name.localeCompare(membersB[0].name);
      }
      return membersA[0].name.localeCompare(membersB[0].name);
    });

    const lineHtml = sortedLineEntries.map(([lineId, members]) => {
      const baseRarity = members[0].rarity;
      const distinctRarities = [...new Set(members.map(m => m.rarity))];
      const rarityWarning = distinctRarities.length > 1
        ? `<span style="font-size:.62rem; color:#f87171; margin-left:6px;">⚠ raretés mixtes dans cette lignée</span>`
        : '';

      // Tags de la lignée regroupés par catégorie
      const lineTagIds = [...new Set(members.flatMap(m => m.tags || []))];
      const cats = state.tagCategories || [];

      const tagAdder = cats.length === 0
        ? `<span style="font-size:.7rem;color:#888;">Aucune catégorie de tag — onglet <strong>🏷️ Tags</strong> pour en créer.</span>`
        : `<div class="tag-by-cat-zone">
            ${cats.map(cat => {
              const catTags = (state.tags || []).filter(t => t.categoryId === cat.id);
              const appliedTags = catTags.filter(t => lineTagIds.includes(t.id));
              const availTags   = catTags.filter(t => !lineTagIds.includes(t.id));
              const chips = appliedTags.map(t => `
                <span class="tag-chip" style="background:${t.color || cat.color}">
                  ${t.name}
                  <button type="button" class="tag-chip-remove" title="Retirer"
                    onclick="CWAdminPanel._removeTagFromLine('${lineId}','${t.id}')">✕</button>
                </span>`).join('');
              const adder = availTags.length > 0
                ? `<select class="tag-add-select" id="tag-add-${cat.id}-${lineId}">
                    <option value="">+ ${cat.name}…</option>
                    ${availTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                  </select>
                  <button class="admin-btn admin-btn-secondary admin-btn-sm"
                    onclick="CWAdminPanel._addTagToLineFromCategory('${lineId}','${cat.id}')">✓</button>`
                : (catTags.length === 0
                    ? `<span style="font-size:.68rem;color:#444;">(aucun tag)</span>`
                    : ``);
              return `<div class="tag-by-cat-row">
                <span class="tag-by-cat-label" style="color:${cat.color};">${cat.icon||'🏷️'} ${cat.name}</span>
                <div class="tag-by-cat-chips">${chips}${adder}</div>
              </div>`;
            }).join('')}
           </div>`;
      const tagChips = ''; // intégré dans tagAdder par catégorie

      const chain = members.map((c, i) => `
        <div class="evo-chain-member" draggable="true" data-drag-id="${c.id}"
             style="display:inline-block; text-align:center; margin:0 8px; cursor:grab;"
             ondragstart="CWAdminPanel._dragStart(event,'evo','${c.id}','${lineId}')"
             ondragover="CWAdminPanel._dragOver(event)"
             ondragleave="CWAdminPanel._dragLeave(event)"
             ondrop="CWAdminPanel._dragDropEvoStage(event,'${lineId}','${c.id}')"
             ondragend="CWAdminPanel._dragEnd(event)">
          ${c.portrait ? `<img src="${c.portrait}" style="width:50px;height:62px;object-fit:cover;border-radius:4px;" />` : `<div style="width:50px;height:62px;background:#333;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#888;font-size:.7rem;">?</div>`}
          <div style="font-size:.75rem; color:#e8d5b7; margin-top:4px;">${c.name}</div>
          <div style="font-size:.68rem; color:#888;">Niv. ${c.evolutionCondition?.value || '—'}</div>
        </div>
        ${i < members.length - 1 ? '<span style="font-size:1.2rem; color:#e94560; vertical-align:middle;">→</span>' : ''}
      `).join('');

      return `
        <div class="admin-list-item" data-line-id="${lineId}" style="flex-direction:column; align-items:flex-start;">
          <div style="font-size:.8rem; color:#aaa; margin-bottom:8px;">
            Lignée : <strong style="color:#e94560">${lineId}</strong>
            <span class="badge badge-${baseRarity}" style="margin-left:8px;">${RARITY_LABELS[baseRarity] || baseRarity}</span>
            ${rarityWarning}
          </div>
          <label style="display:flex; align-items:center; gap:6px; font-size:.75rem; color:#ccc; margin-bottom:10px; cursor:pointer;">
            <input type="checkbox" class="line-avail-checkbox" ${members[0].availableInLineCombat !== false ? 'checked' : ''}
                   onchange="CWAdminPanel._toggleLineCombatAvailability('${members[0].id}', this.checked)" />
            ⚔ Dispo en Combat de Ligne
          </label>
          <div style="margin-bottom:10px;">
            ${tagAdder}
          </div>
          <p style="font-size:.68rem; color:#666; margin:0 0 8px;">Glissez une forme pour réorganiser l'ordre des stades.</p>
          <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">${chain}</div>
          <div style="margin-top:8px;">
            ${members.map(c => `
              <div style="font-size:.72rem; color:#888;">
                <strong style="color:#e8d5b7">${c.name}</strong> (${c.id}) Stage ${c.evolutionStage || 0}
                ${c.evolvesTo ? `→ ${c.evolvesTo} @ lv.${c.evolutionCondition?.value || '?'}` : '<span style="color:#4ade80">✓ Forme finale</span>'}
                <button class="admin-btn admin-btn-primary admin-btn-sm" style="margin-left:8px;" onclick="CWAdminPanel._editCharacter('${c.id}'); CWAdminPanel.switchTab('characters');">✏️ Éditer</button>
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._upgradeCharacter('${c.id}')">⬆️ Upgrade</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span>Arbres évolutifs</span>
          <select class="sort-select" id="evo-sort" onchange="CWAdminPanel._sortEvolutionLines(this.value)">
            <option value="name"   ${_evoSortKey === 'name'   ? 'selected' : ''}>Trier : Nom (A-Z)</option>
            <option value="rarity" ${_evoSortKey === 'rarity' ? 'selected' : ''}>Trier : Rareté</option>
          </select>
        </div>
        <p style="font-size:.8rem; color:#888; margin-bottom:12px;">
          Les évolutions se configurent dans l'onglet <strong>Personnages</strong>.
          Cet onglet affiche les chaînes complètes pour visualisation et édition rapide.
          La rareté affichée est celle des personnages de la lignée (normalement unique).
        </p>
        <div class="admin-actions" style="margin-bottom:14px;">
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._uncheckEpicPlusLines()">
            🚫 Décocher toutes les lignées Épique et +
          </button>
        </div>
        <div class="admin-list">${lineHtml}</div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">⚠️ Réinitialiser toutes les évolutions</div>
        <p style="font-size:.8rem; color:#888;">Force tous les personnages de la collection joueur à revenir au stade 0 de leur lignée.</p>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-danger" onclick="CWAdminPanel._resetAllEvolutions()">⚠️ Réinitialiser</button>
        </div>
      </div>
    `;
  }

  /**
   * Change l'ordre d'affichage des lignées dans l'onglet Évolutions (Nom ou Rareté).
   * Affichage uniquement : ne modifie pas l'ordre canonique des personnages.
   */
  function _sortEvolutionLines(key) {
    _evoSortKey = key || 'name';
    switchTab('evolutions');
  }

  /** Ajoute le tag choisi dans la déroulante à toute la lignée évolutive */
  function _addTagToLineFromCategory(lineId, catId) {
    const select = document.getElementById(`tag-add-${catId}-${lineId}`);
    if (!select?.value) return;
    CWGameState.addTagToLine(lineId, select.value);
    switchTab('evolutions');
  }

  function _addTagToLine(lineId) {
    const select = document.getElementById(`tag-add-${lineId}`);
    const tagId = select?.value;
    if (!tagId) return;
    CWGameState.addTagToLine(lineId, tagId);
    switchTab('evolutions');
  }

  /** Retire un tag de toute la lignée évolutive */
  function _removeTagFromLine(lineId, tagId) {
    CWGameState.removeTagFromLine(lineId, tagId);
    switchTab('evolutions');
  }

  /**
   * Décoche (retire du Combat de Ligne) toutes les lignées dont la rareté
   * (celle des personnages qui la composent) est Épique, Légendaire ou Mythique.
   */
  function _uncheckEpicPlusLines() {
    const state = CWGameState.get();
    const targetRarities = ['epic', 'legendary', 'mythic'];
    const lines = {};
    state.characters.forEach(c => {
      const line = c.evolutionLine || c.id;
      if (!lines[line]) lines[line] = [];
      lines[line].push(c);
    });

    let count = 0;
    Object.values(lines).forEach(members => {
      const base = members.slice().sort((a, b) => (a.evolutionStage || 0) - (b.evolutionStage || 0))[0];
      if (targetRarities.includes(base.rarity) && base.availableInLineCombat !== false) {
        CWGameState.updateCharDef(base.id, { availableInLineCombat: false });
        count++;
      }
    });

    _notify(count > 0
      ? `🚫 ${count} lignée(s) Épique et + retirée(s) du Combat de Ligne.`
      : 'Toutes les lignées Épique et + étaient déjà décochées.');
    switchTab('evolutions');
  }

  /**
   * Active/désactive la disponibilité d'une lignée en Combat de Ligne.
   * Le flag est porté par la forme de base (stade 0) de la lignée, seule
   * forme effectivement combattue dans ce mode.
   */
  function _toggleLineCombatAvailability(baseCharId, checked) {
    CWGameState.updateCharDef(baseCharId, { availableInLineCombat: checked });
    _notify(checked ? '✅ Lignée disponible en Combat de Ligne.' : '🚫 Lignée retirée du Combat de Ligne.');
  }

  function _resetAllEvolutions() {
    if (!confirm('Réinitialiser toutes les évolutions ? Les personnages reviendront à leur forme de base.')) return;
    const state = CWGameState.get();
    const player = CWGameState.getPlayer();
    // Remettre chaque instance sur la forme de base de sa lignée
    player.collection.forEach(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return;
      const baseDef = state.characters.find(c => c.evolutionLine === def.evolutionLine && c.evolutionStage === 0);
      if (baseDef && baseDef.id !== inst.charId) {
        inst.charId = baseDef.id;
      }
    });
    CWGameState.updatePlayer(player);
    _notify('✅ Évolutions réinitialisées.');
  }

  // ─── ONGLET AWAKENING ────────────────────────────────────────────────────────

  function _renderAwakeningTab() {
    const state = CWGameState.get();
    const cfg   = state.config.awakening || {};

    const rarityRows = RARITIES.map(r => {
      const bonuses = cfg.bonusPerLevel[r] || { hp:0, atk:0, def:0, spd:0 };
      return `
        <tr>
          <td><span class="badge badge-${r}">${RARITY_LABELS[r]}</span></td>
          <td><input type="number" id="awk-${r}-hp"  value="${bonuses.hp}"  min="0" max="100" step="0.5" style="width:60px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:4px;text-align:center;" /></td>
          <td><input type="number" id="awk-${r}-atk" value="${bonuses.atk}" min="0" max="100" step="0.5" style="width:60px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:4px;text-align:center;" /></td>
          <td><input type="number" id="awk-${r}-def" value="${bonuses.def}" min="0" max="100" step="0.5" style="width:60px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:4px;text-align:center;" /></td>
          <td><input type="number" id="awk-${r}-spd" value="${bonuses.spd}" min="0" max="100" step="0.5" style="width:60px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:4px;text-align:center;" /></td>
        </tr>
      `;
    }).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Paramètres globaux Awakening</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Niveau Awakening maximum</label>
            <input type="number" id="awk-max-level" value="${cfg.maxLevel}" min="1" max="99" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Bonus % par niveau d'Awakening (par rareté)</div>
        <p style="font-size:.78rem; color:#888; margin-bottom:12px;">
          Ces bonus sont appliqués pour chaque niveau d'Awakening (cumulatif).
          Ex: 5% ATK à level 3 d'Awakening = +15% ATK total.
        </p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse; width:100%;">
            <thead>
              <tr style="font-size:.78rem; color:#aaa;">
                <th style="padding:8px; text-align:left;">Rareté</th>
                <th style="padding:8px;">+PV %</th>
                <th style="padding:8px;">+ATK %</th>
                <th style="padding:8px;">+DEF %</th>
                <th style="padding:8px;">+VIT %</th>
              </tr>
            </thead>
            <tbody>${rarityRows}</tbody>
          </table>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveAwakening()">💾 Sauver</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Awakening des personnages du joueur</div>
        ${_renderPlayerAwakeningList()}
      </div>
    `;
  }

  function _renderPlayerAwakeningList() {
    const player = CWGameState.getPlayer();
    const state  = CWGameState.get();
    if (player.collection.length === 0) return '<p style="color:#888;">Aucun personnage dans la collection.</p>';

    return `<div class="admin-list">` + player.collection.map(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return '';
      return `
        <div class="admin-list-item">
          <div class="admin-list-item-info">
            <div class="admin-list-item-name">${def.name} <span class="badge badge-${def.rarity}">${RARITY_LABELS[def.rarity]}</span></div>
            <div class="admin-list-item-sub">Niv.${inst.level} | Awakening: ${inst.awakening}/${state.config.awakening.maxLevel}</div>
          </div>
          <div class="admin-list-item-actions" style="align-items:center; gap:6px;">
            <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._setAwakening('${inst.instanceId}', ${Math.max(0, inst.awakening - 1)})">−</button>
            <span style="color:#e8d5b7; font-weight:600; min-width:20px; text-align:center;">${inst.awakening}</span>
            <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._setAwakening('${inst.instanceId}', ${inst.awakening + 1})">+</button>
          </div>
        </div>
      `;
    }).join('') + '</div>';
  }

  function _setAwakening(instanceId, value) {
    const player = CWGameState.getPlayer();
    const inst   = player.collection.find(c => c.instanceId === instanceId);
    if (!inst) return;
    const maxAwk = CWGameState.getConfig().awakening.maxLevel;
    inst.awakening = Math.max(0, Math.min(maxAwk, value));
    CWGameState.updatePlayer(player);
    // Refresh la section
    const listEl = document.querySelector('#admin-content .admin-section:last-child');
    if (listEl) {
      const title = listEl.querySelector('.admin-section-title');
      listEl.innerHTML = `<div class="admin-section-title">${title ? title.textContent : 'Awakening joueur'}</div>${_renderPlayerAwakeningList()}`;
    }
    _notify(`⭐ Awakening mis à jour.`);
  }

  function _saveAwakening() {
    const state = CWGameState.get();
    const bonusPerLevel = {};
    RARITIES.forEach(r => {
      bonusPerLevel[r] = {
        hp:  parseFloat(document.getElementById(`awk-${r}-hp`)?.value  || '0'),
        atk: parseFloat(document.getElementById(`awk-${r}-atk`)?.value || '0'),
        def: parseFloat(document.getElementById(`awk-${r}-def`)?.value || '0'),
        spd: parseFloat(document.getElementById(`awk-${r}-spd`)?.value || '0'),
      };
    });

    const newCfg = {
      ...state.config,
      awakening: {
        maxLevel: parseInt(document.getElementById('awk-max-level')?.value || '6'),
        bonusPerLevel,
      },
    };
    CWGameState.updateConfig(newCfg);
    _notify('✅ Configuration Awakening sauvegardée.');
  }

  // ─── ONGLET JOUEUR ───────────────────────────────────────────────────────────

  function _renderPlayerTab() {
    const player = CWGameState.getPlayer();
    const state  = CWGameState.get();
    const catalogueTotal = state.characters.length;
    const catalogueFound = Object.keys(player.catalogue).length;
    const plCfg = state.config.playerLevel || {};
    const xpForNext = CWGameDatabase.xpForPlayerLevel(player.level + 1, plCfg);

    return `
      <div class="admin-section">
        <div class="admin-section-title">Informations Joueur</div>
        <div class="admin-grid">
          <div class="admin-field"><label>Nom du joueur</label><input type="text" id="player-name" value="${player.name}" /></div>
          <div class="admin-field"><label>Niveau joueur</label><input type="number" id="player-level" value="${player.level}" min="1" /></div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._savePlayerInfo()">💾 Sauver</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">📈 Progression du joueur (Niveau & XP)</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Le joueur gagne de l'XP en éliminant des ennemis en combat et en capturant des
          créatures (tirage Gacha ou capture en combat — les ajouts via le panneau admin
          n'en accordent volontairement pas). Chaque niveau de joueur gagné augmente
          l'énergie maximale et regagne immédiatement l'énergie jusqu'à ce nouveau maximum.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>XP de base (formule : base × niveau^exposant)</label>
            <input type="number" id="pl-xp-base" value="${plCfg.xpBase}" min="1" />
          </div>
          <div class="admin-field">
            <label>Exposant XP</label>
            <input type="number" id="pl-xp-exponent" value="${plCfg.xpExponent}" min="0.1" step="0.05" />
          </div>
          <div class="admin-field">
            <label>Énergie max gagnée par niveau</label>
            <input type="number" id="pl-energy-per-level" value="${plCfg.energyPerLevel}" min="0" />
          </div>
          <div class="admin-field">
            <label>XP joueur par ennemi éliminé (combat)</label>
            <input type="number" id="pl-xp-per-kill" value="${plCfg.xpPerEnemyKill}" min="0" />
          </div>
          <div class="admin-field">
            <label>XP joueur par créature capturée (Gacha + Combat)</label>
            <input type="number" id="pl-xp-per-capture" value="${plCfg.xpPerCapture}" min="0" />
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._savePlayerLevelConfig()">💾 Sauver</button>
        </div>
        <div style="margin-top:10px;font-size:.78rem;background:#0f3460;border-radius:6px;padding:8px 12px;">
          État actuel — Niveau <strong>${player.level}</strong> ·
          XP ${Math.floor(player.experience || 0)} / ${xpForNext} ·
          Énergie max <strong>${player.energy.max}</strong>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Collection (${player.collection.length} personnages)</div>
        ${_renderPlayerCollection(player, state)}
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Ajouter un personnage à la collection</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Personnage</label>
            <select id="admin-add-char">
              ${state.characters.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._adminAddChar()">➕ Ajouter</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Catalogue (${catalogueFound}/${catalogueTotal})</div>
        <p style="color:#4ade80; font-size:.85rem;">Complétion : ${Math.round(catalogueFound/Math.max(1,catalogueTotal)*100)}%</p>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
          ${state.characters.map(c => {
            const entry = player.catalogue[c.id];
            return `
              <div style="width:60px; text-align:center; opacity:${entry ? '1' : '0.3'}">
                ${c.portrait ? `<img src="${c.portrait}" style="width:50px;height:62px;object-fit:cover;border-radius:4px;" />` : `<div style="width:50px;height:62px;background:#333;border-radius:4px;margin:0 auto;"></div>`}
                <div style="font-size:.65rem; color:#aaa; margin-top:2px;">${c.name}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">⚠️ Zone dangereuse</div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-danger" onclick="CWAdminPanel._resetPlayer()">🗑️ Réinitialiser le joueur</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._clearCollection()">🗑️ Vider la collection</button>
          <button class="admin-btn admin-btn-danger" style="background:#7f1d1d" onclick="CWAdminPanel._wipeAllPlayerData()">☢️ Supprimer TOUTES les données joueur</button>
        </div>
        <div class="admin-section-title" style="margin-top:14px;color:#7dd3fc">🧪 Mode test</div>
        <div class="admin-actions">
          <button class="admin-btn" style="background:#1e3a5f;border:1px solid #3b82f6;color:#7dd3fc" onclick="CWAdminPanel._unlockAllForTesting()">
            🧪 Débloquer tout (test) — Tous persos Niv.100, Awakening max, 999 équipements mythiques
          </button>
        </div>
      </div>
    `;
  }

  function _renderPlayerCollection(player, state) {
    if (player.collection.length === 0) return '<p style="color:#888;">Collection vide.</p>';
    return `<div class="admin-list">` + player.collection.map(inst => {
      const def = CWGameState.getCharDef(inst.charId);
      if (!def) return '';
      const stats = CWGameDatabase.computeStats(def, inst.level, inst.awakening || 0, state.config.awakening, def.rarity, state.config.level);
      return `
        <div class="admin-list-item">
          ${def.portrait ? `<img src="${def.portrait}" style="width:40px;height:50px;object-fit:cover;border-radius:4px;" />` : `<div style="width:40px;height:50px;background:#333;border-radius:4px;"></div>`}
          <div class="admin-list-item-info">
            <div class="admin-list-item-name">${def.name} <span class="badge badge-${def.rarity}">${RARITY_LABELS[def.rarity]}</span></div>
            <div class="admin-list-item-sub">Niv.${inst.level} | XP: ${inst.xp} | Awk: ★${inst.awakening} | ${inst.instanceId}</div>
            <div class="admin-list-item-sub">PV:${stats.hp} ATK:${stats.atk} DEF:${stats.def} VIT:${stats.spd}</div>
          </div>
          <div class="admin-list-item-actions">
            <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._editPlayerChar('${inst.instanceId}')">✏️</button>
            <button class="admin-btn admin-btn-danger admin-btn-sm"  onclick="CWAdminPanel._removePlayerChar('${inst.instanceId}')">🗑️</button>
          </div>
        </div>
      `;
    }).join('') + '</div>';
  }

  function _savePlayerInfo() {
    const name  = document.getElementById('player-name')?.value.trim() || 'Invocateur';
    const level = parseInt(document.getElementById('player-level')?.value || '1');
    CWGameState.updatePlayer({ name, level });
    _notify('✅ Informations joueur sauvegardées.');
  }

  /** Sauvegarde la configuration du système de niveau/XP du joueur */
  function _savePlayerLevelConfig() {
    const state = CWGameState.get();
    const playerLevel = {
      xpBase:         parseFloat(document.getElementById('pl-xp-base')?.value || '100'),
      xpExponent:     parseFloat(document.getElementById('pl-xp-exponent')?.value || '1.5'),
      energyPerLevel: parseInt(document.getElementById('pl-energy-per-level')?.value || '5'),
      xpPerEnemyKill: parseInt(document.getElementById('pl-xp-per-kill')?.value || '5'),
      xpPerCapture:   parseInt(document.getElementById('pl-xp-per-capture')?.value || '20'),
    };
    CWGameState.updateConfig({ ...state.config, playerLevel });
    _notify('✅ Progression du joueur sauvegardée.');
    switchTab('player');
  }

  function _adminAddChar() {
    const charId = document.getElementById('admin-add-char')?.value;
    if (!charId) return;
    const result = CWGameState.addCharacterToCollection(charId, 'admin');
    if (!result) { _notify('❌ Personnage introuvable.', 'error'); return; }
    _notify(result.isNew ? '✅ Personnage ajouté !' : `⭐ Awakening appliqué (doublon).`);
    switchTab('player');
  }

  function _editPlayerChar(instanceId) {
    const player = CWGameState.getPlayer();
    const inst   = player.collection.find(c => c.instanceId === instanceId);
    if (!inst) return;
    const newLevel = parseInt(prompt(`Nouveau niveau pour "${CWGameState.getCharDef(inst.charId)?.name || instanceId}" :`, inst.level));
    if (isNaN(newLevel) || newLevel < 1) return;
    inst.level = newLevel;
    inst.xp = 0;
    CWGameState.updatePlayer(player);
    _notify('✅ Niveau mis à jour.');
    switchTab('player');
  }

  function _removePlayerChar(instanceId) {
    if (!confirm('Supprimer ce personnage de la collection ?')) return;
    const player = CWGameState.getPlayer();
    player.collection = player.collection.filter(c => c.instanceId !== instanceId);
    player.team = player.team.filter(id => id !== instanceId);
    CWGameState.updatePlayer(player);
    _notify('🗑️ Personnage retiré de la collection.');
    switchTab('player');
  }

  function _resetPlayer() {
    if (!confirm('⚠️ Réinitialiser COMPLÈTEMENT le joueur ? Toute progression sera perdue.')) return;
    const fresh = JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_PLAYER));
    fresh.energy.lastRegen = Date.now();
    CWGameState.updatePlayer(fresh);
    _notify('✅ Joueur réinitialisé.');
    switchTab('player');
  }

  function _unlockAllForTesting() {
    if (!confirm('Débloquer tous les personnages au niveau 100, awakening max, et ajouter 999 équipements mythiques ?\n\nCette action est destinée aux tests uniquement.')) return;

    const state  = CWGameState.get();
    const player = CWGameState.getPlayer();
    const cfg    = state.config;
    const awakeningMax = cfg.awakening?.maxLevel ?? 12;

    // ── 1. Ajouter tous les personnages (toutes évolutions) au niveau 100 ──
    const newCollection = [...(player.collection || [])];
    const newCatalogue  = { ...(player.catalogue  || {}) };
    const existingCharIds = new Set(newCollection.map(i => i.charId));

    state.characters.forEach(charDef => {
      // Ajouter à la collection si absent
      if (!existingCharIds.has(charDef.id)) {
        const inst = {
          instanceId:       `test_${charDef.id}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
          charId:           charDef.id,
          level:            100,
          awakening:        awakeningMax,
          obtainedAt:       Date.now(),
          equipment:        [null, null, null],
          battlesWon:       0,
          enemiesDefeated:  0,
        };
        newCollection.push(inst);
        existingCharIds.add(charDef.id);
      } else {
        // Déjà présent : mettre à jour niveau + awakening
        const inst = newCollection.find(i => i.charId === charDef.id);
        if (inst) { inst.level = 100; inst.awakening = awakeningMax; }
      }
      // Débloquer dans le catalogue
      newCatalogue[charDef.id] = { discovered: true, portrait: charDef.portrait || null };
    });

    // ── 2. Générer 999 exemplaires de chaque équipement mythique ──
    const mythicEquips = state.equipment.filter(e => e.rarity === 'mythic');
    const newEquipInv  = [...(player.equipInventory || [])];

    // Compter les exemplaires existants par définition
    const existingCounts = {};
    newEquipInv.forEach(ei => { existingCounts[ei.defId] = (existingCounts[ei.defId] || 0) + 1; });

    mythicEquips.forEach(equipDef => {
      const existing = existingCounts[equipDef.id] || 0;
      const toAdd    = Math.max(0, 999 - existing);
      for (let i = 0; i < toAdd; i++) {
        newEquipInv.push({
          instanceId: `test_eq_${equipDef.id}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
          defId:      equipDef.id,
          equippedBy: null,
        });
      }
    });

    // ── 3. Booster les ressources pour les tests ──
    const newCurrency = {
      ...player.currency,
      crystals: Math.max(player.currency?.crystals || 0, 999999),
      gold:     Math.max(player.currency?.gold     || 0, 999999),
    };

    // ── 4. Appliquer ──
    CWGameState.updatePlayer({
      collection:   newCollection,
      catalogue:    newCatalogue,
      equipInventory: newEquipInv,
      currency:     newCurrency,
    });

    _notify(`🧪 Test activé : ${newCollection.length} personnages, ${mythicEquips.length} types d'équipements mythiques (×999), ressources boostées.`);
    switchTab('player');
  }

  function _clearCollection() {
    if (!confirm('Vider toute la collection du joueur ?')) return;
    const player = CWGameState.getPlayer();
    player.collection = [];
    player.team = [];
    CWGameState.updatePlayer(player);
    _notify('🗑️ Collection vidée.');
    switchTab('player');
  }

  /**
   * Supprime TOUTES les données du joueur (progression complète), sans toucher
   * aux données database (personnages, types, tags, équipements, objets,
   * config, quêtes définies, bannières, listings shop, etc.).
   * Contrairement à _resetPlayer (qui fait un merge superficiel et laisse donc
   * persister des champs ajoutés après coup comme event/rotatingShop/weeklyQuestState),
   * cette fonction reconstruit player de zéro avec TOUS les champs connus.
   */
  function _wipeAllPlayerData() {
    const sure = confirm(
      '☢️ SUPPRESSION TOTALE des données joueur.\n\n' +
      'Ceci efface : collection, équipe, équipements, objets, monnaies, niveau, ' +
      'énergie, progression Tournée, quêtes quotidiennes/hebdo/event en cours, ' +
      'cycles de connexion, shop tournant, statistiques, pitié Gacha — absolument tout.\n\n' +
      'Les personnages, types, tags, configurations et autres données du jeu ' +
      'NE SERONT PAS touchés.\n\n' +
      'Cette action est irréversible. Continuer ?'
    );
    if (!sure) return;
    const confirmText = prompt('Tape SUPPRIMER en majuscules pour confirmer :');
    if (confirmText !== 'SUPPRIMER') { alert('Annulé.'); return; }

    const fresh = JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_PLAYER));
    fresh.energy.lastRegen = Date.now();

    // Compléter avec tous les champs ajoutés au fil des sessions, absents de
    // DEFAULT_PLAYER, pour garantir une suppression réellement totale.
    fresh.rotatingShop = { date: null, listingIds: [] };
    fresh.weeklyQuestState = { weekStart: null, activeQuestIds: [], progress: {}, claimed: {} };
    fresh.event = { current: null, next: null };

    // Remplacement intégral de l'objet player (pas de spread/merge résiduel)
    const state = CWGameState.get();
    state.player = fresh;
    CWGameState.updatePlayer({}); // déclenche la notification + l'autosave sur l'état déjà remplacé

    _notify('☢️ Toutes les données joueur ont été supprimées.');
    switchTab('player');
  }

  // ─── ONGLET RESSOURCES ───────────────────────────────────────────────────────

  function _renderResourcesTab() {
    const player = CWGameState.getPlayer();
    const state  = CWGameState.get();
    const cfg    = state.config;

    return `
      <div class="admin-section">
        <div class="admin-section-title">Monnaies du joueur</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>${(cfg.gacha||{}).currencyName || 'Diamants'} actuels</label>
            <input type="number" id="res-crystals" value="${player.currency.crystals}" min="0" />
          </div>
          <div class="admin-field">
            <label>Dollars actuelles</label>
            <input type="number" id="res-gold" value="${player.currency.gold || 0}" min="0" />
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveResources()">💾 Mettre à jour</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._addResources(1000)">+1000 Cristaux</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._addResources(99999)">+99999 Cristaux</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._addResources(0, 1000)">+1000 Or</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._addResources(0, 99999)">+99999 Or</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Énergie</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Énergie actuelle</label>
            <input type="number" id="res-energy-current" value="${player.energy.current}" min="0" />
          </div>
          <div class="admin-field">
            <label>Énergie maximum</label>
            <input type="number" id="res-energy-max" value="${cfg.energy.max}" min="0" />
          </div>
          <div class="admin-field">
            <label>Régén / minute</label>
            <input type="number" id="res-energy-regen" value="${cfg.energy.regenPerMinute}" min="0" step="0.1" />
          </div>
          <div class="admin-field">
            <label>Coût Mode Odyssée</label>
            <input type="number" id="res-energy-cost-story" value="${cfg.energy.costs?.story ?? 10}" min="0" />
          </div>
          <div class="admin-field">
            <label>Coût combat aléatoire (non-affiché)</label>
            <input type="number" id="res-energy-cost-random" value="${cfg.energy.costs?.random ?? cfg.energy.combatCost ?? 10}" min="0" />
          </div>
          <div class="admin-field">
            <label>Coût combat par lignée</label>
            <input type="number" id="res-energy-cost-line" value="${cfg.energy.costs?.line ?? 20}" min="0" />
          </div>
          <div class="admin-field">
            <label>Coût Full Aléatoire</label>
            <input type="number" id="res-energy-cost-fullrandom" value="${cfg.energy.costs?.fullRandom ?? 10}" min="0" />
          </div>
          <div class="admin-field">
            <label>Coût Arène</label>
            <input type="number" id="res-energy-cost-arena" value="${cfg.energy.costs?.arena ?? 15}" min="0" />
          </div>
          <div class="admin-field">
            <label>Énergie activée</label>
            <select id="res-energy-enabled">
              <option value="1" ${cfg.energy.enabled ? 'selected' : ''}>Oui</option>
              <option value="0" ${!cfg.energy.enabled ? 'selected' : ''}>Non (illimitée)</option>
            </select>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEnergyConfig()">💾 Sauver config énergie</button>
          <button class="admin-btn admin-btn-warning" onclick="CWAdminPanel._fillEnergy()">⚡ Recharger énergie</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Statistiques joueur</div>
        <div style="font-size:.85rem; line-height:1.8; color:#aaa;">
          🎯 Combats : <strong style="color:#e8d5b7">${player.stats.totalBattles}</strong><br/>
          🏆 Victoires : <strong style="color:#4ade80">${player.stats.totalVictories}</strong><br/>
          🎲 Invocations : <strong style="color:#c4b5fd">${player.stats.totalPulls}</strong><br/>
          🎣 Captures : <strong style="color:#60a5fa">${player.stats.totalCaptures}</strong>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-danger" onclick="CWAdminPanel._resetStats()">🗑️ Réinitialiser les stats</button>
        </div>
      </div>
    `;
  }

  function _saveResources() {
    const crystals = parseInt(document.getElementById('res-crystals')?.value || '0');
    const gold     = parseInt(document.getElementById('res-gold')?.value || '0');
    const player   = CWGameState.getPlayer();
    player.currency.crystals = Math.max(0, crystals);
    player.currency.gold     = Math.max(0, gold);
    CWGameState.updatePlayer(player);
    _notify('✅ Monnaie mise à jour.');
  }

  function _addResources(crystalAmount, goldAmount = 0) {
    CWGameState.modifyResources({ crystals: crystalAmount, gold: goldAmount });
    const crystalInp = document.getElementById('res-crystals');
    const goldInp     = document.getElementById('res-gold');
    if (crystalInp) crystalInp.value = CWGameState.getPlayer().currency.crystals;
    if (goldInp)     goldInp.value   = CWGameState.getPlayer().currency.gold;
    const parts = [];
    if (crystalAmount) parts.push(`+${crystalAmount} Cristaux`);
    if (goldAmount)     parts.push(`+${goldAmount} Or`);
    _notify(`✅ ${parts.join(', ')} ajoutés.`);
  }

  function _saveEnergyConfig() {
    const state  = CWGameState.get();
    const player = CWGameState.getPlayer();
    const maxEnergy = parseInt(document.getElementById('res-energy-max')?.value || '100');
    const curEnergy = parseInt(document.getElementById('res-energy-current')?.value || '0');

    player.energy.current = Math.min(maxEnergy, Math.max(0, curEnergy));
    player.energy.max = maxEnergy;
    CWGameState.updatePlayer(player);

    const newCfg = {
      ...state.config,
      energy: {
        enabled: document.getElementById('res-energy-enabled')?.value === '1',
        max: maxEnergy,
        regenPerMinute: parseFloat(document.getElementById('res-energy-regen')?.value || '1'),
        combatCost: parseInt(document.getElementById('res-energy-cost-random')?.value || '10'),
        costs: {
          story:      parseInt(document.getElementById('res-energy-cost-story')?.value       || '10'),
          random:     parseInt(document.getElementById('res-energy-cost-random')?.value     || '10'),
          line:       parseInt(document.getElementById('res-energy-cost-line')?.value        || '20'),
          fullRandom: parseInt(document.getElementById('res-energy-cost-fullrandom')?.value  || '10'),
          arena:      parseInt(document.getElementById('res-energy-cost-arena')?.value       || '15'),
        },
      },
    };
    CWGameState.updateConfig(newCfg);
    _notify('✅ Configuration énergie sauvegardée.');
  }

  function _fillEnergy() {
    const player = CWGameState.getPlayer();
    player.energy.current = player.energy.max;
    player.energy.lastRegen = Date.now();
    CWGameState.updatePlayer(player);
    const inp = document.getElementById('res-energy-current');
    if (inp) inp.value = player.energy.max;
    _notify('⚡ Énergie rechargée au maximum.');
  }

  function _resetStats() {
    if (!confirm('Réinitialiser toutes les statistiques ?')) return;
    const player = CWGameState.getPlayer();
    player.stats = { totalPulls:0, totalBattles:0, totalVictories:0, totalCaptures:0, playtime:0 };
    CWGameState.updatePlayer(player);
    _notify('🗑️ Statistiques réinitialisées.');
    switchTab('resources');
  }

  // ─── ONGLET COMBAT ───────────────────────────────────────────────────────────

  function _renderCombatTab() {
    const state = CWGameState.get();
    const cfg   = state.config;
    const cCfg  = cfg.combat || {};
    const lCfg  = cfg.level  || {};
    const esCfg = (cfg.game || {}).enemyTeamSize;

    // Diagnostic immédiat : calcule le profil de puissance RÉEL de l'équipe actuelle
    // du joueur, pour vérifier concrètement que le rattrapage adaptatif a un effet.
    const diagTeam = (typeof CWGameState.getTeam === 'function') ? CWGameState.getTeam() : [];
    const diagFactor = cCfg.adaptiveScalingFactor ?? 0.6;
    const diagHtml = _buildAdaptiveScalingPreviewHtml(diagTeam, cCfg.enemyStatRatio ?? 0.85, diagFactor);

    const rarityMeta = {
      common:    { label:'Commune',    color:'#9CA3AF' },
      uncommon:  { label:'Peu commune',color:'#34D399' },
      rare:      { label:'Rare',       color:'#60A5FA' },
      epic:      { label:'Épique',     color:'#A78BFA' },
      legendary: { label:'Légendaire', color:'#F59E0B' },
      mythic:    { label:'Mythique',   color:'#F43F5E' },
    };

    const enemyWeights = cCfg.enemyRarityWeights || { common:50, uncommon:30, rare:12, epic:5, legendary:2, mythic:0.5 };
    const totalEnemyWeight = Object.values(enemyWeights).reduce((a,b) => a+b, 0);
    const enemyWeightRows = RARITIES.map(r => {
      const meta   = rarityMeta[r] || { label:r, color:'#fff' };
      const weight = enemyWeights[r] !== undefined ? enemyWeights[r] : 0;
      const pct    = totalEnemyWeight > 0 ? (weight / totalEnemyWeight * 100).toFixed(2) : '0.00';
      return `
        <tr>
          <td style="padding:8px 12px;">
            <span class="badge badge-${r}" style="color:${meta.color}">${meta.label}</span>
          </td>
          <td style="padding:8px 12px; text-align:center;">
            <input type="number" id="enemy-weight-${r}" value="${weight}"
              min="0" max="9999" step="0.1"
              style="width:80px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:5px;text-align:center;font-size:.85rem;"
              oninput="CWAdminPanel._updateEnemyWeightTotal()" />
          </td>
          <td style="padding:8px 12px; text-align:right;">
            <span id="enemy-weight-pct-${r}" style="color:${meta.color};font-family:monospace;font-weight:700;">${pct}%</span>
          </td>
          <td style="padding:8px 12px; width:200px;">
            <div style="background:#1a1a2e;border-radius:4px;height:10px;overflow:hidden;">
              <div id="enemy-weight-bar-${r}" style="height:100%;width:${pct}%;background:${meta.color};transition:width .3s ease;"></div>
            </div>
          </td>
        </tr>`;
    }).join('');

    const xpBonus = cCfg.enemyXpBonusByRarity || { common:0, uncommon:10, rare:25, epic:50, legendary:100, mythic:200 };
    const enemyXpBonusRows = RARITIES.map(r => {
      const meta  = rarityMeta[r] || { label:r, color:'#fff' };
      const bonus = xpBonus[r] !== undefined ? xpBonus[r] : 0;
      return `
        <tr>
          <td style="padding:8px 12px;">
            <span class="badge badge-${r}" style="color:${meta.color}">${meta.label}</span>
          </td>
          <td style="padding:8px 12px; text-align:center;">
            <input type="number" id="enemy-xpbonus-${r}" value="${bonus}"
              min="0" max="2000" step="5"
              style="width:80px;background:#0f3460;border:1px solid #444;color:#fff;border-radius:4px;padding:5px;text-align:center;font-size:.85rem;" />
          </td>
          <td style="padding:8px 12px;">
            <span style="color:${meta.color};font-family:monospace;font-weight:700;">+${bonus}%</span>
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="admin-section">
        <div class="admin-section-title">Formule de dégâts</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:10px;">
          Formule actuelle : <code style="color:#60A5FA;background:#0f3460;padding:2px 6px;border-radius:4px;">ATK² / (ATK + DEF)</code>
          — garantit des dégâts significatifs même face à une haute défense.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Dégâts minimum</label>
            <input type="number" id="combat-min-dmg" value="${cCfg.minDamage}" min="0" />
          </div>
          <div class="admin-field">
            <label>Taux de capture de base (%)</label>
            <input type="number" id="combat-capture-rate" value="${(cCfg.captureBaseRate * 100).toFixed(0)}" min="0" max="100" />
          </div>
          <div class="admin-field">
            <label>XP par ennemi vaincu (× son niveau)</label>
            <input type="number" id="combat-xp-per-enemy" value="${cCfg.rewardXpPerEnemy}" min="0" step="1" />
          </div>
          <div class="admin-field">
            <label>Dollars par ennemi vaincu</label>
            <input type="number" id="combat-gold-per-enemy" value="${cCfg.rewardGoldPerEnemy}" min="0" step="1" />
          </div>
          <div class="admin-field">
            <label>Diamants par ennemi vaincu</label>
            <input type="number" id="combat-diamonds-per-enemy" value="${cCfg.rewardDiamondsPerEnemy}" min="0" step="1" />
          </div>
          <div class="admin-field">
            <label>Plafond esquive vitesse (%)</label>
            <input type="number" id="combat-spd-evasion" value="${(cCfg.speedEvasionCap * 100).toFixed(0)}" min="0" max="100" />
          </div>
        </div>
        <p style="font-size:.75rem; color:#888; margin-top:8px;">
          Aperçu pour 3 ennemis de niveau 10 : ${3 * 10 * cCfg.rewardXpPerEnemy} XP, ${3 * cCfg.rewardGoldPerEnemy} 💵, ${3 * cCfg.rewardDiamondsPerEnemy} 💎
        </p>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">💥 Coups critiques</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Chance de critique = <code style="color:#60A5FA;background:#0f3460;padding:2px 6px;border-radius:4px;">VIT / (VIT + Diviseur)</code>.
          Un diviseur plus bas = plus de critiques. Exemple : VIT 100, diviseur 200 → 33% de crit.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Diviseur de critique</label>
            <input type="number" id="combat-crit-divisor" value="${cCfg.critDivisor ?? 200}" min="1" step="10"
              oninput="CWAdminPanel._previewCritChance()" />
            <span id="crit-preview" style="font-size:.72rem;color:#A78BFA;margin-top:4px;"></span>
          </div>
          <div class="admin-field">
            <label>Multiplicateur critique (×)</label>
            <input type="number" id="combat-crit-mult" value="${cCfg.critMultiplier ?? 1.5}" min="1" step="0.1" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">💫 Score de puissance (Aura)</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Le score Aura d'un personnage est dérivé de la vraie formule de combat
          (dégâts effectifs incluant le taux de critique, et PV effectifs incluant
          la DEF), calculés face à un adversaire fictif de référence défini ici.
          Une valeur basse récompense fortement la progression réelle du personnage.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>DEF de l'adversaire de référence</label>
            <input type="number" id="combat-score-def-ref" value="${cCfg.scoreDefReference ?? 10}" min="1" step="1" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">📊 Mode Performance</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Combat où le joueur inflige un maximum de dégâts à une vague d'ennemis
          passifs (ils n'attaquent jamais) pendant un nombre de tours limité.
          Chaque ennemi vaincu est immédiatement remplacé. Les récompenses ne
          sont plus distribuées automatiquement — le joueur les réclame
          manuellement depuis le totem, palier par palier.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Nombre de tours</label>
            <input type="number" id="record-max-turns" value="${cCfg.recordMaxTurns ?? 15}" min="1" step="1" />
          </div>
          <div class="admin-field">
            <label>Taille de la vague d'ennemis</label>
            <input type="number" id="record-enemy-count" value="${cCfg.recordEnemyCount ?? 3}" min="1" max="6" step="1" />
          </div>
          <div class="admin-field">
            <label>Points bonus par ennemi vaincu</label>
            <input type="number" id="record-kill-bonus" value="${cCfg.recordKillBonus ?? 100}" min="0" step="10" />
          </div>
        </div>
        <div style="font-size:.76rem;color:#7dd3fc;margin:14px 0 6px;">Paliers de score (3 segments à pas croissant)</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Palier 1 — pas</label>
            <input type="number" id="record-tier1-step" value="${cCfg.recordTier1Step ?? 1000}" min="1" step="100" />
          </div>
          <div class="admin-field">
            <label>Palier 1 — jusqu'à</label>
            <input type="number" id="record-tier1-cap" value="${cCfg.recordTier1Cap ?? 20000}" min="1" step="1000" />
          </div>
          <div class="admin-field">
            <label>Palier 2 — pas</label>
            <input type="number" id="record-tier2-step" value="${cCfg.recordTier2Step ?? 2000}" min="1" step="100" />
          </div>
          <div class="admin-field">
            <label>Palier 2 — jusqu'à</label>
            <input type="number" id="record-tier2-cap" value="${cCfg.recordTier2Cap ?? 40000}" min="1" step="1000" />
          </div>
          <div class="admin-field">
            <label>Palier 3 — pas (au-delà, indéfiniment)</label>
            <input type="number" id="record-tier3-step" value="${cCfg.recordTier3Step ?? 5000}" min="1" step="500" />
          </div>
          <div class="admin-field">
            <label>Score max affiché sur le totem</label>
            <input type="number" id="record-totem-max" value="${cCfg.recordTotemMaxScore ?? 100000}" min="1000" step="5000" />
          </div>
        </div>
        <div style="font-size:.76rem;color:#7dd3fc;margin:14px 0 6px;">Récompense par palier réclamé</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>💵 Dollars par palier</label>
            <input type="number" id="record-gold-per-tier" value="${cCfg.recordGoldPerTier ?? 50}" min="0" step="5" />
          </div>
          <div class="admin-field">
            <label>💎 Diamants par palier</label>
            <input type="number" id="record-crystals-per-tier" value="${cCfg.recordCrystalsPerTier ?? 2}" min="0" step="1" />
          </div>
          <div class="admin-field">
            <label>Croissance (1 = plat, &gt;1 = progressif)</label>
            <input type="number" id="record-reward-growth" value="${cCfg.recordRewardGrowth ?? 1}" min="1" max="2" step="0.01" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">⚖️ Équilibrage joueur / ennemi</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Ces multiplicateurs s'appliquent après le calcul de dégâts pour favoriser le joueur structurellement.
          La variance ±5% est fixe et non configurable.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Bonus dégâts joueur → ennemi (×)</label>
            <input type="number" id="combat-player-bonus" value="${cCfg.playerDmgBonus ?? 1.15}" min="1" step="0.05" />
            <span style="font-size:.72rem;color:#4ade80;">Actuel : +${Math.round(((cCfg.playerDmgBonus ?? 1.15) - 1) * 100)}%</span>
          </div>
          <div class="admin-field">
            <label>Pénalité dégâts ennemi → joueur (×)</label>
            <input type="number" id="combat-enemy-penalty" value="${cCfg.enemyDmgPenalty ?? 0.80}" min="0.1" max="1" step="0.05" />
            <span style="font-size:.72rem;color:#f87171;">Actuel : −${Math.round((1 - (cCfg.enemyDmgPenalty ?? 0.80)) * 100)}%</span>
          </div>
          <div class="admin-field">
            <label>Ratio de stats ennemis (×)</label>
            <input type="number" id="combat-enemy-stat-ratio" value="${cCfg.enemyStatRatio ?? 0.85}" min="0.1" max="2" step="0.05" />
            <span style="font-size:.72rem;color:#aaa;">ATK/DEF/VIT ennemis multipliés par ce ratio</span>
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">📈 Équilibrage adaptatif (anti-snowball)</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Compare les stats RÉELLES de l'équipe du joueur (équipement + awakening + évolution
          inclus) à une version "nue" du même personnage à la forme de base de sa lignée, au
          même niveau. L'écart mesuré est reporté sur les ennemis générés (de façon croisée :
          un surplus d'ATK joueur renforce la DEF/PV ennemis ; un surplus de PV/DEF joueur
          renforce l'ATK ennemie). Évite que l'équipe ne devienne increvable après quelques
          équipements ou une évolution.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Intensité du rattrapage (0 = désactivé, 1 = parité totale)</label>
            <input type="number" id="combat-adaptive-scaling" value="${cCfg.adaptiveScalingFactor ?? 0.6}" min="0" max="1" step="0.05"
              oninput="CWAdminPanel._previewAdaptiveScaling()" />
            <span style="font-size:.72rem;color:#aaa;">Valeur recommandée : 0.5 à 0.7 (laisse un avantage au joueur sans rendre les combats triviaux)</span>
          </div>
        </div>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveAdaptiveScaling()">💾 Enregistrer ce réglage</button>
        </div>
        <div id="adaptive-scaling-preview" style="margin-top:12px;font-size:.78rem;background:#0f3460;border-radius:6px;padding:10px 12px;">${diagHtml}</div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Équipe ennemie</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Mode</label>
            <select id="combat-enemy-mode">
              <option value="fixed"  ${esCfg.mode === 'fixed'  ? 'selected' : ''}>Fixe</option>
              <option value="random" ${esCfg.mode === 'random' ? 'selected' : ''}>Aléatoire</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Valeur fixe (mode fixe)</label>
            <input type="number" id="combat-enemy-value" value="${esCfg.value}" min="1" max="10" />
          </div>
          <div class="admin-field">
            <label>Minimum (mode aléatoire)</label>
            <input type="number" id="combat-enemy-min" value="${esCfg.min}" min="1" max="10" />
          </div>
          <div class="admin-field">
            <label>Maximum (mode aléatoire)</label>
            <input type="number" id="combat-enemy-max" value="${esCfg.max}" min="1" max="10" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">🎲 Fréquence d'apparition par rareté (combat aléatoire)</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Poids relatifs déterminant la probabilité qu'un ennemi de cette rareté soit
          tiré au sort lors d'un combat aléatoire. Sans effet sur le combat par lignée
          (qui combat toujours la forme de base de la lignée choisie).
        </p>
        <table style="width:100%; border-collapse:collapse;">
          <tbody>${enemyWeightRows}</tbody>
        </table>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEnemyRarityWeights()">💾 Enregistrer les poids</button>
          <button class="admin-btn admin-btn-primary" onclick="CWAdminPanel._resetEnemyRarityWeights()">↺ Réinitialiser</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">🧬 Fréquence d'apparition des formes évoluées</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          Une forme évoluée n'intègre le pool d'ennemis qu'une fois débloquée par le joueur
          (présente dans son Catalogue). Une fois débloquée, ce facteur réduit son poids de
          sélection à chaque stade d'évolution (stade 1 → ×facteur, stade 2 → ×facteur², etc.).
          S'applique aux combats Aléatoire, Arène, Odyssée <strong>et</strong> par Lignée.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Facteur de réduction par stade (1 = aucune réduction)</label>
            <input type="number" id="evolved-form-weight-factor" value="${cCfg.evolvedFormWeightFactor ?? 0.5}"
              min="0" max="1" step="0.05" oninput="CWAdminPanel._previewEvolvedFormWeight(this.value)" />
          </div>
        </div>
        <p id="evolved-form-weight-preview" style="font-size:.74rem;color:#aaa;margin-top:6px;font-family:var(--font-mono, monospace);">${_buildEvolvedFormWeightPreview(cCfg.evolvedFormWeightFactor ?? 0.5)}</p>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEvolvedFormWeightFactor()">💾 Enregistrer</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">✨ Bonus d'XP selon la rareté de l'ennemi</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px;">
          S'ajoute en plus de l'XP de base (niveau × XP par ennemi vaincu, ci-dessus).
          Un bonus de 50% sur un ennemi Épique de niveau 10 ajoute +50% à l'XP qu'il
          rapporte normalement.
        </p>
        <table style="width:100%; border-collapse:collapse;">
          <tbody>${enemyXpBonusRows}</tbody>
        </table>
        <div class="admin-actions">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEnemyXpBonus()">💾 Enregistrer les bonus XP</button>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">Progression & XP</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>XP de base (formule)</label>
            <input type="number" id="level-xp-base" value="${lCfg.xpBase}" min="1" />
          </div>
          <div class="admin-field">
            <label>Exposant XP</label>
            <input type="number" id="level-xp-expo" value="${lCfg.xpExponent}" min="1" step="0.1" />
          </div>
        </div>
        <p style="font-size:.78rem; color:#888; margin:8px 0;">Croissance des stats par niveau (%)</p>
        <div class="admin-grid">
          <div class="admin-field"><label>PV %</label><input type="number" id="level-grow-hp"  value="${(lCfg.statGrowthPerLevel.hp*100).toFixed(0)}"  min="0" max="100" /></div>
          <div class="admin-field"><label>ATK %</label><input type="number" id="level-grow-atk" value="${(lCfg.statGrowthPerLevel.atk*100).toFixed(0)}" min="0" max="100" /></div>
          <div class="admin-field"><label>DEF %</label><input type="number" id="level-grow-def" value="${(lCfg.statGrowthPerLevel.def*100).toFixed(0)}" min="0" max="100" /></div>
          <div class="admin-field"><label>VIT %</label><input type="number" id="level-grow-spd" value="${(lCfg.statGrowthPerLevel.spd*100).toFixed(0)}" min="0" max="100" /></div>
        </div>
        <p style="font-size:.75rem; color:#888; margin-top:8px;">
          Aperçu XP : Niv.10 = ${CWGameDatabase.xpForLevel(10, lCfg)} | Niv.50 = ${CWGameDatabase.xpForLevel(50, lCfg)} | Niv.100 = ${CWGameDatabase.xpForLevel(100, lCfg)}
        </p>
      </div>
      <hr class="admin-sep" />

      <!-- ── Mode Odyssée ── -->
      <div class="admin-section">
        <div class="admin-section-title">🌍 Mode Odyssée (Tournée)</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:10px">
          Paramètres de la progression par monde. Les élites et boss reçoivent un boost de stats multiplicatif.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Sous-niveaux par monde</label>
            <input type="number" id="story-sublevels" value="${cCfg.story?.subLevelsPerWorld ?? 25}" min="1" max="100" />
          </div>
          <div class="admin-field">
            <label>Sous-niveau Boss</label>
            <input type="number" id="story-boss" value="${cCfg.story?.bossSubLevel ?? 25}" min="1" max="100" />
          </div>
          <div class="admin-field">
            <label>Élite — Sous-niveaux (ex: 10,20)</label>
            <input type="text"   id="story-elites" value="${(cCfg.story?.eliteSubLevels ?? [10,20]).join(',')}" placeholder="10,20" />
          </div>
          <div class="admin-field">
            <label>Élite — Boost stats (%)</label>
            <input type="number" id="story-elite-boost" value="${Math.round((cCfg.story?.eliteStatBoost ?? 0.10) * 100)}" min="0" max="200" />
          </div>
          <div class="admin-field">
            <label>Boss — Boost stats (%)</label>
            <input type="number" id="story-boss-boost" value="${Math.round((cCfg.story?.bossStatBoost ?? 0.25) * 100)}" min="0" max="500" />
          </div>
          <div class="admin-field">
            <label>Boost par monde supplémentaire (%)</label>
            <input type="number" id="story-world-boost" value="${Math.round((cCfg.story?.worldStatBoost ?? 0.10) * 100)}" min="0" max="200" />
          </div>
          <div class="admin-field">
            <label>Bonus or — victoire Élite 💵</label>
            <input type="number" id="story-reward-elite" value="${cCfg.story?.rewardEliteGold ?? 100}" min="0" step="10" />
          </div>
          <div class="admin-field">
            <label>Bonus diamants — victoire Boss 💎</label>
            <input type="number" id="story-reward-boss" value="${cCfg.story?.rewardBossDiamonds ?? 100}" min="0" step="10" />
          </div>
        </div>
      </div>
      <div class="admin-section">
        <div class="admin-section-title">👥 Taille des équipes</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Taille max de l'équipe joueur</label>
            <input type="number" id="game-max-team" value="${cfg.game?.maxTeamSize ?? 3}" min="1" max="10" />
          </div>
          <div class="admin-field">
            <label>Mode taille équipe ennemie</label>
            <select id="game-enemy-mode">
              <option value="fixed"  ${esCfg?.mode==='fixed'  ?'selected':''}>Fixe</option>
              <option value="random" ${esCfg?.mode==='random' ?'selected':''}>Aléatoire</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Taille fixe / Min aléatoire</label>
            <input type="number" id="game-enemy-val" value="${esCfg?.value ?? esCfg?.min ?? 3}" min="1" max="10" />
          </div>
          <div class="admin-field">
            <label>Max aléatoire</label>
            <input type="number" id="game-enemy-max" value="${esCfg?.max ?? 5}" min="1" max="10" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />

      <!-- ── Esquive & Précision ── -->
      <div class="admin-section">
        <div class="admin-section-title">🕊️ Esquive & Précision</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:10px">
          Plafonds de bonus/malus d'esquive et de précision basés sur l'écart de Grace (Agilité).
          La valeur 0.10 signifie ±10% maximum.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Plafond esquive (ratio 0–1)</label>
            <input type="number" id="combat-evasion-cap" value="${cCfg.speedEvasionCap ?? 0.10}" min="0" max="1" step="0.01" />
          </div>
          <div class="admin-field">
            <label>Plafond précision (ratio 0–1)</label>
            <input type="number" id="combat-accuracy-cap" value="${cCfg.speedAccuracyCap ?? 0.10}" min="0" max="1" step="0.01" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />

      <!-- ── Poids formes évoluées ── -->
      <div class="admin-section">
        <div class="admin-section-title">🔄 Fréquence des formes évoluées en combat</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:10px">
          Facteur appliqué au poids d'apparition des formes évoluées dans les combats aléatoires.
          0.5 = chaque stade d'évolution réduit de moitié la chance d'apparition.
          1 = pas de réduction. 0 = formes évoluées jamais ennemies.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Facteur réduction formes évoluées</label>
            <input type="number" id="combat-evolved-factor" value="${cCfg.evolvedFormWeightFactor ?? 0.5}" min="0" max="1" step="0.05" />
          </div>
        </div>
      </div>
      <hr class="admin-sep" />

      <!-- ── Shop Tournant ── -->
      <div class="admin-section">
        <div class="admin-section-title">🔄 Shop Tournant</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:10px">
          Le shop tournant propose 9 articles aléatoires renouvelés quotidiennement.
        </p>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Nombre d'articles rotatifs</label>
            <input type="number" id="shop-rotating-count" value="${cfg.shop?.rotatingCount ?? 9}" min="1" max="30" />
          </div>
        </div>
      </div>

      <!-- ── Bonus Joueur ── -->
      <div class="admin-section">
        <div class="admin-section-title">🌟 Bonus de stats joueur</div>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px">
          Chaque palier atteint ajoute <b style="color:#a78bfa">+1 à toutes les stats</b> de tous les personnages alliés.
          Modifiez le seuil "tous les N" pour chaque compteur.
        </p>
        <div class="admin-grid">
          ${Object.entries(cfg.playerBonus || CWGameDatabase.DEFAULT_CONFIG.playerBonus).map(([key, rule]) => {
            const statVal = {
              battles: state.player.stats?.totalBattles || 0,
              victories: state.player.stats?.totalVictories || 0,
              kills: state.player.stats?.totalKills || 0,
              captures: state.player.stats?.totalCaptures || 0,
              pulls: state.player.stats?.totalPulls || 0,
              evolutions: state.player.stats?.totalEvolutions || 0,
              awakenings: state.player.stats?.totalAwakenings || 0,
              goldEarned: state.player.stats?.totalGoldEarned || 0,
              scoreTotal: CWGameState.getPlayerAuraScoreTotal?.() || 0,
              scoreTeam:  CWGameState.getPlayerAuraScoreTeam?.()  || 0,
              tourneeProgress: CWGameState.getTourneeProgress?.() || 0,
              galleryEntries:  Object.keys(state.player.catalogue || {}).length,
            }[key] || 0;
            const pts = Math.floor(statVal / rule.every);
            return `<div class="admin-field">
              <label>${rule.label}
                <span style="font-size:.68rem;color:#a78bfa;margin-left:4px">(${statVal.toLocaleString('fr-FR')} → +${pts})</span>
              </label>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:.75rem;color:#888">Tous les</span>
                <input type="number" id="pb-${key}" value="${rule.every}" min="1" style="width:80px">
                <span style="font-size:.75rem;color:#888">= +1 stat</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="admin-actions">
        <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveCombatConfig()">💾 Sauver tous les paramètres</button>
      </div>
    `;
  }

  // ─── ONGLET EVENT ────────────────────────────────────────────────────────────

  function _renderEventTab() {
    const state  = CWGameState.get();
    const player = state.player;
    const ev     = player.event || { current: null, next: null };
    const tpl    = state.config?.event || CWGameDatabase.DEFAULT_CONFIG?.event || {};
    const tags   = state.tags || [];
    const now    = Date.now();

    const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('fr-FR', {day:'2-digit',month:'short',year:'numeric'}) : '—';
    const fmtCountdown = ms => {
      if (ms <= 0) return 'Terminé';
      const d = Math.floor(ms / 86400000);
      const h = String(Math.floor((ms%86400000)/3600000)).padStart(2,'0');
      return `${d}j ${h}h`;
    };

    const tagSelect = (id, selectedId) => `
      <select id="${id}" style="flex:1;min-width:120px">
        ${tags.map(t => `<option value="${t.id}" ${t.id===selectedId?'selected':''}>${t.icon||'🏷️'} ${t.name}</option>`).join('')}
      </select>`;

    const QUEST_TYPE_OPTIONS = `
      <option value="event_defeat">⚔️ Éliminer des rivales [Tag]</option>
      <option value="event_capture">🎭 Capturer des rivales [Tag]</option>
      <option value="event_win_caprice">🌟 Réussir des Caprices de Star</option>
      <option value="event_win_tag">✨ Réussir des combats [Tag]</option>
      <option value="event_win_with_tag">🏅 Finir combat avec perso [Tag] vivant</option>
      <option value="event_summon">💎 Rencontrer sur la bannière [Tag]</option>`;

    // ── Statut de l'Event ──
    const cur  = ev.current;
    const curActive = cur?.active && now < (cur?.endDate||0);
    const nxt  = ev.next;
    const timeLeft = curActive ? fmtCountdown(cur.endDate - now) : null;
    const nextIn   = nxt ? fmtCountdown(nxt.startDate - now) : null;

    // Fonction helper : stats du tag (nb persos par rareté)
    const tagStats = (tagId) => {
      if (!tagId) return '';
      const chars = state.characters.filter(c => c.evolutionStage === 0 && c.tags?.includes(tagId));
      if (!chars.length) return `<div style="font-size:.72rem;color:#f87171;margin-top:6px">⚠ Aucun personnage avec ce tag</div>`;
      const RARITY_ORDER = ['mythic','legendary','epic','rare','uncommon','common'];
      const counts = {};
      chars.forEach(c => { counts[c.rarity] = (counts[c.rarity]||0)+1; });
      const pills = RARITY_ORDER.filter(r=>counts[r]).map(r => {
        const rd = CWGameDatabase.RARITIES[r]||{};
        return `<span style="color:${rd.color||'#aaa'};font-size:.7rem;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:8px;border:1px solid ${rd.color||'#444'}44">${counts[r]} ${rd.name||r}</span>`;
      }).join('');
      return `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center">
        <span style="font-size:.68rem;color:#888">👥 ${chars.length} perso${chars.length>1?'s':''} :</span>${pills}
      </div>`;
    };

    const statusHtml = `
      <div class="admin-section" style="margin-bottom:20px">
        <h3 style="color:#a78bfa;margin-bottom:12px">📡 Statut de la rotation</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="background:#1a1630;border-radius:8px;padding:12px;border-left:3px solid ${curActive?'#a78bfa':'#888'}">
            <div style="font-size:.72rem;text-transform:uppercase;color:#888;margin-bottom:4px">Event en cours</div>
            ${curActive ? `
              <div style="font-weight:800;color:#a78bfa;margin-bottom:4px">${tags.find(t=>t.id===cur.tagId)?.name||cur.tagId}</div>
              <div style="font-size:.78rem;color:#aaa">🗓️ ${fmtDate(cur.startDate)} → ${fmtDate(cur.endDate)}</div>
              <div style="font-size:.78rem;color:#f472b6;margin-top:4px">⏳ ${timeLeft} restants</div>
              ${tagStats(cur.tagId)}
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
                <label style="font-size:.75rem;color:#aaa">Tag :</label>
                ${tagSelect('ev-cur-tag', cur.tagId)}
                <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._saveCurrentTag()">✓</button>
                <button class="admin-btn admin-btn-sm" style="background:#2d1f4e;border:1px solid #6d28d9" onclick="CWAdminPanel._randomCurrentTag()" title="Tag aléatoire">🎲</button>
              </div>
              <button class="admin-btn admin-btn-danger admin-btn-sm" style="margin-top:8px" onclick="CWAdminPanel._stopEvent()">⏹ Terminer l'Event</button>` :
              `<div style="color:#888;font-size:.82rem;margin-top:4px">Aucun Event actif</div>
              ${tags.length ? (() => {
                const tpl = state.config?.event || {};
                const dur = tpl.durationDays ?? 10;
                const now = new Date();
                const pad = n => String(n).padStart(2,'0');
                const dateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
                const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
                return `
                  <div class="admin-grid" style="margin-top:8px;margin-bottom:6px">
                    <div class="admin-field">
                      <label>Tag</label>
                      <div style="display:flex;gap:4px">
                        ${tagSelect('ev-start-tag', tags[0]?.id)}
                        <button class="admin-btn admin-btn-sm" style="background:#2d1f4e;border:1px solid #6d28d9;flex-shrink:0" onclick="CWAdminPanel._randomStartTag()" title="Aléatoire">🎲</button>
                      </div>
                    </div>
                    <div class="admin-field">
                      <label>Date de début</label>
                      <input type="date" id="ev-start-date" value="${dateStr}" style="font-size:.8rem">
                    </div>
                    <div class="admin-field">
                      <label>Heure de début</label>
                      <input type="time" id="ev-start-time" value="${timeStr}" style="font-size:.8rem">
                    </div>
                    <div class="admin-field">
                      <label>Durée (jours)</label>
                      <input type="number" id="ev-start-duration" value="${dur}" min="1" max="60" style="font-size:.8rem">
                    </div>
                  </div>
                  <div id="ev-start-tag-stats" style="margin-top:4px;margin-bottom:8px">${tagStats(tags[0]?.id)}</div>
                  <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._forceStartEvent()">▶ Lancer l'Event</button>`;
              })() : '<div style="color:#f87171;font-size:.8rem;margin-top:6px">Créez d\'abord des Tags !</div>'}`}
          </div>
          <div style="background:#1a1630;border-radius:8px;padding:12px;border-left:3px solid #7dd3fc">
            <div style="font-size:.72rem;text-transform:uppercase;color:#888;margin-bottom:4px">Event suivant</div>
            ${nxt ? (() => {
              const startD = new Date(nxt.startDate);
              const pad = n => String(n).padStart(2,'0');
              const dStr = `${startD.getFullYear()}-${pad(startD.getMonth()+1)}-${pad(startD.getDate())}`;
              const tStr = `${pad(startD.getHours())}:${pad(startD.getMinutes())}`;
              const durDays = nxt.endDate && nxt.startDate
                ? Math.round((nxt.endDate - nxt.startDate) / 86400000)
                : (state.config?.event?.durationDays ?? 10);
              return `
              <div style="font-weight:700;color:#7dd3fc;margin-bottom:4px">${tags.find(t=>t.id===nxt.tagId)?.name||nxt.tagId}</div>
              <div style="font-size:.78rem;color:#aaa">📆 Début le ${fmtDate(nxt.startDate)}</div>
              <div style="font-size:.78rem;color:#94a3b8;margin-top:2px">Dans ${nextIn}</div>
              ${tagStats(nxt.tagId)}
              <div class="admin-grid" style="margin-top:8px;margin-bottom:6px">
                <div class="admin-field">
                  <label>Tag</label>
                  <div style="display:flex;gap:4px">
                    ${tagSelect('ev-nxt-tag', nxt.tagId)}
                    <button class="admin-btn admin-btn-sm" style="background:#1e3a5f;border:1px solid #3b82f6;flex-shrink:0" onclick="CWAdminPanel._randomNextTag()" title="Aléatoire">🎲</button>
                  </div>
                </div>
                <div class="admin-field">
                  <label>Date de début</label>
                  <input type="date" id="ev-nxt-edit-date" value="${dStr}" style="font-size:.8rem">
                </div>
                <div class="admin-field">
                  <label>Heure de début</label>
                  <input type="time" id="ev-nxt-edit-time" value="${tStr}" style="font-size:.8rem">
                </div>
                <div class="admin-field">
                  <label>Durée (jours)</label>
                  <input type="number" id="ev-nxt-edit-duration" value="${durDays}" min="1" max="60" style="font-size:.8rem">
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
                <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._saveNextEventEdit()">💾 Enregistrer les modifications</button>
                <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._cancelNextEvent()">❌ Annuler cet Event</button>
              </div>`;
            })() :
              `<div style="color:#94a3b8;font-size:.82rem;margin-bottom:8px">Aucun Event suivant planifié.</div>
              ${tags.length ? (() => {
                const defaultTag = tags.find(t=>t.id!==cur?.tagId)?.id || tags[0]?.id;
                const tpl = state.config?.event || {};
                const dur = tpl.durationDays ?? 10;
                // Date de début par défaut = fin de l'event en cours + breakDays
                const defaultStart = cur
                  ? new Date(cur.endDate + ((tpl.breakDays??4)*86400000 + 60000))
                  : new Date(Date.now() + 86400000);
                const pad = n => String(n).padStart(2,'0');
                const defaultDateStr = `${defaultStart.getFullYear()}-${pad(defaultStart.getMonth()+1)}-${pad(defaultStart.getDate())}`;
                const defaultTimeStr = `${pad(defaultStart.getHours())}:${pad(defaultStart.getMinutes())}`;
                return `
                  <div class="admin-grid" style="margin-bottom:8px">
                    <div class="admin-field">
                      <label>Tag</label>
                      <div style="display:flex;gap:4px">
                        ${tagSelect('ev-nxt-tag-new', defaultTag)}
                        <button class="admin-btn admin-btn-sm" style="background:#1e3a5f;border:1px solid #3b82f6;flex-shrink:0" onclick="CWAdminPanel._randomNextTagNew()" title="Aléatoire">🎲</button>
                      </div>
                    </div>
                    <div class="admin-field">
                      <label>Date de début</label>
                      <input type="date" id="ev-nxt-start-date" value="${defaultDateStr}" style="font-size:.8rem">
                    </div>
                    <div class="admin-field">
                      <label>Heure de début</label>
                      <input type="time" id="ev-nxt-start-time" value="${defaultTimeStr}" style="font-size:.8rem">
                    </div>
                    <div class="admin-field">
                      <label>Durée (jours)</label>
                      <input type="number" id="ev-nxt-duration" value="${dur}" min="1" max="60" style="font-size:.8rem">
                    </div>
                  </div>
                  <div id="ev-nxt-new-stats" style="margin-top:4px;margin-bottom:8px">${tagStats(defaultTag)}</div>
                  <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._planifyNextEvent()">📅 Planifier cet Event</button>`;
              })() : ''}`}
          </div>
        </div>
      </div>`;

    // ── Template global (s'applique à TOUS les Events) ──
    const durHtml = `
      <div class="admin-section" style="margin-bottom:20px">
        <h3 style="color:#a78bfa">⚙️ Paramètres globaux — s'appliquent à tous les Events</h3>
        <p style="font-size:.78rem;color:#888;margin-bottom:12px">
          Modifier ces paramètres met à jour l'Event en cours ET tous les Events futurs. Seul le Tag change à chaque rotation.
        </p>

        <!-- Durée et pause -->
        <div class="admin-subsection-title">⏱️ Rotation automatique</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          <div class="admin-field" style="flex:1;min-width:120px">
            <label>Durée Event (jours)</label>
            <input type="number" id="ev-tpl-duration" min="1" max="30" value="${tpl.durationDays??10}">
          </div>
          <div class="admin-field" style="flex:1;min-width:120px">
            <label>Pause entre Events (jours)</label>
            <input type="number" id="ev-tpl-break" min="0" max="30" value="${tpl.breakDays??4}">
          </div>
          <div class="admin-field" style="flex:1;min-width:100px">
            <label>Réduction boutique (%)</label>
            <input type="number" id="ev-tpl-discount" min="0" max="90" step="5" value="${tpl.shopDiscount??20}">
          </div>
        </div>

        <!-- Taux bannière Event -->
        <details style="margin-bottom:12px">
          <summary style="cursor:pointer;color:#7dd3fc;font-weight:700;font-size:.82rem">💎 Taux de la bannière Event</summary>
          <div style="padding:10px;background:#1a1630;border-radius:6px;margin-top:6px">
            ${['mythic','legendary','epic','rare','uncommon','common'].map(r => {
              const rd = CWGameDatabase.RARITIES[r]||{};
              return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="color:${rd.color||'#aaa'};width:90px;font-size:.8rem">${rd.name||r}</span>
                <input id="ev-tpl-rate-${r}" type="number" step="0.01" min="0" max="100" value="${tpl.bannerRates?.[r]??0}" style="width:75px">
                <span style="font-size:.75rem;color:#888">%</span>
              </div>`;
            }).join('')}
          </div>
        </details>

        <!-- Combats spéciaux -->
        <div class="admin-subsection-title">⚔️ Combats spéciaux Event</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          ${['capriceDeEtoile','combatTag'].map(mode => {
            const mc = tpl.combatConfig?.[mode]||{};
            const label = mode==='capriceDeEtoile' ? '🌟 Caprice de Star' : '✨ Combat [Tag]';
            const color = mode==='capriceDeEtoile' ? '#fcd34d' : '#a78bfa';
            return `<div style="background:#1a1630;border-radius:8px;padding:10px;border-left:3px solid ${color}">
              <div style="font-weight:700;color:${color};margin-bottom:8px;font-size:.85rem">${label}</div>
              ${[['energyCost','Énergie',1,1,50],['difficulty','Difficulté ×',0.1,0.1,5],['xpMult','Mult. XP ×',0.1,0.1,5],['goldMult','Mult. $ ×',0.1,0.1,5],['diamondMult','Mult. 💎 ×',0.1,0.1,5]].map(([f,label,step,min,max])=>`
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                  <label style="font-size:.72rem;color:#aaa;min-width:100px">${label}</label>
                  <input id="ev-tpl-cc-${mode}-${f}" type="number" step="${step}" min="${min}" max="${max}" value="${mc[f]??1}" style="width:65px">
                </div>`).join('')}
            </div>`;
          }).join('')}
        </div>

        <!-- Quêtes -->
        <div class="admin-subsection-title">📋 Quêtes (template commun)</div>
        <div id="ev-tpl-quests">
          ${(tpl.questTemplates||[]).map((q,i) => `
            <div style="background:#1a1630;border-radius:6px;padding:8px;margin-bottom:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <select id="ev-tpl-q${i}-type" style="flex:1;min-width:160px;font-size:.75rem">
                ${QUEST_TYPE_OPTIONS.replace(`value="${q.type}"`,`value="${q.type}" selected`)}
              </select>
              <span style="font-size:.72rem;color:#888">×</span>
              <input id="ev-tpl-q${i}-target" type="number" min="1" value="${q.target}" style="width:55px">
              <select id="ev-tpl-q${i}-rtype" style="width:110px;font-size:.75rem">
                <option value="crystals" ${q.reward?.type==='crystals'?'selected':''}>💎 Diamants</option>
                <option value="gold"     ${q.reward?.type==='gold'    ?'selected':''}>💵 Or</option>
              </select>
              <input id="ev-tpl-q${i}-ramount" type="number" min="1" value="${q.reward?.amount||100}" style="width:65px">
              <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._deleteEventTplQuest(${i})">✕</button>
            </div>`).join('')}
        </div>
        <button class="admin-btn admin-btn-success admin-btn-sm" style="margin-top:6px" onclick="CWAdminPanel._addEventTplQuest()">+ Ajouter une quête</button>

        <!-- Cycle de connexion Event -->
        <div class="admin-subsection-title" style="margin-top:14px">🗓️ Cycle de connexion (10 jours)</div>
        <div id="ev-tpl-cycle">
          ${(tpl.loginCycle?.rewards||[]).map((r,i) => {
            const day = r.day||i+1;
            const isLast = i === (tpl.loginCycle?.rewards?.length||10)-1;
            const chars  = (state.characters||[]).filter(c=>c.evolutionStage===0);
            return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;padding:3px 6px;background:${isLast?'rgba(251,191,36,.05)':'transparent'};border-radius:4px">
              <span style="font-size:.75rem;color:${isLast?'#fcd34d':'#aaa'};min-width:30px">J${day}${isLast?' ⭐':''}</span>
              <select id="ev-tpl-day${day}-type" style="width:110px;font-size:.72rem" onchange="CWAdminPanel._onTplDayTypeChange(${day})">
                <option value="gold"      ${r.reward?.type==='gold'     ?'selected':''}>💵 Or</option>
                <option value="crystals"  ${r.reward?.type==='crystals' ?'selected':''}>💎 Diamants</option>
                <option value="character" ${r.reward?.type==='character'?'selected':''}>🎭 Personnage</option>
              </select>
              <input id="ev-tpl-day${day}-amount" type="number" min="1" value="${r.reward?.amount||1}" style="width:60px;font-size:.72rem">
              <span id="ev-tpl-day${day}-charwrap" style="display:${r.reward?.type==='character'?'flex':'none'}">
                <select id="ev-tpl-day${day}-charId" style="font-size:.72rem;min-width:130px">
                  <option value="">— Perso épique du Tag (auto) —</option>
                  ${chars.map(c=>{const rd=CWGameDatabase.RARITIES[c.rarity]||{};return `<option value="${c.id}" ${c.id===r.reward?.refId?'selected':''}>${c.name} (${rd.name||c.rarity})</option>`;}).join('')}
                </select>
              </span>
            </div>`;
          }).join('')}
        </div>

        <!-- Bouton de sauvegarde global -->
        <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveEventTemplate()">💾 Sauvegarder le template</button>
          <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._resetEventTemplate()">↺ Réinitialiser aux valeurs par défaut</button>
        </div>
      </div>`;

    return `<div class="admin-form">${statusHtml}${durHtml}</div>`;
  }

  function _onTplDayTypeChange(day) {
    const wrap = document.getElementById(`ev-tpl-day${day}-charwrap`);
    const type = document.getElementById(`ev-tpl-day${day}-type`)?.value;
    if (wrap) wrap.style.display = type === 'character' ? 'flex' : 'none';
  }

  function _saveEventTemplate() {
    const state = CWGameState.get();
    if (!state.config.event) state.config.event = {};
    const tpl = state.config.event;

    tpl.durationDays = parseInt(document.getElementById('ev-tpl-duration')?.value) || 10;
    tpl.breakDays    = parseInt(document.getElementById('ev-tpl-break')?.value)    || 4;
    tpl.shopDiscount = parseInt(document.getElementById('ev-tpl-discount')?.value) || 20;

    // Taux bannière
    const rates = {};
    ['mythic','legendary','epic','rare','uncommon','common'].forEach(r => {
      const el = document.getElementById(`ev-tpl-rate-${r}`);
      if (el) rates[r] = parseFloat(el.value)||0;
    });
    tpl.bannerRates = rates;

    // Combats
    tpl.combatConfig = {};
    ['capriceDeEtoile','combatTag'].forEach(mode => {
      tpl.combatConfig[mode] = {};
      ['energyCost','difficulty','xpMult','goldMult','diamondMult'].forEach(f => {
        const el = document.getElementById(`ev-tpl-cc-${mode}-${f}`);
        if (el) tpl.combatConfig[mode][f] = parseFloat(el.value)||1;
      });
    });

    // Quêtes
    const quests = (tpl.questTemplates||[]).map((q,i) => ({
      type:   document.getElementById(`ev-tpl-q${i}-type`)?.value   || q.type,
      target: parseInt(document.getElementById(`ev-tpl-q${i}-target`)?.value) || q.target,
      reward: {
        type:   document.getElementById(`ev-tpl-q${i}-rtype`)?.value  || q.reward?.type  || 'crystals',
        amount: parseInt(document.getElementById(`ev-tpl-q${i}-ramount`)?.value) || q.reward?.amount || 100,
      },
    }));
    tpl.questTemplates = quests;

    // Cycle de connexion
    const existingRewards = tpl.loginCycle?.rewards || [];
    const rewards = existingRewards.map(r => {
      const day  = r.day;
      const type = document.getElementById(`ev-tpl-day${day}-type`)?.value || r.reward?.type;
      const amt  = parseInt(document.getElementById(`ev-tpl-day${day}-amount`)?.value) || r.reward?.amount || 0;
      const charId = type === 'character'
        ? (document.getElementById(`ev-tpl-day${day}-charId`)?.value || null)
        : null;
      const reward = { type, amount: amt };
      if (charId) reward.refId = charId;
      return { day, reward };
    });
    if (!tpl.loginCycle) tpl.loginCycle = { name: 'Rituel Event', length: 10, loop: false };
    tpl.loginCycle.rewards = rewards;

    // Sauvegarder via setEventConfig qui propage à l'event en cours
    CWGameState.setEventConfig({
      shopDiscount:   tpl.shopDiscount,
      bannerRates:    tpl.bannerRates,
      combatConfig:   tpl.combatConfig,
      questTemplates: tpl.questTemplates,
      loginCycle:     tpl.loginCycle,
      durationDays:   tpl.durationDays,
      breakDays:      tpl.breakDays,
    });

    _notify('✅ Template Event sauvegardé et appliqué à l\'Event en cours.');
    switchTab('event');
  }

  function _resetEventTemplate() {
    if (!confirm('Réinitialiser le template aux valeurs par défaut ?')) return;
    CWGameState.setEventConfig(JSON.parse(JSON.stringify(CWGameDatabase.DEFAULT_CONFIG.event)));
    _notify('✅ Template réinitialisé.');
    switchTab('event');
  }

  function _addEventTplQuest() {
    const state = CWGameState.get();
    if (!state.config.event) state.config.event = {};
    if (!state.config.event.questTemplates) state.config.event.questTemplates = [];
    state.config.event.questTemplates.push({ type:'event_defeat', target:10, reward:{type:'crystals',amount:200} });
    CWGameState.setEventConfig({ questTemplates: state.config.event.questTemplates });
    switchTab('event');
  }

  function _deleteEventTplQuest(i) {
    const state = CWGameState.get();
    if (!state.config.event?.questTemplates) return;
    state.config.event.questTemplates.splice(i, 1);
    CWGameState.setEventConfig({ questTemplates: state.config.event.questTemplates });
    switchTab('event');
  }

  function _saveCurrentTag() {
    const tagId = document.getElementById('ev-cur-tag')?.value;
    if (tagId) CWGameState.setCurrentEventTag(tagId);
    _notify('✅ Tag mis à jour.'); switchTab('event');
  }

  function _saveNextTag() {
    const tagId = document.getElementById('ev-nxt-tag')?.value;
    if (tagId) CWGameState.setNextEventTag(tagId);
    _notify('✅ Tag Event suivant mis à jour.'); switchTab('event');
  }

  /** Enregistre les modifications (tag/date/heure/durée) d'un event suivant déjà planifié */
  function _saveNextEventEdit() {
    const tagId    = document.getElementById('ev-nxt-tag')?.value;
    const dateStr  = document.getElementById('ev-nxt-edit-date')?.value;
    const timeStr  = document.getElementById('ev-nxt-edit-time')?.value || '00:00';
    const duration = parseInt(document.getElementById('ev-nxt-edit-duration')?.value) || null;
    if (!tagId) { alert('Sélectionne un Tag.'); return; }
    if (!dateStr) { alert('Sélectionne une date.'); return; }

    const startDate = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(startDate.getTime())) { alert('Date invalide.'); return; }

    CWGameState.planifyNextEvent(tagId, startDate, duration);
    _notify('✅ Event suivant modifié.');
    switchTab('event');
  }

  /** Annule l'event suivant planifié */
  function _cancelNextEvent() {
    if (!confirm('Annuler cet Event planifié ? Il faudra le reprogrammer entièrement si tu changes d\'avis.')) return;
    CWGameState.cancelNextEvent();
    _notify('❌ Event suivant annulé.');
    switchTab('event');
  }

  function _planifyNextEvent() {
    const tagId    = document.getElementById('ev-nxt-tag-new')?.value;
    if (!tagId) { alert('Sélectionne un Tag.'); return; }

    const dateStr  = document.getElementById('ev-nxt-start-date')?.value;
    const timeStr  = document.getElementById('ev-nxt-start-time')?.value || '00:00';
    const duration = parseInt(document.getElementById('ev-nxt-duration')?.value) || null;

    let startDate;
    if (dateStr) {
      startDate = new Date(`${dateStr}T${timeStr}:00`);
      if (isNaN(startDate.getTime())) { alert('Date invalide.'); return; }
    } else {
      // Fallback : date automatique selon breakDays
      const ev  = CWGameState.get().player.event;
      const tpl = CWGameState.getConfig()?.event || {};
      const afterEnd = ev?.current ? new Date(ev.current.endDate + 60000) : new Date();
      afterEnd.setDate(afterEnd.getDate() + (tpl.breakDays ?? 4));
      afterEnd.setHours(0, 0, 0, 0);
      startDate = afterEnd;
    }

    CWGameState.planifyNextEvent(tagId, startDate, duration);
    _notify(`📅 Event suivant planifié — début le ${startDate.toLocaleDateString('fr-FR')} à ${startDate.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'})}.`);
    switchTab('event');
  }

  function _randomNextTagNew() {
    const tags = CWGameState.get().tags || [];
    const cur  = CWGameState.get().player.event?.current;
    const other = tags.filter(t => t.id !== cur?.tagId);
    const pick  = other.length ? other[Math.floor(Math.random()*other.length)] : tags[0];
    if (!pick) return;
    const el = document.getElementById('ev-nxt-tag-new');
    if (el) {
      el.value = pick.id;
      const statsEl = document.getElementById('ev-nxt-new-stats');
      if (statsEl) {
        const chars = CWGameState.get().characters.filter(c => c.evolutionStage===0 && c.tags?.includes(pick.id));
        const RARITY_ORDER = ['mythic','legendary','epic','rare','uncommon','common'];
        const counts = {};
        chars.forEach(c => { counts[c.rarity] = (counts[c.rarity]||0)+1; });
        const pills = RARITY_ORDER.filter(r=>counts[r]).map(r => {
          const rd = CWGameDatabase.RARITIES[r]||{};
          return `<span style="color:${rd.color||'#aaa'};font-size:.7rem;background:rgba(255,255,255,.05);padding:2px 6px;border-radius:8px;border:1px solid ${rd.color||'#444'}44">${counts[r]} ${rd.name||r}</span>`;
        }).join('');
        statsEl.innerHTML = `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center"><span style="font-size:.68rem;color:#888">👥 ${chars.length} perso${chars.length>1?'s':''} :</span>${pills}</div>`;
      }
    }
  }

  function _randomCurrentTag() {
    const tags  = CWGameState.get().tags || [];
    const cur   = CWGameState.get().player.event?.current;
    const other = tags.filter(t => t.id !== cur?.tagId);
    const pick  = other.length ? other[Math.floor(Math.random()*other.length)] : tags[0];
    if (!pick) return;
    CWGameState.setCurrentEventTag(pick.id);
    _notify(`🎲 Tag aléatoire sélectionné : ${pick.name}`);
    switchTab('event');
  }

  function _randomNextTag() {
    const tags  = CWGameState.get().tags || [];
    const nxt   = CWGameState.get().player.event?.next;
    const other = tags.filter(t => t.id !== nxt?.tagId);
    const pick  = other.length ? other[Math.floor(Math.random()*other.length)] : tags[0];
    if (!pick) return;
    CWGameState.setNextEventTag(pick.id);
    _notify(`🎲 Tag aléatoire sélectionné : ${pick.name}`);
    switchTab('event');
  }

  function _randomStartTag() {
    const tags = CWGameState.get().tags || [];
    const pick = tags[Math.floor(Math.random()*tags.length)];
    if (!pick) return;
    const el = document.getElementById('ev-start-tag');
    if (el) el.value = pick.id;
    _notify(`🎲 ${pick.name} sélectionné — clique sur ▶ Lancer pour démarrer.`);
  }

  function _forceStartEvent() {
    const tags  = CWGameState.get().tags || [];
    const tagId = document.getElementById('ev-start-tag')?.value
      || (tags.length ? tags[Math.floor(Math.random()*tags.length)].id : null);
    if (!tagId) { alert('Aucun tag défini !'); return; }

    const tpl  = CWGameState.getConfig().event || CWGameDatabase.DEFAULT_CONFIG.event;

    // Date/heure de début custom (ou maintenant par défaut)
    const dateStr = document.getElementById('ev-start-date')?.value;
    const timeStr = document.getElementById('ev-start-time')?.value || '00:00';
    let startDate;
    if (dateStr) {
      startDate = new Date(`${dateStr}T${timeStr}:00`);
      if (isNaN(startDate.getTime())) startDate = new Date();
    } else {
      startDate = new Date();
    }

    // Durée custom
    const customDur = parseInt(document.getElementById('ev-start-duration')?.value);
    const dur = (isNaN(customDur) ? (tpl.durationDays ?? 10) : customDur) - 1;
    const end = new Date(startDate); end.setDate(end.getDate() + dur); end.setHours(23,59,59,999);

    const epicChar = CWGameState.get().characters.find(c =>
      c.evolutionStage===0 && c.rarity==='epic' && c.tags?.includes(tagId)
    ) || null;
    const cycleTpl = tpl.loginCycle || CWGameDatabase.DEFAULT_CONFIG.event.loginCycle;
    const loginCycle = JSON.parse(JSON.stringify(cycleTpl));
    loginCycle.id = `ev_login_${tagId}_${Date.now()}`; loginCycle.enabled = true;
    const lastR = loginCycle.rewards[loginCycle.rewards.length-1];
    if (lastR?.reward?.type==='character' && epicChar) lastR.reward.refId = epicChar.id;

    const evObj = {
      tagId, startDate: startDate.getTime(), endDate: end.getTime(),
      shopDiscount:  tpl.shopDiscount  ?? 20,
      bannerRates:   JSON.parse(JSON.stringify(tpl.bannerRates   || {})),
      bannerBoost:   tpl.bannerBoost   ?? 2.0,
      questConfig:   { quests: JSON.parse(JSON.stringify(tpl.questTemplates || [])) },
      combatConfig:  JSON.parse(JSON.stringify(tpl.combatConfig  || {})),
      loginCycles:   [loginCycle],
      active: true, questProgress: {}, questClaimed: {},
    };
    const ev = CWGameState.get().player.event || { current: null, next: null };
    ev.current = evObj;
    CWGameState.get().player.event = ev;
    CWGameState.setEventConfig({ applyToCurrent: false });
    const pad = n => String(n).padStart(2,'0');
    _notify(`✅ Event démarré — ${startDate.toLocaleDateString('fr-FR')} ${pad(startDate.getHours())}:${pad(startDate.getMinutes())} → ${end.toLocaleDateString('fr-FR')}`);
    switchTab('event');
  }

  function _stopEvent() {
    if (!confirm('Terminer l\'Event en cours ?')) return;
    const ev = CWGameState.get().player.event;
    if (ev?.current) {
      ev.current.active = false;
      CWGameState.setEventConfig({ applyToCurrent: false });
    }
    _notify('Event terminé.');
    switchTab('event');
  }

  // Associe chaque clé de stockage audio au champ de config qui retient son nom de fichier
  const AUDIO_FIELD_MAP = {
    global: 'globalMusicName',
    combat: 'combatMusicName',
    sfx_hit_normal: 'sfxHitNormalName',
    sfx_hit_resist: 'sfxHitResistName',
    sfx_hit_weak:   'sfxHitWeakName',
    sfx_victory:    'sfxVictoryName',
    sfx_defeat:     'sfxDefeatName',
    sfx_levelup:    'sfxLevelUpName',
    sfx_evolution:  'sfxEvolutionName',
    sfx_gacha_pull: 'sfxGachaPullName',
  };

  // ─── ONGLET TUTORIEL ─────────────────────────────────────────────────────────

  function _renderTutorialTab() {
    const state   = CWGameState.get();
    const tplData = state.config.tutorial || _defaultTutorial();
    const steps   = tplData.steps || [];
    const player  = state.player;
    const tutDone = player.tutorialDone || false;

    const stepTypes = {
      lore:     '🌟 Lore / Introduction',
      name:     '✏️ Choix du nom',
      currency: '💰 Récompense (ressources)',
      reward:   '🎁 Récompense (persos)',
      combat:   '⚔️ Explication combat',
      free:     '🎮 Fin — jeu libre',
    };

    const stepsHtml = steps.map((s, i) => `
      <div class="admin-section" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <span style="font-family:var(--font-mono);font-size:.75rem;color:#a78bfa;min-width:24px">#${i+1}</span>
          <select id="tuto-step-${i}-type" style="font-size:.78rem">
            ${Object.entries(stepTypes).map(([k,v])=>`<option value="${k}" ${s.type===k?'selected':''}>${v}</option>`).join('')}
          </select>
          <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._deleteTutoStep(${i})">✕</button>
          ${i > 0 ? `<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._moveTutoStep(${i},-1)">↑</button>` : ''}
          ${i < steps.length-1 ? `<button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="CWAdminPanel._moveTutoStep(${i},1)">↓</button>` : ''}
        </div>
        <div class="admin-field">
          <label>Titre</label>
          <input type="text" id="tuto-step-${i}-title" value="${s.title||''}" placeholder="Ex : Bienvenue dans le Nexus Glamour">
        </div>
        <div class="admin-field">
          <label>Texte principal</label>
          <textarea id="tuto-step-${i}-text" rows="3" style="width:100%;resize:vertical">${s.text||''}</textarea>
        </div>
        ${s.type === 'currency' ? `
        <div class="admin-field">
          <label>💎 Diamants offerts</label>
          <input type="number" id="tuto-step-${i}-crystals" value="${s.crystals??500}" min="0" style="width:100px">
        </div>
        <div class="admin-field">
          <label>💵 Dollars offerts</label>
          <input type="number" id="tuto-step-${i}-gold" value="${s.gold??500}" min="0" style="width:100px">
        </div>` : ''}
        ${s.type === 'reward' ? `
        <div class="admin-field">
          <label>Récompenses de bienvenue</label>
          <p style="font-size:.75rem;color:#888;margin:0 0 4px">2 persos Communs + 1 perso Rare tirés aléatoirement.</p>
          <label style="font-size:.75rem;display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="tuto-reward-random-${i}" ${s.randomReward!==false?'checked':''}>
            Sélection aléatoire (recommandé)
          </label>
        </div>` : ''}
        ${s.type === 'combat' ? `
        <div class="admin-field">
          <label>Texte affiché AVANT la première attaque (par-dessus le combat)</label>
          <textarea id="tuto-step-${i}-pre" rows="2" style="width:100%;resize:vertical">${s.preCombatText||''}</textarea>
        </div>
        <div class="admin-field">
          <label>Texte post-combat (après victoire/défaite)</label>
          <textarea id="tuto-step-${i}-post" rows="2" style="width:100%;resize:vertical">${s.postCombatText||''}</textarea>
        </div>` : ''}
      </div>`).join('');

    return `<div class="admin-form">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0;color:#a78bfa;font-family:var(--font-display)">🎓 Tutoriel de démarrage</h2>
          <p style="margin:4px 0 0;font-size:.78rem;color:#888">
            Se déclenche à la première ouverture.
            Statut : <span style="color:${tutDone?'#4ade80':'#f59e0b'}">${tutDone?'✓ Complété':'⏳ Jamais joué'}</span>
          </p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="admin-btn admin-btn-secondary" onclick="CWAdminPanel._resetTutorial()">🔄 Rejouer</button>
          <button class="admin-btn admin-btn-secondary" onclick="CWAdminPanel._resetTutorialContent()">↺ Contenu par défaut</button>
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveTutorial()">💾 Sauvegarder</button>
        </div>
      </div>

      <div class="admin-section" style="margin-bottom:16px">
        <div class="admin-section-title">⚙️ Paramètres globaux</div>
        <div class="admin-grid">
          <div class="admin-field">
            <label>Nom de la narratrice</label>
            <input type="text" id="tuto-narrator-name" value="${tplData.narratorName||'La Directrice'}" placeholder="La Directrice">
          </div>
          <div class="admin-field">
            <label>Portrait narratrice (URL)</label>
            <input type="text" id="tuto-narrator-portrait" value="${tplData.narratorPortrait||''}" placeholder="URL">
          </div>
          <div class="admin-field" style="grid-column:1/-1">
            <label>Message de bienvenue (avant le tuto)</label>
            <textarea id="tuto-welcome" rows="2" style="width:100%;resize:vertical">${tplData.welcomeMessage||''}</textarea>
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="admin-section-title" style="margin:0">📋 Étapes (${steps.length})</div>
        <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._addTutoStep()">+ Ajouter</button>
      </div>
      <div id="tuto-steps-container">
        ${stepsHtml || '<p style="color:#888;font-size:.82rem">Aucune étape configurée.</p>'}
      </div>
    </div>`;
  }

  function _defaultTutorial() {
    return {
      narratorName: 'La Directrice',
      narratorPortrait: '',
      welcomeMessage: 'Bienvenue dans le Nexus Glamour, un espace hors du temps où les actrices les plus éblouissantes de toutes les époques se sont retrouvées...',
      steps: [
        { type:'lore',   title:'Le Nexus Glamour',   text:"Une faille temporelle a brisé les frontières entre les époques. Des actrices, idoles et personnalités de tous les temps se retrouvent désormais dans le même espace : le Nexus Glamour. Vous êtes la Directrice de Casting — seule capable de les rassembler et de stabiliser ce monde fragile." },
        { type:'name',     title:'Qui êtes-vous ?',       text:"Avant de commencer votre mission, comment souhaitez-vous être appelée ?" },
        { type:'currency', title:'Ressources de démarrage', text:"Pour vous lancer dans l'aventure, le Nexus vous offre quelques ressources. Elles vous permettront vos premières invocations.", crystals:500, gold:500 },
        { type:'reward',   title:'Vos premières actrices',  text:"Trois actrices ont répondu à votre appel. Elles seront vos compagnes pour débuter cette aventure.", randomReward:true },
        { type:'combat', title:'Premier combat', text:"Le Nexus est instable — des actrices rivales cherchent à perturber l'équilibre. Apprenez à vous battre !", preCombatText:"Voici comment fonctionne le combat : chaque actrice agit selon sa Grace. Cliquez sur une attaque pour lancer votre action !", postCombatText:"Excellent ! Vous avez le sens du spectacle. Maintenant, le Nexus tout entier vous attend..." },
        { type:'free',   title:"L'aventure commence", text:"Le Nexus Glamour est vaste, et des dizaines d'actrices n'attendent que vous. Bonne chance, Directrice." },
      ],
    };
  }

  function _addTutoStep() {
    _saveTutorial(true);
    const state = CWGameState.get();
    if (!state.config.tutorial) state.config.tutorial = _defaultTutorial();
    state.config.tutorial.steps.push({ type:'lore', title:'Nouvelle étape', text:'' });
    CWGameState.updateConfig({ tutorial: state.config.tutorial });
    switchTab('tutorial');
  }

  function _deleteTutoStep(i) {
    _saveTutorial(true);
    const state = CWGameState.get();
    state.config.tutorial.steps.splice(i, 1);
    CWGameState.updateConfig({ tutorial: state.config.tutorial });
    switchTab('tutorial');
  }

  function _moveTutoStep(i, dir) {
    _saveTutorial(true);
    const state = CWGameState.get();
    const steps = state.config.tutorial.steps;
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    CWGameState.updateConfig({ tutorial: state.config.tutorial });
    switchTab('tutorial');
  }

  function _saveTutorial(silent) {
    const state = CWGameState.get();
    if (!state.config.tutorial) state.config.tutorial = _defaultTutorial();
    const tpl   = state.config.tutorial;
    const steps = tpl.steps || [];

    // Lire TOUS les champs AVANT tout rechargement d'onglet
    tpl.narratorName     = document.getElementById('tuto-narrator-name')?.value     || 'La Directrice';
    tpl.narratorPortrait = document.getElementById('tuto-narrator-portrait')?.value || '';
    tpl.welcomeMessage   = document.getElementById('tuto-welcome')?.value           || '';

    steps.forEach((s, i) => {
      s.type  = document.getElementById(`tuto-step-${i}-type`)?.value  || s.type;
      s.title = document.getElementById(`tuto-step-${i}-title`)?.value || s.title || '';
      s.text  = document.getElementById(`tuto-step-${i}-text`)?.value  ?? s.text ?? '';
      if (s.type === 'currency') {
        s.crystals = parseInt(document.getElementById(`tuto-step-${i}-crystals`)?.value) || 0;
        s.gold     = parseInt(document.getElementById(`tuto-step-${i}-gold`)?.value)     || 0;
      }
      if (s.type === 'reward')  s.randomReward   = document.getElementById(`tuto-reward-random-${i}`)?.checked !== false;
      if (s.type === 'combat') {
        s.preCombatText  = document.getElementById(`tuto-step-${i}-pre`)?.value  ?? s.preCombatText  ?? '';
        s.postCombatText = document.getElementById(`tuto-step-${i}-post`)?.value ?? s.postCombatText ?? '';
      }
    });

    // Sauvegarder dans state ET dans le localStorage via updateConfig
    state.config.tutorial = tpl;
    CWGameState.updateConfig({ tutorial: tpl });

    if (!silent) { _notify('Tutoriel sauvegardé.'); switchTab('tutorial'); }
  }

  function _resetTutorialContent() {
    if (!confirm('Remplacer le contenu du tutoriel par les valeurs par défaut ? Les étapes actuelles seront perdues.')) return;
    CWGameState.updateConfig({ tutorial: _defaultTutorial() });
    _notify('✅ Contenu du tutoriel réinitialisé.');
    switchTab('tutorial');
  }

  function _resetTutorial() {
    if (!confirm('Remettre le tutoriel à "non joué" ?')) return;
    CWGameState.updatePlayer({ tutorialDone: false, tutorialStep: 0 });
    _notify('Tutoriel réinitialisé.');
    switchTab('tutorial');
  }

  // ─── ONGLET MODE HISTOIRE ─────────────────────────────────────────────────────

  function _renderStoryTab() {
    const state    = CWGameState.get();
    const sm       = state.config.storyMode || _defaultStoryMode();
    const chapters = sm.chapters || [];

    // Config par défaut des stages pour un chapitre donné
    const defaultStageConfig = (ci) => {
      const base = ci * 5; // niveau de base augmente par chapitre
      return {
        1:  { enemies: 2, level: Math.max(1, base + 1) },
        2:  { enemies: 2, level: Math.max(1, base + 1) },
        3:  { enemies: 2, level: Math.max(1, base + 1) },
        4:  { enemies: 3, level: Math.max(1, base + 2) },
        5:  { enemies: 3, level: Math.max(1, base + 2) },
        6:  { enemies: 3, level: Math.max(1, base + 2) },
        7:  { enemies: 2, level: Math.max(1, base + 3) },
        8:  { enemies: 2, level: Math.max(1, base + 3) },
        9:  { enemies: 2, level: Math.max(1, base + 3) },
        10: { enemies: 1, level: Math.max(1, base + 5) },
      };
    };

    return `<div class="admin-form">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0;color:#7dd3fc;font-family:var(--font-display)">📖 Mode Histoire</h2>
          <p style="margin:4px 0 0;font-size:.78rem;color:#888">
            10 niveaux par chapitre. Dialogues aux étapes <b>1 · 5 · 8 · 10</b>.
            Configurez le nombre et le niveau des ennemis pour chaque stage.
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._addStoryChapter()">+ Chapitre</button>
          <button class="admin-btn admin-btn-success" onclick="CWAdminPanel._saveStoryMode()">💾 Sauvegarder</button>
        </div>
      </div>

      ${chapters.length ? chapters.map((ch, ci) => {
        const defCfg = defaultStageConfig(ci);
        const stages = ch.stages || {};
        return `
        <details class="admin-section" style="margin-bottom:12px" ${ci===chapters.length-1?'open':''}>
          <summary style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:4px 0;list-style:none">
            <span style="color:#7dd3fc;font-weight:700;min-width:90px">Chapitre ${ci+1}</span>
            <input type="text" id="story-ch-${ci}-title" value="${ch.title||''}"
              placeholder="Titre..." style="flex:1;font-size:.82rem" onclick="event.stopPropagation()">
            <button class="admin-btn admin-btn-danger admin-btn-sm"
              onclick="event.stopPropagation();CWAdminPanel._deleteStoryChapter(${ci})">✕</button>
          </summary>
          <div style="padding:10px 0 0">
            <div class="admin-grid" style="margin-bottom:12px">
              <div class="admin-field">
                <label>Synopsis (référence interne)</label>
                <textarea id="story-ch-${ci}-synopsis" rows="2" style="width:100%;resize:vertical">${ch.synopsis||''}</textarea>
              </div>
              <div class="admin-field">
                <label>Note de difficulté</label>
                <input type="text" id="story-ch-${ci}-difficulty" value="${ch.difficultyNote||''}" placeholder="Ex : Niv.1-10">
              </div>
            </div>

            <!-- Config des 10 stages -->
            <div style="font-size:.75rem;font-weight:800;color:#7dd3fc;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">
              ⚔️ Configuration des stages
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:14px">
              ${Array.from({length:10},(_,i)=>{
                const s = i+1;
                const cfg = stages[s] || defCfg[s] || { enemies:2, level:1 };
                const isNarr = [1,5,8,10].includes(s);
                const narrColor = isNarr ? 'border:1px solid rgba(167,139,250,.4);background:rgba(109,40,217,.1)' : '';
                return `<div style="border-radius:8px;padding:6px;background:rgba(255,255,255,.03);${narrColor}">
                  <div style="font-size:.7rem;font-weight:800;color:${isNarr?'#a78bfa':'#7dd3fc'};text-align:center;margin-bottom:4px">
                    ${isNarr?'📖 ':''} Stage ${s}
                  </div>
                  <div style="display:flex;flex-direction:column;gap:3px">
                    <label style="font-size:.6rem;color:#888">Ennemis</label>
                    <select id="story-ch-${ci}-stage-${s}-enemies" style="font-size:.7rem;padding:2px">
                      <option value="1" ${cfg.enemies===1?'selected':''}>1</option>
                      <option value="2" ${cfg.enemies===2?'selected':''}>2</option>
                      <option value="3" ${cfg.enemies===3?'selected':''}>3</option>
                    </select>
                    <label style="font-size:.6rem;color:#888">Niveau</label>
                    <input type="number" id="story-ch-${ci}-stage-${s}-level"
                      value="${cfg.level}" min="1" max="100"
                      style="font-size:.7rem;padding:2px;width:100%">
                  </div>
                </div>`;
              }).join('')}
            </div>

            <!-- Dialogues narratifs -->
            <div style="font-size:.75rem;font-weight:800;color:#94a3b8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">
              💬 Dialogues narratifs
            </div>
            ${[1,5,8,10].map(stage => {
              const d = (ch.dialogues||{})[stage] || {};
              const stageLabel = stage===1?'🌅 Stage 1 — Découverte':stage===5?'🌀 Stage 5 — Questionnement':stage===8?'⚡ Stage 8 — Compréhension':'🏁 Stage 10 — Résolution';
              const stageColor = stage===1?'#4ade80':stage===5?'#7dd3fc':stage===8?'#f59e0b':'#a78bfa';
              return `<div style="background:#1a1630;border-radius:8px;padding:10px 12px;margin-bottom:8px;border-left:3px solid ${stageColor}">
                <div style="font-size:.75rem;font-weight:800;color:${stageColor};margin-bottom:8px">${stageLabel}</div>
                <div class="admin-grid" style="gap:8px;margin-bottom:6px">
                  <div class="admin-field" style="margin:0">
                    <label>Personnage / Narrateur</label>
                    <input type="text" id="story-ch-${ci}-dlg-${stage}-speaker" value="${d.speaker||''}" placeholder="La Directrice">
                  </div>
                  <div class="admin-field" style="margin:0">
                    <label>Portrait (URL optionnel)</label>
                    <input type="text" id="story-ch-${ci}-dlg-${stage}-portrait" value="${d.portrait||''}" placeholder="URL">
                  </div>
                </div>
                <div class="admin-field" style="margin:0 0 6px">
                  <label>Dialogue principal</label>
                  <textarea id="story-ch-${ci}-dlg-${stage}-text" rows="3" style="width:100%;resize:vertical">${d.text||''}</textarea>
                </div>
                <div class="admin-field" style="margin:0">
                  <label>Réplique secondaire (optionnel)</label>
                  <textarea id="story-ch-${ci}-dlg-${stage}-text2" rows="2" style="width:100%;resize:vertical">${d.text2||''}</textarea>
                </div>
              </div>`;
            }).join('')}
          </div>
        </details>`;
      }).join('')
      : '<p style="color:#888;font-size:.82rem;padding:20px;text-align:center">Aucun chapitre. Cliquez sur "+ Chapitre" pour commencer.</p>'}
    </div>`;
  }

  function _defaultStoryMode() {
    return {
      chapters: [{
        title: 'La Fissure du Nexus',
        synopsis: 'La Directrice découvre le Nexus Glamour.',
        difficultyNote: 'Débutant — Niv.1 à 5',
        stages: {
          1:{ enemies:2, level:1 }, 2:{ enemies:2, level:1 }, 3:{ enemies:2, level:1 },
          4:{ enemies:3, level:2 }, 5:{ enemies:3, level:2 }, 6:{ enemies:3, level:2 },
          7:{ enemies:2, level:3 }, 8:{ enemies:2, level:3 }, 9:{ enemies:2, level:3 },
          10:{ enemies:1, level:5 },
        },
        dialogues: {
          1:  { speaker:'La Directrice', portrait:'', text:"Le Nexus Glamour... Je ne suis pas certaine de comprendre ce qui se passe ici. Des visages que je ne connais pas, des lieux qui n'existent pas. Et pourtant, tout semble réel.", text2:'' },
          5:  { speaker:'Mystérieuse inconnue', portrait:'', text:"Tu crois vraiment contrôler ce monde, Directrice ? Le Nexus a ses propres règles. Et ses propres gardiens.", text2:'' },
          8:  { speaker:'La Directrice', portrait:'', text:"Je commence à comprendre. Ces combats ne sont pas des batailles — ce sont des auditions. Et moi, je suis le jury.", text2:'' },
          10: { speaker:'Voix du Nexus', portrait:'', text:"La première fissure est scellée. Mais d'autres s'ouvrent, Directrice. Le Nexus vous attend.", text2:'' },
        },
      }],
    };
  }

  function _addStoryChapter() {
    _saveStoryMode(true);
    const state = CWGameState.get();
    if (!state.config.storyMode) state.config.storyMode = _defaultStoryMode();
    const ci = state.config.storyMode.chapters.length + 1;
    state.config.storyMode.chapters.push({ title:`Chapitre ${ci}`, synopsis:'', difficultyNote:'', dialogues:{1:{},5:{},8:{},10:{}} });
    CWGameState.updateConfig({ storyMode: state.config.storyMode });
    switchTab('story');
  }

  function _deleteStoryChapter(ci) {
    if (!confirm(`Supprimer le chapitre ${ci+1} ?`)) return;
    _saveStoryMode(true);
    const state = CWGameState.get();
    state.config.storyMode.chapters.splice(ci, 1);
    CWGameState.updateConfig({ storyMode: state.config.storyMode });
    switchTab('story');
  }

  function _saveStoryMode(silent) {
    const state = CWGameState.get();
    if (!state.config.storyMode) state.config.storyMode = _defaultStoryMode();
    const sm = state.config.storyMode;

    sm.chapters.forEach((ch, ci) => {
      ch.title          = document.getElementById(`story-ch-${ci}-title`)?.value      || ch.title || '';
      ch.synopsis       = document.getElementById(`story-ch-${ci}-synopsis`)?.value   || '';
      ch.difficultyNote = document.getElementById(`story-ch-${ci}-difficulty`)?.value || '';

      // Config des 10 stages (nb ennemis + niveau)
      ch.stages = ch.stages || {};
      for (let s = 1; s <= 10; s++) {
        const enemies = parseInt(document.getElementById(`story-ch-${ci}-stage-${s}-enemies`)?.value) || ch.stages[s]?.enemies || 2;
        const level   = parseInt(document.getElementById(`story-ch-${ci}-stage-${s}-level`)?.value)   || ch.stages[s]?.level   || 1;
        ch.stages[s] = { enemies, level };
      }

      // Dialogues narratifs
      ch.dialogues = ch.dialogues || {};
      [1,5,8,10].forEach(stage => {
        ch.dialogues[stage] = {
          speaker:  document.getElementById(`story-ch-${ci}-dlg-${stage}-speaker`)?.value  || ch.dialogues[stage]?.speaker  || '',
          portrait: document.getElementById(`story-ch-${ci}-dlg-${stage}-portrait`)?.value || ch.dialogues[stage]?.portrait || '',
          text:     document.getElementById(`story-ch-${ci}-dlg-${stage}-text`)?.value     || ch.dialogues[stage]?.text     || '',
          text2:    document.getElementById(`story-ch-${ci}-dlg-${stage}-text2`)?.value    || ch.dialogues[stage]?.text2    || '',
        };
      });
    });

    state.config.storyMode = sm;
    CWGameState.updateConfig({ storyMode: sm });
    if (!silent) { _notify('Mode Histoire sauvegardé.'); switchTab('story'); }
  }

  function _renderAudioTab() {
    const state = CWGameState.get();
    const aCfg  = state.config.audio || {};

    const fileRow = (kind, label, currentUrl) => `
      <div class="admin-field" style="margin-bottom:16px;">
        <label>${label}</label>
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <input type="file" id="audio-file-${kind}" accept="audio/*" style="display:none"
                 onchange="CWAdminPanel._uploadAudioFile('${kind}', this.files[0])" />
          <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="document.getElementById('audio-file-${kind}').click()">
            📁 Choisir un fichier
          </button>
          ${currentUrl ? `
            <span style="font-size:.8rem; color:#4ade80;">🎵 Fichier importé</span>
            <button class="admin-btn admin-btn-sm" onclick="new Audio('${currentUrl}').play()">▶️ Écouter</button>
            <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._removeAudioFile('${kind}')">🗑️ Retirer</button>
          ` : `<span style="font-size:.8rem; color:#888;">Aucun fichier importé</span>`}
        </div>
      </div>
    `;

    return `
      <div class="admin-section">
        <div class="admin-section-title">🎵 Musique de fond</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:14px;">
          Importe un fichier audio (MP3, OGG, WAV...) directement depuis ton ordinateur.
          Il est hébergé en ligne et accessible à TOUS les joueurs (pas seulement toi),
          et se relance automatiquement en boucle continue. Le joueur peut couper le
          son via le bouton 🔇 en haut de l'écran — par défaut, la lecture démarre
          coupée (obligation des navigateurs), il doit cliquer une fois pour l'activer.
        </p>
        ${fileRow('global', 'Musique de fond globale (interface)', aCfg.globalMusicName)}
        ${fileRow('combat', 'Musique de combat', aCfg.combatMusicName)}
        <p style="font-size:.72rem;color:#888;margin:-6px 0 14px;">Si aucune musique de combat n'est définie, la musique globale continue pendant les combats.</p>
        <div class="admin-field">
          <label>Musique activée</label>
          <select id="audio-enabled" onchange="CWAdminPanel._saveAudioEnabled(this.value)">
            <option value="1" ${aCfg.enabled !== false ? 'selected' : ''}>Oui</option>
            <option value="0" ${aCfg.enabled === false ? 'selected' : ''}>Non</option>
          </select>
        </div>
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">🔊 Bruitages de combat</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:14px;">
          Sons courts joués au moment de l'impact (en plus de la musique, qui continue de
          jouer) et à la fin du combat. Laisse vide pour ne pas avoir de bruitage à cet endroit.
        </p>
        ${fileRow('sfx_hit_normal', 'Coup normal', aCfg.sfxHitNormalName)}
        ${fileRow('sfx_hit_resist', 'Coup sur résistance (peu efficace / immunité)', aCfg.sfxHitResistName)}
        ${fileRow('sfx_hit_weak',   'Coup sur faiblesse (super efficace)', aCfg.sfxHitWeakName)}
        ${fileRow('sfx_victory',    'Fin de combat — Victoire', aCfg.sfxVictoryName)}
        ${fileRow('sfx_defeat',     'Fin de combat — Défaite', aCfg.sfxDefeatName)}
      </div>
      <hr class="admin-sep" />
      <div class="admin-section">
        <div class="admin-section-title">🌟 Bruitages de progression</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:14px;">
          Joués lors d'une montée de niveau, d'une évolution (en combat ou via une Pillule
          de Puissance), et à chaque révélation de carte (tirage Gacha ou capture réussie).
        </p>
        ${fileRow('sfx_levelup',    'Montée de niveau', aCfg.sfxLevelUpName)}
        ${fileRow('sfx_evolution',  'Évolution', aCfg.sfxEvolutionName)}
        ${fileRow('sfx_gacha_pull', 'Révélation de carte (Gacha / capture)', aCfg.sfxGachaPullName)}
      </div>
      <hr class="admin-sep" />
      <div class="admin-section" style="opacity:.55;">
        <div class="admin-section-title">🎬 Vidéo & Thème (à venir)</div>
        <p style="font-size:.8rem;color:#888;">
          Section réservée pour plus tard : possibilité de changer le thème de couleurs
          de l'interface, et d'autres options vidéo. Pas encore fonctionnel.
        </p>
        <div class="admin-field">
          <label>Thème de couleurs</label>
          <select disabled>
            <option>Par défaut (ChronoWaifu)</option>
          </select>
        </div>
      </div>
    `;
  }

  // ─── ONGLET FONDS D'ÉCRAN ───────────────────────────────────────────────────

  // Écrans configurables (le Bureau/hub n'y figure pas volontairement,
  // cf. commentaire dans database.js — son illustration a des zones cliquables
  // positionnées en % qu'un fond de remplacement casserait).
  const BACKGROUND_SCREENS = [
    { key: 'combat',          label: '⚔️ Combat (pendant le combat)' },
    { key: 'combat-select',   label: '🗺️ Sélection du mode de combat' },
    { key: 'team-hub',        label: '👥 Menu Équipe' },
    { key: 'collection',      label: '✨ Collection' },
    { key: 'team',            label: '🧩 Composition d\'équipe' },
    { key: 'gacha',           label: '📜 Contrat (Gacha)' },
    { key: 'equip',           label: '💍 Parures (Équipement)' },
    { key: 'inventory',       label: '🎒 Inventaire' },
    { key: 'shop',            label: '🛍️ Shop' },
    { key: 'quests',          label: '📅 Escapades (Quêtes)' },
    { key: 'catalogue',       label: '📖 Galerie (Catalogue)' },
    { key: 'story-chapters',  label: '📖 Mode Histoire — Liste des chapitres' },
    { key: 'story-chapter',   label: '📖 Mode Histoire — Écran d\'un chapitre' },
  ];

  function _renderBackgroundsTab() {
    const state = CWGameState.get();
    const bgCfg = state.config.backgrounds || {};

    const row = (key, label) => {
      const url = bgCfg[key] || '';
      const safeKey = key.replace(/[^a-z0-9]/gi, '_');
      return `
        <div class="admin-field" style="margin-bottom:16px;">
          <label>${label}</label>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <input type="text" id="bg-url-${safeKey}" value="${url}" placeholder="https://..."
                   style="flex:1; min-width:220px;"
                   oninput="CWAdminPanel._previewBackground('${key}', this.value)" />
            <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._saveBackground('${key}')">💾 Enregistrer</button>
            ${url ? `<button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._removeBackground('${key}')">🗑️ Retirer</button>` : ''}
          </div>
          <div id="bg-preview-wrap-${safeKey}" style="display:${url ? 'block' : 'none'};margin-top:8px;">
            <img id="bg-preview-${safeKey}" src="${url}" alt="Aperçu"
                 style="max-width:220px; max-height:120px; object-fit:cover; border-radius:8px; border:1px solid #2a2540;"
                 onerror="this.style.display='none'" onload="this.style.display='block'" />
          </div>
        </div>`;
    };

    return `
      <div class="admin-section">
        <div class="admin-section-title">🖼️ Fonds d'écran personnalisés</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:14px;">
          Comme pour les personnages, indique l'URL d'une image hébergée en ligne
          (pas d'upload direct). Laisse vide pour garder le fond par défaut du thème.
          Le fond s'affiche derrière le contenu de l'écran avec un léger voile sombre
          pour garder le texte lisible.
        </p>
        ${BACKGROUND_SCREENS.map(s => row(s.key, s.label)).join('')}
      </div>
    `;
  }

  // ─── ONGLET IMPORT VERS SUPABASE ─────────────────────────────────────────────
  // Permet de basculer un fichier de sauvegarde JSON (exporté depuis l'ancienne
  // version locale du jeu) vers la base de données partagée. Scinde
  // automatiquement la partie structurelle (personnages, équipements, config...)
  // de la partie propre au joueur, exactement comme le fait la sauvegarde
  // automatique normale.

  function _renderCloudImportTab() {
    return `
      <div class="admin-section">
        <div class="admin-section-title">📥 Importer une sauvegarde JSON vers Supabase</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:6px;">
          Choisis un fichier de sauvegarde exporté depuis l'ancienne version locale
          du jeu (bouton "Exporter" — un fichier <code>rpg_save_...json</code>).
        </p>
        <p style="font-size:.78rem;color:#fbbf24;margin-bottom:14px;">
          ⚠️ Ceci REMPLACE le contenu actuel de la base partagée (personnages,
          équipements, config...) par celui du fichier. Vérifie que c'est bien le
          bon fichier avant de confirmer.
        </p>
        <div class="admin-field" style="margin-bottom:14px;">
          <input type="file" id="cloud-import-file" accept="application/json,.json" />
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;margin-bottom:16px;">
          <input type="checkbox" id="cloud-import-restore-player" checked />
          Restaurer aussi MA progression joueur (contenue dans ce fichier) sur mon compte actuel
        </label>
        <button class="admin-btn admin-btn-primary" id="cloud-import-btn" onclick="CWAdminPanel._runCloudImport()">📥 Importer vers Supabase</button>
        <div id="cloud-import-status" style="margin-top:14px;font-size:.82rem;"></div>
      </div>
    `;
  }

  /** Lit le fichier JSON choisi, scinde structurel/joueur, envoie vers Supabase */
  async function _runCloudImport() {
    const fileInput  = document.getElementById('cloud-import-file');
    const restorePlayer = document.getElementById('cloud-import-restore-player')?.checked;
    const statusEl   = document.getElementById('cloud-import-status');
    const btn        = document.getElementById('cloud-import-btn');
    const file = fileInput?.files?.[0];
    if (!file) { statusEl.innerHTML = '<span style="color:#f87171">Choisis un fichier d\'abord.</span>'; return; }

    btn.disabled = true;
    statusEl.innerHTML = '⏳ Lecture du fichier...';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const { player, version, exportDate, timestamp, ...structural } = data;

      statusEl.innerHTML = '⏳ Envoi des données de jeu vers Supabase...';
      await CWBackend.saveGameData(structural);

      if (restorePlayer && player) {
        statusEl.innerHTML = '⏳ Restauration de ta progression joueur...';
        const userId = CWBackend.getCurrentUserId();
        if (userId) await CWBackend.savePlayerData(userId, player);
      }

      statusEl.innerHTML = '✅ Import terminé ! Rechargement de la page dans 2 secondes...';
      setTimeout(() => window.location.reload(), 2000);
    } catch (e) {
      console.error('[Admin] Échec import Supabase:', e);
      statusEl.innerHTML = `<span style="color:#f87171">❌ Échec : ${e.message || e}</span>`;
      btn.disabled = false;
    }
  }

  // ─── ONGLET COMPTES JOUEURS ──────────────────────────────────────────────────
  // Accès admin à la progression de TOUS les joueurs (lecture + modification),
  // et restauration depuis la sauvegarde de secours automatique. Nécessite les
  // policies RLS ajoutées par supabase_setup_admin_accounts.sql — sans elles,
  // cet onglet affiche simplement une liste vide (aucune erreur, aucun crash).

  function _renderPlayerAccountsTab() {
    // Le chargement est asynchrone (plusieurs requêtes Supabase) : on affiche
    // un espace réservé tout de suite, puis on le remplit une fois prêt.
    _loadPlayerAccountsData();
    return `
      <div class="admin-section">
        <div class="admin-section-title">👥 Comptes joueurs</div>
        <p style="font-size:.8rem;color:#888;margin-bottom:14px;">
          Clique sur "✏️ Éditer" pour basculer temporairement les écrans "Joueur"
          et "Ressources" sur la progression de ce joueur (mêmes écrans que
          d'habitude, mais ils affichent SES données). Un bandeau reste affiché
          en haut pendant l'édition, avec les boutons Enregistrer/Annuler. La
          colonne "Secours" indique la date de la dernière sauvegarde de
          secours automatique disponible pour ce joueur.
        </p>
        <div id="player-accounts-content"><p style="color:#888">⏳ Chargement des comptes...</p></div>
      </div>
    `;
  }

  async function _loadPlayerAccountsData() {
    const [profiles, saves, backups] = await Promise.all([
      CWBackend.loadAllProfiles(),
      CWBackend.loadAllPlayerSaves(),
      CWBackend.loadBackupDates(),
    ]);
    const container = document.getElementById('player-accounts-content');
    if (!container) return; // l'admin a changé d'onglet entre-temps

    if (saves.length === 0) {
      container.innerHTML = `<p style="color:#f87171">Aucun compte trouvé — vérifie que le script
        <code>supabase_setup_admin_accounts.sql</code> a bien été exécuté (droits admin sur les
        sauvegardes joueurs).</p>`;
      return;
    }

    const profileMap = {}; profiles.forEach(p => profileMap[p.id] = p);
    const backupMap  = {}; backups.forEach(b => backupMap[b.user_id] = b.backed_up_at);

    // Stocke les données brutes pour un accès rapide depuis l'éditeur (évite un rechargement réseau)
    _playerAccountsCache = {};
    saves.forEach(s => { _playerAccountsCache[s.user_id] = s; });
    _playerAccountsProfileMap = profileMap;

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:.8rem;border-collapse:collapse;">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid #333;">
              <th style="padding:6px 8px;">Joueur</th>
              <th style="padding:6px 8px;text-align:center;">Niveau</th>
              <th style="padding:6px 8px;text-align:center;">💎</th>
              <th style="padding:6px 8px;text-align:center;">💵</th>
              <th style="padding:6px 8px;text-align:center;">Collection</th>
              <th style="padding:6px 8px;text-align:center;">Dernière sauvegarde</th>
              <th style="padding:6px 8px;text-align:center;">Secours</th>
              <th style="padding:6px 8px;"></th>
            </tr>
          </thead>
          <tbody>
            ${saves.map(s => {
              const p  = profileMap[s.user_id] || {};
              const pd = s.data || {};
              const level     = pd.level ?? '—';
              const crystals  = pd.currency?.crystals ?? 0;
              const gold      = pd.currency?.gold ?? 0;
              const collCount = (pd.collection || []).length;
              const updated   = s.updated_at ? new Date(s.updated_at).toLocaleString('fr-FR') : '—';
              const backupAt  = backupMap[s.user_id];
              const backupTxt = backupAt ? new Date(backupAt).toLocaleDateString('fr-FR') : '—';
              return `
                <tr style="border-bottom:1px solid #2a2a3a;">
                  <td style="padding:6px 8px;">${p.display_name || s.user_id}</td>
                  <td style="padding:6px 8px;text-align:center;">${level}</td>
                  <td style="padding:6px 8px;text-align:center;">${crystals.toLocaleString('fr-FR')}</td>
                  <td style="padding:6px 8px;text-align:center;">${gold.toLocaleString('fr-FR')}</td>
                  <td style="padding:6px 8px;text-align:center;">${collCount}</td>
                  <td style="padding:6px 8px;text-align:center;font-size:.72rem;color:#888;">${updated}</td>
                  <td style="padding:6px 8px;text-align:center;font-size:.72rem;color:#888;">${backupTxt}</td>
                  <td style="padding:6px 8px;white-space:nowrap;">
                    <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="CWAdminPanel._openPlayerEditor('${s.user_id}')">✏️ Éditer</button>
                    ${backupAt ? `<button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._confirmRestoreBackup('${s.user_id}')">⏪ Restaurer</button>` : ''}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── ÉDITION GRAPHIQUE D'UN AUTRE JOUEUR (bascule temporaire) ────────────────
  // Plutôt que de reconstruire un formulaire dédié, on réutilise TELS QUELS les
  // écrans "Joueur" et "Ressources" déjà existants (déjà graphiques, avec
  // portraits) : on bascule temporairement _state.player sur les données du
  // joueur ciblé, on désactive la sauvegarde automatique normale (pour ne
  // jamais écraser le compte de l'admin par erreur), et un bandeau permanent
  // permet d'enregistrer explicitement chez le bon joueur, ou d'annuler.

  let _impersonation = null; // { targetUserId, targetDisplayName, adminOwnPlayerSnapshot }

  /** Bascule l'admin en mode édition sur les données d'un autre joueur */
  function _openPlayerEditor(userId) {
    const entry = _playerAccountsCache?.[userId];
    if (!entry) { _notify('❌ Données introuvables — recharge l\'onglet.', 'error'); return; }
    if (_impersonation) { _notify('⚠️ Termine ou annule l\'édition en cours avant d\'en commencer une autre.', 'error'); return; }

    const profileName = _playerAccountsProfileName(userId);

    // Mémoriser les données de l'admin lui-même, pour pouvoir les restaurer ensuite
    _impersonation = {
      targetUserId: userId,
      targetDisplayName: profileName,
      adminOwnPlayerSnapshot: JSON.parse(JSON.stringify(CWGameState.getPlayer())),
    };

    // Désactiver l'autosave normal : le temps de l'édition, plus aucune sauvegarde
    // automatique ne doit partir vers le compte de l'admin (qui contient
    // temporairement les données d'un autre joueur).
    if (window.__cwSuspendAutosave) window.__cwSuspendAutosave();

    // Charger les données du joueur ciblé dans l'état courant
    CWGameState.updatePlayer(entry.data);

    _showImpersonationBanner();
    switchTab('player'); // écran "Joueur" déjà existant, réutilisé tel quel
    _notify(`✏️ Édition de ${profileName} — pense à "Enregistrer chez ce joueur" une fois terminé.`);
  }

  function _playerAccountsProfileName(userId) {
    return _playerAccountsProfileMap?.[userId]?.display_name || userId;
  }

  function _showImpersonationBanner() {
    const banner = document.getElementById('admin-impersonation-banner');
    if (!banner || !_impersonation) return;
    banner.style.display = 'flex';
    banner.innerHTML = `
      <span>🎭 Mode édition — <strong>${_impersonation.targetDisplayName}</strong>
        (tu navigues dans les écrans "Joueur"/"Ressources" comme si c'était toi, mais
        c'est bien SA progression qui est affichée)</span>
      <span style="display:flex; gap:8px;">
        <button class="admin-btn admin-btn-success admin-btn-sm" onclick="CWAdminPanel._savePlayerImpersonation()">💾 Enregistrer chez ce joueur</button>
        <button class="admin-btn admin-btn-danger admin-btn-sm" onclick="CWAdminPanel._cancelPlayerImpersonation()">✕ Annuler</button>
      </span>
    `;
  }

  /** Enregistre les modifications chez le joueur ciblé, puis sort du mode édition */
  async function _savePlayerImpersonation() {
    if (!_impersonation) return;
    const { targetUserId, targetDisplayName } = _impersonation;
    try {
      await CWBackend.savePlayerData(targetUserId, CWGameState.getPlayer());
      _notify(`✅ Modifications enregistrées chez ${targetDisplayName}.`);
    } catch (e) {
      _notify('❌ Échec de l\'enregistrement : ' + (e.message || e), 'error');
      return; // on ne quitte pas le mode édition si l'enregistrement a échoué
    }
    // Cas particulier : si le joueur édité est TOI-MÊME (le compte connecté dans
    // cette page), la session de jeu en cours a encore l'ancienne version en
    // mémoire — sans rechargement, la prochaine sauvegarde automatique
    // écraserait tes propres modifications qu'on vient d'enregistrer.
    if (targetUserId === CWBackend.getCurrentUserId?.()) {
      _notify('🔄 C\'était ton propre compte — rechargement de la page pour resynchroniser...');
      setTimeout(() => window.location.reload(), 1200);
      return;
    }
    _exitPlayerImpersonation();
  }

  /** Annule les modifications en cours (rien n'est envoyé au joueur ciblé) */
  function _cancelPlayerImpersonation() {
    if (!_impersonation) return;
    if (!confirm(`Annuler l'édition de ${_impersonation.targetDisplayName} ? Les modifications non enregistrées seront perdues.`)) return;
    _exitPlayerImpersonation();
  }

  /** Restaure les données propres de l'admin et la sauvegarde automatique normale */
  function _exitPlayerImpersonation() {
    if (!_impersonation) return;
    CWGameState.updatePlayer(_impersonation.adminOwnPlayerSnapshot);
    if (window.__cwRestoreAutosave) window.__cwRestoreAutosave();
    _impersonation = null;
    const banner = document.getElementById('admin-impersonation-banner');
    if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
    switchTab('player-accounts');
  }

  /** Demande confirmation puis restaure la sauvegarde de secours d'un joueur */
  async function _confirmRestoreBackup(userId) {
    if (!confirm('Restaurer la sauvegarde de secours va ÉCRASER la progression actuelle de ce joueur par la dernière sauvegarde automatique. Continuer ?')) return;
    try {
      await CWBackend.restorePlayerFromBackup(userId);
      _notify('✅ Sauvegarde de secours restaurée.');
      // Cas particulier : si c'est TON PROPRE compte que tu viens de restaurer,
      // ta session de jeu en cours tourne toujours avec l'ancienne version en
      // mémoire dans cette même page — sans rechargement, la prochaine
      // sauvegarde automatique écraserait la restauration qu'on vient de faire.
      if (userId === CWBackend.getCurrentUserId?.()) {
        _notify('🔄 C\'était ton propre compte — rechargement de la page pour resynchroniser...');
        setTimeout(() => window.location.reload(), 1200);
        return;
      }
      _loadPlayerAccountsData();
    } catch (e) {
      _notify('❌ Échec de la restauration : ' + (e.message || e), 'error');
    }
  }

  /** Prévisualise en direct l'URL saisie, sans encore l'enregistrer */
  function _previewBackground(key, url) {
    const safeKey = key.replace(/[^a-z0-9]/gi, '_');
    const wrap    = document.getElementById(`bg-preview-wrap-${safeKey}`);
    const img     = document.getElementById(`bg-preview-${safeKey}`);
    if (!wrap || !img) return;
    const clean = (url || '').trim();
    if (!clean) { wrap.style.display = 'none'; return; }
    img.src = clean;
    wrap.style.display = 'block';
  }

  /** Enregistre l'URL de fond d'écran pour l'écran donné, et rafraîchit l'aperçu en jeu */
  function _saveBackground(key) {
    const safeKey = key.replace(/[^a-z0-9]/gi, '_');
    const input = document.getElementById(`bg-url-${safeKey}`);
    const url   = (input?.value || '').trim() || null;
    const state = CWGameState.get();
    CWGameState.updateConfig({
      backgrounds: { ...(state.config.backgrounds || {}), [key]: url },
    });
    _notify(url ? '✅ Fond d\'écran enregistré !' : '✅ Fond d\'écran retiré.', 'success');
    _renderTab('backgrounds');
  }

  /** Retire le fond d'écran personnalisé pour l'écran donné */
  function _removeBackground(key) {
    const state = CWGameState.get();
    CWGameState.updateConfig({
      backgrounds: { ...(state.config.backgrounds || {}), [key]: null },
    });
    _notify('✅ Fond d\'écran retiré.', 'success');
    _renderTab('backgrounds');
  }


  async function _uploadAudioFile(kind, file) {
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      _notify('❌ Le fichier sélectionné n\'est pas un fichier audio.', 'error');
      return;
    }
    try {
      _notify('⏳ Envoi en cours...', 'info');
      const url = await CWAudioSystem.saveTrack(kind, file);
      const state = CWGameState.get();
      const fieldName = AUDIO_FIELD_MAP[kind];
      if (fieldName) {
        CWGameState.updateConfig({
          ...state.config,
          audio: { ...state.config.audio, [fieldName]: url },
        });
      }
      _notify(`✅ "${file.name}" importé (accessible à tous les joueurs).`);
      switchTab('audio');
      // Applique immédiatement la musique globale (l'admin n'est généralement pas ouvert en plein combat)
      if (kind === 'global') CWAudioSystem.playGlobal(true);
    } catch (e) {
      _notify('❌ Échec de l\'import : ' + (e.message || e), 'error');
    }
  }

  /** Retire le fichier audio (musique ou bruitage) de la clé donnée */
  async function _removeAudioFile(kind) {
    try {
      await CWAudioSystem.removeTrack(kind);
    } catch (e) {
      _notify('❌ Échec de la suppression : ' + (e.message || e), 'error');
      return;
    }
    const state = CWGameState.get();
    const fieldName = AUDIO_FIELD_MAP[kind];
    if (fieldName) {
      CWGameState.updateConfig({
        ...state.config,
        audio: { ...state.config.audio, [fieldName]: '' },
      });
    }
    _notify('🗑️ Fichier retiré.');
    switchTab('audio');
  }

  /** Active/désactive la musique de fond globalement */
  function _saveAudioEnabled(value) {
    const state = CWGameState.get();
    CWGameState.updateConfig({
      ...state.config,
      audio: { ...state.config.audio, enabled: value === '1' },
    });
    _notify(value === '1' ? '✅ Musique activée.' : '🚫 Musique désactivée.');
    if (value === '1') CWAudioSystem.playGlobal();
    else CWAudioSystem.stop();
  }

  /** Prévisualise la chance de crit en temps réel selon le diviseur saisi */
  /**
   * Construit le HTML du diagnostic "Équilibrage adaptatif" : profil de puissance
   * réel de l'équipe actuelle du joueur, et multiplicateurs ennemis qui en résultent
   * avec le réglage donné. Permet de vérifier concrètement que le curseur a un effet,
   * sans avoir à lancer un vrai combat.
   */
  function _buildAdaptiveScalingPreviewHtml(teamInstances, statRatio, scalingFactor) {
    if (!teamInstances || teamInstances.length === 0) {
      return `<span style="color:#888">Aucune équipe active : impossible de calculer un aperçu (composez une équipe pour voir le diagnostic).</span>`;
    }
    if (typeof CWCombatEngine === 'undefined' || typeof CWCombatEngine._computePowerProfile !== 'function') {
      return `<span style="color:#888">Diagnostic indisponible.</span>`;
    }

    const profile = CWCombatEngine._computePowerProfile(teamInstances);
    const sf = Math.max(0, Math.min(1, scalingFactor ?? 0));
    const tankiness = Math.sqrt(Math.max(0.01, profile.def) * Math.max(0.01, profile.hp));
    const offense   = profile.atk;
    const speed     = profile.spd;

    const atkMult = statRatio * (1 + (tankiness - 1) * sf);
    const defMult = statRatio * (1 + (offense   - 1) * sf);
    const spdMult = statRatio * (1 + (speed     - 1) * sf * 0.5);
    const hpMult  = 1         * (1 + (offense   - 1) * sf);

    const fmtRatio = (v) => `×${v.toFixed(2)}`;
    const noChange = Math.abs(profile.hp - 1) < 0.02 && Math.abs(profile.atk - 1) < 0.02 &&
                      Math.abs(profile.def - 1) < 0.02 && Math.abs(profile.spd - 1) < 0.02;

    return `
      <div style="margin-bottom:6px;color:#ddd;"><strong>Profil de puissance réel de l'équipe active</strong> (équipement + awakening + évolution vs forme de base "nue", même niveau) :</div>
      <div style="font-family:monospace;color:#60A5FA;margin-bottom:8px;">
        PV ${fmtRatio(profile.hp)} &nbsp; ATK ${fmtRatio(profile.atk)} &nbsp; DEF ${fmtRatio(profile.def)} &nbsp; VIT ${fmtRatio(profile.spd)}
      </div>
      ${noChange ? `<div style="color:#f59e0b;margin-bottom:8px;">⚠️ Équipe actuellement "nue" (≈×1 partout) : avec ce réglage, le rattrapage adaptatif n'aura visuellement <u>aucun effet</u> tant que cette équipe ne porte pas d'équipement / awakening / évolution au-delà de la forme de base. Ce n'est pas un bug — il n'y a simplement rien à compenser pour l'instant.</div>` : ''}
      <div style="color:#ddd;margin-bottom:4px;"><strong>Multiplicateurs ennemis résultants</strong> (réglage actuel du champ ci-dessus) :</div>
      <div style="font-family:monospace;color:#4ade80;">
        PV ${fmtRatio(hpMult)} &nbsp; ATK ${fmtRatio(atkMult)} &nbsp; DEF ${fmtRatio(defMult)} &nbsp; VIT ${fmtRatio(spdMult)}
      </div>
    `;
  }

  /** Recalcule l'aperçu d'équilibrage adaptatif en direct, sans sauvegarder */
  function _previewAdaptiveScaling() {
    const el = document.getElementById('adaptive-scaling-preview');
    if (!el) return;
    const state  = CWGameState.get();
    const factor = parseFloat(document.getElementById('combat-adaptive-scaling')?.value ?? '0.6');
    const team   = CWGameState.getTeam();
    el.innerHTML = _buildAdaptiveScalingPreviewHtml(team, state.config.combat.enemyStatRatio ?? 0.85, factor);
  }

  /** Sauvegarde isolément le facteur de rattrapage adaptatif (bouton dédié, sans dépendre du bouton "tout sauver" en bas de page) */
  function _saveAdaptiveScaling() {
    const state  = CWGameState.get();
    const factor = Math.max(0, Math.min(1, parseFloat(document.getElementById('combat-adaptive-scaling')?.value ?? '0.6')));
    CWGameState.updateConfig({
      ...state.config,
      combat: { ...state.config.combat, adaptiveScalingFactor: factor },
    });
    _notify(`✅ Intensité du rattrapage sauvegardée : ${factor}`);
    _previewAdaptiveScaling();
  }

  function _previewCritChance() {
    const divisor = parseFloat(document.getElementById('combat-crit-divisor')?.value || '200');
    const el = document.getElementById('crit-preview');
    if (!el || divisor <= 0) return;
    const examples = [20, 50, 100, 200, 500].map(spd => {
      const pct = Math.round(spd / (spd + divisor) * 100);
      return `VIT ${spd} → ${pct}%`;
    });
    el.textContent = examples.join(' | ');
  }

  function _saveCombatConfig() {
    const state  = CWGameState.get();
    const xpBase = parseInt(document.getElementById('level-xp-base')?.value || '100');
    const xpExpo = parseFloat(document.getElementById('level-xp-expo')?.value || '1.8');

    // Sous-niveaux élites (champ texte "10,20")
    const eliteRaw = document.getElementById('story-elites')?.value || '10,20';
    const eliteSubLevels = eliteRaw.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

    const newCfg = {
      ...state.config,
      game: {
        ...state.config.game,
        maxTeamSize: parseInt(document.getElementById('game-max-team')?.value || '3'),
        enemyTeamSize: {
          mode:  document.getElementById('game-enemy-mode')?.value || 'fixed',
          value: parseInt(document.getElementById('game-enemy-val')?.value || '3'),
          min:   parseInt(document.getElementById('game-enemy-val')?.value || '1'),
          max:   parseInt(document.getElementById('game-enemy-max')?.value || '5'),
        },
      },
      shop: {
        ...(state.config.shop || {}),
        rotatingCount: parseInt(document.getElementById('shop-rotating-count')?.value || '9'),
      },
      combat: {
        ...state.config.combat,
        minDamage:               parseInt(document.getElementById('combat-min-dmg')?.value || '1'),
        captureBaseRate:         parseInt(document.getElementById('combat-capture-rate')?.value || '15') / 100,
        rewardXpPerEnemy:        parseFloat(document.getElementById('combat-xp-per-enemy')?.value || '20'),
        rewardGoldPerEnemy:      parseFloat(document.getElementById('combat-gold-per-enemy')?.value || '5'),
        rewardDiamondsPerEnemy:  parseFloat(document.getElementById('combat-diamonds-per-enemy')?.value || '10'),
        speedEvasionCap:         parseFloat(document.getElementById('combat-evasion-cap')?.value || '0.10'),
        speedAccuracyCap:        parseFloat(document.getElementById('combat-accuracy-cap')?.value || '0.10'),
        critDivisor:             parseFloat(document.getElementById('combat-crit-divisor')?.value || '200'),
        critMultiplier:          parseFloat(document.getElementById('combat-crit-mult')?.value || '1.5'),
        scoreDefReference:       parseFloat(document.getElementById('combat-score-def-ref')?.value || '10'),
        recordMaxTurns:          parseInt(document.getElementById('record-max-turns')?.value || '15'),
        recordEnemyCount:        parseInt(document.getElementById('record-enemy-count')?.value || '3'),
        recordKillBonus:         parseInt(document.getElementById('record-kill-bonus')?.value || '100'),
        recordTier1Step:         parseInt(document.getElementById('record-tier1-step')?.value || '1000'),
        recordTier1Cap:          parseInt(document.getElementById('record-tier1-cap')?.value || '20000'),
        recordTier2Step:         parseInt(document.getElementById('record-tier2-step')?.value || '2000'),
        recordTier2Cap:          parseInt(document.getElementById('record-tier2-cap')?.value || '40000'),
        recordTier3Step:         parseInt(document.getElementById('record-tier3-step')?.value || '5000'),
        recordTotemMaxScore:     parseInt(document.getElementById('record-totem-max')?.value || '100000'),
        recordGoldPerTier:       parseInt(document.getElementById('record-gold-per-tier')?.value || '50'),
        recordCrystalsPerTier:   parseInt(document.getElementById('record-crystals-per-tier')?.value || '2'),
        recordRewardGrowth:      parseFloat(document.getElementById('record-reward-growth')?.value || '1'),
        playerDmgBonus:          parseFloat(document.getElementById('combat-player-bonus')?.value || '1.15'),
        enemyDmgPenalty:         parseFloat(document.getElementById('combat-enemy-penalty')?.value || '0.80'),
        enemyStatRatio:          parseFloat(document.getElementById('combat-enemy-stat-ratio')?.value || '0.85'),
        adaptiveScalingFactor:   Math.max(0, Math.min(1, parseFloat(document.getElementById('combat-adaptive-scaling')?.value ?? '0.6'))),
        evolvedFormWeightFactor: parseFloat(document.getElementById('combat-evolved-factor')?.value || '0.5'),
        story: {
          ...(state.config.combat?.story || {}),
          subLevelsPerWorld: parseInt(document.getElementById('story-sublevels')?.value || '25'),
          bossSubLevel:      parseInt(document.getElementById('story-boss')?.value || '25'),
          eliteSubLevels,
          eliteStatBoost:    parseInt(document.getElementById('story-elite-boost')?.value || '10') / 100,
          bossStatBoost:     parseInt(document.getElementById('story-boss-boost')?.value || '25') / 100,
          worldStatBoost:    parseInt(document.getElementById('story-world-boost')?.value || '10') / 100,
          rewardEliteGold:      parseInt(document.getElementById('story-reward-elite')?.value || '100'),
          rewardBossDiamonds:   parseInt(document.getElementById('story-reward-boss')?.value  || '100'),
        },
      },
      level: {
        ...state.config.level,
        xpBase,
        xpExponent: xpExpo,
        statGrowthPerLevel: {
          hp:  parseInt(document.getElementById('level-grow-hp')?.value  || '5')  / 100,
          atk: parseInt(document.getElementById('level-grow-atk')?.value || '4')  / 100,
          def: parseInt(document.getElementById('level-grow-def')?.value || '4')  / 100,
          spd: parseInt(document.getElementById('level-grow-spd')?.value || '3')  / 100,
        },
      },
    };
    // Bonus joueur
    const bonusKeys = ['battles','victories','kills','captures','pulls','evolutions','awakenings','goldEarned','scoreTotal','scoreTeam','tourneeProgress','galleryEntries'];
    const defaultBonus = CWGameDatabase.DEFAULT_CONFIG.playerBonus;
    const playerBonus = {};
    bonusKeys.forEach(k => {
      const el = document.getElementById(`pb-${k}`);
      playerBonus[k] = {
        every: parseInt(el?.value) || defaultBonus[k].every,
        label: defaultBonus[k].label,
      };
    });

    CWGameState.updateConfig({ ...newCfg, playerBonus });
    _notify('✅ Tous les paramètres ont été sauvegardés.');
  }

  // ─── SAUVEGARDE / EXPORT / IMPORT ────────────────────────────────────────────

  /**
   * Exporte la sauvegarde complète en JSON
   */
  function exportSave() {
    const state = CWGameState.get();
    const json  = JSON.stringify(state, null, 2);
    const blob  = new Blob([json], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `chronowaifu_save_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    _notify('✅ Sauvegarde exportée.');
  }

  /**
   * Importe une sauvegarde JSON
   */
  function importSave() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file   = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!confirm('Remplacer toute la sauvegarde actuelle par ce fichier ?')) return;
          CWGameState.init(data);
          _notify('✅ Sauvegarde importée avec succès.');
          switchTab(_activeTab);
        } catch (err) {
          _notify('❌ Fichier invalide : ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ─── AFFICHAGE / MASQUAGE ────────────────────────────────────────────────────

  function show() {
    const panel = document.getElementById('admin-panel');
    if (panel) {
      panel.classList.add('visible');
      _visible = true;
      _renderTab(_activeTab);
    }
  }

  function hide() {
    if (_impersonation) {
      _notify('⚠️ Édition en cours annulée (panneau fermé sans enregistrer).', 'error');
      _exitPlayerImpersonation();
    }
    const panel = document.getElementById('admin-panel');
    if (panel) {
      panel.classList.remove('visible');
      _visible = false;
    }
  }

  function toggle() {
    _visible ? hide() : show();
  }

  // ─── ÉVÉNEMENTS GLOBAUX ───────────────────────────────────────────────────────

  function _bindGlobalEvents() {
    // Échap pour fermer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _visible) hide();
    });
    // Overlay pour fermer
    document.addEventListener('click', (e) => {
      if (e.target.id === 'admin-overlay') hide();
    });
  }

  // ─── UTILITAIRES ─────────────────────────────────────────────────────────────

  function _setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  /**
   * Fait défiler le panneau admin jusqu'à l'élément de liste correspondant à l'ID
   * donné (le personnage ou l'équipement qui vient d'être créé/modifié), et le
   * met brièvement en évidence pour qu'il soit facile à repérer.
   * @param {string} id
   */
  function _scrollToListItem(id) {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-drag-id="${id}"]`);
      if (!el) { _scrollContentToBottom(); return; } // repli si introuvable
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('just-saved');
      setTimeout(() => el.classList.remove('just-saved'), 1500);
    });
  }

  /** Fait défiler le panneau admin jusqu'en bas (repli quand l'élément ciblé est introuvable) */
  function _scrollContentToBottom() {
    const content = document.getElementById('admin-content');
    if (!content) return;
    requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
  }

  let _notifTimeout = null;
  function _notify(msg, type = 'success') {
    const el = document.getElementById('admin-notification');
    if (!el) return;
    el.textContent = msg;
    el.className   = type === 'error' ? 'error show' : 'show';
    clearTimeout(_notifTimeout);
    _notifTimeout = setTimeout(() => { el.className = ''; }, 3000);
  }

  // ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

  return {
    init, show, hide, toggle, switchTab,
    exportSave, importSave,
    // Méthodes appelées depuis le HTML (onclick)
    _previewPortrait,
    _openCropEditor, _cropZoom, _cropReset, _cropConfirm,
    _saveCharacter, _editCharacter, _deleteCharacter, _clearCharForm, _upgradeCharacter,
    _saveType, _editType, _deleteType, _clearTypeForm,
    _saveTagCategory, _editTagCategory, _deleteTagCategory, _clearTagCategoryForm,
    _saveTag, _editTag, _deleteTag, _clearTagForm, _addTagToLine, _addTagToLineFromCategory, _removeTagFromLine,
    _addFeaturedByTag,
    _matrixCellChanged, _saveMatrix,
    _saveEquip, _editEquip, _deleteEquip, _clearEquipForm, _duplicateEquip,
    _saveItem, _editItem, _deleteItem, _clearItemForm, _updateItemEffectAmountLabel,
    _saveShopListing, _editShopListing, _deleteShopListing, _clearShopForm, _toggleShopListing, _updateShopRefOptions, _setShopSort, _autoPopulateShop,
    _updateRewardRefVisibility,
    _saveCycle, _editCycle, _toggleCycle, _deleteCycle, _clearCycleForm, _rebuildCycleDayRows, _toggleSecondReward,
    _saveWeeklyQuest, _editWeeklyQuest, _toggleWeeklyQuest, _deleteWeeklyQuest, _clearWeeklyQuestForm,
    _setDailySubTab,
    _saveEventTemplate, _resetEventTemplate, _addEventTplQuest, _deleteEventTplQuest,
    _saveCurrentTag, _saveNextTag, _onTplDayTypeChange, _forceStartEvent, _stopEvent,
    _randomCurrentTag, _randomNextTag, _randomStartTag, _planifyNextEvent, _randomNextTagNew,
    _saveNextEventEdit, _cancelNextEvent,
    _saveQuest, _editQuest, _toggleQuest, _deleteQuest, _clearQuestForm,
    _savePassive, _editPassive, _deletePassive, _clearPassiveForm, _updatePassiveParamsFields,
    _saveGachaConfig, _saveBanner, _editBanner, _deleteBanner, _clearBannerForm, _filterBannerFeaturedList, _updateBannerPoolFields,
    _saveDropRates, _resetDropRates, _updateDropTotal,
    _resetAllEvolutions, _toggleLineCombatAvailability, _uncheckEpicPlusLines, _sortEvolutionLines,
    _saveAwakening, _setAwakening,
    _savePlayerInfo, _savePlayerLevelConfig, _adminAddChar, _editPlayerChar, _removePlayerChar, _resetPlayer, _clearCollection, _wipeAllPlayerData, _unlockAllForTesting,
    _saveTutorial, _resetTutorial, _resetTutorialContent, _addTutoStep, _deleteTutoStep, _moveTutoStep,
    _saveStoryMode, _addStoryChapter, _deleteStoryChapter,
    _saveResources, _addResources, _saveEnergyConfig, _fillEnergy, _resetStats,
    _saveCombatConfig, _saveAdaptiveScaling, _previewAdaptiveScaling, _saveEnemyRarityWeights, _resetEnemyRarityWeights, _updateEnemyWeightTotal, _saveEnemyXpBonus,
    _saveEventTemplate, _resetEventTemplate, _addEventTplQuest, _deleteEventTplQuest,
    _saveCurrentTag, _saveNextTag, _onTplDayTypeChange,
    _previewEvolvedFormWeight, _saveEvolvedFormWeightFactor,
    _uploadAudioFile, _removeAudioFile, _saveAudioEnabled,
    _previewBackground, _saveBackground, _removeBackground,
    _runCloudImport,
    _openPlayerEditor, _savePlayerImpersonation, _cancelPlayerImpersonation, _confirmRestoreBackup,
    _dragStart, _dragOver, _dragLeave, _dragEnd, _dragDropChar, _dragDropEquip, _dragDropEvoStage, _dragDropType,
    _sortCharList, _filterCharList, _sortEquipList,
  };
})();
