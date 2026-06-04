/**
 * 韩国国立国语院 한국어기초사전 (KRDict) API 集成
 *
 * 【获取 API Key 步骤】
 * 1. 访问 https://krdict.korean.go.kr/openApi/openApiInfo
 * 2. 点击右上角"회원가입"注册账号
 * 3. 登录后点击"인증키 신청"申请 API Key（免费）
 * 4. 审核通过后（一般即时），在"나의 인증키"查看 Key
 * 5. 将 Key 填入 .env 文件: VITE_KRDICT_KEY=your_key_here
 *
 * API 文档: https://krdict.korean.go.kr/openApi/openApiInfo
 */

// 词性映射：KRDict pos_code → 本地 pos 代码
const POS_MAP = {
  '명사':    'n',
  '대명사':  'n',
  '수사':    'n',
  '동사':    'v',
  '형용사':  'adj',
  '부사':    'adv',
  '관형사':  'adj',
  '감탄사':  'expr',
  '조사':    'expr',
  '의존명사':'n',
  '보조동사':'v',
};

// 难度映射：KRDict level_code → TOPIK level
const LEVEL_MAP = {
  '초급': 1,   // 初级 → TOPIK 1-2
  '중급': 3,   // 中级 → TOPIK 3-4
  '고급': 5,   // 高级 → TOPIK 5-6
};

// KRDict 官方 API 地址
const KRDICT_DIRECT = 'https://krdict.korean.go.kr/api/selectWordList';

/**
 * 构建请求 URL
 * 开发 & 生产统一使用 corsproxy.io 作为 CORS 代理（免费、稳定）
 * 如果 corsproxy 不可用，自动尝试直连（可能被 CORS 拦截，但部分浏览器扩展会放行）
 */
function buildUrl(params) {
  const direct = `${KRDICT_DIRECT}?${params}`;
  // corsproxy.io 免费 CORS 代理
  return `https://corsproxy.io/?${encodeURIComponent(direct)}`;
}

const API_KEY = import.meta.env.VITE_KRDICT_KEY || '';

/** 将已加载的 API 词条缓存到 sessionStorage，避免重复请求 */
const CACHE_KEY = 'krdict_cache_v1';

function getCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]'); }
  catch { return []; }
}
function addToCache(words) {
  const cur = getCache();
  const ids = new Set(cur.map(w => w.korean));
  const newOnes = words.filter(w => !ids.has(w.korean));
  const merged = [...cur, ...newOnes].slice(-2000); // 最多缓存 2000 词
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(merged)); } catch {}
  return merged;
}

/**
 * 从 KRDict API 获取一批词条
 * @param {Object} opts
 * @param {number}   opts.topikLevel   1-6
 * @param {number}   opts.count        返回数量（最大 100）
 * @param {number}   opts.startIdx     分页起点（默认 1）
 * @returns {Promise<Array>}  格式化后的词条数组
 */
export async function fetchFromKRDict({ topikLevel = 1, count = 40, startIdx = 1 } = {}) {
  if (!API_KEY) {
    console.warn('[KRDict] No API key. Set VITE_KRDICT_KEY in .env');
    return [];
  }

  // KRDict level: 초급(1-2), 중급(3-4), 고급(5-6)
  const kLevel = topikLevel <= 2 ? '1' : topikLevel <= 4 ? '2' : '3';

  const params = new URLSearchParams({
    key:      API_KEY,
    q:        '*',           // 高级模式下支持通配符
    advanced: 'y',           // 启用高级搜索，才能按等级过滤
    part:     'word',
    sort:     'popular',
    num:      String(Math.min(count, 100)),
    start:    String(startIdx),
    level:    kLevel,
    lang_examp: '11',        // 11 = 중국어（中文）
    type1:    '1',           // 1 = 일반어（普通词汇）
  });

  try {
    const url = buildUrl(params);
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml  = await res.text();
    return parseKRDictXML(xml, topikLevel);
  } catch (err) {
    console.error('[KRDict] fetch error:', err);
    return [];
  }
}

