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


async function createFolder(accessToken, name, parentId) {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `'${parentId}' in parents`,
    'trashed=false'
  ].join(' and ');

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json().catch(() => ({}));
  if (!searchRes.ok) throw new Error(searchData.error?.message || 'Google Drive 폴더 조회 실패');
  if (searchData.files?.[0]) return searchData.files[0];

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) throw new Error(createData.error?.message || 'Google Drive 폴더 생성 실패');
  return createData;
}

async function uploadText(accessToken, parentId) {
  const boundary = `homesfm_${Date.now()}`;
  const fileName = `HOMES_FM_연결테스트_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  const metadata = { name: fileName, parents: [parentId], mimeType: 'text/plain' };
  const content = `HOMES FM Google Drive 연결 테스트\n${new Date().toISOString()}`;

  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google Drive 업로드 실패 (HTTP ${res.status})`);
  return data;
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST 요청만 허용됩니다.' });

  try {
    await requireAdmin(event);
    if (!GOOGLE_ROOT_FOLDER_ID) {
      return json(400, { error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID 환경변수가 없습니다.' });
    }

    const accessToken = await getAccessToken();
    const testFolder = await createFolder(accessToken, 'HOMES_FM_연결테스트', GOOGLE_ROOT_FOLDER_ID);
    const file = await uploadText(accessToken, testFolder.id);

    return json(200, { ok: true, folder: testFolder, file });
  } catch (error) {
    console.error('google-drive-test:', error);
    return json(error.status || 400, { error: error.message || 'Google Drive 연결 검사에 실패했습니다.' });
  }
};
