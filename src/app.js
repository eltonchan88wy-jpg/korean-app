// =====================================================
//  韩语听写 App — Main Application Logic
// =====================================================

// ===== CONSTANTS =====
var LEVELS_SYSTEM = [
  { level:1, name:"냉면",       icon:"🍜", xp:0     },
  { level:2, name:"돈까스",     icon:"🍱", xp:500   },
  { level:3, name:"쌀국수",     icon:"🍲", xp:1000  },
  { level:4, name:"닭갈비",     icon:"🍗", xp:1500  },
  { level:5, name:"비빔밥",     icon:"🥗", xp:2500  },
  { level:6, name:"된장찌개",   icon:"🍵", xp:4000  },
  { level:7, name:"김치전",     icon:"🥘", xp:5500  },
  { level:8, name:"김치등갈비", icon:"🍖", xp:7500  },
  { level:9, name:"갈비찜",     icon:"👑", xp:10000 },
];

var TOPIK_INFO = [
  { n:1, label:"初级上", color:"#10b981" },
  { n:2, label:"初级下", color:"#3b82f6" },
  { n:3, label:"中级上", color:"#8b5cf6" },
  { n:4, label:"中级下", color:"#f59e0b" },
  { n:5, label:"高级上", color:"#ef4444" },
  { n:6, label:"高级下", color:"#1e293b" },
];

// ===== STATE =====
var AppState = {
  user: null,           // Firebase user or guest object
  profile: null,        // { username, score, totalAnswered, totalCorrect, bestStreak, activeLevels }
  currentWord: null,
  sessionCorrect: 0,
  sessionWrong: 0,
  sessionStreak: 0,
  resultShown: false,
  hintShown: false,
  isReviewMode: false,
  reviewQueue: [],
  speechRate: 1.0,
  speechVolume: 1.0,
  friends: [],
  pendingRequests: [],  // incoming requests
  leaderboard: [],
  currentScreen: 'loading',
};

// ===== LOCAL STORAGE HELPERS =====
function lsGet(key, def) {
  try { var v = localStorage.getItem('kr_app_' + key); return v ? JSON.parse(v) : def; }
  catch(e) { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem('kr_app_' + key, JSON.stringify(val)); } catch(e) {}
}

// ===== PROFILE HELPERS =====
function getProfile() {
  if (AppState.profile) return AppState.profile;
  return lsGet('profile', {
    username: 'Guest',
    score: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    bestStreak: 0,
    activeLevels: [1, 2],
    wrongBank: {}
  });
}
function saveProfile(p) {
  AppState.profile = p;
  lsSet('profile', p);
  if (FIREBASE_ENABLED && AppState.user && !AppState.user.isGuest) {
    var db = firebase.firestore();
    db.collection('users').doc(AppState.user.uid).set({
      username: p.username,
      score: p.score,
      totalAnswered: p.totalAnswered,
      totalCorrect: p.totalCorrect,
      bestStreak: p.bestStreak,
      activeLevels: p.activeLevels,
      lastActive: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(function(e) { console.warn('Firestore write failed:', e); });
  }
}
function saveWrongBank(wb) {
  var p = getProfile();
  p.wrongBank = wb;
  AppState.profile = p;
  lsSet('profile', p);
}
function getWrongBank() { return getProfile().wrongBank || {}; }

// ===== LEVEL SYSTEM =====
function getLevelInfo(xp) {
  var cur = LEVELS_SYSTEM[0];
  LEVELS_SYSTEM.forEach(function(l) { if (xp >= l.xp) cur = l; });
  return cur;
}
function getNextLevel(xp) {
  for (var i = 0; i < LEVELS_SYSTEM.length; i++) {
    if (xp < LEVELS_SYSTEM[i].xp) return LEVELS_SYSTEM[i];
  }
  return null;
}

// ===== TTS =====
function speak(text, rate) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  var utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ko-KR';
  utt.rate = rate !== undefined ? rate : AppState.speechRate;
  utt.volume = AppState.speechVolume;
  window.speechSynthesis.speak(utt);
}

// ===== WORD POOL =====
function getWordPool() {
  var p = getProfile();
  var levels = p.activeLevels || [1,2];
  return VOCABULARY.filter(function(w) { return levels.indexOf(w.level) >= 0; });
}
function pickWord() {
  var pool = getWordPool();
  if (!pool.length) return null;
  var bank = getWrongBank();
  var weighted = [];
  pool.forEach(function(w) {
    var n = 1 + Math.min(((bank[w.id] && bank[w.id].count) || 0) * 2, 6);
    for (var i = 0; i < n; i++) weighted.push(w);
  });
  return weighted[Math.floor(Math.random() * weighted.length)];
}
function addToWrongBank(id) {
  var bank = getWrongBank();
  if (!bank[id]) bank[id] = { count: 0, word: AppState.currentWord };
  bank[id].count++;
  saveWrongBank(bank);
}
function removeFromWrongBank(id) {
  var bank = getWrongBank();
  if (bank[id]) {
    bank[id].count = Math.max(0, bank[id].count - 1);
    if (!bank[id].count) delete bank[id];
  }
  saveWrongBank(bank);
}

// ===== SCORE =====
function addScore(xp) {
  var p = getProfile();
  var prevXp = p.score || 0;
  p.score = prevXp + xp;
  var prevLv = getLevelInfo(prevXp).level;
  var newLv = getLevelInfo(p.score).level;
  saveProfile(p);
  if (newLv > prevLv) triggerLevelUp(newLv);
}

// ===== ROUTER =====
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active');
  });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  AppState.currentScreen = name;

  // Update bottom nav
  document.querySelectorAll('.nav-item').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.screen === name);
  });

  // Run screen-specific init
  if (name === 'home')     initHomeScreen();
  if (name === 'practice') initPracticeScreen();
  if (name === 'review')   initReviewScreen();
  if (name === 'friends')  initFriendsScreen();
  if (name === 'profile')  initProfileScreen();
  if (name === 'settings') initSettingsScreen();
}

