/**
 * 从韩国国立国语院 KRDict API 预取词汇数据
 * 运行: node scripts/fetch-krdict.mjs
 * 输出: src/data/api-words.json
 *
 * 策略：按常见韩文初始音节逐字搜索，每次加等级过滤
 * 比通配符 q=* 更稳定，避免 API 返回 404
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 读取 API Key ──────────────────────────────────────────
function loadEnv() {
  try {
    const content = readFileSync(path.join(__dirname, '..', '.env'), 'utf-8');
    const match = content.match(/VITE_KRDICT_KEY=(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
}

const API_KEY = loadEnv();
if (!API_KEY) {
  console.error('❌ 未找到 API Key，请在 .env 文件中设置 VITE_KRDICT_KEY');
  process.exit(1);
}
console.log(`✅ API Key: ${API_KEY.slice(0,6)}...${API_KEY.slice(-4)}`);

// ── 常量 ─────────────────────────────────────────────────
const POS_MAP = {
  '명사': 'n', '대명사': 'n', '수사': 'n', '의존 명사': 'n',
  '동사': 'v', '보조 동사': 'v',
  '형용사': 'adj', '보조 형용사': 'adj', '관형사': 'adj',
  '부사': 'adv', '감탄사': 'expr', '조사': 'expr',
};

// 按常见频率排序的搜索词（覆盖 가~히 最常见音节）
const SEARCH_QUERIES = [
  '가', '나', '다', '라', '마', '바', '사',
  '아', '자', '차', '카', '타', '파', '하',
  '고', '노', '도', '모', '보', '소', '오',
  '조', '코', '토', '포', '호', '구', '두',
  '무', '부', '수', '우', '주', '쿠', '투',
  '기', '니', '디', '리', '미', '비', '시',
  '이', '지', '치', '키', '티', '피', '히',
  '그', '느', '드', '르', '므', '브', '스', '으',
];

// KRDict 难度 → TOPIK 等级
const LEVEL_MAP = [
  { kLevel: '1', topikLevels: [1, 2] },
  { kLevel: '2', topikLevels: [3, 4] },
  { kLevel: '3', topikLevels: [5, 6] },
];

// ── 单次 API 请求 ─────────────────────────────────────────
async function fetchWords(q, kLevel) {
  const params = new URLSearchParams({
    key:    API_KEY,
    q,
    part:   'word',
    sort:   'popular',
    num:    '100',
    start:  '1',
    advanced: 'y',
    level:  kLevel,
    method: 'start',   // 以 q 开头的词
  });

  const url = `https://krdict.korean.go.kr/api/selectWordList?${params}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (res.status === 404) return '';   // 无结果，不报错
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.text();
}

// ── 解析 XML ──────────────────────────────────────────────
function parseXML(xml) {
  const results = [];
  if (!xml || xml.includes('<error>')) return results;

  const getTag = (str, tag) => {
    const m = str.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
  };

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const word    = getTag(item, 'word');
    const posRaw  = getTag(item, 'pos');
    const meaning = getTag(item, 'definition');
    const example = getTag(item, 'example');

    if (!word || !meaning) continue;
    if (word.length > 8) continue;

    results.push({
      korean:    word,
      rom:       '',
      pos:       POS_MAP[posRaw] || 'n',
      meaning:   meaning.length > 40 ? meaning.slice(0, 40) + '…' : meaning,
      example:   example || `${word}을/를 공부해요.`,
      exMeaning: '（来自国立国语院词典）',
      level:     0,   // 后面按 kLevel 分配
      fromApi:   true,
    });
  }
  return results;
}

// ── 主流程 ────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 开始从 KRDict API 抓取词汇...');
  console.log(`📡 API 地址: https://krdict.korean.go.kr/api/selectWordList\n`);

  // 先测试 API 是否可用
  console.log('🔍 测试 API 连接...');
  try {
    const testXml = await fetchWords('가', '1');
    if (!testXml) {
      console.error('❌ API 返回空响应，请检查 API Key 或网络');
      process.exit(1);
    }
    const testItems = testXml.match(/<item>/g) || [];
    console.log(`✅ API 连接成功！测试查询返回 ${testItems.length} 条结果\n`);
  } catch (err) {
    console.error(`❌ API 连接失败: ${err.message}`);
    console.error('   请检查：1) 网络连接  2) API Key 是否正确  3) VPN/防火墙设置');
    process.exit(1);
  }

  // 读取本地词库，避免重复
  let localVocab = [];
  try {
    const { VOCABULARY } = await import('../src/vocabulary.js');
    localVocab = VOCABULARY;
  } catch {}
  const existingKorean = new Set(localVocab.map(w => w.korean));
  console.log(`📚 本地词库已有 ${localVocab.length} 个词，将跳过重复\n`);

  const allWords = [];
  let nextId = 10001;

  for (const { kLevel, topikLevels } of LEVEL_MAP) {
    const levelName = kLevel === '1' ? '초급 (TOPIK 1-2)' : kLevel === '2' ? '중급 (TOPIK 3-4)' : '고급 (TOPIK 5-6)';
    console.log(`\n📖 ${levelName}...`);
    const collected = [];

    for (const q of SEARCH_QUERIES) {
      try {
        const xml   = await fetchWords(q, kLevel);
        const words = parseXML(xml).filter(w => !existingKorean.has(w.korean));
        if (words.length > 0) {
          collected.push(...words);
          process.stdout.write(`  ${q}:${words.length} `);
        }
        // 礼貌延迟
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        process.stdout.write(`  ${q}:❌ `);
      }
    }

    // 去重 + 按 TOPIK 等级均分
    const unique = [...new Map(collected.map(w => [w.korean, w])).values()];
    const half   = Math.ceil(unique.length / topikLevels.length);
    topikLevels.forEach((lv, i) => {
      const slice = unique.slice(i * half, (i + 1) * half);
      slice.forEach(w => {
        existingKorean.add(w.korean);
        allWords.push({ ...w, id: nextId++, level: lv });
      });
      console.log(`\n  ✅ TOPIK ${lv}: ${slice.length} 个新词`);
    });
  }

  if (allWords.length === 0) {
    console.error('\n❌ 未获取到任何词汇');
    process.exit(1);
  }

  // 写出 JSON
  const outDir  = path.join(__dirname, '..', 'src', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'api-words.json');
  writeFileSync(outPath, JSON.stringify(allWords, null, 2), 'utf-8');

  console.log(`\n\n🎉 完成！共获取 ${allWords.length} 个词汇`);
  console.log(`📄 已保存: src/data/api-words.json`);
  [1,2,3,4,5,6].forEach(lv => {
    const n = allWords.filter(w => w.level === lv).length;
    if (n) console.log(`   TOPIK ${lv}: ${n} 词`);
  });
  console.log('\n💡 重启开发服务器（npm run dev）即可使用新词库！');
}

main().catch(err => { console.error('\n💥 Fatal:', err.message); process.exit(1); });
