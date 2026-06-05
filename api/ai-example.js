import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const APPID = process.env.BAIDU_FANYI_APPID;
  const KEY   = process.env.BAIDU_FANYI_KEY;
  if (!APPID || !KEY) return res.status(500).json({ error: 'API not configured' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { text } = body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  const salt = Date.now().toString();
  const sign = crypto.createHash('md5').update(APPID + text + salt + KEY).digest('hex');

  const params = new URLSearchParams({ q: text, from: 'kor', to: 'zh', appid: APPID, salt, sign });

  try {
    const resp = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`);
    const data = await resp.json();
    if (data.error_code) return res.status(502).json({ error: `Baidu error ${data.error_code}: ${data.error_msg}` });
    const result = data.trans_result?.map(r => r.dst).join(' ') || '';
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
