// ============================================================
// Foxbots Scouting App — app.js
// Team 25657 | Competition Day Scouting Tool
// ============================================================

// ── CONFIG ──────────────────────────────────────────────────
const CONFIG = {
  memberHash:  '52fa766a9473d5573b5c4af10068b212d398a27eb450e8ccc1b99186a8624073',
  captainHash: '4eee6a5fd1048c7206efd395e019b7a6207521c36371c273995cfc35b0e1e797',

  scriptUrl: 'https://script.google.com/macros/s/AKfycbxMUvsHW9lBF3RUDzbxKLR53UpCyobKYvt5ywW2JbWr8UoJI1YZE1L1AXnL7fKt3ZKE/exec',

  // Pre-match scouting form — edit per season
  // type: 'radio' | 'stepper' | 'textarea' | 'toggle'
  prematchForm: [
    {
      section: 'Autonomous',
      color: 'teal',
      questions: [
        { id: 'auto_starts',   label: 'Starting Position',    type: 'radio',    options: ['Left', 'Center', 'Right', 'Unknown'] },
        { id: 'auto_scoring',  label: 'Auto Scoring Ability', type: 'radio',    options: ['None', 'Low Goal', 'High Goal', 'Both'] },
        { id: 'auto_reliable', label: 'Auto Reliability',     type: 'radio',    options: ['Never', 'Sometimes', 'Usually', 'Always'] },
        { id: 'auto_notes',    label: 'Auto Notes',           type: 'textarea' },
      ]
    },
    {
      section: 'TeleOp',
      color: 'orange',
      questions: [
        { id: 'tele_primary',     label: 'Primary Scoring Method',    type: 'radio',   options: ['Ground Pickup', 'Human Player', 'Both', 'None'] },
        { id: 'tele_speed',       label: 'Robot Speed',               type: 'radio',   options: ['Slow', 'Medium', 'Fast', 'Very Fast'] },
        { id: 'tele_defense',     label: 'Plays Defense?',            type: 'toggle' },
        { id: 'tele_avg_cycles',  label: 'Approx. Cycles per Match',  type: 'stepper' },
        { id: 'tele_notes',       label: 'TeleOp Notes',              type: 'textarea' },
      ]
    },
    {
      section: 'Endgame',
      color: 'purple',
      questions: [
        { id: 'end_climb',    label: 'Endgame Action',      type: 'radio',    options: ['Nothing', 'Park', 'Low Hang', 'High Hang', 'Unknown'] },
        { id: 'end_reliable', label: 'Endgame Reliability', type: 'radio',    options: ['Never', 'Sometimes', 'Usually', 'Always'] },
        { id: 'end_notes',    label: 'Endgame Notes',       type: 'textarea' },
      ]
    },
    {
      section: 'Overall',
      color: 'teal',
      questions: [
        { id: 'overall_rating',   label: 'Overall Rating',    type: 'radio',    options: ['1 — Weak', '2 — Below Avg', '3 — Average', '4 — Strong', '5 — Excellent'] },
        { id: 'overall_strategy', label: 'Best Alliance Role', type: 'radio',   options: ['Captain', 'Support', 'Defense', 'Flexible'] },
        { id: 'overall_notes',    label: 'Additional Notes',  type: 'textarea' },
      ]
    }
  ]
};

// ── STATE ────────────────────────────────────────────────────
let STATE = {
  role: null,
  identity: null,
  currentTab: null,
  syncStatus: 'idle',
  competition: '',      // current competition name

  setup: {
    eventName: '',
    numMatches: 0,
    rotationInterval: 3,
    teams: [],
  },
  roster: [],
  driveTeam: [],        // shared across all sections
  prematchGroups: [],   // scout groups only (no Drive Team entry)
  prematchPits: [],     // pit crew for pre-match section
  matchGroups: [],
  matchPits: [],        // pit crew for match section
  playoffGroups: [],
  playoffPits: [],      // pit crew for playoff section
  prematchData: [],
  matchData: [],
  playoffData: [],
};

// ── UTILS ────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function saveLocal() {
  localStorage.setItem('foxbots_state', JSON.stringify({
    role: STATE.role,
    identity: STATE.identity,
    competition: STATE.competition,
    setup: STATE.setup,
    roster: STATE.roster,
    driveTeam: STATE.driveTeam,
    prematchGroups: STATE.prematchGroups,
    prematchPits: STATE.prematchPits,
    matchGroups: STATE.matchGroups,
    matchPits: STATE.matchPits,
    playoffGroups: STATE.playoffGroups,
    playoffPits: STATE.playoffPits,
    prematchData: STATE.prematchData,
    matchData: STATE.matchData,
    playoffData: STATE.playoffData,
  }));
}

function loadLocal() {
  try {
    const s = localStorage.getItem('foxbots_state');
    if (s) { Object.assign(STATE, JSON.parse(s)); return true; }
  } catch(e) {}
  return false;
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  setTimeout(() => t.className = '', 2500);
}

function showLoading(text = 'Loading...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('show');
}

function setSyncStatus(status) {
  STATE.syncStatus = status;
  const dot = document.getElementById('sync-dot');
  dot.className = 'sync-dot' + (status === 'syncing' ? ' syncing' : status === 'error' ? ' error' : '');
}

function fuzzyMatchTeam(input, teams) {
  if (!input) return null;
  const inp = String(input).trim().toLowerCase();
  let match = teams.find(t => String(t.number) === inp);
  if (match) return { team: match, confidence: 'exact' };
  match = teams.find(t => t.name.toLowerCase() === inp);
  if (match) return { team: match, confidence: 'exact' };
  match = teams.find(t => String(t.number).startsWith(inp) || inp.startsWith(String(t.number)));
  if (match) return { team: match, confidence: 'fuzzy' };
  match = teams.find(t => t.name.toLowerCase().includes(inp) || inp.includes(t.name.toLowerCase()));
  if (match) return { team: match, confidence: 'fuzzy' };
  let best = null, bestDist = Infinity;
  teams.forEach(t => {
    const d = levenshtein(inp, t.name.toLowerCase());
    if (d < bestDist) { bestDist = d; best = t; }
    const dn = levenshtein(inp, String(t.number));
    if (dn < bestDist) { bestDist = dn; best = t; }
  });
  if (best && bestDist <= 3) return { team: best, confidence: 'fuzzy' };
  return { team: best, confidence: 'flagged' };
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function initials(name) {
  return name.split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2);
}

function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function tryParse(str, def) {
  try { return JSON.parse(str); } catch(e) { return def; }
}

// ── BACKEND ──────────────────────────────────────────────────
async function apiPost(data) {
  setSyncStatus('syncing');
  if (STATE.competition) data.competition = STATE.competition;
  try {
    const res = await fetch(CONFIG.scriptUrl, { method: 'POST', body: JSON.stringify(data) });
    const json = await res.json();
    setSyncStatus('idle');
    return json;
  } catch(e) {
    setSyncStatus('error');
    showToast('Saved locally — will sync when connected', 'error');
    const queue = JSON.parse(localStorage.getItem('foxbots_queue')||'[]');
    queue.push(data);
    localStorage.setItem('foxbots_queue', JSON.stringify(queue));
    return { success: false };
  }
}

async function apiGet(type) {
  setSyncStatus('syncing');
  try {
    const comp = STATE.competition ? '&competition=' + encodeURIComponent(STATE.competition) : '';
    const res = await fetch(CONFIG.scriptUrl + '?type=' + type + comp);
    const json = await res.json();
    setSyncStatus('idle');
    return json.data;
  } catch(e) {
    setSyncStatus('error');
    return null;
  }
}

async function retryQueue() {
  const queue = JSON.parse(localStorage.getItem('foxbots_queue')||'[]');
  if (!queue.length) return;
  const remaining = [];
  for (const item of queue) {
    const res = await apiPost(item);
    if (!res.success) remaining.push(item);
  }
  localStorage.setItem('foxbots_queue', JSON.stringify(remaining));
  if (!remaining.length) showToast('Offline data synced!', 'success');
}

// ── AUTH ─────────────────────────────────────────────────────
let authRole = 'member';

