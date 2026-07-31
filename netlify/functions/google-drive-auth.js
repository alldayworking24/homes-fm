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

function cleanName(value, fallback = '미분류') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  return cleaned || fallback;
}

async function requireActiveUser(event, adminOnly = false) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('Supabase 환경변수가 없습니다.'), { status: 500 });
  }

  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  if (!authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('로그인이 필요합니다.'), { status: 401 });
  }

  const accessToken = authorization.slice(7).trim();

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!userRes.ok) {
    throw Object.assign(new Error('로그인 세션이 만료되었습니다.'), { status: 401 });
  }

  const authUser = await userRes.json();

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_users?user_id=eq.${encodeURIComponent(authUser.id)}` +
      '&select=user_id,email,role,is_active&limit=1',
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );

  if (!profileRes.ok) {
    throw Object.assign(new Error('사용자 정보를 확인하지 못했습니다.'), { status: 500 });
  }

  const profiles = await profileRes.json();
  const profile = profiles?.[0];

  if (!profile || profile.is_active === false) {
    throw Object.assign(new Error('사용 중인 계정을 확인할 수 없습니다.'), { status: 403 });
  }

  if (adminOnly && profile.role !== 'admin') {
    throw Object.assign(new Error('시스템 관리자만 사용할 수 있습니다.'), { status: 403 });
  }

  return { authUser, profile };
}

async function getGoogleAccessToken(refreshToken = GOOGLE_REFRESH_TOKEN) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !refreshToken) {
    throw Object.assign(
      new Error('Google Drive 환경변수가 완전하지 않습니다.'),
      { status: 500 }
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const tokenData = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok || !tokenData.access_token) {
    throw Object.assign(
      new Error(
        tokenData.error_description ||
        tokenData.error ||
        `Google 토큰 발급 실패 (HTTP ${tokenRes.status})`
      ),
      { status: 400 }
    );
  }

  return tokenData.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
  const name = cleanName(folderName);
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = [
    `name='${escaped}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    `'${parentId}' in parents`,
    'trashed=false'
  ].join(' and ');

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
      '&fields=files(id,name)&pageSize=1&spaces=drive',
    {
      headers: { authorization: `Bearer ${accessToken}` }
    }
  );

  const searchData = await searchRes.json().catch(() => ({}));

  if (!searchRes.ok) {
    throw new Error(searchData.error?.message || 'Google Drive 폴더 조회에 실패했습니다.');
  }

  if (searchData.files?.length) {
    return searchData.files[0];
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    {
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
    }
  );

  const createData = await createRes.json().catch(() => ({}));

  if (!createRes.ok) {
    throw new Error(createData.error?.message || 'Google Drive 폴더 생성에 실패했습니다.');
  }

  return createData;
}

async function ensureFolderPath(accessToken, folderNames) {
  let parentId = GOOGLE_ROOT_FOLDER_ID;
  const folders = [];

  for (const folderName of folderNames) {
    const folder = await findOrCreateFolder(accessToken, parentId, folderName);
    folders.push(folder);
    parentId = folder.id;
  }

  return { parentId, folders };
}


function html(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    },
    body
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

exports.handler = async function handler(event) {
  try {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      return json(500, {
        error: 'GOOGLE_DRIVE_CLIENT_ID 또는 GOOGLE_DRIVE_CLIENT_SECRET이 없습니다.'
      });
    }

    const host = event.headers?.['x-forwarded-host'] || event.headers?.host;
    const protocol = event.headers?.['x-forwarded-proto'] || 'https';
    const redirectUri = `${protocol}://${host}/.netlify/functions/google-drive-auth`;

    const code = event.queryStringParameters?.code;
    const oauthError = event.queryStringParameters?.error;

    if (oauthError) {
      return html(
        400,
        `<meta charset="utf-8"><script>
          alert('Google 연결이 취소되었거나 실패했습니다.');
          window.close();
        </script>`
      );
    }

    if (!code) {
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true'
      });

      return {
        statusCode: 302,
        headers: {
          location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        },
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
      return html(
        400,
        `<meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">
          <h2>Google Drive 연결 실패</h2>
          <p>${escapeHtml(tokenData.error_description || tokenData.error || '토큰 오류')}</p>
        </body>`
      );
    }

    const refreshToken = tokenData.refresh_token || '';
    const message = refreshToken
      ? '아래 값을 Netlify의 GOOGLE_DRIVE_REFRESH_TOKEN 환경변수에 저장하세요.'
      : '새 Refresh Token이 발급되지 않았습니다. Google 계정에서 기존 앱 권한을 취소한 후 다시 연결하세요.';

    return html(
      200,
      `<!doctype html>
      <meta charset="utf-8">
      <title>Google Drive 연결 완료</title>
      <body style="font-family:sans-serif;padding:24px;line-height:1.6">
        <h2>Google Drive 연결 완료</h2>
        <p>${escapeHtml(message)}</p>
        <textarea style="width:100%;height:180px">${escapeHtml(refreshToken)}</textarea>
        <p>환경변수 저장 후 Netlify를 다시 배포하고 테스트 사진 저장을 누르세요.</p>
      </body>`
    );
  } catch (error) {
    console.error('google-drive-auth error:', error);
    return json(error.status || 500, {
      error: error.message || 'Google 연결 처리 중 오류가 발생했습니다.'
    });
  }
};
