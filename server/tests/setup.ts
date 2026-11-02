process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/dainty-bloom-test';
process.env.CLIENT_URL = 'http://localhost:3001';
process.env.JWT_ACCESS_SECRET =
  'test-access-secret-with-at-least-32-characters';
process.env.JWT_REFRESH_SECRET =
  'test-refresh-secret-with-at-least-32-characters';
process.env.ACCESS_TOKEN_TTL = '15m';
process.env.REFRESH_TOKEN_TTL = '7d';
process.env.COOKIE_SECRET = 'test-cookie-signing-secret-with-at-least-32-chars';
process.env.COOKIE_SAMESITE = 'lax';
process.env.BCRYPT_COST = '10';
process.env.PASSWORD_RESET_TTL = '15m';
process.env.UPLOAD_MAX_BYTES = '10485760';
process.env.STORAGE_DRIVER = 'local';
process.env.API_PUBLIC_URL = 'http://localhost:3000';
process.env.UPLOAD_SIGNING_SECRET =
  'test-upload-signing-secret-with-at-least-32-characters';
process.env.CONTACT_RECIPIENT_EMAIL = 'owner@example.test';
process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_USERNAME = 'test-user';
process.env.SMTP_PASSWORD = 'test-only-password';
process.env.SMTP_FROM = 'store@example.test';