function setAuthRole(role) {
  authRole = role;
  document.getElementById('role-member').classList.toggle('active', role === 'member');
  document.getElementById('role-captain').classList.toggle('active', role === 'captain');
}

async function attemptAuth() {
  const pw = document.getElementById('auth-pw').value;
  if (!pw) return;
  const hash = await sha256(pw);
  const target = authRole === 'captain' ? CONFIG.captainHash : CONFIG.memberHash;

  if (hash === target) {
    document.getElementById('auth-pw').classList.remove('error');
    document.getElementById('auth-error').style.display = 'none';
    STATE.role = authRole;
    saveLocal();
    document.getElementById('auth-screen').style.display = 'none';
    await loadAllData();
    if (authRole === 'captain') {
      STATE.identity = { name: 'Captain', group: 'Captain' };
      saveLocal();
      launchApp();
    } else {
      showIdentityScreen();
    }
  } else {
    document.getElementById('auth-pw').classList.add('error');
    document.getElementById('auth-error').style.display = 'block';
    document.getElementById('auth-pw').value = '';
  }
}

// ── IDENTITY ─────────────────────────────────────────────────
function showIdentityScreen() {
  const screen = document.getElementById('identity-screen');
  screen.style.display = 'flex';
  screen.style.flexDirection = 'column';
  renderIdentityList();
}

function renderIdentityList() {
  const list = document.getElementById('identity-list');
  const members = STATE.roster.filter(m => m.name && m.name !== 'Captain');

  if (!members.length) {
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      <h3>No team members yet</h3>
      <p>Ask your captain to add the roster in Setup</p>
    </div>`;
    return;
  }

  const groups = {};
  members.forEach(m => {
    const g = m.group || 'Unassigned';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  });

  list.innerHTML = Object.entries(groups).map(([group, mems]) => `
    <div class="section-label">${escHtml(group)}</div>
    ${mems.map(m => `
      <button class="identity-item" onclick="selectIdentity(${JSON.stringify(escHtml(m.name))}, ${JSON.stringify(escHtml(m.group||''))})">
        <div class="identity-avatar">${initials(m.name)}</div>
        <div>
          <div class="identity-name">${escHtml(m.name)}</div>
          <div class="identity-group">${escHtml(m.group||'')}</div>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    `).join('')}
  `).join('');
}

function selectIdentity(name, group) {
  STATE.identity = { name, group };
  saveLocal();
  document.getElementById('identity-screen').style.display = 'none';
  launchApp();
}

function switchIdentity() {
  if (STATE.role === 'captain') return;
  document.getElementById('identity-screen').style.display = 'flex';
  document.getElementById('identity-screen').style.flexDirection = 'column';
  renderIdentityList();
}

// ── APP LAUNCH ───────────────────────────────────────────────
async function loadAllData() {
  showLoading('Syncing data...');
  if (!STATE.competition) { hideLoading(); return; }
  const data = await apiGet('all');
  if (data) {
    if (data.setup && Array.isArray(data.setup)) {
      const setupMap = {};
      data.setup.forEach(row => {
        try { setupMap[row.key] = JSON.parse(row.value); } catch(e) { setupMap[row.key] = row.value; }
      });
      if (setupMap.eventName)       STATE.setup.eventName       = setupMap.eventName;
      if (setupMap.numMatches)      STATE.setup.numMatches      = setupMap.numMatches;
      if (setupMap.rotationInterval) STATE.setup.rotationInterval = setupMap.rotationInterval;
      if (setupMap.teams)           STATE.setup.teams           = setupMap.teams;
    }
    if (data.roster && Array.isArray(data.roster) && data.roster.length > 0) STATE.roster = data.roster;
    if (data.assignments && Array.isArray(data.assignments)) {
      const driveRow = data.assignments.find(a=>a.phase==='driveteam');
      if (driveRow) STATE.driveTeam = tryParse(driveRow.members, []);

      STATE.prematchGroups = data.assignments.filter(a=>a.phase==='prematch').map(a=>({
        groupName: a.group, members: tryParse(a.members,[]), teams: tryParse(a.targets,[]),
      }));
      const pmPitsRow = data.assignments.find(a=>a.phase==='prematch_pits');
      if (pmPitsRow) STATE.prematchPits = tryParse(pmPitsRow.members, []);

      STATE.matchGroups = data.assignments.filter(a=>a.phase==='match').map(a=>({
        groupName: a.group, members: tryParse(a.members,[]),
      }));
      const mPitsRow = data.assignments.find(a=>a.phase==='match_pits');
      if (mPitsRow) STATE.matchPits = tryParse(mPitsRow.members, []);

      STATE.playoffGroups = data.assignments.filter(a=>a.phase==='playoff').map(a=>({
        groupName: a.group, members: tryParse(a.members,[]), targets: tryParse(a.targets,[]), notes: a.notes||'',
      }));
      const plPitsRow = data.assignments.find(a=>a.phase==='playoff_pits');
      if (plPitsRow) STATE.playoffPits = tryParse(plPitsRow.members, []);
    }
    if (data.prematch) STATE.prematchData = data.prematch;
    if (data.match)    STATE.matchData    = data.match;
    if (data.playoff)  STATE.playoffData  = data.playoff;
    saveLocal();
  }
  hideLoading();
  retryQueue();
}

function launchApp() {
  document.getElementById('app').style.display = 'flex';
  updateTopbar();
  buildTabBar();
  switchTab(STATE.role === 'captain' ? 'setup' : 'prematch');
}

function updateTopbar() {
  const name = STATE.identity?.name || '?';
  document.getElementById('topbar-avatar').textContent = initials(name);
  document.getElementById('topbar-name').textContent = name;
}

// ── ICONS ────────────────────────────────────────────────────
const icons = {
  clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>`,
  lightning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
  trophy:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V8"/><path d="M14 22V8"/><path d="M6 4v8a6 6 0 0 0 12 0V4H6z"/></svg>`,
  gear:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  chart:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`,
  star:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  team:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  people:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><circle cx="19" cy="7" r="2"/><path d="M19 14h2a2 2 0 0 1 2 2v3"/></svg>`,
  group:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  info:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  warn:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  check:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg>`,
  x:         `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  clock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  empty:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
};

// ── TAB BAR ──────────────────────────────────────────────────
const TABS_MEMBER = [
  { id: 'prematch', label: 'Pre-Match', icon: icons.clipboard },
  { id: 'match',    label: 'Matches',   icon: icons.lightning },
  { id: 'playoffs', label: 'Playoffs',  icon: icons.trophy },
];
const TABS_CAPTAIN = [
  { id: 'setup',    label: 'Setup',     icon: icons.gear },
  { id: 'prematch', label: 'Pre-Match', icon: icons.clipboard },
  { id: 'match',    label: 'Matches',   icon: icons.lightning },
  { id: 'playoffs', label: 'Playoffs',  icon: icons.trophy },
  { id: 'results',  label: 'Results',   icon: icons.chart },
];

function buildTabBar() {
  const tabs = STATE.role === 'captain' ? TABS_CAPTAIN : TABS_MEMBER;
  document.getElementById('tabbar').innerHTML = tabs.map(t => `
    <button class="tab-btn" id="tab-${t.id}" onclick="switchTab('${t.id}')">
      ${t.icon}<span>${t.label}</span>
    </button>
  `).join('');
}

function switchTab(id) {
  STATE.currentTab = id;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const tabBtn = document.getElementById('tab-' + id);
  if (tabBtn) tabBtn.classList.add('active');
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  renderPage(id);
}

function renderPage(id) {
  switch(id) {
    case 'prematch': renderPrematch(); break;
    case 'match':    renderMatch();    break;
    case 'playoffs': renderPlayoffs(); break;
    case 'setup':    renderSetup();    break;
    case 'results':  renderResults();  break;
  }
}

// ── DRAWER ───────────────────────────────────────────────────
function openDrawer(title, bodyHtml) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = bodyHtml;
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}

