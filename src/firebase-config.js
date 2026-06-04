/**
 * Firebase 配置
 * 激活方式: 在 .env 文件中填写以下变量（参考 .env.example）
 * 尚未配置时，App 以"本地模式"运行（无好友系统）
 */

export const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID|| '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '',
};

export const FIREBASE_ENABLED = !!(
  FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId
);
