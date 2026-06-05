export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const { word, meaning, example } = body;
  if (!word) {
    return new Response(JSON.stringify({ error: 'Missing word' }), { status: 400 });
  }

  const hasExample = example && example.trim();

  const prompt = hasExample
    ? `你是韩语教学助手。请针对以下内容用中文给出简洁的学习分析，格式严格按照示例输出，不要多余内容。

单词：${word}（${meaning || ''}）
例句：${example}

请输出以下格式（每部分各占一行，不要编号或多余符号）：
[翻译]
例句的中文翻译

[语法]
1条或2条最重要的语法/词汇要点，每条一行，用"•"开头`
    : `你是韩语教学助手。请为韩语单词"${word}"（${meaning || ''}）造一个简单实用的例句，并给出学习分析。格式严格如下：

[例句]
韩语例句

[翻译]
例句的中文翻译

[语法]
1条或2条最重要的语法/词汇要点，每条一行，用"•"开头`;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 300,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Deepseek API error: ${resp.status}`, detail: err.slice(0, 200) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    return new Response(JSON.stringify({ result: text }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
