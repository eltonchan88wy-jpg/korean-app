/**
 * 批量为 api-words.json 的例句生成中文翻译
 * 使用 Gemini REST API，结果永久写入 JSON（一次性操作，断点续传）
 */

import https from 'https';
import http from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir     = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dir, '../src/data/api-words.json');

const API_KEY   = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ 请先设置环境变量：GEMINI_API_KEY=你的Key node scripts/translate-examples.mjs');
  process.exit(1);
}

const BATCH_SIZE = 30;
const DELAY_MS   = 15000;  // Gemini free tier: ~4 req/min to be safe

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 7890;
const TARGET_HOST = 'generativelanguage.googleapis.com';

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const path = url.replace('https://' + TARGET_HOST, '');

    // Connect via HTTP CONNECT proxy tunnel
    const proxyReq = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: 'CONNECT',
      path: `${TARGET_HOST}:443`,
    });

    proxyReq.on('error', reject);
    proxyReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
        return;
      }
      const tlsSocket = https.request({
        host: TARGET_HOST,
        path,
        method: 'POST',
        socket,
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Host': TARGET_HOST,
        },
      }, resp => {
        let raw = '';
        resp.on('data', c => raw += c);
        resp.on('end', () => {
          if (resp.statusCode >= 400) {
            reject(new Error(`HTTP ${resp.statusCode}: ${raw.slice(0, 300)}`));
          } else {
            try { resolve(JSON.parse(raw)); }
            catch { reject(new Error('JSON parse error: ' + raw.slice(0, 200))); }
          }
        });
      });
      tlsSocket.on('error', reject);
      tlsSocket.write(data);
      tlsSocket.end();
    });
    proxyReq.end();
  });
}

async function translateBatch(sentences) {
  const numbered = sentences.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: `请将以下韩语句子翻译成中文。只输出翻译，格式为"编号. 翻译"，一行一句，不要任何解释。\n\n${numbered}` }] }],
    generationConfig: { temperature: 0.1 }
  };
  const res  = await httpsPost(url, body);
  const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  const lines = text.split('\n').filter(l => l.trim());
  return lines.map(l => l.replace(/^\d+[\.\、\s]+/, '').trim());
}

async function main() {
  const words = JSON.parse(readFileSync(DATA_PATH, 'utf8'));

  const todo = words
    .map((w, i) => ({ i, example: w.example }))
    .filter(({ i, example }) => example && !words[i].exTrans);

  const already = words.filter(w => w.exTrans).length;
  console.log(`词库共 ${words.length} 词 | 已翻译：${already} | 待翻译：${todo.length}\n`);

  if (todo.length === 0) { console.log('✅ 全部已翻译！'); return; }

  let success = 0;
  const total = Math.ceil(todo.length / BATCH_SIZE);

  for (let b = 0; b < todo.length; b += BATCH_SIZE) {
    const batch    = todo.slice(b, b + BATCH_SIZE);
    const batchNum = Math.floor(b / BATCH_SIZE) + 1;
    process.stdout.write(`[${batchNum}/${total}] 第${b+1}~${Math.min(b+BATCH_SIZE, todo.length)}条... `);

    try {
      const translations = await translateBatch(batch.map(x => x.example));
      batch.forEach(({ i }, j) => { words[i].exTrans = translations[j] || ''; });
      writeFileSync(DATA_PATH, JSON.stringify(words, null, 2), 'utf8');
      success += batch.length;
      console.log('✓');
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }

    if (b + BATCH_SIZE < todo.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n✅ 完成！翻译了 ${success}/${todo.length} 条，写入 api-words.json。`);
}

main().catch(e => { console.error('脚本出错：', e); process.exit(1); });