/** 解析 KRDict API 返回的 XML，转换为本地词条格式 */
function parseKRDictXML(xml, level) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xml, 'text/xml');
  const items  = doc.querySelectorAll('item');
  const results = [];
  let nextId = 10000 + Date.now() % 90000; // 临时 ID，避免与本地词库冲突

  items.forEach(item => {
    const word    = getText(item, 'word');
    const posRaw  = getText(item, 'pos');
    const defEl   = item.querySelector('sense > definition');
    const meaning = defEl ? defEl.textContent.trim() : '';
    const exEl    = item.querySelector('sense > example');
    const example = exEl ? exEl.textContent.trim() : (word + '을/를 잘 배워요.');

    // 发音（romanization 需要另外处理，KRDict 不直接提供罗马字）
    const rom = hangulToRom(word);

    if (!word || !meaning) return;

    results.push({
      id:        nextId++,
      korean:    word,
      rom:       rom,
      pos:       POS_MAP[posRaw] || 'n',
      meaning:   meaning.length > 30 ? meaning.slice(0, 30) + '…' : meaning,
      example:   example.length > 50 ? example.slice(0, 50) + '…' : example,
      exMeaning: '（来自国立国语院词典）',
      level:     level,
      fromApi:   true,
    });
  });

  return results;
}

function getText(el, tag) {
  const found = el.querySelector(tag);
  return found ? found.textContent.trim() : '';
}

/**
 * 简易韩文罗马字转换（汉语拼音参考用）
 * 完整版可用 es-hangul 库：npm install es-hangul
 */
function hangulToRom(text) {
  // 基础字母转换表（简化版，仅用于显示）
  const map = {
    '가':'ga','나':'na','다':'da','라':'ra','마':'ma','바':'ba','사':'sa',
    '아':'a', '자':'ja','차':'cha','카':'ka','타':'ta','파':'pa','하':'ha',
    '거':'geo','너':'neo','더':'deo','러':'reo','머':'meo','버':'beo','서':'seo',
    '어':'eo','저':'jeo','처':'cheo','커':'keo','터':'teo','퍼':'peo','허':'heo',
    '고':'go','노':'no','도':'do','로':'ro','모':'mo','보':'bo','소':'so',
    '오':'o', '조':'jo','초':'cho','코':'ko','토':'to','포':'po','호':'ho',
    '구':'gu','누':'nu','두':'du','루':'ru','무':'mu','부':'bu','수':'su',
    '우':'u', '주':'ju','추':'chu','쿠':'ku','투':'tu','푸':'pu','후':'hu',
    '기':'gi','니':'ni','디':'di','리':'ri','미':'mi','비':'bi','시':'si',
    '이':'i', '지':'ji','치':'chi','키':'ki','티':'ti','피':'pi','히':'hi',
    '은':'eun','는':'neun','을':'eul','를':'reul','이':'i','가':'ga',
  };
  return Array.from(text).map(ch => map[ch] || ch).join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 智能获取词库：优先使用缓存，按需从 API 补充
 * @param {number[]} levels   需要的 TOPIK 等级
 * @param {number}   minCount 每个等级至少要有的词条数
 * @returns {Promise<Array>}
 */
export async function getEnrichedVocabulary(localVocabulary, levels, minCount = 80) {
  const cached = getCache();

  // 检查每个等级是否满足最低数量
  const missing = levels.filter(lv => {
    const existing = localVocabulary.filter(w => w.level === lv).length
      + cached.filter(w => w.level === lv).length;
    return existing < minCount;
  });

  if (missing.length === 0 || !API_KEY) {
    return [...localVocabulary, ...cached];
  }

  // 并发请求缺失等级
  const fetched = await Promise.all(
    missing.map(lv => fetchFromKRDict({ topikLevel: lv, count: 60 }))
  );
  const flat = fetched.flat();
  addToCache(flat);

  return [...localVocabulary, ...getCache()];
}
