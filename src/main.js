/**
 * 韩语听写 App — ES Module Entry Point (Vite)
 * 所有依赖通过 import 加载，无全局变量污染
 */

import { VOCABULARY, POS_NAMES }      from './vocabulary.js';
import { FIREBASE_CONFIG, FIREBASE_ENABLED } from './firebase-config.js';
import romanize from 'romanize-korean';
import apiWordsRaw from './data/api-words.json';
const API_WORDS = Array.isArray(apiWordsRaw) ? apiWordsRaw : [];

// ────────────────────────────────────────────────────────────
//  MERGE LOCAL + API VOCAB (去重)
// ────────────────────────────────────────────────────────────
function mergeVocab(local, api) {
  const seen = new Set(local.map(w => w.korean));
  const filtered = api.filter(w => !seen.has(w.korean));
  return [...local, ...filtered];
}

// ────────────────────────────────────────────────────────────
//  CONSTANTS
// ────────────────────────────────────────────────────────────
const LEVELS_SYSTEM = [
  { level:1, name:'냉면',       icon:'🍜', xp:0    },
  { level:2, name:'돈까스',     icon:'🍱', xp:100  },
  { level:3, name:'쌀국수',     icon:'🍲', xp:250  },
  { level:4, name:'닭갈비',     icon:'🍗', xp:500  },
  { level:5, name:'비빔밥',     icon:'🥗', xp:900  },
  { level:6, name:'된장찌개',   icon:'🍵', xp:1500 },
  { level:7, name:'김치전',     icon:'🥘', xp:2500 },
  { level:8, name:'김치등갈비', icon:'🍖', xp:4000 },
  { level:9, name:'갈비찜',     icon:'👑', xp:6000 },
];

const TOPIK_INFO = [
  { n:1, label:'初级上', color:'#10b981' },
  { n:2, label:'初级下', color:'#3b82f6' },
  { n:3, label:'中级上', color:'#8b5cf6' },
  { n:4, label:'中级下', color:'#f59e0b' },
  { n:5, label:'高级上', color:'#ef4444' },
  { n:6, label:'高级下', color:'#1e293b' },
];

// ────────────────────────────────────────────────────────────
//  REACTIVE STATE
// ────────────────────────────────────────────────────────────
const State = {
  user: null,
  profile: null,
  allWords: mergeVocab(VOCABULARY, API_WORDS),  // 本地词库 + API 预取词库
  currentWord: null,
  sessionCorrect: 0,
  sessionWrong: 0,
  sessionStreak: 0,
  resultShown: false,
  hintShown: false,
  isReviewMode: false,
  reviewQueue: [],
  sentencePromise: null,
  analyzePromise: null,
  speechRate: 1.0,
  speechVolume: 1.0,
  firebaseApp: null,
  friends: [],
  pendingRequests: [],
};

// ────────────────────────────────────────────────────────────
//  LOCAL STORAGE
// ────────────────────────────────────────────────────────────
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem('kr_'+k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('kr_'+k, JSON.stringify(v)); } catch {} },
};

// ────────────────────────────────────────────────────────────
//  PROFILE
// ────────────────────────────────────────────────────────────
function getProfile() {
  if (State.profile) return State.profile;
  return LS.get('profile', {
    username: 'Guest', score: 0, totalAnswered: 0, totalCorrect: 0,
    bestStreak: 0, activeLevels: [1, 2], wrongBank: {},
    avatar: '🐱', bio: '', studyStreak: 0, lastStudyDate: '',
    masteredWords: {}, wordStreak: {},
  });
}

function saveProfile(p) {
  State.profile = p;
  LS.set('profile', p);
  if (FIREBASE_ENABLED && State.user && !State.user.isGuest) {
    const db = firebase.firestore();
    db.collection('users').doc(State.user.uid).set({
      username: p.username, score: p.score,
      totalAnswered: p.totalAnswered, totalCorrect: p.totalCorrect,
      bestStreak: p.bestStreak, activeLevels: p.activeLevels,
      avatar: p.avatar || '🐱', bio: p.bio || '',
      studyStreak: p.studyStreak || 0, lastStudyDate: p.lastStudyDate || '',
      masteredWords: p.masteredWords || {},
      masteredCount: Object.keys(p.masteredWords || {}).length,
      wrongBank: p.wrongBank || {},
      lastActive: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(e => console.warn('Firestore write:', e));
  }
}

const getWrongBank = () => getProfile().wrongBank || {};
function saveWrongBank(wb) {
  const p = getProfile(); p.wrongBank = wb;
  State.profile = p; LS.set('profile', p);
}

// ────────────────────────────────────────────────────────────
//  LEVEL SYSTEM
// ────────────────────────────────────────────────────────────
function getLevelInfo(xp) {
  let cur = LEVELS_SYSTEM[0];
  LEVELS_SYSTEM.forEach(l => { if (xp >= l.xp) cur = l; });
  return cur;
}
function getNextLevel(xp) {
  return LEVELS_SYSTEM.find(l => xp < l.xp) || null;
}

// ────────────────────────────────────────────────────────────
//  TTS  (Google Cloud Neural2 → fallback Web Speech API)
// ────────────────────────────────────────────────────────────
const ttsCache = {};
let currentAudio = null;

async function speak(text, rate) {
  if (!text) return;
  const slow = rate != null && rate < 0.85;
  const cacheKey = text + (slow ? '_slow' : '');

  // Stop any current audio
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  // Pre-unlock audio context with a silent play during the user gesture
  const unlockAudio = new Audio();
  unlockAudio.play().catch(() => {});

  try {
    let audioB64 = ttsCache[cacheKey];
    if (!audioB64) {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, slow }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      audioB64 = data.audio;
      ttsCache[cacheKey] = audioB64;
    }
    const audio = new Audio('data:audio/mp3;base64,' + audioB64);
    audio.volume = State.speechVolume;
    currentAudio = audio;
    await audio.play();
  } catch (e) {
    showToast('TTS错误: ' + e.message);
  }
}

// ────────────────────────────────────────────────────────────
//  WORD POOL
// ────────────────────────────────────────────────────────────
function getWordPool() {
  const p = getProfile();
  const levels = p.activeLevels || [1, 2];
  const mastered = p.masteredWords || {};
  return State.allWords.filter(w => levels.includes(w.level) && !mastered[w.id]);
}

function pickWord() {
  const pool = getWordPool();
  if (!pool.length) return null;
  const bank = getWrongBank();
  const weighted = [];
  pool.forEach(w => {
    const n = 1 + Math.min((bank[w.id]?.count || 0) * 2, 6);
    for (let i = 0; i < n; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}

function addToWrongBank(id) {
  const bank = getWrongBank();
  if (!bank[id]) bank[id] = { count: 0, word: State.currentWord };
  bank[id].count++;
  saveWrongBank(bank);
}
function removeFromWrongBank(id) {
  const bank = getWrongBank();
  if (bank[id]) {
    bank[id].count = Math.max(0, bank[id].count - 1);
    if (!bank[id].count) delete bank[id];
  }
  saveWrongBank(bank);
}

// ── 掌握系统 ────────────────────────────────────────────────
function checkWordMastery(id) {
  const p = getProfile();
  const streak = p.wordStreak || {};
  streak[id] = (streak[id] || 0) + 1;
  p.wordStreak = streak;

  if (streak[id] >= 3) {
    // 已掌握：加入 masteredWords，删除 wordStreak 记录
    const mastered = p.masteredWords || {};
    mastered[id] = true;
    p.masteredWords = mastered;
    delete streak[id];
    // 同时从错题库移除
    const bank = p.wrongBank || {};
    delete bank[id];
    p.wrongBank = bank;
    saveProfile(p);
    const word = State.currentWord;
    showToast(`🎉 已完全掌握「${word?.korean || ''}」！`);
    updateMasteryProgress();
  } else {
    saveProfile(p);
    // 提示剩余次数（仅第1、2次答对时）
    if (streak[id] === 1) showFloatingXP('1/3 ✓');
    else if (streak[id] === 2) showFloatingXP('2/3 ✓✓');
  }
}

function resetWordStreak(id) {
  const p = getProfile();
  const streak = p.wordStreak || {};
  if (streak[id]) {
    delete streak[id];
    p.wordStreak = streak;
    saveProfile(p);
  }
}

function updateMasteryProgress() {
  const mastered = Object.keys(getProfile().masteredWords || {}).length;
  const total = State.allWords.length;
  const pct = total > 0 ? (mastered / total * 100).toFixed(1) : 0;

  // 首页进度条
  const textEl = $('mastery-text');
  const barEl  = $('mastery-bar-fill');
  if (textEl) textEl.textContent = `${mastered} / ${total} 词已掌握`;
  if (barEl)  barEl.style.width  = pct + '%';

  // Profile 页进度条
  const pTextEl = $('profile-mastery-text');
  const pBarEl  = $('profile-mastery-bar');
  const pSubEl  = $('profile-mastery-sub');
  if (pTextEl) pTextEl.textContent = mastered + ' 词';
  if (pBarEl)  pBarEl.style.width  = pct + '%';
  if (pSubEl)  pSubEl.textContent  = `占全部词库 ${pct}%（共 ${total} 词）`;

  // 若当前词库全部掌握，提醒换级
  const pool = getWordPool();
  if (pool.length === 0 && State.currentScreen === 'practice') {
    showToast('🏆 当前词库全部掌握！请在主页选择更高等级继续挑战');
  }
}

// ────────────────────────────────────────────────────────────
//  SCORE
// ────────────────────────────────────────────────────────────
function addScore(xp) {
  const p = getProfile();
  const prev = p.score || 0;
  p.score = prev + xp;
  const prevLv = getLevelInfo(prev).level;
  const newLv  = getLevelInfo(p.score).level;
  saveProfile(p);
  updateHeaderUI();
  if (newLv > prevLv) triggerLevelUp(newLv);
}

// ────────────────────────────────────────────────────────────
//  ROUTER
// ────────────────────────────────────────────────────────────
// expose globally so inline onclick=""  still works
window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.screen === name));

  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  State.currentScreen = name;

  const init = { home: initHome, practice: initPractice, review: initReview,
                 friends: initFriends, profile: initProfile, settings: initSettings };
  init[name]?.();
};

// ────────────────────────────────────────────────────────────
//  FIREBASE
// ────────────────────────────────────────────────────────────
function initFirebase() {
  if (!FIREBASE_ENABLED) { showScreen('auth'); return; }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(user => {
      if (user) {
        State.user = user;
        loadUserProfile(user.uid).then(() => showScreen('home'));
      } else {
        showScreen('auth');
      }
    });
  } catch (e) {
    console.error('Firebase init failed:', e);
    showScreen('auth');
  }
}

