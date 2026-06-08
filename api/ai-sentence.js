import crypto from 'crypto';

const LEVEL_GUIDE = {
  1: '极简短句，5个词以内，只用最基础的 -아요/어요、-이에요/예요、있어요/없어요 语法，日常生活场景',
  2: '简单短句，8个词以内，可用 -고、-지만、-에서、-에게 等基础助词和连接词',
  3: '中等长度句子，可用 -아서/어서、-(으)면、-(으)ㄹ 수 있다、-고 싶다 等语法',
  4: '稍复杂句子，可用 -(으)ㄹ 것 같다、-는데、-기 때문에、간접화법 等中级语法',
  5: '较复杂自然句子，可用高级语法如 -도록、-(으)ㄹ수록、인용문 等',
  6: '接近书面语或高级口语，可使用复杂句型和丰富词汇',
};

async function generateKoreanSentence(word, meaning, level, apiKey) {
  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[1];
  const prompt = `你是韩语教学助手。请为韩语单词"${word}"（中文意思：${meaning}）造一个韩文例句。

要求：
- 难度等级：TOPIK ${level}级
- 句子风格：${guide}
- 例句必须包含单词"${word}"
- 例句可以用第一、第二、第三人称，自然选择最合适的
- 如果需要出现第三人称人名，统一使用"유진이"
- 例句必须语法正确，符合韩语母语者的自然表达
- 只输出一个韩文句子，不要任何其他内容，不要翻译，不要解释`;

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
  const data = await resp.json();
  if (data.error_code) throw new Error(`Baidu error ${data.error_code}: ${data.error_msg}`);
  return data.trans_result?.[0]?.dst || '';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const GEMINI_KEY  = process.env.GEMINI_API_KEY;
  const BAIDU_APPID = process.env.BAIDU_FANYI_APPID;
  const BAIDU_KEY   = process.env.BAIDU_FANYI_KEY;

  if (!GEMINI_KEY || !BAIDU_APPID || !BAIDU_KEY)
    return res.status(500).json({ error: 'API keys not configured' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { word, meaning, pos, level = 1 } = body;
  if (!word) return res.status(400).json({ error: 'Missing word' });

  try {
    // Step 1: Gemini generates Korean sentence
    const sentence = await generateKoreanSentence(word, meaning, level, GEMINI_KEY);
    if (!sentence) throw new Error('Empty sentence from Gemini');

    // Step 2: Baidu translates the Korean sentence to Chinese
    let translation = await baiduTranslate(sentence, BAIDU_APPID, BAIDU_KEY);

    // Normalize 유진이 transliteration to 俞真尼
    translation = translation.replace(/유진이|柳珍伊|刘珍妮|尤珍妮|裕真伊|有珍伊/g, '俞真尼');

    res.json({ sentence, translation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