// ── SETUP PAGE ───────────────────────────────────────────────
function renderSetup() {
  const s = STATE.setup;
  const roster = STATE.roster;

  document.getElementById('setup-content').innerHTML = `
    <!-- Competition -->
    <div class="card">
      <div class="card-header">
        <div class="card-header-icon">${icons.lightning}</div>
        <div>
          <div class="card-title">Competition</div>
          <div class="card-subtitle">${STATE.competition ? 'Active: ' + escHtml(STATE.competition) : 'No competition selected'}</div>
        </div>
      </div>
      <div class="card-body">
        ${STATE.competition ? `
          <div class="alert alert-teal">${icons.check} Currently scouting: <strong>${escHtml(STATE.competition)}</strong></div>
          <button class="btn btn-orange btn-full" onclick="newCompetition()">Start New Competition</button>
        ` : `
          <div class="alert alert-orange">${icons.warn} No competition active. Create one to get started.</div>
          <div class="form-group">
            <label class="form-label">Competition Name</label>
            <input class="form-input" id="new-comp-name" placeholder="e.g. Chesapeake Regional 2026">
          </div>
          <button class="btn btn-primary btn-full" onclick="createCompetition()">Create Competition</button>
        `}
      </div>
    </div>

    ${STATE.competition ? `
    <!-- Event Info -->
    <div class="card">
      <div class="card-header">
        <div class="card-header-icon">${icons.star}</div>
        <div><div class="card-title">Event Info</div></div>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Event Name</label>
          <input class="form-input" id="s-event" value="${escHtml(s.eventName)}" placeholder="e.g. Chesapeake Regional">
        </div>
        <div class="form-group">
          <label class="form-label">Number of Qualification Matches</label>
          <input class="form-input" id="s-matches" type="number" value="${s.numMatches||''}" placeholder="e.g. 60">
        </div>
        <div class="form-group mb-8">
          <label class="form-label">Match Rotation Interval (matches per shift)</label>
          <input class="form-input" id="s-rotation" type="number" value="${s.rotationInterval||3}" placeholder="e.g. 3">
        </div>
        <button class="btn btn-primary btn-full" onclick="saveEventInfo()">Save Event Info</button>
      </div>
    </div>

    <!-- Teams -->
    <div class="card">
      <div class="card-header">
        <div class="card-header-icon">${icons.team}</div>
        <div>
          <div class="card-title">Event Teams</div>
          <div class="card-subtitle">${s.teams.length} teams added</div>
        </div>
      </div>
      <div class="card-body">
        <div class="alert alert-teal">
          ${icons.info} Enter teams as "NUMBER Name" per line, e.g.<br><code>12345 RoboRockets<br>67890 Iron Eagles</code>
        </div>
        <div class="form-group">
          <textarea class="form-input" id="s-teams" rows="8" placeholder="12345 RoboRockets&#10;67890 Iron Eagles&#10;...">${s.teams.map(t=>t.number+' '+t.name).join('\n')}</textarea>
        </div>
        <button class="btn btn-primary btn-full" onclick="saveTeams()">Save Teams</button>
      </div>
    </div>

    <!-- Roster -->
    <div class="card">
      <div class="card-header">
        <div class="card-header-icon">${icons.people}</div>
        <div>
          <div class="card-title">Team Roster</div>
          <div class="card-subtitle">${roster.length} members</div>
        </div>
      </div>
      <div id="roster-list">${renderRosterList()}</div>
      <div class="card-body" style="padding-top:8px">
        <div class="flex gap-8">
          <input class="form-input" id="new-member-name" placeholder="Member name" style="flex:1">
          <input class="form-input" id="new-member-group" placeholder="Group (optional)" style="flex:1">
        </div>
        <button class="btn btn-primary btn-full mt-12" onclick="addMember()">Add Member</button>
      </div>
    </div>
    ` : ''}
  `;
}

function createCompetition() {
  const name = document.getElementById('new-comp-name')?.value.trim();
  if (!name) { showToast('Enter a competition name', ''); return; }
  STATE.competition = name;
  STATE.setup = { eventName: name, numMatches: 0, rotationInterval: 3, teams: [] };
  STATE.driveTeam = [];
  STATE.prematchGroups = []; STATE.prematchPits = [];
  STATE.matchGroups   = []; STATE.matchPits    = [];
  STATE.playoffGroups = []; STATE.playoffPits  = [];
  STATE.prematchData = [];
  STATE.matchData = [];
  STATE.playoffData = [];
  saveLocal();
  showToast('Competition created: ' + name, 'success');
  renderSetup();
}

function newCompetition() {
  if (!confirm('Start a new competition? Current assignments will clear. Old data stays saved in the sheet.')) return;
  STATE.competition = '';
  STATE.setup = { eventName: '', numMatches: 0, rotationInterval: 3, teams: [] };
  STATE.driveTeam = [];
  STATE.prematchGroups = []; STATE.prematchPits = [];
  STATE.matchGroups   = []; STATE.matchPits    = [];
  STATE.playoffGroups = []; STATE.playoffPits  = [];
  STATE.prematchData = [];
  STATE.matchData = [];
  STATE.playoffData = [];
  saveLocal();
  renderSetup();
}

function renderRosterList() {
  if (!STATE.roster.length) return `<div class="empty-state" style="padding:24px"><p>No members yet</p></div>`;
  return STATE.roster.map((m, i) => `
    <div class="list-item">
      <div class="identity-avatar" style="width:36px;height:36px;font-size:13px">${initials(m.name)}</div>
      <div class="list-item-main">
        <div class="list-item-title">${escHtml(m.name)}</div>
        <div class="list-item-sub">${escHtml(m.group||'No group')}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="removeMember(${i})">Remove</button>
    </div>
  `).join('');
}

function saveEventInfo() {
  STATE.setup.eventName       = document.getElementById('s-event').value.trim();
  STATE.setup.numMatches      = parseInt(document.getElementById('s-matches').value)||0;
  STATE.setup.rotationInterval = parseInt(document.getElementById('s-rotation').value)||3;
  saveLocal();
  apiPost({ type: 'setup', payload: STATE.setup });
  showToast('Event info saved', 'success');
}

function saveTeams() {
  const raw = document.getElementById('s-teams').value.trim();
  STATE.setup.teams = raw.split('\n').filter(l=>l.trim()).map(line => {
    const parts = line.trim().split(' ');
    const number = parts[0];
    const name = parts.slice(1).join(' ') || 'Team ' + number;
    return { number, name };
  });
  saveLocal();
  apiPost({ type: 'setup', payload: STATE.setup });
  showToast(`${STATE.setup.teams.length} teams saved`, 'success');
  renderSetup();
}

function addMember() {
  const name  = document.getElementById('new-member-name').value.trim();
  const group = document.getElementById('new-member-group').value.trim();
  if (!name) return;
  STATE.roster.push({ name, group });
  saveLocal();
  apiPost({ type: 'roster', members: STATE.roster });
  document.getElementById('new-member-name').value = '';
  document.getElementById('new-member-group').value = '';
  document.getElementById('roster-list').innerHTML = renderRosterList();
  showToast(name + ' added', 'success');
}

function removeMember(i) {
  STATE.roster.splice(i, 1);
  saveLocal();
  apiPost({ type: 'roster', members: STATE.roster });
  document.getElementById('roster-list').innerHTML = renderRosterList();
}

// ── PRE-MATCH ─────────────────────────────────────────────────
function renderPrematch() {
  if (STATE.role === 'captain') {
    document.getElementById('prematch-captain-view').classList.remove('hidden');
    document.getElementById('prematch-member-view').classList.add('hidden');
    renderPrematchCaptain();
  } else {
    document.getElementById('prematch-member-view').classList.remove('hidden');
    document.getElementById('prematch-captain-view').classList.add('hidden');
    renderPrematchMember();
  }
}