async function loadUserProfile(uid) {
  try {
    const doc = await firebase.firestore().collection('users').doc(uid).get();
    if (doc.exists) {
      const d = doc.data();
      const local = LS.get('profile', {});
      State.profile = {
        username: d.username || 'User', score: d.score || 0,
        totalAnswered: d.totalAnswered || 0, totalCorrect: d.totalCorrect || 0,
        bestStreak: d.bestStreak || 0, activeLevels: d.activeLevels || [1,2],
        wrongBank: d.wrongBank || local.wrongBank || {},
        avatar: d.avatar || local.avatar || '🐱',
        bio: d.bio || local.bio || '',
        studyStreak: d.studyStreak || local.studyStreak || 0,
        lastStudyDate: d.lastStudyDate || local.lastStudyDate || '',
        masteredWords: d.masteredWords || local.masteredWords || {},
        wordStreak: local.wordStreak || {},
      };
      LS.set('profile', State.profile);
    }
  } catch (e) { console.warn('loadUserProfile:', e); }
}

// ────────────────────────────────────────────────────────────
//  AUTH SCREEN
// ────────────────────────────────────────────────────────────
function initAuth() {
  const loginTab = $('auth-tab-login'), regTab = $('auth-tab-register');
  const loginForm = $('auth-form-login'), regForm = $('auth-form-register');

  loginTab.onclick = () => {
    loginTab.classList.add('active'); regTab.classList.remove('active');
    loginForm.classList.remove('hidden'); regForm.classList.add('hidden');
    clearAuthError();
  };
  regTab.onclick = () => {
    regTab.classList.add('active'); loginTab.classList.remove('active');
    regForm.classList.remove('hidden'); loginForm.classList.add('hidden');
    clearAuthError();
  };

  $('auth-guest-btn').onclick = () => {
    State.user = { isGuest: true, uid: 'guest' };
    State.profile = LS.get('profile', {
      username:'游客', score:0, totalAnswered:0, totalCorrect:0,
      bestStreak:0, activeLevels:[1,2], wrongBank:{},
    });
    LS.set('profile', State.profile);
    showScreen('home');
  };

  $('auth-login-btn').onclick = () => {
    if (!FIREBASE_ENABLED) { showAuthError('Firebase 尚未配置，请先填写 .env 文件'); return; }
    const email = $('login-email').value.trim(), pass = $('login-pass').value;
    if (!email || !pass) { showAuthError('请填写邮箱和密码'); return; }
    setAuthLoading(true);
    firebase.auth().signInWithEmailAndPassword(email, pass)
      .then(uc => { State.user = uc.user; return loadUserProfile(uc.user.uid); })
      .then(() => { setAuthLoading(false); showScreen('home'); })
      .catch(e => { setAuthLoading(false); showAuthError(authErrMsg(e.code)); });
  };

  $('auth-register-btn').onclick = () => {
    if (!FIREBASE_ENABLED) { showAuthError('Firebase 尚未配置，请先填写 .env 文件'); return; }
    const uname = $('reg-username').value.trim();
    const email = $('reg-email').value.trim();
    const pass  = $('reg-pass').value;
    const pass2 = $('reg-pass2').value;
    if (!uname || !email || !pass) { showAuthError('请填写所有字段'); return; }
    if (uname.length < 2) { showAuthError('用户名至少 2 个字符'); return; }
    if (pass.length < 6)  { showAuthError('密码至少 6 位'); return; }
    if (pass !== pass2)   { showAuthError('两次密码不一致'); return; }
    setAuthLoading(true);
    firebase.auth().createUserWithEmailAndPassword(email, pass)
      .then(uc => {
        State.user = uc.user;
        const np = { username:uname, score:0, totalAnswered:0, totalCorrect:0,
                     bestStreak:0, activeLevels:[1,2], wrongBank:{} };
        State.profile = np; LS.set('profile', np);
        return firebase.firestore().collection('users').doc(uc.user.uid).set({
          username: uname, email, score:0, totalAnswered:0, totalCorrect:0,
          bestStreak:0, activeLevels:[1,2],
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastActive: firebase.firestore.FieldValue.serverTimestamp(),
        });
      })
      .then(() => {
        setAuthLoading(false);
        firebase.auth().signOut();
        State.user = null;
        $('modal-register-success').classList.remove('hidden');
      })
      .catch(e => { setAuthLoading(false); showAuthError(authErrMsg(e.code)); });
  };

  [$('login-email'), $('login-pass')].forEach(el =>
    el.addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-login-btn').click(); }));

  $('forgot-pass-btn').onclick = () => {
    const email = $('login-email').value.trim();
    if (!email) { showAuthError('请先输入你的邮箱，再点忘记密码'); return; }
    firebase.auth().sendPasswordResetEmail(email)
      .then(() => {
        clearAuthError();
        const btn = $('forgot-pass-btn');
        btn.textContent = '✅ 重置邮件已发送，请查收';
        btn.style.color = 'var(--success, #10b981)';
        btn.disabled = true;
      })
      .catch(e => {
        const msg = e.code === 'auth/user-not-found' ? '该邮箱未注册'
                  : e.code === 'auth/invalid-email'  ? '邮箱格式不正确'
                  : '发送失败，请稍后再试';
        showAuthError(msg);
      });
  };
}

const showAuthError = msg => { const el = $('auth-error'); el.textContent = msg; el.classList.remove('hidden'); };
const clearAuthError = () => $('auth-error').classList.add('hidden');
const setAuthLoading = on => { $('auth-login-btn').disabled = on; $('auth-register-btn').disabled = on; };
const authErrMsg = code => ({
  'auth/user-not-found':      '用户不存在',
  'auth/wrong-password':      '密码错误',
  'auth/email-already-in-use':'该邮箱已被注册',
  'auth/invalid-email':       '邮箱格式不正确',
  'auth/weak-password':       '密码强度不够（至少6位）',
  'auth/too-many-requests':   '登录尝试太多，请稍后再试',
}[code] || '操作失败：' + code);

// ────────────────────────────────────────────────────────────
//  HOME SCREEN
// ────────────────────────────────────────────────────────────
function initHome() {
  const p    = getProfile();
  const info = getLevelInfo(p.score || 0);
  const next = getNextLevel(p.score || 0);

  $('home-avatar').textContent = p.avatar || '🐱';
  const h = new Date().getHours();
  $('home-greeting').textContent = (h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好') + '！';
  $('home-username').textContent  = p.username || 'Guest';
  $('home-level-chip').textContent = `${info.icon} Lv.${info.level} ${info.name}`;
  $('home-xp-chip').textContent    = `✦ ${p.score || 0}`;

  if (next) {
    const pct = ((p.score - info.xp) / (next.xp - info.xp) * 100).toFixed(1);
    $('home-xp-bar').style.width = Math.min(pct, 100) + '%';
    $('home-xp-label').textContent = `${p.score - info.xp} / ${next.xp - info.xp} XP → Lv.${next.level}`;
  } else {
    $('home-xp-bar').style.width = '100%';
    $('home-xp-label').textContent = '已达最高等级 👑';
  }

  const acc = p.totalAnswered > 0 ? Math.round(p.totalCorrect / p.totalAnswered * 100) : 0;
  $('home-stat-answered').textContent      = p.totalAnswered || 0;
  $('home-stat-accuracy').textContent      = acc + '%';
  $('home-stat-streak').textContent        = p.bestStreak || 0;
  $('home-stat-study-streak').textContent  = p.studyStreak || 0;

  buildLevelCards();
  loadLeaderboard();

  // 显示词库统计（已排除已掌握的词）
  const pool = getWordPool();
  const apiCount = pool.filter(w => w.fromApi).length;
  const masteredCount = Object.keys(getProfile().masteredWords || {}).length;
  const masteredNote = masteredCount > 0 ? ` · 已掌握 ${masteredCount} 词` : '';
  $('vocab-count').textContent = `练习池: ${pool.length} 词${masteredNote}${apiCount ? ` (含 ${apiCount} 个国立国语院词条)` : ''}`;

  updateMasteryProgress();
}

function updateHeaderUI() {
  const p    = getProfile();
  const info = getLevelInfo(p.score || 0);
  $('home-level-chip').textContent = `${info.icon} Lv.${info.level} ${info.name}`;
  $('home-xp-chip').textContent    = `✦ ${p.score || 0}`;
}


function buildLevelCards() {
  const active = getProfile().activeLevels || [1, 2];
  const grid = $('level-cards-grid');
  grid.innerHTML = '';

  TOPIK_INFO.forEach(t => {
    const div = document.createElement('div');
    div.className = 'level-card' + (active.includes(t.n) ? ' selected' : '');
    // 显示每个等级的词条数
    const count = State.allWords.filter(w => w.level === t.n).length;
    div.innerHTML = `<div class="level-card-num" style="color:${t.color}">T${t.n}</div>
                     <div class="level-card-name">${t.label}</div>
                     <div style="font-size:0.6rem;color:var(--text-muted);margin-top:2px">${count}词</div>`;
    div.onclick = () => {
      const cur = [...(getProfile().activeLevels || [1,2])];
      const idx = cur.indexOf(t.n);
      if (idx >= 0) {
        if (cur.length === 1) { showToast('至少选择一个等级'); return; }
        cur.splice(idx, 1);
      } else {
        cur.push(t.n); cur.sort((a,b) => a-b);
      }
      const pp = getProfile(); pp.activeLevels = cur; saveProfile(pp);
      buildLevelCards();
    };
    grid.appendChild(div);
  });

  // 全部按钮
  const all = document.createElement('button');
  all.className = 'level-card-all';
  const totalCount = State.allWords.length;
  all.innerHTML = `🌏 &nbsp;全部等级 (TOPIK 1-6) · ${totalCount} 词`;
  all.onclick = () => {
    const pp = getProfile(); pp.activeLevels = [1,2,3,4,5,6]; saveProfile(pp);
    buildLevelCards();
  };
  grid.appendChild(all);
}

function loadLeaderboard() {
  const container = $('home-leaderboard');
  container.innerHTML = '';
  if (!FIREBASE_ENABLED) {
    container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:12px">🔒 配置 Firebase 后可查看世界排名</div>';
    return;
  }
  firebase.firestore().collection('users').orderBy('score','desc').limit(5).get()
    .then(snap => {
      if (snap.empty) { container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:12px;font-size:0.85rem">暂无排名数据</div>'; return; }
      let rank = 1;
      snap.forEach(doc => {
        const d = doc.data(), isMe = State.user && doc.id === State.user.uid;
        const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'#'+rank;
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `<div class="rank-badge ${rank<=3?'r'+rank:''}">${medal}</div>
          <div class="lb-name">${d.username||'—'}${isMe?'<span class="lb-you">我</span>':''}</div>
          <div class="lb-score">✦ ${d.score||0}</div>`;
        container.appendChild(div); rank++;
      });
    }).catch(() => {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;text-align:center">排行榜加载失败</div>';
    });
}

// ────────────────────────────────────────────────────────────
//  PRACTICE SCREEN
// ────────────────────────────────────────────────────────────
function initPractice() {
  State.sessionCorrect = State.sessionWrong = State.sessionStreak = 0;
  updateSessionStats();
  nextWord(false);
}

function nextWord(fromReview) {
  State.resultShown = false;
  State.hintShown   = false;
  State.isReviewMode = !!fromReview;

  State.currentWord = (fromReview && State.reviewQueue.length > 0)
    ? State.reviewQueue.shift()
    : (() => { State.isReviewMode = false; return pickWord(); })();

  const w = State.currentWord;
  if (!w) {
    const masteredCount = Object.keys(getProfile().masteredWords || {}).length;
    if (masteredCount > 0) {
      showToast('🏆 当前词库全部掌握！请在主页选择更高等级');
    } else {
      showToast('请先在主页选择词库等级！');
    }
    showScreen('home');
    return;
  }

  const inp = $('practice-input');
  inp.value = ''; inp.className = 'input input-korean'; inp.disabled = false;
  $('practice-submit').disabled = false;
  $('practice-dontknow').disabled = false;
  $('practice-result').classList.add('hidden');
  $('practice-hint-rom').classList.add('hidden');
  $('practice-hint-btn').textContent = '💡 显示发音提示';

  // 词级徽章
  const lvClass = 't' + w.level;
  const badge = $('practice-level-badge');
  badge.className = 'topik-badge ' + lvClass;
  badge.textContent = 'TOPIK ' + w.level;

  // 含义 + 词性（新功能：练习时显示）
  $('practice-pos').textContent     = POS_NAMES[w.pos] || w.pos;
  $('practice-meaning').textContent  = w.meaning;

  // API 来源标注
  $('practice-source').textContent = w.fromApi ? '📡 国立国语院' : '';

  setTimeout(() => speak(w.korean), 300);
  setTimeout(() => inp.focus(), 350);

  // 词出现时立即在后台预生成例句，存入 State.sentencePromise
  // 等用户答完题调 showResult 时，例句通常已经就绪
  State.sentencePromise = prefetchSentence(w);
}

function dontKnow() {
  if (!State.currentWord || State.resultShown) return;
  State.resultShown = true;
  $('practice-input').value = '';
  $('practice-input').disabled = true;
  $('practice-submit').disabled = true;
  $('practice-dontknow').disabled = true;
  $('practice-input').className = 'input input-korean wrong';
  const p = getProfile();
  p.totalAnswered = (p.totalAnswered || 0) + 1;
  State.sessionWrong++;
  State.sessionStreak = 0;
  saveProfile(p);
  addToWrongBank(State.currentWord.id);
  resetWordStreak(State.currentWord.id);     // 不知道也重置该词连击
  recordStudyDay();
  updateSessionStats();
  showResult(false);
}

function submitAnswer() {
  if (!State.currentWord || State.resultShown) return;
  const answer  = $('practice-input').value.trim();
  const isRight = answer === State.currentWord.korean;

  State.resultShown = true;
  $('practice-input').disabled = true;
  $('practice-submit').disabled = true;
  $('practice-input').className = 'input input-korean ' + (isRight ? 'correct' : 'wrong');

  const p = getProfile();
  p.totalAnswered = (p.totalAnswered || 0) + 1;

  if (isRight) {
    State.sessionCorrect++;
    State.sessionStreak++;
    p.totalCorrect = (p.totalCorrect || 0) + 1;
    if (State.sessionStreak > (p.bestStreak || 0)) p.bestStreak = State.sessionStreak;
    const xp = 10 + Math.floor(State.sessionStreak / 3) * 5;
    saveProfile(p);
    addScore(xp);
    removeFromWrongBank(State.currentWord.id);
    showFloatingXP('+' + xp + ' XP');
    checkWordMastery(State.currentWord.id);  // 检查是否已掌握（连续3次）
  } else {
    State.sessionWrong++;
    State.sessionStreak = 0;
    saveProfile(p);
    addToWrongBank(State.currentWord.id);
    resetWordStreak(State.currentWord.id);   // 答错重置该词连击
  }
  recordStudyDay();
  updateSessionStats();
  showResult(isRight);
}

function recordStudyDay() {
  const p = getProfile();
  const today = new Date().toISOString().slice(0, 10);
  if (p.lastStudyDate === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  p.studyStreak = p.lastStudyDate === yesterday ? (p.studyStreak || 0) + 1 : 1;
  p.lastStudyDate = today;
  saveProfile(p);
  $('home-stat-study-streak').textContent = p.studyStreak;
}

function showResult(isRight) {
  const w = State.currentWord;
  $('practice-result').classList.remove('hidden');
  const st = $('practice-result-status');
  st.textContent = isRight ? '✅ 答对了！+XP' : '❌ 答错了';
  st.className   = 'result-status ' + (isRight ? 'correct' : 'wrong');
  $('practice-result-word').textContent    = w.korean;
  $('practice-result-meaning').textContent = w.rom ? `${w.meaning}  (${w.rom})` : w.meaning;

  // 词典释义（중국어 대역어 뜻풀이）：显示在词义下方作为补充说明
  const defEl = $('practice-result-definition');
  if (defEl) {
    defEl.textContent = w.exMeaning || '';
    defEl.style.display = w.exMeaning ? '' : 'none';
  }

  // 例句：全部用 Groq 生成，不使用本地词典例句
  const korEl     = $('practice-example-korean');
  const chineseEl = $('practice-example-chinese');
  korEl.textContent     = '例句生成中...';
  chineseEl.textContent = '';
  chineseEl.style.display = 'none';
  generateLevelSentence(w, korEl, chineseEl);
  // Reset AI panel
  $('practice-ai-result').classList.add('hidden');
  $('practice-ai-result').innerHTML = '';
  const aiBtn = $('practice-ai-analyze');
  aiBtn.disabled = false;
  aiBtn.textContent = '✨ AI 分析';

  // 答题结果出现时，后台静默预生成 AI 解析
  // 用户点按钮时直接取结果，无需等待
  State.analyzePromise = prefetchAnalyze(w);
}

function updateSessionStats() {
  $('s-correct').textContent = State.sessionCorrect;
  $('s-wrong').textContent   = State.sessionWrong;
  $('s-streak').textContent  = State.sessionStreak;
}

// ────────────────────────────────────────────────────────────
//  REVIEW SCREEN
// ────────────────────────────────────────────────────────────
function initReview() {
  const bank  = getWrongBank();
  const words = Object.values(bank).filter(e => e.count > 0).sort((a,b) => b.count - a.count);
  $('review-count').textContent = `${words.length} 个单词`;
  const list = $('review-list'), empty = $('review-empty'), wrap = $('review-start-wrap');
  list.innerHTML = '';
  if (!words.length) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  words.forEach(entry => {
    const w = entry.word;
    const div = document.createElement('div');
    div.className = 'review-item';
    div.innerHTML = `<div style="flex:1"><div class="review-word">${w.korean}</div>
      <div class="review-meaning">${POS_NAMES[w.pos]||w.pos} · ${w.meaning}</div></div>
      <div class="review-wrong-badge">错误 ${entry.count} 次</div>`;
    list.appendChild(div);
  });
}

// ────────────────────────────────────────────────────────────
//  FRIENDS SCREEN
// ────────────────────────────────────────────────────────────
function initFriends() {
  if (!FIREBASE_ENABLED || !State.user || State.user.isGuest) {
    $('friends-offline-msg').classList.remove('hidden');
    $('friends-content').classList.add('hidden');
    return;
  }
  $('friends-offline-msg').classList.add('hidden');
  $('friends-content').classList.remove('hidden');
  loadFriends(); loadFriendRequests(); loadFriendLeaderboard();
}

function loadFriends() {
  const list = $('friends-list');
  list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px">加载中...</div>';
  firebase.firestore().collection('users').doc(State.user.uid).collection('friends').get()
    .then(snap => {
      list.innerHTML = ''; State.friends = [];
      if (snap.empty) {
        list.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-icon">👥</div><div>还没有好友，搜索添加吧！</div></div>';
        return;
      }
      snap.forEach(doc => {
        const d = doc.data();
        State.friends.push({ uid: doc.id, username: d.username, score: d.score || 0, avatar: d.avatar || '👤' });
        list.appendChild(friendItem(doc.id, d.username, d.score || 0, 'friend', d.avatar));
      });
    }).catch(() => { list.innerHTML = '<div style="color:var(--danger);text-align:center">加载失败</div>'; });
}

function loadFriendRequests() {
  const section = $('friend-requests-section'), list = $('friend-requests-list');
  firebase.firestore().collection('users').doc(State.user.uid).collection('friendRequests').get()
    .then(snap => {
      if (snap.empty) { section.classList.add('hidden'); return; }
      section.classList.remove('hidden'); list.innerHTML = ''; State.pendingRequests = [];
      snap.forEach(doc => {
        const d = doc.data();
        State.pendingRequests.push({ uid: doc.id, username: d.fromUsername });
        list.appendChild(friendItem(doc.id, d.fromUsername, null, 'request'));
      });
      const badge = $('friends-nav-badge');
      if (badge) { badge.textContent = snap.size; badge.classList.toggle('hidden', snap.empty); }
    }).catch(() => {});
}

function loadFriendLeaderboard() {
  const lb = $('friends-leaderboard'); lb.innerHTML = '';
  firebase.firestore().collection('users').doc(State.user.uid).collection('friends').get()
    .then(snap => {
      const uids = [State.user.uid];
      snap.forEach(d => uids.push(d.id));
      return Promise.all(uids.map(id => firebase.firestore().collection('users').doc(id).get()));
    })
    .then(docs => {
      const entries = docs.filter(d => d.data()).sort((a,b) => (b.data().score||0) - (a.data().score||0));
      entries.forEach((doc, i) => {
        const d = doc.data(), isMe = doc.id === State.user.uid;
        const rank = i + 1, medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'#'+rank;
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `<div class="rank-badge ${rank<=3?'r'+rank:''}">${medal}</div>
          <div class="lb-name">${d.username||'—'}${isMe?'<span class="lb-you">我</span>':''}</div>
          <div class="lb-score">✦ ${d.score||0}</div>`;
        lb.appendChild(div);
      });
    }).catch(() => { lb.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;text-align:center">加载失败</div>'; });
}

function friendItem(uid, username, score, type, avatar) {
  const div = document.createElement('div');
  div.className = 'friend-item';
  const emo = avatar || '👤';
  const scoreHTML = score !== null ? `<div class="friend-score">✦ ${score} XP</div>` : '';
  const actHTML = type === 'request'
    ? `<div class="friend-actions">
        <button class="friend-action-btn btn-accept" onclick="acceptFriend('${uid}','${username}')">✓ 接受</button>
        <button class="friend-action-btn btn-decline" onclick="declineFriend('${uid}')">✕</button>
       </div>`
    : `<div class="friend-actions">
        <button class="friend-action-btn btn-remove" onclick="removeFriend('${uid}','${username}')">移除</button>
       </div>`;
  div.innerHTML = `<div class="friend-avatar">${emo}</div>
    <div class="friend-info"><div class="friend-name" onclick="viewFriendProfile('${uid}')" style="cursor:pointer;text-decoration:underline dotted">${username}</div>${scoreHTML}</div>${actHTML}`;
  return div;
}

function searchUser() {
  if (!FIREBASE_ENABLED) return;
  const q = $('friend-search-input').value.trim();
  if (q.length < 2) { showToast('请输入至少 2 个字符'); return; }
  const results = $('friend-search-results');
  results.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:10px">搜索中...</div>';
  firebase.firestore().collection('users')
    .where('username', '>=', q).where('username', '<=', q + '').limit(8).get()
    .then(snap => {
      results.innerHTML = '';
      if (snap.empty) { results.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:10px">没有找到用户</div>'; return; }
      snap.forEach(doc => {
        if (doc.id === State.user.uid) return;
        const d = doc.data();
        const already = State.friends.some(f => f.uid === doc.id);
        const div = document.createElement('div');
        div.className = 'friend-item';
        div.innerHTML = `<div class="friend-avatar">👤</div>
          <div class="friend-info"><div class="friend-name">${d.username}</div><div class="friend-score">✦ ${d.score||0} XP</div></div>
          <div class="friend-actions">${already
            ? '<span style="font-size:0.8rem;color:var(--success)">已添加</span>'
            : `<button class="friend-action-btn btn-add" onclick="sendFriendRequest('${doc.id}','${d.username}')">+ 添加</button>`
          }</div>`;
        results.appendChild(div);
      });
    }).catch(() => { results.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;text-align:center">搜索失败</div>'; });
}

// Expose friend actions globally
window.acceptFriend = (fromUid, fromUsername) => {
  const db = firebase.firestore(), uid = State.user.uid, p = getProfile();
  const batch = db.batch();
  batch.set(db.collection('users').doc(uid).collection('friends').doc(fromUid), { username:fromUsername, score:0, addedAt:firebase.firestore.FieldValue.serverTimestamp() });
  batch.set(db.collection('users').doc(fromUid).collection('friends').doc(uid), { username:p.username, score:p.score||0, addedAt:firebase.firestore.FieldValue.serverTimestamp() });
  batch.delete(db.collection('users').doc(uid).collection('friendRequests').doc(fromUid));
  batch.commit().then(() => { showToast('已添加好友 ' + fromUsername + '！'); initFriends(); }).catch(() => showToast('操作失败'));
};
window.declineFriend = fromUid => {
  firebase.firestore().collection('users').doc(State.user.uid).collection('friendRequests').doc(fromUid).delete()
    .then(() => { showToast('已拒绝'); initFriends(); });
};
window.removeFriend = (friendUid, name) => {
  if (!confirm('确定移除好友 ' + name + '？')) return;
  const db = firebase.firestore(), uid = State.user.uid;
  const batch = db.batch();
  batch.delete(db.collection('users').doc(uid).collection('friends').doc(friendUid));
  batch.delete(db.collection('users').doc(friendUid).collection('friends').doc(uid));
  batch.commit().then(() => { showToast('已移除好友'); initFriends(); });
};
window.sendFriendRequest = (toUid, toUsername) => {
  const p = getProfile();
  firebase.firestore().collection('users').doc(toUid).collection('friendRequests').doc(State.user.uid).set({
    fromUsername: p.username, fromUid: State.user.uid,
    sentAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).then(() => { showToast('好友申请已发送！'); $('friend-search-results').innerHTML = ''; $('friend-search-input').value = ''; })
    .catch(() => showToast('发送失败，请重试'));
};

// ────────────────────────────────────────────────────────────
//  PROFILE SCREEN
// ────────────────────────────────────────────────────────────
function initProfile() {
  const p = getProfile(), info = getLevelInfo(p.score || 0);
  $('profile-avatar').textContent     = p.avatar || '🐱';
  $('profile-username').textContent   = p.username || 'Guest';
  $('profile-level-name').textContent = `${info.icon} Lv.${info.level} ${info.name}`;
  $('profile-score').textContent      = `✦ ${p.score || 0} 总积分`;
  $('profile-total').textContent      = p.totalAnswered || 0;
  $('profile-correct').textContent    = p.totalCorrect  || 0;
  $('profile-acc').textContent        = p.totalAnswered > 0 ? Math.round(p.totalCorrect/p.totalAnswered*100)+'%' : '0%';
  $('profile-streak').textContent     = p.bestStreak || 0;

  const bioDisplay = $('profile-bio-display');
  bioDisplay.textContent  = p.bio || '还没有简介，点击编辑添加吧~';
  bioDisplay.style.fontStyle = p.bio ? 'normal' : 'italic';

  const list = $('profile-level-list'); list.innerHTML = '';
  LEVELS_SYSTEM.forEach(l => {
    const isCur = l.level === info.level, isUnlocked = (p.score||0) >= l.xp;
    const div = document.createElement('div');
    div.className = 'level-progress-item' + (isCur?' current':isUnlocked?' done':'');
    div.innerHTML = `<div class="level-icon">${l.icon}</div>
      <div class="level-info"><div class="level-name-text">Lv.${l.level} ${l.name}</div>
      <div class="level-xp-text">${l.xp} XP 解锁</div></div>
      ${isCur?'<span class="level-status-tag now">◀ 当前</span>'
       :isUnlocked?'<span class="level-status-tag done">✓ 已解锁</span>'
       :`<span class="level-status-tag locked">需 ${l.xp} XP</span>`}`;
    list.appendChild(div);
  });

  const isLoggedIn = FIREBASE_ENABLED && State.user && !State.user.isGuest;
  $('profile-bio-edit-btn').classList.toggle('hidden', !isLoggedIn);

  updateMasteryProgress();

  const changeUsernameBtn = $('profile-change-username-btn');
  if (changeUsernameBtn) {
    if (isLoggedIn) {
      changeUsernameBtn.classList.remove('hidden');
      changeUsernameBtn.onclick = () => {
        $('username-input-new').value = getProfile().username || '';
        $('username-change-error').classList.add('hidden');
        $('modal-change-username').classList.remove('hidden');
      };
    } else {
      changeUsernameBtn.classList.add('hidden');
    }
  }

  const logoutBtn = $('profile-logout-btn');
  if (isLoggedIn) {
    logoutBtn.classList.remove('hidden');
    logoutBtn.onclick = () => {
      State.user = null;
      State.profile = null;
      localStorage.removeItem('kr_profile');
      firebase.auth().signOut().catch(e => console.warn('signOut:', e));
      showScreen('auth');
    };
  } else {
    logoutBtn.classList.add('hidden');
  }
}

// ────────────────────────────────────────────────────────────
//  SETTINGS SCREEN
// ────────────────────────────────────────────────────────────
function initSettings() {
  State.speechRate   = LS.get('speechRate',   1.0);
  State.speechVolume = LS.get('speechVolume', 1.0);
  $('rate-slider').value  = State.speechRate;
  $('rate-value').textContent = State.speechRate.toFixed(1) + 'x';
  $('vol-slider').value   = State.speechVolume;
  $('vol-value').textContent  = Math.round(State.speechVolume * 100) + '%';

  // KRDict API key status
  const krKey = import.meta.env.VITE_KRDICT_KEY;
  $('krdict-status').textContent = krKey
    ? '✅ API Key 已配置，词库自动扩充中'
    : '⚠️ 未配置 — 在 .env 文件中填写 VITE_KRDICT_KEY';
  $('krdict-status').style.color = krKey ? 'var(--success)' : 'var(--warning)';
}

// ────────────────────────────────────────────────────────────
//  LEVEL UP MODAL
// ────────────────────────────────────────────────────────────
function triggerLevelUp(newLevel) {
  const info = LEVELS_SYSTEM.find(l => l.level === newLevel) || LEVELS_SYSTEM.at(-1);
  $('modal-level-text').textContent = `恭喜升级到 ${info.icon} Lv.${newLevel} ${info.name}！`;
  $('modal-levelup').classList.remove('hidden');
  speak('레벨 업!');
}

// ────────────────────────────────────────────────────────────
//  FLOATING XP + TOAST
// ────────────────────────────────────────────────────────────
function showFloatingXP(text) {
  const el = document.createElement('div');
  el.className = 'float-xp';
  el.textContent = text;
  el.style.cssText = 'top:80px;right:20px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 2500);
}

// ────────────────────────────────────────────────────────────
//  HELPERS
// ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ────────────────────────────────────────────────────────────
//  BIND EVENTS
// ────────────────────────────────────────────────────────────
function bindEvents() {
  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => showScreen(btn.dataset.screen)));

  // Home
  $('home-start-btn').addEventListener('click', () => showScreen('practice'));
  $('home-avatar').addEventListener('click', () => showScreen('profile'));

  // Practice
  $('practice-play-btn').addEventListener('click', () => State.currentWord && speak(State.currentWord.korean));
  $('practice-slow-btn').addEventListener('click', () => State.currentWord && speak(State.currentWord.korean, 0.5));
  $('practice-hint-btn').addEventListener('click', () => {
    State.hintShown = !State.hintShown;
    const el = $('practice-hint-rom');
    el.classList.toggle('hidden', !State.hintShown);
    $('practice-hint-btn').textContent = State.hintShown ? '💡 隐藏发音提示' : '💡 显示发音提示';
    if (!State.hintShown) return;
    const w = State.currentWord;
    if (!w) return;
    if (w.rom) { el.textContent = w.rom; return; }
    el.textContent = fetchRomanization(w) || '（暂无）';
  });
  $('practice-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (!State.resultShown) submitAnswer();
      else $('practice-next-btn').click();
    }
  });
  $('practice-submit').addEventListener('click', submitAnswer);
  $('practice-dontknow').addEventListener('click', dontKnow);
  $('practice-next-btn').addEventListener('click', () => nextWord(State.isReviewMode && State.reviewQueue.length > 0));
  $('practice-play-example').addEventListener('click', () => State.currentWord && speak(State.currentWord.example, State.speechRate * 0.9));
  $('practice-ai-analyze').addEventListener('click', () => { if (State.currentWord) analyzeWord(State.currentWord); });

  // Emoji picker
  $('emoji-picker-cancel').addEventListener('click', () => $('modal-emoji-picker').classList.add('hidden'));

  // Friend profile modal close
  $('fp-close').addEventListener('click', () => $('modal-friend-profile').classList.add('hidden'));

  // Bio edit modal
  $('profile-bio-edit-btn').addEventListener('click', () => {
    const p = getProfile();
    $('bio-input-modal').value = p.bio || '';
    $('bio-modal-count').textContent = (p.bio || '').length;
    $('modal-edit-bio').classList.remove('hidden');
  });
  $('bio-input-modal').addEventListener('input', () => {
    $('bio-modal-count').textContent = $('bio-input-modal').value.length;
  });
  $('bio-modal-cancel').addEventListener('click', () => $('modal-edit-bio').classList.add('hidden'));
  $('bio-modal-save').addEventListener('click', () => {
    const p = getProfile();
    p.bio = $('bio-input-modal').value.trim();
    saveProfile(p);
    $('profile-bio-display').textContent = p.bio || '还没有简介，点击编辑添加吧~';
    $('profile-bio-display').style.fontStyle = p.bio ? 'normal' : 'italic';
    $('modal-edit-bio').classList.add('hidden');
    showToast('简介已保存！');
  });

  // Review
  $('review-start-btn').addEventListener('click', () => {
    const bank = getWrongBank();
    State.reviewQueue = Object.values(bank).filter(e => e.count > 0)
      .sort((a,b) => b.count - a.count).map(e => e.word);
    if (!State.reviewQueue.length) return;
    showScreen('practice'); nextWord(true);
  });

  // Friends search
  $('friend-search-btn').addEventListener('click', searchUser);
  $('friend-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') searchUser(); });

  // Settings
  $('rate-slider').addEventListener('input', e => {
    State.speechRate = parseFloat(e.target.value);
    $('rate-value').textContent = State.speechRate.toFixed(1) + 'x';
    LS.set('speechRate', State.speechRate);
  });
  $('vol-slider').addEventListener('input', e => {
    State.speechVolume = parseFloat(e.target.value);
    $('vol-value').textContent = Math.round(State.speechVolume * 100) + '%';
    LS.set('speechVolume', State.speechVolume);
  });
  $('settings-test-btn').addEventListener('click', () => speak('안녕하세요! 한국어 받아쓰기 앱에 오신 것을 환영합니다.'));
  $('settings-reset-btn').addEventListener('click', () => {
    if (!confirm('确定重置所有学习进度？此操作无法撤销。')) return;
    ['profile','speechRate','speechVolume'].forEach(k => localStorage.removeItem('kr_' + k));
    State.profile = null;
    if (FIREBASE_ENABLED && State.user && !State.user.isGuest) {
      firebase.firestore().collection('users').doc(State.user.uid)
        .set({ score:0, totalAnswered:0, totalCorrect:0, bestStreak:0,
               masteredWords: {}, masteredCount: 0,
               lastActive: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    showToast('进度已重置！'); showScreen('home');
  });

  // Modal: level up
  $('modal-close-btn').addEventListener('click', () => {
    $('modal-levelup').classList.add('hidden'); initProfile();
  });

  // Modal: register success
  $('modal-register-ok-btn').addEventListener('click', () => {
    $('modal-register-success').classList.add('hidden');
    $('auth-tab-login').click();
    showScreen('auth');
  });

  // Modal: change username
  $('modal-username-cancel').addEventListener('click', () => {
    $('modal-change-username').classList.add('hidden');
  });
  $('modal-username-save').addEventListener('click', () => {
    const newName = $('username-input-new').value.trim();
    if (!newName || newName.length < 2) {
      $('username-change-error').textContent = '用户名至少 2 个字符';
      $('username-change-error').classList.remove('hidden');
      return;
    }
    $('modal-username-save').disabled = true;
    const p = getProfile();
    p.username = newName;
    saveProfile(p);
    $('modal-change-username').classList.add('hidden');
    $('modal-username-save').disabled = false;
    showToast('用户名已更新！');
    initProfile();
  });
}

function fetchRomanization(w) {
  try {
    const rom = romanize(w.korean) || '';
    w.rom = rom;
    return rom;
  } catch {
    return '';
  }
}

function formatGroqResult(text) {
  let html = '';
  const parts = text.split(/\[([^\]]+)\]/g);
  const labelMap = { '语法要点': '💡 语法要点', '学习提示': '🔖 学习提示' };
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i].trim();
    const content = (parts[i + 1] || '').trim();
    if (!content) continue;
    html += `<div class="ai-section-title" style="margin-top:10px">${labelMap[key] || key}</div>`;
    content.split('\n').filter(l => l.trim()).forEach(l => {
      html += `<div style="color:#374151">${l.trim()}</div>`;
    });
  }
  return html || `<div class="ai-section-title" style="margin-top:10px">💡 语法分析</div><div style="color:#374151">${text}</div>`;
}

// ────────────────────────────────────────────────────────────
//  AUTO TRANSLATION (Baidu Fanyi)
// ────────────────────────────────────────────────────────────
// AI Cache — localStorage (L1) + Firestore (L2 shared across users)
const CACHE_KEY_SENTENCE = 'aiCache_sentence';
const CACHE_KEY_ANALYZE  = 'aiCache_analyze';

function lsLoad(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } }
function lsSave(k, obj) { try { localStorage.setItem(k, JSON.stringify(obj)); } catch {} }

const sentenceCache = lsLoad(CACHE_KEY_SENTENCE);
const analyzeCache  = lsLoad(CACHE_KEY_ANALYZE);

function fsDb() { return typeof firebase !== 'undefined' && firebase.apps?.length ? firebase.firestore() : null; }

async function fsGet(docId) {
  const db = fsDb(); if (!db) return null;
  try { const d = await db.collection('aiCache').doc(docId).get(); return d.exists ? d.data() : null; } catch { return null; }
}
async function fsSet(docId, data) {
  const db = fsDb(); if (!db) return;
  try { await db.collection('aiCache').doc(docId).set(data); } catch {}
}

// 预生成例句：词出现时立即调用，返回 Promise 存入 State
// showResult 时直接 await 这个 Promise，通常已经完成
function prefetchSentence(w) {
  const level = w.level || 1;
  const localKey = (w.id || w.korean) + '_' + level;

  // L1: 内存缓存（当次 App 开启期间）
  if (sentenceCache[localKey]) {
    return Promise.resolve(sentenceCache[localKey]);
  }

  // L2: localStorage 持久缓存
  const lsAll = lsLoad(CACHE_KEY_SENTENCE);
  if (lsAll[localKey]) {
    sentenceCache[localKey] = lsAll[localKey];
    return Promise.resolve(lsAll[localKey]);
  }

  // L3: Firestore 共享缓存（所有用户共享，A 生成过 B 直接用）
  // 读取是异步的，但因为 prefetchSentence 在词出现时就启动，
  // 这 300-500ms 完全藏在用户答题时间里，感知不到
  const fsKey = 's_' + localKey;
  return fsGet(fsKey)
    .then(remote => {
      if (remote?.sentence) {
        // Firestore 命中：存入本地缓存，直接返回
        sentenceCache[localKey] = remote;
        lsSave(CACHE_KEY_SENTENCE, { ...lsLoad(CACHE_KEY_SENTENCE), [localKey]: remote });
        return remote;
      }
      // L4: Firestore 也没有，才调 Groq
      return fetch('/api/ai-sentence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: w.korean, meaning: w.meaning, pos: w.pos, level }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          const entry = { sentence: data.sentence || '', translation: data.translation || '' };
          sentenceCache[localKey] = entry;
          lsSave(CACHE_KEY_SENTENCE, { ...lsLoad(CACHE_KEY_SENTENCE), [localKey]: entry });
          fsSet(fsKey, entry); // fire-and-forget 写入 Firestore，下次任何用户都能命中
          return entry;
        });
    })
    .catch(() => ({ sentence: '', translation: '' }));
}

async function generateLevelSentence(w, korEl, chineseEl) {
  // 直接 await 已经在后台跑着的 Promise
  const entry = await (State.sentencePromise || prefetchSentence(w));
  const sentence    = entry.sentence    || '';
  const translation = entry.translation || '';
  korEl.textContent = sentence || '（例句生成失败，请重试）';
  chineseEl.textContent = translation;
  chineseEl.style.display = translation ? '' : 'none';
  if (sentence)    w.example = sentence;
  if (translation) w.exTrans = translation;
}


async function autoTranslateExample(text, el) {
  try {
    const resp = await fetch('/api/ai-example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    el.textContent = data.result || '';
  } catch {
    el.textContent = '';
    el.style.display = 'none';
  }
}

// ────────────────────────────────────────────────────────────
//  AI WORD ANALYSIS
// ────────────────────────────────────────────────────────────
const POS_MAP = {
  n: '名词', v: '动词', adj: '形容词', adv: '副词',
  conj: '连接词', det: '冠词/限定词', prep: '介词',
  pron: '代词', num: '数词', intj: '感叹词', aux: '助动词',
};

// 预生成 AI 解析（答题结果出现时后台静默启动，存入 State.analyzePromise）
function prefetchAnalyze(w) {
  const analyzeCacheKey = w.korean + '_' + (w.id || '');
  const analyzefsKey    = 'a_' + w.korean + '_' + (w.id || '');
  const posLabel        = POS_MAP[w.pos] || w.pos || '';

  // L1: 内存
  if (analyzeCache[analyzeCacheKey]) return Promise.resolve(analyzeCache[analyzeCacheKey]);

  // L2: localStorage
  const lsAll = lsLoad(CACHE_KEY_ANALYZE);
  if (lsAll[analyzeCacheKey]) {
    analyzeCache[analyzeCacheKey] = lsAll[analyzeCacheKey];
    return Promise.resolve(lsAll[analyzeCacheKey]);
  }

  // L3: Firestore（非阻塞，和例句一样藏在答题时间里）
  // → 命中：直接返回，用户点按钮时秒出
  // → 未命中：调 Groq，同时写入 Firestore 供其他用户共享
  return fsGet(analyzefsKey)
    .then(remote => {
      if (remote?.html) {
        analyzeCache[analyzeCacheKey] = remote.html;
        lsSave(CACHE_KEY_ANALYZE, { ...lsLoad(CACHE_KEY_ANALYZE), [analyzeCacheKey]: remote.html });
        return remote.html;
      }
      // L4: Groq
      const exampleTrans = w.exTrans || '';
      return fetch('/api/ai-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: w.korean, meaning: w.meaning, pos: posLabel, example: w.example, exampleTrans }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          const html = formatGroqResult(data.result);
          analyzeCache[analyzeCacheKey] = html;
          lsSave(CACHE_KEY_ANALYZE, { ...lsLoad(CACHE_KEY_ANALYZE), [analyzeCacheKey]: html });
          fsSet(analyzefsKey, { html }); // fire-and-forget，写入 Firestore 供所有用户共享
          return html;
        });
    })
    .catch(() => null);
}

async function analyzeWord(w) {
  const btn = $('practice-ai-analyze');
  const box = $('practice-ai-result');
  btn.disabled = true;
  btn.textContent = '分析中...';
  box.classList.remove('hidden');

  // 构建 baseHtml（例句 + 单词信息）
  const posLabel     = POS_MAP[w.pos] || w.pos || '';
  const exampleTrans = w.exTrans || '';
  const highlighted  = w.example
    ? w.example.replace(new RegExp(w.korean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        `<strong style="color:#7c3aed">${w.korean}</strong>`)
    : '';
  let baseHtml = '';
  if (highlighted) {
    baseHtml += `<div class="ai-section-title">📝 例句</div>`;
    baseHtml += `<div style="font-family:'Noto Sans KR',sans-serif;font-size:1rem;line-height:1.6">${highlighted}</div>`;
    if (exampleTrans) baseHtml += `<div style="color:#4b5563;margin-top:2px">${exampleTrans}</div>`;
  }
  baseHtml += `<div class="ai-section-title" style="margin-top:10px">📖 单词信息</div>`;
  if (posLabel) baseHtml += `<div>词性：${posLabel}</div>`;
  baseHtml += `<div>含义：${w.meaning}</div>`;
  if (w.rom) baseHtml += `<div>罗马音：${w.rom}</div>`;

  box.innerHTML = baseHtml + `<div class="ai-section-title" style="margin-top:10px">💡 AI 分析中...</div>`;

  // 直接 await 后台已经跑好的 Promise，通常已就绪
  const analysisHtml = await (State.analyzePromise || prefetchAnalyze(w));

  if (analysisHtml) {
    box.innerHTML = baseHtml + analysisHtml;
  } else {
    box.innerHTML = baseHtml + `<div class="ai-section-title" style="margin-top:10px">💡 语法分析</div><div style="color:#ef4444">分析失败，请重试</div>`;
  }
  btn.textContent = '✨ AI 分析';
  btn.disabled = false;
}

// ────────────────────────────────────────────────────────────
//  EMOJI AVATAR PICKER
// ────────────────────────────────────────────────────────────
const EMOJI_LIST = [
  '🐱','🐶','🐼','🐨','🐸','🦊','🐰','🦁','🐯','🐺',
  '🦝','🦉','🦋','🐠','🐧','🦄','🐲','🌸','⭐','🌈',
  '🎵','🎨','🏆','💎','🚀','🌙','☀️','🍀','🎯','👑',
  '🌺','🌻','🍓','🎸','📚','🎭','🎪','🔥','💫','🌊',
];

window.openEmojiPicker = function() {
  const p = getProfile();
  if (!p.username || p.username === 'Guest') { showToast('请先登录后再设置头像'); return; }
  const grid = $('emoji-grid');
  grid.innerHTML = '';
  EMOJI_LIST.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'emoji-option' + (e === (p.avatar || '🐱') ? ' selected' : '');
    btn.textContent = e;
    btn.onclick = () => {
      p.avatar = e;
      saveProfile(p);
      $('profile-avatar').textContent = e;
      $('home-avatar').textContent = e;
      $('modal-emoji-picker').classList.add('hidden');
      showToast('头像已更新！');
    };
    grid.appendChild(btn);
  });
  $('modal-emoji-picker').classList.remove('hidden');
};

// ────────────────────────────────────────────────────────────
//  FRIEND PROFILE VIEW
// ────────────────────────────────────────────────────────────
window.viewFriendProfile = function(uid) {
  if (!FIREBASE_ENABLED) return;
  $('fp-avatar').textContent  = '⏳';
  $('fp-username').textContent = '加载中...';
  $('fp-level').textContent   = '';
  $('fp-bio').textContent     = '';
  $('fp-accuracy').textContent = '—';
  $('fp-streak').textContent  = '—';
  $('fp-score').textContent   = '—';
  $('modal-friend-profile').classList.remove('hidden');

  firebase.firestore().collection('users').doc(uid).get().then(doc => {
    if (!doc.exists) { $('fp-username').textContent = '用户不存在'; return; }
    const d = doc.data();
    const info = getLevelInfo(d.score || 0);
    const acc  = d.totalAnswered > 0 ? Math.round(d.totalCorrect / d.totalAnswered * 100) : 0;
    $('fp-avatar').textContent   = d.avatar || '👤';
    $('fp-username').textContent = d.username || '—';
    $('fp-level').textContent    = `${info.icon} Lv.${info.level} ${info.name}`;
    $('fp-bio').textContent      = d.bio || '这个人很神秘，什么都没写~';
    $('fp-bio').style.fontStyle  = d.bio ? 'normal' : 'italic';
    $('fp-accuracy').textContent = acc + '%';
    $('fp-streak').textContent   = (d.studyStreak || 0) + '天';
    $('fp-score').textContent    = d.score || 0;
  }).catch(() => { $('fp-username').textContent = '加载失败'; });
};

// ────────────────────────────────────────────────────────────
//  ENTRY POINT
// ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  State.speechRate   = LS.get('speechRate',   1.0);
  State.speechVolume = LS.get('speechVolume', 1.0);
  bindEvents();
  initAuth();
  initFirebase();
});

// ────────────────────────────────────────────────────────────
//  PWA — 注册 Service Worker
// ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('[SW] 注册成功，scope:', reg.scope))
      .catch(err => console.warn('[SW] 注册失败:', err));
  });
}