// ===== FIREBASE AUTH =====
function initFirebase() {
  if (!FIREBASE_ENABLED) {
    console.log('Firebase not configured — running in local mode');
    showScreen('auth');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    firebase.auth().onAuthStateChanged(function(user) {
      if (user) {
        AppState.user = user;
        loadUserProfile(user.uid).then(function() {
          showScreen('home');
        });
      } else {
        showScreen('auth');
      }
    });
  } catch(e) {
    console.error('Firebase init failed:', e);
    showScreen('auth');
  }
}

function loadUserProfile(uid) {
  var db = firebase.firestore();
  return db.collection('users').doc(uid).get().then(function(doc) {
    var localProfile = lsGet('profile', {});
    if (doc.exists) {
      var data = doc.data();
      AppState.profile = {
        username: data.username || localProfile.username || 'User',
        score: data.score || 0,
        totalAnswered: data.totalAnswered || 0,
        totalCorrect: data.totalCorrect || 0,
        bestStreak: data.bestStreak || 0,
        activeLevels: data.activeLevels || [1,2],
        wrongBank: localProfile.wrongBank || {}
      };
    } else {
      AppState.profile = localProfile || { username:'User', score:0, totalAnswered:0, totalCorrect:0, bestStreak:0, activeLevels:[1,2], wrongBank:{} };
    }
    lsSet('profile', AppState.profile);
  }).catch(function(e) {
    console.warn('Failed to load profile from Firestore:', e);
    AppState.profile = lsGet('profile', { username:'User', score:0, totalAnswered:0, totalCorrect:0, bestStreak:0, activeLevels:[1,2], wrongBank:{} });
  });
}

// ===== AUTH SCREEN =====
function initAuthScreen() {
  var loginTab = document.getElementById('auth-tab-login');
  var registerTab = document.getElementById('auth-tab-register');
  var loginForm = document.getElementById('auth-form-login');
  var registerForm = document.getElementById('auth-form-register');

  loginTab.onclick = function() {
    loginTab.classList.add('active'); registerTab.classList.remove('active');
    loginForm.classList.remove('hidden'); registerForm.classList.add('hidden');
    clearAuthError();
  };
  registerTab.onclick = function() {
    registerTab.classList.add('active'); loginTab.classList.remove('active');
    registerForm.classList.remove('hidden'); loginForm.classList.add('hidden');
    clearAuthError();
  };

  // Guest mode
  document.getElementById('auth-guest-btn').onclick = function() {
    AppState.user = { isGuest: true, uid: 'guest' };
    var p = lsGet('profile', null);
    if (!p) {
      p = { username:'游客', score:0, totalAnswered:0, totalCorrect:0, bestStreak:0, activeLevels:[1,2], wrongBank:{} };
      lsSet('profile', p);
    }
    AppState.profile = p;
    showScreen('home');
  };

  // Login submit
  document.getElementById('auth-login-btn').onclick = function() {
    if (!FIREBASE_ENABLED) { showAuthError('Firebase 尚未配置，请先填写 firebase-config.js'); return; }
    var email = document.getElementById('login-email').value.trim();
    var pass  = document.getElementById('login-pass').value;
    if (!email || !pass) { showAuthError('请填写邮箱和密码'); return; }
    setAuthLoading(true);
    firebase.auth().signInWithEmailAndPassword(email, pass)
      .then(function(uc) {
        AppState.user = uc.user;
        return loadUserProfile(uc.user.uid);
      })
      .then(function() { setAuthLoading(false); showScreen('home'); })
      .catch(function(e) { setAuthLoading(false); showAuthError(getAuthError(e.code)); });
  };

  // Register submit
  document.getElementById('auth-register-btn').onclick = function() {
    if (!FIREBASE_ENABLED) { showAuthError('Firebase 尚未配置，请先填写 firebase-config.js'); return; }
    var username = document.getElementById('reg-username').value.trim();
    var email    = document.getElementById('reg-email').value.trim();
    var pass     = document.getElementById('reg-pass').value;
    var pass2    = document.getElementById('reg-pass2').value;
    if (!username || !email || !pass) { showAuthError('请填写所有字段'); return; }
    if (username.length < 2) { showAuthError('用户名至少 2 个字符'); return; }
    if (pass.length < 6) { showAuthError('密码至少 6 位'); return; }
    if (pass !== pass2) { showAuthError('两次密码不一致'); return; }
    setAuthLoading(true);
    firebase.auth().createUserWithEmailAndPassword(email, pass)
      .then(function(uc) {
        AppState.user = uc.user;
        var newProfile = {
          username: username,
          score: 0, totalAnswered: 0, totalCorrect: 0, bestStreak: 0,
          activeLevels: [1,2], wrongBank: {}
        };
        AppState.profile = newProfile;
        lsSet('profile', newProfile);
        var db = firebase.firestore();
        return db.collection('users').doc(uc.user.uid).set({
          username: username,
          email: email,
          score: 0,
          totalAnswered: 0,
          totalCorrect: 0,
          bestStreak: 0,
          activeLevels: [1,2],
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastActive: firebase.firestore.FieldValue.serverTimestamp()
        });
      })
      .then(function() {
        setAuthLoading(false);
        firebase.auth().signOut();
        AppState.user = null;
        showRegisterSuccess();
      })
      .catch(function(e) { setAuthLoading(false); showAuthError(getAuthError(e.code)); });
  };

  // Enter key support
  ['login-email','login-pass'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('auth-login-btn').click();
    });
  });
}

