/**
 * Vercel Serverless Function — KRDict API 代理
 * 路径: /api/krdict
 * 解决浏览器直接调用 krdict.korean.go.kr 时的 CORS 问题
 *
 * 此文件部署到 Vercel 后自动生效，无需额外配置。
 * 需要在 Vercel 项目设置中添加环境变量: VITE_KRDICT_KEY
 */

export default async function handler(req, res) {
  // 只允许 GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.VITE_KRDICT_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'VITE_KRDICT_KEY not configured' });
  }

  // 透传查询参数，注入 key
  const params = new URLSearchParams(req.query);
  params.set('key', apiKey);

  const upstream = `https://krdict.korean.go.kr/api/selectWordList?${params}`;

  try {
    const upstream_res = await fetch(upstream, {
      headers: { 'User-Agent': 'KoreanLearningApp/1.0' },
    });

    const body = await upstream_res.text();

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(upstream_res.status).send(body);
  } catch (err) {
    console.error('[krdict proxy]', err);
    res.status(502).json({ error: 'Upstream request failed' });
  }
}
