export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const API_KEY = process.env.GROQ_API_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { word, meaning, pos, example, exampleTrans } = body;
  if (!word) return new Response(JSON.stringify({ error: 'Missing word' }), { status: 400 });

  const prompt = `你是韩语教学助手，请用中文对以下内容做简洁的学习分析。

单词：${word}（${meaning || ''}）
${pos ? `词性：${pos}` : ''}
${example ? `例句：${example}` : ''}
${exampleTrans ? `例句翻译：${exampleTrans}` : ''}

请输出以下内容（简洁，每点一行）：
[语法要点]
用"•"开头，列出例句中1~2个最值得学习的语法点或用法，说明含义和用法。

[学习提示]
一句话：记忆这个单词的小技巧或常见搭配。`;

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Groq error ${resp.status}`, detail: err.slice(0, 200) }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const data = await resp.json();
    const result = data.choices?.[0]?.message?.content?.trim() || '';
    return new Response(JSON.stringify({ result }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
