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


function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);

  if (!match) {
    throw Object.assign(
      new Error('사진 데이터 형식이 올바르지 않습니다.'),
      { status: 400 }
    );
  }

  return {
    mimeType: match[1] || 'image/jpeg',
    bytes: Buffer.from(match[2], 'base64')
  };
}

function normalizePhase(phase) {
  const raw = String(phase || '').toLowerCase();

  if (raw.includes('before') || raw.includes('pre')) return '01_보수전';
  if (raw.includes('working') || raw.includes('during')) return '02_작업중';
  if (raw.includes('after') || raw.includes('complete')) return '03_보수후';
  if (raw.includes('repair')) return '02_보수사진';
  if (raw.includes('check') || raw.includes('inspection')) return '01_점검사진';

  return cleanName(phase, '사진');
}

function workCategory(payload) {
  const typeText = String(payload.inspectionType || '').toLowerCase();
  const phaseText = String(payload.phase || '').toLowerCase();

  const isRepair =
    typeText.includes('보수') ||
    typeText.includes('repair') ||
    phaseText.includes('before') ||
    phaseText.includes('working') ||
    phaseText.includes('after') ||
    phaseText.includes('repair');

  return isRepair ? '02_보수' : '01_점검';
}

async function uploadBinaryFile(accessToken, parentId, fileName, mimeType, bytes) {
  const boundary = `homesfm_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name: cleanName(fileName, `사진_${Date.now()}.jpg`),
    parents: [parentId],
    mimeType
  };

  const prefix = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`
  );

  const suffix = Buffer.from(`\r\n--${boundary}--`);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`
      },
      body: Buffer.concat([prefix, bytes, suffix])
    }
  );

  const uploadData = await uploadRes.json().catch(() => ({}));

  if (!uploadRes.ok) {
    throw new Error(
      uploadData.error?.message ||
      `Google Drive 사진 업로드 실패 (HTTP ${uploadRes.status})`
    );
  }

  return uploadData;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST 요청만 허용됩니다.' });
  }

  try {
    await requireActiveUser(event, false);

    if (!GOOGLE_ROOT_FOLDER_ID) {
      return json(500, {
        error: 'GOOGLE_DRIVE_ROOT_FOLDER_ID 환경변수가 없습니다.'
      });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, {
        error: '요청 데이터 형식이 올바르지 않습니다.'
      });
    }

    // index.html에서 보내는 실제 필드명:
    // dataUrl, fileName, inspectionScope, branch, building, unit,
    // commonSpace, commonZone, date, inspectionType, phase
    const { mimeType, bytes } = parseDataUrl(payload.dataUrl);

    const scope = payload.inspectionScope === 'common' ? '02_공용부' : '01_전용부';

    const location =
      payload.inspectionScope === 'common'
        ? [payload.commonSpace, payload.commonZone].filter(Boolean).join('_')
        : payload.unit;

    const category = workCategory(payload);
    const phaseFolder = normalizePhase(payload.phase);

    // 최종 폴더 구조:
    // 루트 / 지점 / 동 / 전용부·공용부 / 호실·공용공간 / 점검·보수 / 날짜 / 사진단계
    const folderPath = [
      cleanName(payload.branch, '지점 미등록'),
      cleanName(payload.building, '동 구분 없음'),
      scope,
      cleanName(location, '위치 미등록'),
      category,
      cleanName(payload.date, new Date().toISOString().slice(0, 10)),
      phaseFolder
    ];

    const accessToken = await getGoogleAccessToken();
    const { parentId, folders } = await ensureFolderPath(
      accessToken,
      folderPath
    );

    const file = await uploadBinaryFile(
      accessToken,
      parentId,
      payload.fileName || `사진_${Date.now()}.jpg`,
      mimeType,
      bytes
    );

    return json(200, {
      ok: true,
      file,
      folder_path: folderPath,
      folder_ids: folders.map(folder => folder.id)
    });
  } catch (error) {
    console.error('google-drive-upload error:', error);
    return json(error.status || 500, {
      error: error.message || 'Google Drive 저장에 실패했습니다.'
    });
  }
};
