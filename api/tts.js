export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const API_KEY = process.env.GOOGLE_TTS_KEY;
  if (!API_KEY) return new Response(JSON.stringify({ error: 'not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }

  const { text, slow } = body;
  if (!text) return new Response(JSON.stringify({ error: 'Missing text' }), { status: 400 });

  try {
    const resp = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'ko-KR', name: 'ko-KR-Neural2-A' },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: slow ? 0.65 : 1.0,
          pitch: 0,
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Google TTS error ${resp.status}`, detail: err.slice(0, 300) }), {
        status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await resp.json();
    const audio = data.audioContent;
    return new Response(JSON.stringify({ audio }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
