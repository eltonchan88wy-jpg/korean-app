// Node.js runtime needed for crypto (Baidu sign)
import crypto from 'crypto';

const LEVEL_GUIDE = {
  1: '极简短句，5个词以内，只用最基础的 -아요/어요、-이에요/예요、있어요/없어요 语法，日常生活场景',
  2: '简单短句，8个词以内，可用 -고、-지만、-에서、-에게 等基础助词和连接词',
  3: '中等长度句子，可用 -아서/어서、-(으)면、-(으)ㄹ 수 있다、-고 싶다 等语法',
  4: '稍复杂句子，可用 -(으)ㄹ 것 같다、-는데、-기 때문에、간접화법 等中级语法',
  5: '较复杂自然句子，可用高级语法如 -도록、-(으)ㄹ수록、인용문 等',
  6: '接近书面语或高级口语，可使用复杂句型和丰富词汇',
};

async function generateKoreanSentence(word, meaning, pos, level, apiKey) {
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[1];
  const prompt = `你是韩语教学助手。请为韩语单词"${word}"（中文意思：${meaning}）造一个韩文例句。

要求：
- 难度等级：TOPIK ${level}级
- 句子风格：${guide}
- 例句必须包含单词"${word}"
- 例句可以用第一、第二、第三人称，自然选择最合适的
- 如果需要出现第三人称人名，统一使用"유진이"
- 例句必须语法正确，符合韩语母语者的自然表达
- 只输出一个韩文句子，不要任何其他内容，不要翻译，不要解释，不要标点说明`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 100 },
      }),
    }
  );
  if (!resp.ok) throw new Error(`Gemini error ${resp.status}`);
  const data = await resp.json();
  return (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
}

async function baiduTranslate(text, appid, key) {
  const salt = Date.now().toString();
  const sign = crypto.createHash('md5').update(appid + text + salt + key).digest('hex');
  const params = new URLSearchParams({ q: text, from: 'kor', to: 'zh', appid, salt, sign });
  const resp = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`);
  if (!resp.ok) throw new Error(`Baidu error ${resp.status}`);
  const data = await resp.json();
  if (data.error_code) throw new Error(`Baidu error ${data.error_code}`);
  return data.trans_result?.[0]?.dst || '';
}

export default async function handler(req) {
  if (req.method !== 'POST') return Response.json({ error: 'Method Not Allowed' }, { status: 405 });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const BAIDU_APPID = process.env.BAIDU_FANYI_APPID;
  const BAIDU_KEY  = process.env.BAIDU_FANYI_KEY;

  if (!GEMINI_KEY || !BAIDU_APPID || !BAIDU_KEY)
    return Response.json({ error: 'API keys not configured' }, { status: 500 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { word, meaning, pos, level = 1 } = body;
  if (!word) return Response.json({ error: 'Missing word' }, { status: 400 });

  try {
    // Step 1: Gemini generates Korean sentence
    const sentence = await generateKoreanSentence(word, meaning, pos, level, GEMINI_KEY);
    if (!sentence) throw new Error('Empty sentence from Gemini');

    // Step 2: Baidu translates sentence to Chinese
    // Replace 유진이 in sentence with a note so Baidu knows it's a name
    const translation = await baiduTranslate(sentence, BAIDU_APPID, BAIDU_KEY);

    // Replace any transliteration of 유진이 with 俞真尼
    const finalTranslation = translation.replace(/유진이|柳珍伊|刘珍妮|尤珍妮|裕真|有珍|幽珍[이이]?/g, '俞真尼');

    return Response.json({ sentence, translation: finalTranslation }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return Response.json({ error: e.message }, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
