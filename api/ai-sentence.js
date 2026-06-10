export const config = { runtime: 'edge' };

const LEVEL_GUIDE = {
  1: 'very short sentence (max 5 words), only basic grammar: -아요/어요, -이에요/예요, 있어요/없어요, daily life topics',
  2: 'short sentence (max 8 words), can use -고, -지만, -에서, -에게 and basic connectors',
  3: 'medium sentence, can use -아서/어서, -(으)면, -(으)ㄹ 수 있다, -고 싶다',
  4: 'slightly complex sentence, can use -(으)ㄹ 것 같다, -는데, -기 때문에, indirect speech',
  5: 'complex natural sentence, can use advanced grammar: -도록, -(으)ㄹ수록, quotations',
  6: 'near written language or advanced spoken Korean, rich vocabulary and complex structure',
};

// Check if string contains Korean characters
function hasKorean(s) { return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(s); }
// Check if string contains Chinese characters
function hasChinese(s) { return /[一-鿿]/.test(s); }

async function callDeepSeek(apiKey, messages) {
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages,
      temperature: 0.3,
      max_tokens: 150,
    }),
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function parseResult(raw) {
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed.sentence || !parsed.translation) return null;
    if (!hasKorean(parsed.sentence)) return null;
    if (!hasChinese(parsed.translation)) return null;
    return parsed;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { word, meaning, level = 1 } = body;
  if (!word) return new Response(JSON.stringify({ error: 'Missing word' }), { status: 400 });

  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[1];

  const systemMsg = {
    role: 'system',
    content: `You are a Korean language teaching assistant. You MUST:
1. Output ONLY valid JSON in the exact format: {"sentence":"...","translation":"..."}
2. The "sentence" field must be a Korean sentence (Hangul characters only, no English, no Chinese, no Japanese)
3. The "translation" field must be natural Chinese (Mandarin) translation only
4. Never mix languages in either field
5. Never add explanations, markdown, or any text outside the JSON`,
  };

  const userMsg = {
    role: 'user',
    content: `Create one example sentence for the Korean word "${word}" (meaning: ${meaning}).

Rules:
- TOPIK level ${level}: ${guide}
- The sentence MUST contain the word "${word}"
- Use 1st, 2nd, or 3rd person naturally — whichever fits best
- If 3rd person name is needed, use "유진이" only (Chinese: 俞真尼). Never use 지수, 민준, or other names
- Korean grammar must be 100% correct — check particles (조사) and sentence structure carefully
- Chinese translation must sound natural to native Chinese speakers, not word-for-word
- CRITICAL for kinship/relationship words: preserve the correct direction — 누나/언니 = 姐姐 (older sister), 오빠/형 = 哥哥 (older brother), 동생 = 弟弟/妹妹 (younger sibling), 아버지/아빠 = 爸爸, 어머니/엄마 = 妈妈. Never confuse 누나(姐姐) with 妹妹
- Output only JSON: {"sentence":"Korean sentence here","translation":"Chinese translation here"}`,
  };

  try {
    // First attempt
    let raw = await callDeepSeek(API_KEY, [systemMsg, userMsg]);
    let parsed = parseResult(raw);

    // Retry once if output is invalid
    if (!parsed) {
      raw = await callDeepSeek(API_KEY, [systemMsg, userMsg]);
      parsed = parseResult(raw);
    }

    if (!parsed) throw new Error('Invalid response after retry');

    return new Response(JSON.stringify({ sentence: parsed.sentence, translation: parsed.translation }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