function renderPrematchCaptain() {
  const groups  = STATE.prematchGroups;
  const teams   = STATE.setup.teams;
  const members = STATE.roster.filter(m => m.name);
  const memberNames = members.map(m => m.name);

  // Compute who is assigned in this section (pits + scout groups), to grey out in other pickers
  const assignedInSection = getAssignedInSection(groups, STATE.prematchPits);

  // Drive team is shared — show it greyed out but not editable here (edit in any section)
  const driveGreyed = STATE.driveTeam.filter(n => !assignedInSection.includes(n));

  let html = `<div class="alert alert-teal">${icons.info} Changes auto-save. Drive Team is shared across all sections.</div>`;

  html += `
    <div class="card">
      <div class="card-header">
        <div class="card-header-icon">${icons.people}</div>
        <div><div class="card-title">Reserved Assignments</div></div>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Drive Team <span style="font-size:11px;color:var(--text-3)">(shared across all sections)</span></label>
          <div class="pill-select" id="pm-drive-team">${renderPillSelect(memberNames, STATE.driveTeam, assignedInSection.filter(n=>!STATE.driveTeam.includes(n)), 'onPrematchDriveToggle(this)')}</div>
        </div>
        <div class="form-group mb-8">
          <label class="form-label">Pits <span style="font-size:11px;color:var(--text-3)">(pre-match only)</span></label>
          <div class="pill-select" id="pm-pits">${renderPillSelect(memberNames, STATE.prematchPits, [...STATE.driveTeam, ...assignedInSection.filter(n=>!STATE.prematchPits.includes(n))], 'onPrematchPitsToggle(this)')}</div>
        </div>
      </div>
    </div>`;

  groups.forEach((group, gi) => { html += renderPrematchGroupCard(group, gi, memberNames, teams); });

  html += `
    <button class="btn btn-secondary btn-full mt-8" onclick="addPrematchGroup()">+ Add Scouting Group</button>`;

  document.getElementById('prematch-captain-content').innerHTML = html;
}

function renderPrematchGroupCard(group, gi, memberNames, teams) {
  // Grey out: drive team + anyone in pits + anyone in OTHER scout groups
  const otherGroupMembers = STATE.prematchGroups
    .filter((_, i) => i !== gi)
    .flatMap(g => g.members);
  const greyedMembers = [...new Set([...STATE.driveTeam, ...STATE.prematchPits, ...otherGroupMembers])];

  return `
    <div class="card" id="pmg-${gi}">
      <div class="card-header">
        <div class="card-header-icon">${icons.group}</div>
        <div style="flex:1">
          <input class="form-input" value="${escHtml(group.groupName)}"
            oninput="STATE.prematchGroups[${gi}].groupName=this.value"
            style="border:none;padding:0;background:transparent;font-size:15px;font-weight:700;width:100%" placeholder="Group name">
        </div>
        <button class="btn btn-sm btn-danger" onclick="removePrematchGroup(${gi})">Remove</button>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Members</label>
          <div class="pill-select" id="pmg-members-${gi}">${renderPillSelect(memberNames, group.members||[], greyedMembers, 'onPrematchGroupMemberToggle(this,'+gi+')')}</div>
        </div>
        <div class="form-group mb-8">
          <label class="form-label">Teams to Scout</label>
          <div class="pill-select" id="pmg-teams-${gi}">${renderPillSelect(teams.map(t=>t.number+' '+t.name),(group.teams||[]).map(t=>t.number+' '+t.name),[])}</div>
        </div>
      </div>
    </div>`;
}

// Render pills; greyedOut = array of values to show as disabled (already assigned elsewhere)
function renderPillSelect(options, selected, greyedOut = [], autoSaveFn = null) {
  return options.map(opt => {
    const sel      = selected.includes(opt) || selected.some(s => String(s) === String(opt));
    const greyed   = !sel && greyedOut.includes(opt);
    const fn       = greyed ? '' : (autoSaveFn ? `onclick="${autoSaveFn}"` : `onclick="pillToggle(this)"`) ;
    const disabled = greyed ? 'disabled' : '';
    return `<button class="pill-option ${sel?'selected':''} ${greyed?'disabled':''}" data-val="${escHtml(opt)}" ${fn} ${disabled}>${escHtml(opt)}</button>`;
  }).join('');
}

function pillToggle(el) {
  el.classList.toggle('selected');
}

function getPillSelected(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} .pill-option.selected`)).map(b=>b.dataset.val);
}

// Returns all members already assigned in any group/pits for a section (excluding Drive Team which is global)
function getAssignedInSection(sectionGroups, sectionPits) {
  const assigned = new Set(sectionPits);
  sectionGroups.forEach(g => g.members.forEach(m => assigned.add(m)));
  return Array.from(assigned);
}

// Auto-save helpers — called on every pill click in captain views
function autoSavePrematch() { savePrematchAssignments(true); }
function autoSaveMatch()    { saveMatchAssignments(true); }
function autoSavePlayoff()  { savePlayoffAssignments(true); }

// ── PREMATCH AUTO-SAVE HANDLERS ───────────────────────────────
function onPrematchDriveToggle(el) {
  pillToggle(el);
  // Sync drive team across all sections immediately
  STATE.driveTeam = getPillSelected('pm-drive-team');
  savePrematchAssignments(true);
  // Re-render other sections' drive team pills if they're visible (will sync on next render)
}

function onPrematchPitsToggle(el) {
  pillToggle(el);
  STATE.prematchPits = getPillSelected('pm-pits');
  savePrematchAssignments(true);
  renderPrematchCaptain(); // refresh grey-out state
}

function onPrematchGroupMemberToggle(el, gi) {
  pillToggle(el);
  STATE.prematchGroups[gi].members = getPillSelected('pmg-members-' + gi);
  savePrematchAssignments(true);
  renderPrematchCaptain(); // refresh grey-out state for other groups
}

function addPrematchGroup() {
  STATE.prematchGroups.push({ groupName: 'Group ' + (STATE.prematchGroups.length + 1), members: [], teams: [] });
  renderPrematchCaptain();
}

function removePrematchGroup(gi) {
  STATE.prematchGroups.splice(gi, 1);
  savePrematchAssignments(true);
  renderPrematchCaptain();
}

function savePrematchAssignments(silent = false) {
  const teams = STATE.setup.teams;
  // Collect current drive team and pits from DOM if pills exist
  const dtEl   = document.getElementById('pm-drive-team');
  const pitsEl = document.getElementById('pm-pits');
  if (dtEl)   STATE.driveTeam    = getPillSelected('pm-drive-team');
  if (pitsEl) STATE.prematchPits = getPillSelected('pm-pits');

  // Collect scout group members + teams from DOM
  STATE.prematchGroups.forEach((group, gi) => {
    const memsEl  = document.getElementById('pmg-members-' + gi);
    const teamsEl = document.getElementById('pmg-teams-' + gi);
    if (memsEl)  group.members = getPillSelected('pmg-members-' + gi);
    if (teamsEl) {
      const teamVals = getPillSelected('pmg-teams-' + gi);
      group.teams = teamVals.map(v => { const num = v.split(' ')[0]; return teams.find(t=>t.number===num)||{number:num,name:v}; });
    }
  });
  saveLocal();
  apiPost({ type: 'assignments', assignments: buildAssignments() });
  if (!silent) showToast('Pre-match assignments saved', 'success');
}

function buildAssignments() {
  return [
    { phase:'driveteam',    group:'Drive Team', members:STATE.driveTeam,    targets:[], notes:'' },
    { phase:'prematch_pits',group:'Pits',       members:STATE.prematchPits, targets:[], notes:'' },
    ...STATE.prematchGroups.map(g=>({phase:'prematch',group:g.groupName,members:g.members,targets:g.teams,notes:''})),
    { phase:'match_pits',   group:'Pits',       members:STATE.matchPits,    targets:[], notes:'' },
    ...STATE.matchGroups.map(g=>({phase:'match',group:g.groupName,members:g.members,targets:[],notes:''})),
    { phase:'playoff_pits', group:'Pits',       members:STATE.playoffPits,  targets:[], notes:'' },
    ...STATE.playoffGroups.map(g=>({phase:'playoff',group:g.groupName,members:g.members,targets:g.targets,notes:g.notes})),
  ];
}

function renderPrematchMember() {
  const identity = STATE.identity;

  // Check shared drive team first
  if (STATE.driveTeam && STATE.driveTeam.includes(identity.name)) {
    document.getElementById('prematch-member-content').innerHTML = `<div class="alert alert-teal">${icons.info} You're on the Drive Team — no pre-match scouting needed.</div>`;
    return;
  }
  // Check pre-match pits
  if (STATE.prematchPits && STATE.prematchPits.includes(identity.name)) {
    document.getElementById('prematch-member-content').innerHTML = `<div class="alert alert-orange">${icons.info} You're assigned to the Pits — no pre-match scouting needed.</div>`;
    return;
  }

  const myGroup = STATE.prematchGroups.find(g => g.members && g.members.includes(identity.name));

  if (!myGroup) {
    document.getElementById('prematch-member-content').innerHTML = `
      <div class="empty-state">${icons.empty}<h3>No assignment yet</h3><p>Your captain hasn't set up pre-match assignments yet. Check back soon.</p></div>`;
    return;
  }

  const teams     = myGroup.teams || [];
  const submitted = STATE.prematchData.filter(d=>d.submitter===identity.name).map(d=>d.teamNumber);
  document.getElementById('prematch-member-subtitle').textContent =
    `${teams.length} teams to scout · with ${myGroup.members.filter(m=>m!==identity.name).join(', ')||'solo'}`;

  if (!teams.length) {
    document.getElementById('prematch-member-content').innerHTML = `
      <div class="empty-state">${icons.empty}<h3>No teams assigned</h3><p>Your captain hasn't assigned any teams to your group yet.</p></div>`;
    return;
  }

  document.getElementById('prematch-member-content').innerHTML = `
    <div class="card">
      ${teams.map(team => {
        const done = submitted.includes(String(team.number));
        return `
          <button class="list-item" onclick="openPrematchForm('${escHtml(team.number)}','${escHtml(team.name)}')">
            <div class="match-badge" style="${done?'background:var(--green-light);color:var(--green)':''}">${done?'✓':team.number}</div>
            <div class="list-item-main">
              <div class="list-item-title">${escHtml(team.name)}</div>
              <div class="list-item-sub">${done?'Scouted ✓':'Tap to scout'}</div>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>`;
      }).join('')}
    </div>`;
}

