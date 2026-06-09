import admin from 'firebase-admin';

let adminApp;
function getAdminApp() {
  if (adminApp) return adminApp;
  const key = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  adminApp = admin.initializeApp({
    credential: admin.credential.cert(key),
  });
  return adminApp;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { username, email, newPassword } = body;
  if (!username || !email || !newPassword) return json({ error: '请填写所有字段' }, 400);
  if (newPassword.length < 6) return json({ error: '新密码至少6位' }, 400);

  try {
    const app = getAdminApp();
    const db = admin.firestore(app);
    const auth = admin.auth(app);

    // 1. 用邮箱查 Firebase Auth，获取 uid
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch {
      return json({ error: '邮箱或用户名不匹配' }, 400);
    }

    // 2. 用 uid 查 Firestore，验证用户名是否一致
    const doc = await db.collection('users').doc(userRecord.uid).get();
    if (!doc.exists) return json({ error: '邮箱或用户名不匹配' }, 400);

    const storedUsername = (doc.data().username || '').trim().toLowerCase();
    if (storedUsername !== username.trim().toLowerCase()) {
      return json({ error: '邮箱或用户名不匹配' }, 400);
    }

    // 3. 验证通过，更新密码
    await auth.updateUser(userRecord.uid, { password: newPassword });
    return json({ ok: true });

  } catch (e) {
    return json({ error: '服务器错误，请稍后再试' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
