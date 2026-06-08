export const config = { runtime: 'edge' };

const LEVEL_GUIDE = {
  1: '极简短句，5个词以内，只用最基础的 -아요/어요、-이에요/예요、있어요/없어요 语法，日常生活场景',
  2: '简单短句，8个词以内，可用 -고、-지만、-에서、-에게 等基础助词和连接词',
  3: '中等长度句子，可用 -아서/어서、-(으)면、-(으)ㄹ 수 있다、-고 싶다 等语法',
  4: '稍复杂句子，可用 -(으)ㄹ 것 같다、-는데、-기 때문에、간접화법 等中级语法',
  5: '较复杂自然句子，可用高级语法如 -도록、-(으)ㄹ수록、인용문 等',
  6: '接近书面语或高级口语，可使用复杂句型和丰富词汇',
};

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { word, meaning, pos, level = 1 } = body;
  if (!word) return new Response(JSON.stringify({ error: 'Missing word' }), { status: 400 });

  const guide = LEVEL_GUIDE[level] || LEVEL_GUIDE[1];

  const prompt = `你是韩语教学助手。请为韩语单词"${word}"（中文意思：${meaning}）造一个例句。

要求：
- 难度等级：TOPIK ${level}级
- 句子风格：${guide}
- 例句必须包含单词"${word}"
- 例句可以用第一、第二、第三人称，自然选择最合适的
- 如果例句中需要出现第三人称人名，统一使用"유진이"，中文翻译中对应写"俞真尼"，不要用지수、민준或其他名字
- 中文翻译要地道自然，符合中国人的表达习惯，不要逐字直译，读起来像正常中文句子
- 例句必须语法正确，符合韩语母语者的自然表达，造句前请自行检查助词、语序和语法结构是否正确
- 只输出JSON，格式：{"sentence":"韩文例句","translation":"中文翻译"}
- 不要任何其他内容，不要markdown代码块，不要解释`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 150 },
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Gemini error ${resp.status}`, detail: err.slice(0, 300) }), {
        status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid response format');
    const parsed = JSON.parse(match[0]);

    return new Response(JSON.stringify({ sentence: parsed.sentence || '', translation: parsed.translation || '' }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