// ── PRE-MATCH FORM ────────────────────────────────────────────
let currentFormState = {};
let currentFormTeam  = null;

function openPrematchForm(number, name) {
  currentFormTeam  = { number, name };
  currentFormState = {};
  const existing = STATE.prematchData.find(d=>d.submitter===STATE.identity.name&&d.teamNumber===String(number));
  if (existing) { try { currentFormState = JSON.parse(existing.responses); } catch(e) {} }
  openDrawer(`Scout: ${number} ${name}`, buildPrematchFormHtml());
}

function buildPrematchFormHtml() {
  return CONFIG.prematchForm.map(section => `
    <div style="margin-bottom:24px">
      <div class="scout-section-header ${section.color}">${section.section}</div>
      <div style="margin-top:14px">${section.questions.map(q=>buildFormQuestion(q)).join('')}</div>
    </div>
  `).join('') + `<button class="btn btn-primary btn-full" onclick="submitPrematchForm()">Submit Scouting Report</button>`;
}

function buildFormQuestion(q) {
  const val = currentFormState[q.id];
  switch(q.type) {
    case 'radio':
      return `<div class="form-group">
        <label class="form-label">${escHtml(q.label)}</label>
        <div class="radio-group">
          ${q.options.map(opt=>`
            <button class="radio-option ${val===opt?'selected':''}" onclick="setFormVal('${q.id}',this,'radio')" data-val="${escHtml(opt)}">
              <div class="radio-dot"></div>${escHtml(opt)}
            </button>`).join('')}
        </div>
      </div>`;
    case 'textarea':
      return `<div class="form-group">
        <label class="form-label">${escHtml(q.label)}</label>
        <textarea class="form-input" id="fq-${q.id}" onchange="currentFormState['${q.id}']=this.value">${escHtml(val||'')}</textarea>
      </div>`;
    case 'stepper':
      return `<div class="form-group">
        <label class="form-label">${escHtml(q.label)}</label>
        <div class="stepper">
          <button class="stepper-btn" onclick="stepperChange('${q.id}',-1)">−</button>
          <div class="stepper-val" id="sv-${q.id}">${val||0}</div>
          <button class="stepper-btn" onclick="stepperChange('${q.id}',1)">+</button>
        </div>
      </div>`;
    case 'toggle':
      return `<div class="toggle-row" style="padding:0 0 14px">
        <div><div class="toggle-label">${escHtml(q.label)}</div></div>
        <div class="toggle ${val?'on':''}" id="tog-${q.id}" onclick="toggleFormVal('${q.id}')"></div>
      </div>`;
    default: return '';
  }
}

function setFormVal(id, el, type) {
  if (type === 'radio') {
    el.closest('.radio-group').querySelectorAll('.radio-option').forEach(b=>b.classList.remove('selected'));
    el.classList.add('selected');
    currentFormState[id] = el.dataset.val;
  }
}

function stepperChange(id, delta) {
  currentFormState[id] = Math.max(0, (currentFormState[id]||0) + delta);
  document.getElementById('sv-'+id).textContent = currentFormState[id];
}

function toggleFormVal(id) {
  currentFormState[id] = !currentFormState[id];
  document.getElementById('tog-'+id).classList.toggle('on', currentFormState[id]);
}

async function submitPrematchForm() {
  CONFIG.prematchForm.forEach(section => {
    section.questions.forEach(q => {
      if (q.type === 'textarea') { const el = document.getElementById('fq-'+q.id); if (el) currentFormState[q.id] = el.value; }
    });
  });
  const entry = {
    type: 'prematch',
    submitter:  STATE.identity.name,
    teamNumber: String(currentFormTeam.number),
    teamName:   currentFormTeam.name,
    responses:  JSON.stringify(currentFormState),
  };
  const idx = STATE.prematchData.findIndex(d=>d.submitter===STATE.identity.name&&d.teamNumber===String(currentFormTeam.number));
  if (idx > -1) STATE.prematchData[idx] = entry; else STATE.prematchData.push(entry);
  saveLocal();
  closeDrawer();
  renderPrematchMember();
  showToast('Scouting report submitted!', 'success');
  await apiPost(entry);
}

// ── MATCH SCOUTING ────────────────────────────────────────────
function renderMatch() {
  if (STATE.role === 'captain') {
    document.getElementById('match-captain-view').classList.remove('hidden');
    document.getElementById('match-member-view').classList.add('hidden');
    renderMatchCaptain();
  } else {
    document.getElementById('match-member-view').classList.remove('hidden');
    document.getElementById('match-captain-view').classList.add('hidden');
    renderMatchMember();
  }
}

function renderMatchCaptain() {
  const memberNames = STATE.roster.filter(m=>m.name).map(m=>m.name);
  const numMatches  = STATE.setup.numMatches;
  const interval    = STATE.setup.rotationInterval;
  const scoutGroups = STATE.matchGroups;

  const assignedInSection = getAssignedInSection(scoutGroups, STATE.matchPits);

  let html = `
    <div class="alert alert-teal">${icons.info} Changes auto-save. Drive Team is shared across all sections.</div>
    <div class="card">
      <div class="card-header"><div class="card-header-icon">${icons.people}</div>
        <div><div class="card-title">Reserved</div></div>
      </div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Drive Team <span style="font-size:11px;color:var(--text-3)">(shared across all sections)</span></label>
          <div class="pill-select" id="ms-drive">${renderPillSelect(memberNames, STATE.driveTeam, assignedInSection.filter(n=>!STATE.driveTeam.includes(n)), 'onMatchDriveToggle(this)')}</div>
        </div>
        <div class="form-group mb-8">
          <label class="form-label">Pits <span style="font-size:11px;color:var(--text-3)">(match section only)</span></label>
          <div class="pill-select" id="ms-pits">${renderPillSelect(memberNames, STATE.matchPits, [...STATE.driveTeam, ...assignedInSection.filter(n=>!STATE.matchPits.includes(n))], 'onMatchPitsToggle(this)')}</div>
        </div>
      </div>
    </div>`;

  scoutGroups.forEach((group, gi) => {
    const otherGroupMembers = scoutGroups.filter((_,i)=>i!==gi).flatMap(g=>g.members);
    const greyedMembers = [...new Set([...STATE.driveTeam, ...STATE.matchPits, ...otherGroupMembers])];
    html += `
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <input class="form-input" value="${escHtml(group.groupName)}" id="mg-name-${gi}"
              oninput="STATE.matchGroups[${gi}].groupName=this.value"
              style="border:none;padding:0;background:transparent;font-size:15px;font-weight:700;width:100%" placeholder="Group name">
          </div>
          <button class="btn btn-sm btn-danger" onclick="removeMatchGroup(${gi})">Remove</button>
        </div>
        <div class="card-body">
          <label class="form-label">Members</label>
          <div class="pill-select" id="mg-members-${gi}">${renderPillSelect(memberNames, group.members||[], greyedMembers, 'onMatchGroupMemberToggle(this,'+gi+')')}</div>
        </div>
      </div>`;
  });

  if (scoutGroups.length >= 2 && numMatches > 0) html += renderRotationPreview(scoutGroups, numMatches, interval);

  html += `<button class="btn btn-secondary btn-full mt-8" onclick="addMatchGroup()">+ Add Scouting Group</button>`;

  document.getElementById('match-captain-content').innerHTML = html;
}

