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


function html(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body
  };
}

exports.handler = async function(event) {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return json(500, { error: 'GOOGLE_DRIVE_CLIENT_ID 또는 GOOGLE_DRIVE_CLIENT_SECRET이 없습니다.' });
    }

    const origin = `https://${event.headers.host}`;
    const redirectUri = `${origin}/.netlify/functions/google-drive-auth`;

    const code = event.queryStringParameters?.code;
    const error = event.queryStringParameters?.error;

    if (error) {
      return html(400, `<script>alert('Google 연결이 취소되었거나 실패했습니다: ${String(error).replace(/'/g, '')}');window.close();</script>`);
    }

    if (!code) {
      const state = Math.random().toString(36).slice(2);
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.file',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state
      });
      return {
        statusCode: 302,
        headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
        body: ''
      };
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok) {
      return html(400, `<script>alert('Google 연결 실패: ${String(tokenData.error_description || tokenData.error || '토큰 오류').replace(/'/g, '')}');window.close();</script>`);
    }

    const refreshToken = tokenData.refresh_token || '';
    const message = refreshToken
      ? `연결 성공. Netlify 환경변수 GOOGLE_DRIVE_REFRESH_TOKEN에 다음 값을 저장하세요:\\n\\n${refreshToken}`
      : '연결은 성공했지만 새 Refresh Token이 발급되지 않았습니다. Google 계정 권한을 취소한 뒤 다시 연결하세요.';

    return html(200, `<!doctype html><meta charset="utf-8"><title>Google Drive 연결</title>
      <body style="font-family:sans-serif;padding:24px;line-height:1.6">
      <h2>Google Drive 연결 결과</h2>
      <textarea style="width:100%;height:180px">${message}</textarea>
      <p>값을 저장한 뒤 이 창을 닫고 테스트 사진 저장을 누르세요.</p>
      </body>`);
  } catch (error) {
    return json(error.status || 500, { error: error.message || 'Google 연결 처리 중 오류가 발생했습니다.' });
  }
};
