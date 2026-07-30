const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET || '';
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '';
const GOOGLE_ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '';

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

async function requireAdmin(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  const token = auth.slice(7).trim();

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) throw Object.assign(new Error('로그인 세션이 유효하지 않습니다.'), { status: 401 });
  const user = await userRes.json();

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(user.id)}&select=role,is_active&limit=1`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );
  if (!profileRes.ok) throw Object.assign(new Error('관리자 정보를 확인하지 못했습니다.'), { status: 500 });
  const rows = await profileRes.json();
  const profile = rows?.[0];
  if (!profile || profile.is_active === false || profile.role !== 'admin') {
    throw Object.assign(new Error('시스템 관리자만 사용할 수 있습니다.'), { status: 403 });
  }
  return user;
}

async function getAccessToken(refreshToken = GOOGLE_REFRESH_TOKEN) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refreshToken) {
    throw Object.assign(new Error('Google Drive 환경변수가 완전하지 않습니다.'), { status: 500 });
  }
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const msg = data.error_description || data.error || `Google 토큰 발급 실패 (HTTP ${res.status})`;
    throw Object.assign(new Error(msg), { status: 400 });
  }
  return data.access_token;
}


exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 허용됩니다.' });

  try {
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    if (!auth.startsWith('Bearer ')) return json(401, { error: '로그인이 필요합니다.' });

    if (!GOOGLE_ROOT_FOLDER_ID) return json(400, { error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID가 없습니다.' });

    const payload = JSON.parse(event.body || '{}');
    const fileName = String(payload.file_name || `homes-fm-${Date.now()}.jpg`);
    const mimeType = String(payload.mime_type || 'image/jpeg');
    const base64 = String(payload.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return json(400, { error: '업로드할 이미지 데이터가 없습니다.' });

    const accessToken = await getAccessToken();
    const boundary = `homesfm_${Date.now()}`;
    const metadata = {
      name: fileName,
      parents: [GOOGLE_ROOT_FOLDER_ID],
      mimeType
    };
    const binary = Buffer.from(base64, 'base64');
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`
    );
    const encoded = Buffer.from(binary.toString('base64'));
    const suffix = Buffer.from(`\r\n--${boundary}--`);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': `multipart/related; boundary=${boundary}`
        },
        body: Buffer.concat([prefix, encoded, suffix])
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json(res.status, { error: data.error?.message || 'Google Drive 업로드 실패' });

    return json(200, { ok: true, file: data });
  } catch (error) {
    console.error('google-drive-upload:', error);
    return json(error.status || 500, { error: error.message || '사진 업로드에 실패했습니다.' });
  }
};