function renderRotationPreview(scoutGroups, numMatches, interval) {
  const roles = ['Stands', 'Pits', 'Break'];
  let rows = '';
  for (let m = 1; m <= Math.min(numMatches, 12); m++) {
    const groupIdx = Math.floor((m-1)/interval) % scoutGroups.length;
    rows += `<div class="list-item" style="padding:10px 18px">
      <div class="match-badge" style="width:36px;height:36px;font-size:12px">${m}</div>
      <div class="list-item-main">
        ${scoutGroups.map((g,gi) => {
          const role = roles[(gi - groupIdx + scoutGroups.length) % scoutGroups.length];
          const cls  = role==='Stands'?'chip-teal':role==='Pits'?'chip-orange':'chip-gray';
          return `<span class="chip ${cls}" style="margin-right:4px;margin-bottom:4px">${escHtml(g.groupName)}: ${role}</span>`;
        }).join('')}
      </div>
    </div>`;
  }
  const more = numMatches > 12 ? `<div style="padding:10px 18px;font-size:13px;color:var(--text-3)">...and ${numMatches-12} more matches</div>` : '';
  return `<div class="card">
    <div class="card-header"><div class="card-header-icon">${icons.lightning}</div>
      <div><div class="card-title">Rotation Preview</div><div class="card-subtitle">First 12 matches</div></div>
    </div>${rows}${more}</div>`;
}

// ── MATCH AUTO-SAVE HANDLERS ──────────────────────────────────
function onMatchDriveToggle(el) {
  pillToggle(el);
  STATE.driveTeam = getPillSelected('ms-drive');
  saveMatchAssignments(true);
}

function onMatchPitsToggle(el) {
  pillToggle(el);
  STATE.matchPits = getPillSelected('ms-pits');
  saveMatchAssignments(true);
  renderMatchCaptain();
}

function onMatchGroupMemberToggle(el, gi) {
  pillToggle(el);
  STATE.matchGroups[gi].members = getPillSelected('mg-members-' + gi);
  saveMatchAssignments(true);
  renderMatchCaptain();
}

function addMatchGroup() {
  STATE.matchGroups.push({ groupName: 'Group ' + (STATE.matchGroups.length + 1), members: [] });
  renderMatchCaptain();
}

function removeMatchGroup(gi) {
  STATE.matchGroups.splice(gi, 1);
  saveMatchAssignments(true);
  renderMatchCaptain();
}

function saveMatchAssignments(silent = false) {
  const dtEl   = document.getElementById('ms-drive');
  const pitsEl = document.getElementById('ms-pits');
  if (dtEl)   STATE.driveTeam = getPillSelected('ms-drive');
  if (pitsEl) STATE.matchPits = getPillSelected('ms-pits');
  STATE.matchGroups.forEach((group, gi) => {
    const memsEl = document.getElementById('mg-members-' + gi);
    const nameEl = document.getElementById('mg-name-' + gi);
    if (memsEl) group.members = getPillSelected('mg-members-' + gi);
    if (nameEl) group.groupName = nameEl.value;
  });
  saveLocal();
  apiPost({ type: 'assignments', assignments: buildAssignments() });
  if (!silent) showToast('Match assignments saved', 'success');
}

function renderMatchMember() {
  const identity   = STATE.identity;
  const numMatches = STATE.setup.numMatches;
  const interval   = STATE.setup.rotationInterval || 3;
  const roles      = ['Stands', 'Pits', 'Break'];

  // Check shared drive team first
  if (STATE.driveTeam && STATE.driveTeam.includes(identity.name)) {
    document.getElementById('match-member-content').innerHTML = `<div class="alert alert-teal">${icons.info} You're on the Drive Team. Good luck!</div>`;
    return;
  }
  // Check match-section pits
  if (STATE.matchPits && STATE.matchPits.includes(identity.name)) {
    document.getElementById('match-member-content').innerHTML = `<div class="alert alert-orange">${icons.info} You're assigned to the Pits — no match scouting needed.</div>`;
    return;
  }

  const myGroup = STATE.matchGroups.find(g=>g.members&&g.members.includes(identity.name));

  if (!myGroup) {
    document.getElementById('match-member-content').innerHTML = `
      <div class="empty-state">${icons.empty}<h3>No assignment yet</h3><p>Your captain hasn't set up match assignments yet.</p></div>`;
    return;
  }

  const scoutGroups = STATE.matchGroups;
  const myGroupIdx  = scoutGroups.findIndex(g=>g.groupName===myGroup.groupName);

  let matchItems = '';
  for (let m = 1; m <= (numMatches||20); m++) {
    const groupIdx = Math.floor((m-1)/interval) % scoutGroups.length;
    const myRole   = roles[(myGroupIdx - groupIdx + scoutGroups.length) % scoutGroups.length];
    const submitted = STATE.matchData.find(d=>d.submitter===identity.name&&d.matchNumber===m);
    matchItems += `
      <button class="list-item" onclick="${myRole!=='Break'?`openMatchForm(${m},'${myRole}')`:''}"
        ${myRole==='Break'?'style="opacity:0.5;pointer-events:none"':''}>
        <div class="match-badge ${myRole==='Pits'?'pits':myRole==='Break'?'break':''}">${m}</div>
        <div class="list-item-main">
          <div class="list-item-title">Match ${m} — ${myRole}</div>
          <div class="list-item-sub">${submitted?'Notes submitted ✓':myRole==='Break'?'On break':'Tap to add notes'}</div>
        </div>
        ${myRole!=='Break'?`<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`:''}
      </button>`;
  }

  document.getElementById('match-member-subtitle').textContent =
    `${myGroup.groupName} · with ${myGroup.members.filter(m=>m!==identity.name).join(', ')||'solo'}`;
  document.getElementById('match-member-content').innerHTML = `<div class="card">${matchItems}</div>`;
}

// ── MATCH FORM ────────────────────────────────────────────────
let currentMatchForm = { match: 0, location: '', teams: [{},{},{},{}] };

function openMatchForm(matchNum, location) {
  const existing = STATE.matchData.find(d=>d.submitter===STATE.identity.name&&d.matchNumber===matchNum);
  currentMatchForm = {
    match: matchNum, location,
    teams: existing ? tryParse(existing.teams,[{},{},{},{}]) : [{},{},{},{}]
  };
  openDrawer(`Match ${matchNum} — ${location}`, buildMatchFormHtml());
}

