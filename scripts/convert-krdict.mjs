/**
 * KRDict 完整词典 JSON → App 词库转换脚本
 * 运行: node scripts/convert-krdict.mjs
 * 输出: src/data/api-words.json
 *
 * 读取 scripts/krdict-raw/ 目录下的所有 JSON 文件
 * 提取含中文翻译的词条，按 TOPIK 等级分组
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR   = path.join(__dirname, 'krdict-raw');
const OUT_PATH  = path.join(__dirname, '..', 'src', 'data', 'api-words.json');

// ── 词性映射 ─────────────────────────────────────────────
const POS_MAP = {
  '명사':      'n',
  '대명사':    'n',
  '수사':      'n',
  '의존 명사': 'n',
  '동사':      'v',
  '보조 동사': 'v',
  '형용사':    'adj',
  '보조 형용사':'adj',
  '관형사':    'adj',
  '부사':      'adv',
  '감탄사':    'expr',
  '조사':      'expr',
  '어미':      'expr',
  '접사':      'expr',
  '품사 없음': 'expr',
};

// ── 难度等级映射 ─────────────────────────────────────────
// 按文件顺序把 초급/중급/고급 均分到 TOPIK 1-2/3-4/5-6
// 用计数器让同等级的词交替分配到两个 TOPIK 级别
const levelCounters = { '초급': 0, '중급': 0, '고급': 0 };

function getTopikLevel(vocaLevel) {
  const c = levelCounters[vocaLevel] || 0;
  levelCounters[vocaLevel] = c + 1;
  if (vocaLevel === '초급') return c % 2 === 0 ? 1 : 2;
  if (vocaLevel === '중급') return c % 2 === 0 ? 3 : 4;
  if (vocaLevel === '고급') return c % 2 === 0 ? 5 : 6;
  return null; // 跳过没有等级的词
}

// ── 辅助：从 feat 数组中提取值 ───────────────────────────
function getVal(feats, attName) {
  if (!feats) return '';
  const arr = Array.isArray(feats) ? feats : [feats];
  const found = arr.find(f => f.att === attName);
  return found ? found.val : '';
}

// ── 从 Equivalent 数组中提取中文翻译 ────────────────────
function getChineseTranslation(equivalents) {
  if (!equivalents) return null;
  const arr = Array.isArray(equivalents) ? equivalents : [equivalents];
  for (const eq of arr) {
    const feats = Array.isArray(eq.feat) ? eq.feat : [eq.feat];
    const lang  = feats.find(f => f.att === 'language');
    if (lang && lang.val === '중국어') {
      const lemma = feats.find(f => f.att === 'lemma');
      const def   = feats.find(f => f.att === 'definition');
      return {
        lemma: lemma ? lemma.val.trim() : '',
        definition: def ? def.val.trim() : '',
      };
    }
  }
  return null;
}

// ── 从 SenseExample 中提取第一个完整例句 ────────────────
function getExample(senseExamples) {
  if (!senseExamples) return '';
  const arr = Array.isArray(senseExamples) ? senseExamples : [senseExamples];
  // 优先取"문장"类型，再取任意类型
  const sentence = arr.find(e => {
    const feats = Array.isArray(e.feat) ? e.feat : [e.feat];
    return feats.some(f => f.att === 'type' && f.val === '문장');
  });
  const any = sentence || arr[0];
  if (!any) return '';
  const feats = Array.isArray(any.feat) ? any.feat : [any.feat];
  const ex = feats.find(f => f.att === 'example');
  return ex ? ex.val.trim() : '';
}

// ── 处理单个 LexicalEntry ────────────────────────────────
function processEntry(entry, existingWords) {
  // 韩文单词
  const korean = entry.Lemma?.feat?.val?.trim();
  if (!korean) return null;

  // 跳过已有单词
  if (existingWords.has(korean)) return null;

  // 跳过包含空格的词组（只保留单词）
  if (korean.includes(' ') || korean.startsWith('-') || korean.endsWith('-')) return null;

  // 词条属性
  const feats = Array.isArray(entry.feat) ? entry.feat : (entry.feat ? [entry.feat] : []);
  const partOfSpeech    = getVal(feats, 'partOfSpeech');
  const vocabularyLevel = getVal(feats, 'vocabularyLevel');

  // 只保留有等级标注的词
  if (!vocabularyLevel || !['초급', '중급', '고급'].includes(vocabularyLevel)) return null;

  const topikLevel = getTopikLevel(vocabularyLevel);
  if (!topikLevel) return null;

  // 处理 Sense（可能是数组或单个对象）
  const senses = Array.isArray(entry.Sense) ? entry.Sense : (entry.Sense ? [entry.Sense] : []);
  if (!senses.length) return null;

  // 取第一个 Sense 的中文翻译
  let chineseTrans = null;
  let exampleText  = '';

  for (const sense of senses) {
    if (!chineseTrans) {
      chineseTrans = getChineseTranslation(sense.Equivalent);
    }
    if (!exampleText) {
      exampleText = getExample(sense.SenseExample);
    }
    if (chineseTrans && exampleText) break;
  }

  // 必须有中文翻译
  if (!chineseTrans || !chineseTrans.lemma) return null;

  // 中文含义：优先用 lemma（简短词义），definition 作为备用
  const meaning = chineseTrans.lemma.length <= 20
    ? chineseTrans.lemma
    : (chineseTrans.definition.length <= 40
        ? chineseTrans.definition.slice(0, 40)
        : chineseTrans.lemma.slice(0, 20));

  const exMeaning = chineseTrans.definition.length <= 60
    ? chineseTrans.definition
    : chineseTrans.definition.slice(0, 60) + '…';

  return {
    korean,
    rom:       '',   // 罗马字可后续补充
    pos:       POS_MAP[partOfSpeech] || 'n',
    meaning:   meaning || chineseTrans.lemma.slice(0, 20),
    example:   exampleText || `${korean}을/를 배워요.`,
    exMeaning: exMeaning || '（来自国立国语院词典）',
    level:     topikLevel,
    fromApi:   true,
  };
}

// ── 主函数 ───────────────────────────────────────────────
async function main() {
  console.log('🚀 开始转换 KRDict 词典数据...\n');

  // 读取已有本地词库（避免重复）
  let existingWords = new Set();
  try {
    const { VOCABULARY } = await import('../src/vocabulary.js');
    existingWords = new Set(VOCABULARY.map(w => w.korean));
    console.log(`📚 本地词库: ${VOCABULARY.length} 词（将跳过重复）`);
  } catch {}

  // 列出所有 JSON 文件
  const files = readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => {
      const n1 = parseInt(a.split('_')[0]);
      const n2 = parseInt(b.split('_')[0]);
      return n1 - n2;
    });

  console.log(`\n📂 找到 ${files.length} 个词典文件\n`);

  const allWords  = [];
  let nextId      = 10001;
  let totalEntries = 0;
  let skippedNoZh  = 0;
  let skippedNoLv  = 0;

  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    process.stdout.write(`处理 ${file}... `);

    let data;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.log(`❌ 读取失败: ${e.message}`);
      continue;
    }

    const entries = data?.LexicalResource?.Lexicon?.LexicalEntry;
    if (!Array.isArray(entries)) {
      console.log('⚠️ 未找到 LexicalEntry 数组');
      continue;
    }

    let fileCount = 0;
    for (const entry of entries) {
      totalEntries++;
      const result = processEntry(entry, existingWords);
      if (result) {
        result.id = nextId++;
        allWords.push(result);
        existingWords.add(result.korean);
        fileCount++;
      }
    }

    console.log(`✅ ${entries.length} 词条 → 提取 ${fileCount} 个有效词`);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 处理结果：`);
  console.log(`   总词条数: ${totalEntries.toLocaleString()}`);
  console.log(`   有效词汇: ${allWords.length.toLocaleString()}`);

  console.log(`\n📈 按 TOPIK 等级分布：`);
  [1,2,3,4,5,6].forEach(lv => {
    const n = allWords.filter(w => w.level === lv).length;
    const bar = '█'.repeat(Math.floor(n / 100));
    console.log(`   TOPIK ${lv}: ${String(n).padStart(5)} 词  ${bar}`);
  });

  // 每个等级最多取 800 词，避免文件过大
  const MAX_PER_LEVEL = 800;
  const filtered = [];
  [1,2,3,4,5,6].forEach(lv => {
    const lvWords = allWords.filter(w => w.level === lv);
    filtered.push(...lvWords.slice(0, MAX_PER_LEVEL));
  });

  console.log(`\n✂️ 每级最多 ${MAX_PER_LEVEL} 词，最终输出: ${filtered.length} 词`);

  // 写出文件
  writeFileSync(OUT_PATH, JSON.stringify(filtered, null, 2), 'utf-8');
  console.log(`\n✅ 已保存到 src/data/api-words.json`);
  console.log(`\n💡 重启开发服务器（npm run dev）即可加载新词库！`);
}

main().catch(err => {
  console.error('💥 Error:', err.message);
  process.exit(1);
});