function showRegisterSuccess() {
  document.getElementById('modal-register-success').classList.remove('hidden');
}

function showAuthError(msg) {
  var el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearAuthError() { document.getElementById('auth-error').classList.add('hidden'); }
function setAuthLoading(on) {
  document.getElementById('auth-login-btn').disabled = on;
  document.getElementById('auth-register-btn').disabled = on;
}
function getAuthError(code) {
  var map = {
    'auth/user-not-found': '用户不存在',
    'auth/wrong-password': '密码错误',
    'auth/email-already-in-use': '该邮箱已被注册',
    'auth/invalid-email': '邮箱格式不正确',
    'auth/weak-password': '密码强度不够（至少6位）',
    'auth/too-many-requests': '登录尝试太多，请稍后再试',
    'auth/network-request-failed': '网络错误，请检查连接',
  };
  return map[code] || '操作失败：' + code;
}

// ===== HOME SCREEN =====
function initHomeScreen() {
  var p = getProfile();
  var info = getLevelInfo(p.score || 0);
  var next = getNextLevel(p.score || 0);

  // Greeting
  var h = new Date().getHours();
  var greeting = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  document.getElementById('home-greeting').textContent = greeting + '！';
  document.getElementById('home-username').textContent = p.username || 'Guest';

  // Level
  document.getElementById('home-level-chip').textContent = info.icon + ' Lv.' + info.level + ' ' + info.name;
  document.getElementById('home-xp-chip').textContent = '✦ ' + (p.score || 0);

  // XP bar
  if (next) {
    var pct = ((p.score - info.xp) / (next.xp - info.xp) * 100).toFixed(1);
    document.getElementById('home-xp-bar').style.width = Math.min(pct, 100) + '%';
    document.getElementById('home-xp-label').textContent =
      (p.score - info.xp) + ' / ' + (next.xp - info.xp) + ' XP → Lv.' + next.level;
  } else {
    document.getElementById('home-xp-bar').style.width = '100%';
    document.getElementById('home-xp-label').textContent = '已达最高等级 👑';
  }

  // Stats
  document.getElementById('home-stat-answered').textContent = p.totalAnswered || 0;
  var acc = p.totalAnswered > 0 ? Math.round(p.totalCorrect / p.totalAnswered * 100) : 0;
  document.getElementById('home-stat-accuracy').textContent = acc + '%';
  document.getElementById('home-stat-streak').textContent = p.bestStreak || 0;

  // Level selection cards
  buildLevelCards();

  // Leaderboard preview
  loadLeaderboardPreview();
}

function buildLevelCards() {
  var p = getProfile();
  var active = p.activeLevels || [1,2];
  var grid = document.getElementById('level-cards-grid');
  grid.innerHTML = '';

  TOPIK_INFO.forEach(function(t) {
    var div = document.createElement('div');
    div.className = 'level-card' + (active.indexOf(t.n) >= 0 ? ' selected' : '');
    div.innerHTML = '<div class="level-card-num" style="color:' + t.color + '">T' + t.n + '</div><div class="level-card-name">' + t.label + '</div>';
    div.onclick = function() {
      var cur = getProfile().activeLevels || [1,2];
      var idx = cur.indexOf(t.n);
      if (idx >= 0) {
        if (cur.length === 1) { showToast('至少选择一个等级'); return; }
        cur.splice(idx, 1);
      } else {
        cur.push(t.n);
        cur.sort(function(a,b){return a-b;});
      }
      var pp = getProfile(); pp.activeLevels = cur; saveProfile(pp);
      buildLevelCards();
    };
    grid.appendChild(div);
  });

  // "全部" button
  var allBtn = document.createElement('button');
  allBtn.className = 'level-card-all';
  allBtn.innerHTML = '🌏 &nbsp;全部等级 (TOPIK 1-6)';
  allBtn.onclick = function() {
    var pp = getProfile(); pp.activeLevels = [1,2,3,4,5,6]; saveProfile(pp);
    buildLevelCards();
  };
  grid.appendChild(allBtn);
}

function loadLeaderboardPreview() {
  var container = document.getElementById('home-leaderboard');
  container.innerHTML = '';

  if (!FIREBASE_ENABLED) {
    container.innerHTML = '<div class="empty-state" style="padding:16px"><div style="font-size:0.85rem;color:var(--text-muted)">🔒 配置 Firebase 后可查看世界排名</div></div>';
    return;
  }

  var db = firebase.firestore();
  db.collection('users').orderBy('score','desc').limit(5).get().then(function(snap) {
    if (snap.empty) {
      container.innerHTML = '<div style="font-size:0.85rem;color:var(--text-muted);text-align:center;padding:12px">暂无排名数据</div>';
      return;
    }
    var rank = 1;
    snap.forEach(function(doc) {
      var d = doc.data();
      var isMe = AppState.user && doc.id === AppState.user.uid;
      var div = document.createElement('div');
      div.className = 'leaderboard-item';
      var cls = rank <= 3 ? 'r' + rank : '';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      div.innerHTML = '<div class="rank-badge ' + cls + '">' + medal + '</div>' +
        '<div class="lb-name">' + (d.username||'—') + (isMe ? '<span class="lb-you">我</span>' : '') + '</div>' +
        '<div class="lb-score">✦ ' + (d.score||0) + '</div>';
      container.appendChild(div);
      rank++;
    });
  }).catch(function(e) {
    container.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:10px">排行榜加载失败</div>';
  });
}

// ===== PRACTICE SCREEN =====
function initPracticeScreen() {
  AppState.sessionCorrect = 0;
  AppState.sessionWrong   = 0;
  AppState.sessionStreak  = 0;
  updateSessionStats();
  nextWord(false);
}

function nextWord(fromReview) {
  AppState.resultShown = false;
  AppState.hintShown   = false;
  AppState.isReviewMode = !!fromReview;

  if (fromReview && AppState.reviewQueue.length > 0) {
    AppState.currentWord = AppState.reviewQueue.shift();
  } else {
    AppState.isReviewMode = false;
    AppState.currentWord = pickWord();
  }

  var w = AppState.currentWord;
  if (!w) { showToast('请先在设置中选择词库等级！'); showScreen('settings'); return; }

  // Reset UI
  var inp = document.getElementById('practice-input');
  inp.value = '';
  inp.className = 'input input-korean';
  inp.disabled = false;
  document.getElementById('practice-submit').disabled = false;
  document.getElementById('practice-result').classList.add('hidden');
  document.getElementById('practice-hint-rom').classList.add('hidden');
  document.getElementById('practice-hint-btn').textContent = '💡 显示发音提示';

  // Word level badge
  var lvClass = 't' + w.level;
  document.getElementById('practice-level-badge').className = 'topik-badge ' + lvClass;
  document.getElementById('practice-level-badge').textContent = 'TOPIK ' + w.level;

  // Meaning box (shown during practice)
  document.getElementById('practice-pos').textContent = POS_NAMES[w.pos] || w.pos;
  document.getElementById('practice-meaning').textContent = w.meaning;

  // Auto play
  setTimeout(function() { speak(w.korean); }, 300);
  setTimeout(function() { inp.focus(); }, 350);
}

function submitAnswer() {
  if (!AppState.currentWord || AppState.resultShown) return;
  var answer  = document.getElementById('practice-input').value.trim();
  var correct = AppState.currentWord.korean;
  var isRight = answer === correct;

  AppState.resultShown = true;
  document.getElementById('practice-input').disabled = true;
  document.getElementById('practice-submit').disabled = true;
  document.getElementById('practice-input').className =
    'input input-korean ' + (isRight ? 'correct' : 'wrong');

  // Update stats
  var p = getProfile();
  p.totalAnswered = (p.totalAnswered || 0) + 1;

  if (isRight) {
    AppState.sessionCorrect++;
    AppState.sessionStreak++;
    p.totalCorrect = (p.totalCorrect || 0) + 1;
    if (AppState.sessionStreak > (p.bestStreak || 0)) p.bestStreak = AppState.sessionStreak;
    var xp = 10 + Math.floor(AppState.sessionStreak / 3) * 5;
    saveProfile(p);
    addScore(xp);
    removeFromWrongBank(AppState.currentWord.id);
    showFloatingXP('+' + xp + ' XP', isRight);
  } else {
    AppState.sessionWrong++;
    AppState.sessionStreak = 0;
    saveProfile(p);
    addToWrongBank(AppState.currentWord.id);
  }

  updateSessionStats();
  showResult(isRight);
}

function showResult(isRight) {
  var w = AppState.currentWord;
  document.getElementById('practice-result').classList.remove('hidden');
  var statusEl = document.getElementById('practice-result-status');
  statusEl.textContent = isRight ? '✅ 答对了！+XP' : '❌ 答错了';
  statusEl.className   = 'result-status ' + (isRight ? 'correct' : 'wrong');
  document.getElementById('practice-result-word').textContent    = w.korean;
  document.getElementById('practice-result-meaning').textContent = w.meaning + '  (' + w.rom + ')';
  document.getElementById('practice-example-korean').textContent  = w.example;
  document.getElementById('practice-example-chinese').textContent = w.exMeaning;
}

function updateSessionStats() {
  document.getElementById('s-correct').textContent = AppState.sessionCorrect;
  document.getElementById('s-wrong').textContent   = AppState.sessionWrong;
  document.getElementById('s-streak').textContent  = AppState.sessionStreak;
}

// ===== REVIEW SCREEN =====
function initReviewScreen() {
  var bank  = getWrongBank();
  var words = Object.values(bank).filter(function(e) { return e.count > 0; });
  words.sort(function(a,b) { return b.count - a.count; });

  document.getElementById('review-count').textContent = words.length + ' 个单词';
  var list  = document.getElementById('review-list');
  var empty = document.getElementById('review-empty');
  var btnWrap = document.getElementById('review-start-wrap');
  list.innerHTML = '';

  if (!words.length) {
    empty.classList.remove('hidden');
    btnWrap.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  btnWrap.classList.remove('hidden');

  words.forEach(function(entry) {
    var w = entry.word;
    var div = document.createElement('div');
    div.className = 'review-item';
    div.innerHTML =
      '<div style="flex:1">' +
        '<div class="review-word">' + w.korean + '</div>' +
        '<div class="review-meaning">' + (POS_NAMES[w.pos]||w.pos) + ' &nbsp;·&nbsp; ' + w.meaning + '</div>' +
      '</div>' +
      '<div class="review-wrong-badge">错误 ' + entry.count + ' 次</div>';
    list.appendChild(div);
  });
}

// ===== FRIENDS SCREEN =====
function initFriendsScreen() {
  if (!FIREBASE_ENABLED || !AppState.user || AppState.user.isGuest) {
    document.getElementById('friends-offline-msg').classList.remove('hidden');
    document.getElementById('friends-content').classList.add('hidden');
    return;
  }
  document.getElementById('friends-offline-msg').classList.add('hidden');
  document.getElementById('friends-content').classList.remove('hidden');
  loadFriends();
  loadFriendRequests();
  loadFriendLeaderboard();
}

function loadFriends() {
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  var list = document.getElementById('friends-list');
  list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:12px">加载中...</div>';

  db.collection('users').doc(uid).collection('friends').get().then(function(snap) {
    list.innerHTML = '';
    AppState.friends = [];
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state" style="padding:20px"><div class="empty-icon">👥</div><div class="empty-text">还没有好友，快去搜索添加吧！</div></div>';
      return;
    }
    snap.forEach(function(doc) {
      var d = doc.data();
      AppState.friends.push({ uid: doc.id, username: d.username, score: d.score || 0 });
      var div = createFriendItem(doc.id, d.username, d.score || 0, 'friend');
      list.appendChild(div);
    });
  }).catch(function(e) {
    list.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;text-align:center">加载失败</div>';
  });
}

function loadFriendRequests() {
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  var section = document.getElementById('friend-requests-section');
  var list = document.getElementById('friend-requests-list');

  db.collection('users').doc(uid).collection('friendRequests').get().then(function(snap) {
    AppState.pendingRequests = [];
    if (snap.empty) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    list.innerHTML = '';
    snap.forEach(function(doc) {
      var d = doc.data();
      AppState.pendingRequests.push({ uid: doc.id, username: d.fromUsername });
      var div = createFriendItem(doc.id, d.fromUsername, null, 'request');
      list.appendChild(div);
    });
    // Update badge
    var badge = document.getElementById('friends-nav-badge');
    if (badge) badge.textContent = snap.size;
    badge && badge.classList.toggle('hidden', snap.empty);
  }).catch(function(){});
}

function loadFriendLeaderboard() {
  var lb  = document.getElementById('friends-leaderboard');
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  lb.innerHTML = '';

  // Get my friends' UIDs
  db.collection('users').doc(uid).collection('friends').get().then(function(snap) {
    var uids = [uid];
    snap.forEach(function(d) { uids.push(d.id); });

    // Fetch scores for all (me + friends)
    var promises = uids.map(function(id) {
      return db.collection('users').doc(id).get();
    });
    return Promise.all(promises);
  }).then(function(docs) {
    var entries = docs.map(function(doc) {
      return { uid: doc.id, data: doc.data() };
    }).filter(function(e) { return e.data; });
    entries.sort(function(a,b) { return (b.data.score||0) - (a.data.score||0); });

    var rank = 1;
    entries.forEach(function(e) {
      var isMe = e.uid === AppState.user.uid;
      var div = document.createElement('div');
      div.className = 'leaderboard-item';
      var medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '#' + rank;
      div.innerHTML = '<div class="rank-badge ' + (rank<=3?'r'+rank:'') + '">' + medal + '</div>' +
        '<div class="lb-name">' + (e.data.username||'—') + (isMe ? '<span class="lb-you">我</span>' : '') + '</div>' +
        '<div class="lb-score">✦ ' + (e.data.score||0) + '</div>';
      lb.appendChild(div);
      rank++;
    });
  }).catch(function(e) {
    lb.innerHTML = '<div style="color:var(--text-muted);font-size:0.82rem;text-align:center">加载失败</div>';
  });
}

function createFriendItem(uid, username, score, type) {
  var div = document.createElement('div');
  div.className = 'friend-item';
  var scoreText = score !== null ? '✦ ' + score + ' XP' : '';
  var actions = '';
  if (type === 'request') {
    actions = '<div class="friend-actions">' +
      '<button class="friend-action-btn btn-accept" onclick="acceptFriend(\'' + uid + '\',\'' + username + '\')">✓ 接受</button>' +
      '<button class="friend-action-btn btn-decline" onclick="declineFriend(\'' + uid + '\')">✕</button>' +
      '</div>';
  } else {
    actions = '<div class="friend-actions">' +
      '<button class="friend-action-btn btn-remove" onclick="removeFriend(\'' + uid + '\',\'' + username + '\')">移除</button>' +
      '</div>';
  }
  div.innerHTML =
    '<div class="friend-avatar">👤</div>' +
    '<div class="friend-info">' +
      '<div class="friend-name">' + username + '</div>' +
      (scoreText ? '<div class="friend-score">' + scoreText + '</div>' : '') +
    '</div>' + actions;
  return div;
}

function searchUser() {
  if (!FIREBASE_ENABLED) return;
  var query = document.getElementById('friend-search-input').value.trim();
  if (query.length < 2) { showToast('请输入至少 2 个字符'); return; }
  var results = document.getElementById('friend-search-results');
  results.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:10px">搜索中...</div>';

  var db = firebase.firestore();
  db.collection('users')
    .where('username', '>=', query)
    .where('username', '<=', query + '')
    .limit(8)
    .get()
    .then(function(snap) {
      results.innerHTML = '';
      if (snap.empty) {
        results.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:10px">没有找到用户</div>';
        return;
      }
      snap.forEach(function(doc) {
        if (doc.id === AppState.user.uid) return;
        var d = doc.data();
        var alreadyFriend = AppState.friends.some(function(f) { return f.uid === doc.id; });
        var div = document.createElement('div');
        div.className = 'friend-item';
        div.innerHTML =
          '<div class="friend-avatar">👤</div>' +
          '<div class="friend-info"><div class="friend-name">' + d.username + '</div>' +
          '<div class="friend-score">✦ ' + (d.score||0) + ' XP</div></div>' +
          '<div class="friend-actions">' +
            (alreadyFriend
              ? '<span style="font-size:0.8rem;color:var(--success)">已添加</span>'
              : '<button class="friend-action-btn btn-add" onclick="sendFriendRequest(\'' + doc.id + '\',\'' + d.username + '\')">+ 添加</button>') +
          '</div>';
        results.appendChild(div);
      });
    }).catch(function() {
      results.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;text-align:center">搜索失败</div>';
    });
}

function sendFriendRequest(toUid, toUsername) {
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  var p   = getProfile();
  // Write to recipient's friendRequests subcollection
  db.collection('users').doc(toUid).collection('friendRequests').doc(uid).set({
    fromUsername: p.username,
    fromUid: uid,
    sentAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function() {
    showToast('好友申请已发送！');
    document.getElementById('friend-search-results').innerHTML = '';
    document.getElementById('friend-search-input').value = '';
  }).catch(function() { showToast('发送失败，请重试'); });
}

function acceptFriend(fromUid, fromUsername) {
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  var p   = getProfile();
  var batch = db.batch();

  // Add to my friends
  batch.set(db.collection('users').doc(uid).collection('friends').doc(fromUid), {
    username: fromUsername,
    score: 0,
    addedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // Add me to their friends
  batch.set(db.collection('users').doc(fromUid).collection('friends').doc(uid), {
    username: p.username,
    score: p.score || 0,
    addedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // Delete the request
  batch.delete(db.collection('users').doc(uid).collection('friendRequests').doc(fromUid));

  batch.commit().then(function() {
    showToast('已添加好友 ' + fromUsername + '！');
    initFriendsScreen();
  }).catch(function() { showToast('操作失败，请重试'); });
}

function declineFriend(fromUid) {
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  db.collection('users').doc(uid).collection('friendRequests').doc(fromUid).delete()
    .then(function() { showToast('已拒绝'); initFriendsScreen(); })
    .catch(function() { showToast('操作失败'); });
}

function removeFriend(friendUid, friendUsername) {
  if (!confirm('确定移除好友 ' + friendUsername + '？')) return;
  var db  = firebase.firestore();
  var uid = AppState.user.uid;
  var batch = db.batch();
  batch.delete(db.collection('users').doc(uid).collection('friends').doc(friendUid));
  batch.delete(db.collection('users').doc(friendUid).collection('friends').doc(uid));
  batch.commit().then(function() {
    showToast('已移除好友');
    initFriendsScreen();
  }).catch(function() { showToast('操作失败'); });
}

// ===== PROFILE SCREEN =====
function initProfileScreen() {
  var p    = getProfile();
  var info = getLevelInfo(p.score || 0);
  document.getElementById('profile-username').textContent  = p.username || 'Guest';
  document.getElementById('profile-level-name').textContent = info.icon + ' Lv.' + info.level + ' ' + info.name;
  document.getElementById('profile-score').textContent     = '✦ ' + (p.score || 0) + ' 总积分';
  document.getElementById('profile-total').textContent     = p.totalAnswered || 0;
  document.getElementById('profile-correct').textContent   = p.totalCorrect  || 0;
  var acc = p.totalAnswered > 0 ? Math.round(p.totalCorrect / p.totalAnswered * 100) : 0;
  document.getElementById('profile-acc').textContent  = acc + '%';
  document.getElementById('profile-streak').textContent = p.bestStreak || 0;

  // Level list
  var list = document.getElementById('profile-level-list');
  list.innerHTML = '';
  LEVELS_SYSTEM.forEach(function(l) {
    var isCur = l.level === info.level;
    var isUnlocked = (p.score || 0) >= l.xp;
    var div = document.createElement('div');
    div.className = 'level-progress-item' + (isCur ? ' current' : isUnlocked ? ' done' : '');
    var statusHTML = isCur
      ? '<span class="level-status-tag now">◀ 当前</span>'
      : isUnlocked
        ? '<span class="level-status-tag done">✓ 已解锁</span>'
        : '<span class="level-status-tag locked">需 ' + l.xp + ' XP</span>';
    div.innerHTML =
      '<div class="level-icon">' + l.icon + '</div>' +
      '<div class="level-info"><div class="level-name-text">Lv.' + l.level + ' ' + l.name + '</div>' +
      '<div class="level-xp-text">' + l.xp + ' XP 解锁</div></div>' +
      statusHTML;
    list.appendChild(div);
  });

  // Logout button
  var logoutBtn = document.getElementById('profile-logout-btn');
  if (AppState.user && !AppState.user.isGuest && FIREBASE_ENABLED) {
    logoutBtn.classList.remove('hidden');
    logoutBtn.onclick = function() {
      AppState.user = null;
      AppState.profile = null;
      localStorage.removeItem('kr_app_profile');
      firebase.auth().signOut().catch(function(e) { console.warn('signOut error:', e); });
      showScreen('auth');
    };
  } else {
    logoutBtn.classList.add('hidden');
  }
}

// ===== SETTINGS SCREEN =====
function initSettingsScreen() {
  AppState.speechRate   = lsGet('speechRate',   1.0);
  AppState.speechVolume = lsGet('speechVolume', 1.0);
  document.getElementById('rate-slider').value    = AppState.speechRate;
  document.getElementById('rate-value').textContent  = AppState.speechRate.toFixed(1) + 'x';
  document.getElementById('vol-slider').value     = AppState.speechVolume;
  document.getElementById('vol-value').textContent   = Math.round(AppState.speechVolume * 100) + '%';
}

// ===== LEVEL UP MODAL =====
function triggerLevelUp(newLevel) {
  var info = LEVELS_SYSTEM.find(function(l) { return l.level === newLevel; }) || LEVELS_SYSTEM[LEVELS_SYSTEM.length - 1];
  document.getElementById('modal-level-text').textContent =
    '恭喜升级到 ' + info.icon + ' Lv.' + newLevel + ' ' + info.name + '！';
  document.getElementById('modal-levelup').classList.remove('hidden');
  speak('레벨 업!');
}

// ===== FLOATING XP =====
function showFloatingXP(text) {
  var el = document.createElement('div');
  el.className = 'float-xp';
  el.textContent = text;
  el.style.top   = '80px';
  el.style.right = '20px';
  document.body.appendChild(el);
  setTimeout(function() { el.remove(); }, 1400);
}

// ===== TOAST =====
var toastTimer = null;
function showToast(msg) {
  if (toastTimer) clearTimeout(toastTimer);
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(function() { el.remove(); }, 2500);
}

// ===== BIND GLOBAL EVENTS =====
function bindEvents() {
  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() { showScreen(btn.dataset.screen); });
  });

  // Home start button
  document.getElementById('home-start-btn').addEventListener('click', function() {
    showScreen('practice');
  });

  // Home avatar → profile
  document.getElementById('home-avatar').addEventListener('click', function() {
    showScreen('profile');
  });

  // Practice: play buttons
  document.getElementById('practice-play-btn').addEventListener('click', function() {
    if (AppState.currentWord) speak(AppState.currentWord.korean);
  });
  document.getElementById('practice-slow-btn').addEventListener('click', function() {
    if (AppState.currentWord) speak(AppState.currentWord.korean, 0.5);
  });

  // Practice: hint
  document.getElementById('practice-hint-btn').addEventListener('click', function() {
    AppState.hintShown = !AppState.hintShown;
    var el = document.getElementById('practice-hint-rom');
    if (AppState.hintShown) {
      el.textContent = AppState.currentWord ? AppState.currentWord.rom : '';
      el.classList.remove('hidden');
      document.getElementById('practice-hint-btn').textContent = '💡 隐藏发音提示';
    } else {
      el.classList.add('hidden');
      document.getElementById('practice-hint-btn').textContent = '💡 显示发音提示';
    }
  });

  // Practice: input enter
  document.getElementById('practice-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      if (!AppState.resultShown) submitAnswer();
      else document.getElementById('practice-next-btn').click();
    }
  });

  // Practice: submit
  document.getElementById('practice-submit').addEventListener('click', submitAnswer);

  // Practice: next
  document.getElementById('practice-next-btn').addEventListener('click', function() {
    nextWord(AppState.isReviewMode && AppState.reviewQueue.length > 0);
  });

  // Practice: play example
  document.getElementById('practice-play-example').addEventListener('click', function() {
    if (AppState.currentWord) speak(AppState.currentWord.example, AppState.speechRate * 0.9);
  });

  // Review: start
  document.getElementById('review-start-btn').addEventListener('click', function() {
    var bank = getWrongBank();
    AppState.reviewQueue = Object.values(bank)
      .filter(function(e) { return e.count > 0; })
      .sort(function(a,b) { return b.count - a.count; })
      .map(function(e) { return e.word; });
    if (!AppState.reviewQueue.length) return;
    showScreen('practice');
    nextWord(true);
  });

  // Friends: search
  document.getElementById('friend-search-btn').addEventListener('click', searchUser);
  document.getElementById('friend-search-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') searchUser();
  });

  // Settings: rate
  document.getElementById('rate-slider').addEventListener('input', function(e) {
    AppState.speechRate = parseFloat(e.target.value);
    document.getElementById('rate-value').textContent = AppState.speechRate.toFixed(1) + 'x';
    lsSet('speechRate', AppState.speechRate);
  });

  // Settings: volume
  document.getElementById('vol-slider').addEventListener('input', function(e) {
    AppState.speechVolume = parseFloat(e.target.value);
    document.getElementById('vol-value').textContent = Math.round(AppState.speechVolume * 100) + '%';
    lsSet('speechVolume', AppState.speechVolume);
  });

  // Settings: test voice
  document.getElementById('settings-test-btn').addEventListener('click', function() {
    speak('안녕하세요! 한국어 받아쓰기 앱에 오신 것을 환영합니다.');
  });

  // Settings: reset
  document.getElementById('settings-reset-btn').addEventListener('click', function() {
    if (!confirm('确定重置所有学习进度？此操作无法撤销。')) return;
    var keys = ['profile','speechRate','speechVolume'];
    keys.forEach(function(k) { localStorage.removeItem('kr_app_' + k); });
    AppState.profile = null;
    if (FIREBASE_ENABLED && AppState.user && !AppState.user.isGuest) {
      firebase.firestore().collection('users').doc(AppState.user.uid).set({
        score:0, totalAnswered:0, totalCorrect:0, bestStreak:0,
        lastActive: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});
    }
    showToast('进度已重置！');
    showScreen('home');
  });

  // Register success modal confirm
  document.getElementById('modal-register-ok-btn').addEventListener('click', function() {
    document.getElementById('modal-register-success').classList.add('hidden');
    // Switch to login tab
    document.getElementById('auth-tab-login').click();
    showScreen('auth');
  });

  // Level up modal close
  document.getElementById('modal-close-btn').addEventListener('click', function() {
    document.getElementById('modal-levelup').classList.add('hidden');
    initProfileScreen && initProfileScreen();
  });
}

// ===== INIT =====
function init() {
  AppState.speechRate   = lsGet('speechRate',   1.0);
  AppState.speechVolume = lsGet('speechVolume', 1.0);
  bindEvents();
  initAuthScreen();
  initFirebase();
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