function buildMatchFormHtml() {
  const labels = ['Red 1','Red 2','Blue 1','Blue 2'];
  return labels.map((label, i) => {
    const t = currentMatchForm.teams[i] || {};
    return `
      <div style="margin-bottom:20px">
        <div class="scout-section-header ${i<2?'orange':'teal'}">${label}</div>
        <div style="margin-top:12px">
          <div class="form-group">
            <label class="form-label">Team Number / Name</label>
            <input class="form-input" value="${escHtml(t.team||'')}"
              onchange="currentMatchForm.teams[${i}].team=this.value" placeholder="e.g. 12345">
          </div>
          <div class="form-group mb-8">
            <label class="form-label">Notes (at least one observation)</label>
            <textarea class="form-input" rows="3"
              onchange="currentMatchForm.teams[${i}].notes=this.value"
              placeholder="What did you observe?">${escHtml(t.notes||'')}</textarea>
          </div>
        </div>
      </div>`;
  }).join('') + `<button class="btn btn-primary btn-full" onclick="submitMatchForm()">Submit Match Notes</button>`;
}

async function submitMatchForm() {
  const entry = {
    type: 'match',
    submitter:   STATE.identity.name,
    matchNumber: currentMatchForm.match,
    location:    currentMatchForm.location,
    teams:       JSON.stringify(currentMatchForm.teams),
  };
  const idx = STATE.matchData.findIndex(d=>d.submitter===STATE.identity.name&&d.matchNumber===currentMatchForm.match);
  if (idx > -1) STATE.matchData[idx] = entry; else STATE.matchData.push(entry);
  saveLocal();
  closeDrawer();
  renderMatchMember();
  showToast('Match notes submitted!', 'success');
  await apiPost(entry);
}

// ── PLAYOFFS ─────────────────────────────────────────────────
function renderPlayoffs() {
  if (STATE.role === 'captain') {
    document.getElementById('playoffs-captain-view').classList.remove('hidden');
    document.getElementById('playoffs-member-view').classList.add('hidden');
    renderPlayoffsCaptain();
  } else {
    document.getElementById('playoffs-member-view').classList.remove('hidden');
    document.getElementById('playoffs-captain-view').classList.add('hidden');
    renderPlayoffsMember();
  }
}

function renderPlayoffsCaptain() {
  const memberNames = STATE.roster.filter(m=>m.name).map(m=>m.name);
  const teams       = STATE.setup.teams;
  const dt          = STATE.driveTeam || [];
  const plPits      = STATE.playoffPits || [];

  // Greyed-out for drive team picker = pit + all group members
  const dtGreyed = [...new Set([...plPits, ...STATE.playoffGroups.flatMap(g=>g.members||[])])];
  // Greyed-out for pit picker = driveTeam + all group members
  const pitsGreyed = [...new Set([...dt, ...STATE.playoffGroups.flatMap(g=>g.members||[])])];

  let html = `
    <div class="alert alert-orange">${icons.info} Assign pairs to recruit specific alliance partners.</div>
    <div class="card">
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Drive Team (shared across all sections)</label>
          <div class="pill-select" id="pl-drive-team">
            ${renderPillSelect(memberNames, dt, dtGreyed, 'onPlayoffDriveToggle(this)')}
          </div>
        </div>
        <div class="form-group mb-8">
          <label class="form-label">Pit Crew (playoff section)</label>
          <div class="pill-select" id="pl-pits">
            ${renderPillSelect(memberNames, plPits, pitsGreyed, 'onPlayoffPitsToggle(this)')}
          </div>
        </div>
      </div>
    </div>`;

  STATE.playoffGroups.forEach((group, gi) => {
    // Grey out = driveTeam + playoffPits + all OTHER group members
    const otherGroupMembers = STATE.playoffGroups
      .filter((_,i)=>i!==gi).flatMap(g=>g.members||[]);
    const greyedMembers = [...new Set([...dt, ...plPits, ...otherGroupMembers])];

    html += `
      <div class="card">
        <div class="card-header">
          <div style="flex:1">
            <input class="form-input" value="${escHtml(group.groupName)}" id="plg-name-${gi}"
              style="border:none;padding:0;background:transparent;font-size:15px;font-weight:700;width:100%"
              placeholder="Pairing name" onchange="onPlayoffGroupNameChange(${gi},this.value)">
          </div>
          <button class="btn btn-sm btn-danger" onclick="removePlayoffGroup(${gi})">Remove</button>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label">Members</label>
            <div class="pill-select" id="plg-members-${gi}">
              ${renderPillSelect(memberNames, group.members||[], greyedMembers, `onPlayoffGroupMemberToggle(this,${gi})`)}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Target Teams to Recruit</label>
            <div class="pill-select" id="plg-teams-${gi}">
              ${renderPillSelect(teams.map(t=>t.number+' '+t.name),(group.targets||[]).map(t=>t.number+' '+t.name),[],`onPlayoffGroupTeamToggle(this,${gi})`)}
            </div>
          </div>
          <div class="form-group mb-8">
            <label class="form-label">Why They'd Be a Good Partner (talking points)</label>
            <textarea class="form-input" id="plg-notes-${gi}" rows="3"
              placeholder="e.g. Strong auto, good defense..."
              onchange="onPlayoffGroupNotesChange(${gi},this.value)">${escHtml(group.notes||'')}</textarea>
          </div>
        </div>
      </div>`;
  });

  html += `<button class="btn btn-secondary btn-full mt-8" onclick="addPlayoffGroup()">+ Add Pairing</button>`;
  document.getElementById('playoffs-captain-content').innerHTML = html;
}

// ── PLAYOFF AUTO-SAVE HANDLERS ────────────────────────────────
function onPlayoffDriveToggle(el) {
  pillToggle(el);
  STATE.driveTeam = getPillSelected('pl-drive-team');
  savePlayoffAssignments(true);
}

function onPlayoffPitsToggle(el) {
  pillToggle(el);
  STATE.playoffPits = getPillSelected('pl-pits');
  savePlayoffAssignments(true);
  renderPlayoffsCaptain();
}

function onPlayoffGroupMemberToggle(el, gi) {
  pillToggle(el);
  STATE.playoffGroups[gi].members = getPillSelected('plg-members-' + gi);
  savePlayoffAssignments(true);
  renderPlayoffsCaptain();
}

function onPlayoffGroupTeamToggle(el, gi) {
  pillToggle(el);
  const teams    = STATE.setup.teams;
  const teamVals = getPillSelected('plg-teams-' + gi);
  STATE.playoffGroups[gi].targets = teamVals.map(v => {
    const num = v.split(' ')[0];
    return teams.find(t=>t.number===num) || { number: num, name: v };
  });
  savePlayoffAssignments(true);
}

function onPlayoffGroupNameChange(gi, val) {
  STATE.playoffGroups[gi].groupName = val;
  savePlayoffAssignments(true);
}

function onPlayoffGroupNotesChange(gi, val) {
  STATE.playoffGroups[gi].notes = val;
  savePlayoffAssignments(true);
}

function addPlayoffGroup() {
  STATE.playoffGroups.push({ groupName: 'Pairing ' + (STATE.playoffGroups.length+1), members: [], targets: [], notes: '' });
  renderPlayoffsCaptain();
}

function removePlayoffGroup(gi) {
  STATE.playoffGroups.splice(gi, 1);
  savePlayoffAssignments(true);
  renderPlayoffsCaptain();
}

function savePlayoffAssignments(silent = false) {
  const dtEl   = document.getElementById('pl-drive-team');
  const pitsEl = document.getElementById('pl-pits');
  if (dtEl)   STATE.driveTeam   = getPillSelected('pl-drive-team');
  if (pitsEl) STATE.playoffPits = getPillSelected('pl-pits');
  // groups are updated in-place by individual handlers; persist name/notes if elements exist
  STATE.playoffGroups.forEach((group, gi) => {
    const nameEl  = document.getElementById('plg-name-' + gi);
    const notesEl = document.getElementById('plg-notes-' + gi);
    if (nameEl)  group.groupName = nameEl.value;
    if (notesEl) group.notes     = notesEl.value;
  });
  saveLocal();
  apiPost({ type: 'assignments', assignments: buildAssignments() });
  if (!silent) showToast('Playoff assignments saved', 'success');
}

