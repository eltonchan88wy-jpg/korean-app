export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { word, meaning, pos, example, exampleTrans } = body;
  if (!word) return new Response(JSON.stringify({ error: 'Missing word' }), { status: 400 });

  const prompt = `你是韩语教学助手，请用中文对以下内容做简洁的学习分析。
注意：只输出下面要求的两个部分，不要输出词典解释、单词定义或其他内容，不要用markdown标题符号（#），不要混入英文或其他语言。

单词：${word}（${meaning || ''}）
${pos ? `词性：${pos}` : ''}
${example ? `例句（韩文）：${example}` : ''}
${exampleTrans ? `例句（中文）：${exampleTrans}` : ''}

请输出以下两个部分：

[语法要点]
用"•"开头，针对上面的韩文例句，列出1~2个最值得学习的语法点（如助词用法、语尾变化、句型结构等），说明含义和用法。

[学习提示]
一句话：帮助记忆"${word}"这个单词的小技巧或最常见搭配。`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 400 },
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Gemini error ${resp.status}`, detail: err.slice(0, 200) }), {
        status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await resp.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return new Response(JSON.stringify({ result }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
