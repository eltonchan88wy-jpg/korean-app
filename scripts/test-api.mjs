import https from 'https';

import { constants } from 'crypto';

const options = {
  // 回到 krdict，尝试最简参数
  hostname: 'krdict.korean.go.kr',
  port: 443,
  path: '/api/search?key=FED1CBA747649D21AFF2683F6938A01C&q=%EA%B0%80',
  method: 'GET',
  rejectUnauthorized: false,
  // 允许旧版 TLS (TLS 1.0/1.1) 和弱密码套件
  secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT | constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
  ciphers: 'DEFAULT:@SECLEVEL=0',
  minVersion: 'TLSv1',
  headers: {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept':          'application/xml, text/xml, */*; q=0.01',
    'Accept-Language': 'ko-KR,ko;q=0.9,zh-CN;q=0.8',
    'Referer':         'https://krdict.korean.go.kr/openApi/openApiInfo',
    'Origin':          'https://krdict.korean.go.kr',
    'Connection':      'keep-alive',
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log('✅ 连接成功！');
    console.log('HTTP 状态:', res.statusCode);
    console.log('响应内容（前500字）:', data.slice(0, 500));
  });
});

req.on('error', (e) => {
  console.error('❌ 连接失败:', e.message);
  console.error('错误代码:', e.code);
});

req.setTimeout(10000, () => {
  console.error('❌ 请求超时');
  req.destroy();
});

req.end();