function renderPlayoffsMember() {
  const identity = STATE.identity;

  // Check shared drive team first
  if (STATE.driveTeam && STATE.driveTeam.includes(identity.name)) {
    document.getElementById('playoffs-member-content').innerHTML = `<div class="alert alert-teal">${icons.info} You're on the Drive Team. Good luck in playoffs!</div>`;
    return;
  }
  // Check playoff-section pits
  if (STATE.playoffPits && STATE.playoffPits.includes(identity.name)) {
    document.getElementById('playoffs-member-content').innerHTML = `<div class="alert alert-orange">${icons.info} You're assigned to the Pits — no playoff recruiting needed.</div>`;
    return;
  }

  const myGroup = STATE.playoffGroups.find(g=>g.members&&g.members.includes(identity.name));

  if (!myGroup) {
    document.getElementById('playoffs-member-content').innerHTML = `
      <div class="empty-state">${icons.empty}<h3>No playoff assignment</h3><p>Your captain hasn't set up playoff assignments yet.</p></div>`;
    return;
  }

  const targets    = myGroup.targets || [];
  const myContacts = STATE.playoffData.filter(d=>d.submitter===identity.name);

  const targetHtml = targets.map(t => {
    const contact = myContacts.find(c=>c.teamNumber===String(t.number));
    const status  = contact ? contact.status : 'pending';
    return `
      <div class="status-row">
        <div class="status-icon ${status}">${status==='good'?icons.check:status==='bad'?icons.x:icons.clock}</div>
        <div class="list-item-main">
          <div class="list-item-title">${escHtml(t.number)} ${escHtml(t.name)}</div>
          <div class="list-item-sub">${status==='good'?'Went well!':status==='bad'?"Didn't go well":'Not contacted yet'}</div>
          <div class="status-btn-row">
            <button class="status-btn ${status==='good'?'good':''}" onclick="setPlayoffStatus('${escHtml(t.number)}','${escHtml(t.name)}','good')">✓ Went Well</button>
            <button class="status-btn ${status==='bad'?'bad':''}"  onclick="setPlayoffStatus('${escHtml(t.number)}','${escHtml(t.name)}','bad')">✗ Didn't Go Well</button>
          </div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('playoffs-member-content').innerHTML = `
    ${myGroup.notes ? `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><div class="card-header-icon">${icons.star}</div>
          <div><div class="card-title">Talking Points</div><div class="card-subtitle">From your captain</div></div>
        </div>
        <div class="card-body"><p style="font-size:14px;line-height:1.6">${escHtml(myGroup.notes)}</p></div>
      </div>` : ''}
    <div class="card">
      <div class="card-header"><div class="card-header-icon">${icons.trophy}</div>
        <div>
          <div class="card-title">Your Target Teams</div>
          <div class="card-subtitle">with ${myGroup.members.filter(m=>m!==identity.name).join(', ')||'solo'}</div>
        </div>
      </div>
      ${targetHtml || `<div class="empty-state" style="padding:24px"><p>No target teams assigned</p></div>`}
    </div>`;
}

async function setPlayoffStatus(number, name, status) {
  const entry = { type: 'playoff', submitter: STATE.identity.name, teamNumber: String(number), status, notes: '' };
  const idx = STATE.playoffData.findIndex(d=>d.submitter===STATE.identity.name&&d.teamNumber===String(number));
  if (idx > -1) STATE.playoffData[idx] = entry; else STATE.playoffData.push(entry);
  saveLocal();
  renderPlayoffsMember();
  await apiPost(entry);
}

// ── RESULTS ──────────────────────────────────────────────────
function renderResults() {
  const teams = STATE.setup.teams;
  if (!teams.length) {
    document.getElementById('results-content').innerHTML = `
      <div class="empty-state">${icons.empty}<h3>No teams yet</h3><p>Add teams in Setup first.</p></div>`;
    return;
  }

  const teamData = {};
  teams.forEach(t => { teamData[t.number] = { team: t, prematch: [], match: [], flagged: false }; });

  STATE.prematchData.forEach(d => {
    const result = fuzzyMatchTeam(d.teamNumber || d.teamName, teams);
    if (result && result.team) {
      const key = result.team.number;
      if (!teamData[key]) teamData[key] = { team: result.team, prematch: [], match: [], flagged: false };
      teamData[key].prematch.push({ ...d, matchConfidence: result.confidence });
      if (result.confidence === 'flagged') teamData[key].flagged = true;
    }
  });

  STATE.matchData.forEach(d => {
    tryParse(d.teams, []).forEach(t => {
      if (!t.team) return;
      const result = fuzzyMatchTeam(t.team, teams);
      if (result && result.team) {
        const key = result.team.number;
        if (!teamData[key]) teamData[key] = { team: result.team, prematch: [], match: [], flagged: false };
        teamData[key].match.push({ match: d.matchNumber, location: d.location, notes: t.notes, submitter: d.submitter, confidence: result.confidence });
        if (result.confidence === 'flagged') teamData[key].flagged = true;
      }
    });
  });

  const html = Object.values(teamData).map(td => {
    const { team, prematch, match, flagged } = td;
    const total = prematch.length + match.length;
    return `
      <div class="result-team-card">
        <div class="result-team-header" onclick="toggleResultCard('rc-${team.number}')">
          <div>
            <div class="result-team-num">${escHtml(team.number)}</div>
            <div class="result-team-name">${escHtml(team.name)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${flagged?`<span class="chip chip-orange">⚠ Flag</span>`:''}
            <span class="chip chip-teal">${total} report${total!==1?'s':''}</span>
            <svg class="result-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </div>
        <div id="rc-${team.number}" style="display:none">
          ${prematch.length ? `
            <div style="padding:12px 18px 0"><div class="section-label">Pre-Match Reports (${prematch.length})</div></div>
            ${prematch.map(r=>`
              <div class="list-item" onclick="openResultDetail(${JSON.stringify(escHtml(JSON.stringify(r)))})">
                <div class="list-item-main">
                  <div class="list-item-title">by ${escHtml(r.submitter)}</div>
                  <div class="list-item-sub">${r.matchConfidence==='fuzzy'?'⚠ Fuzzy match':'Exact match'}</div>
                </div>
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </div>`).join('')}` : ''}
          ${match.length ? `
            <div style="padding:12px 18px 0"><div class="section-label">Match Notes (${match.length})</div></div>
            ${match.map(r=>`
              <div class="list-item">
                <div class="match-badge ${r.location==='Pits'?'pits':''}" style="width:36px;height:36px;font-size:12px">${r.match}</div>
                <div class="list-item-main">
                  <div class="list-item-title">Match ${r.match} — ${escHtml(r.location||'Field')}</div>
                  <div class="list-item-sub">${escHtml(r.notes||'No notes')}</div>
                  <div class="text-xs text-muted mt-8">by ${escHtml(r.submitter)}</div>
                </div>
              </div>`).join('')}` : ''}
          ${!total?`<div style="padding:16px 18px;font-size:14px;color:var(--text-3)">No data yet for this team.</div>`:''}
        </div>
      </div>`;
  }).join('');

  document.getElementById('results-content').innerHTML = html;
}

function toggleResultCard(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function openResultDetail(jsonStr) {
  try {
    const data      = JSON.parse(jsonStr);
    const responses = tryParse(data.responses, {});
    let html = `<div class="text-sm text-muted mb-8">Submitted by ${escHtml(data.submitter)}</div>`;
    CONFIG.prematchForm.forEach(section => {
      html += `<div class="section-label">${section.section}</div>`;
      section.questions.forEach(q => {
        const val = responses[q.id];
        if (val !== undefined && val !== '' && val !== null) {
          html += `<div class="toggle-row" style="padding:10px 0">
            <div class="toggle-label" style="font-size:13px;color:var(--text-2)">${escHtml(q.label)}</div>
            <div class="fw-600 text-sm">${escHtml(String(val))}</div>
          </div>`;
        }
      });
    });
    openDrawer('Pre-Match Report', html);
  } catch(e) {}
}

// ── BOOT ─────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const restored = loadLocal();
  if (restored && STATE.role && STATE.identity) {
    document.getElementById('auth-screen').style.display = 'none';
    await loadAllData();
    launchApp();
  }
  retryQueue();
});
