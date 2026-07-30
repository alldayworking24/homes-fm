const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEFAULT_PASSWORD_RAW = process.env.HOMES_FM_DEFAULT_PASSWORD || 'Homes!0338';

function temporaryPassword() {
  const pw = String(DEFAULT_PASSWORD_RAW || '');
  const strong = pw.length >= 8 &&
    /[A-Za-z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw);
  return strong ? pw : 'Homes!0338';
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.msg ||
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Supabase 요청 실패 (HTTP ${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function getCaller(event) {
  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  if (!authorization.startsWith('Bearer ')) {
    const err = new Error('로그인 정보가 없습니다.');
    err.status = 401;
    throw err;
  }

  const accessToken = authorization.slice(7).trim();

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!userRes.ok) {
    const err = new Error('로그인 세션이 만료되었거나 유효하지 않습니다.');
    err.status = 401;
    throw err;
  }

  const authUser = await userRes.json();

  const rows = await supabaseFetch(
    `/rest/v1/app_users?user_id=eq.${encodeURIComponent(authUser.id)}` +
    `&select=user_id,email,role,is_active&limit=1`
  );

  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile || profile.is_active === false) {
    const err = new Error('사용 중인 관리자 계정을 확인할 수 없습니다.');
    err.status = 403;
    throw err;
  }

  return { authUser, profile };
}

function ensureRole(profile, allowedRoles) {
  if (!allowedRoles.includes(profile.role)) {
    const err = new Error('이 작업을 수행할 권한이 없습니다.');
    err.status = 403;
    throw err;
  }
}

async function listUsers(caller) {
  ensureRole(caller.profile, ['admin', 'manager']);

  const users = await supabaseFetch(
    '/rest/v1/app_users' +
    '?select=user_id,email,display_name,department,phone,role,is_active,last_seen_at,last_login_at,created_at' +
    '&order=created_at.desc'
  );

  const now = Date.now();
  const withOnline = (users || []).map((user) => {
    const seen = user.last_seen_at ? new Date(user.last_seen_at).getTime() : 0;
    return {
      ...user,
      is_online: Boolean(seen && now - seen <= 2 * 60 * 1000)
    };
  });

  return response(200, { users: withOnline });
}

async function createUser(caller, payload) {
  ensureRole(caller.profile, ['admin']);

  const email = String(payload.email || '').trim().toLowerCase();
  const displayName = String(payload.name || payload.display_name || '').trim();
  const department = String(payload.department || '').trim() || null;
  const phone = String(payload.phone || '').trim() || null;
  const role = ['staff', 'manager', 'admin'].includes(payload.role)
    ? payload.role
    : 'staff';

  if (!email || !displayName) {
    return response(400, { error: '이메일과 이름은 필수입니다.' });
  }

  if (role !== 'admin' && !email.endsWith('@homes.global')) {
    return response(400, {
      error: '일반·운영 계정은 @homes.global 이메일만 등록할 수 있습니다.'
    });
  }

  const password = temporaryPassword();

  let createdAuthUser = null;
  try {
    createdAuthUser = await supabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name: displayName,
          display_name: displayName,
          department,
          phone,
          role,
          must_change_password: true
        }
      })
    });

    const userId = createdAuthUser?.id || createdAuthUser?.user?.id;
    if (!userId) throw new Error('생성된 사용자 ID를 확인할 수 없습니다.');

    await supabaseFetch('/rest/v1/app_users', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        email,
        display_name: displayName,
        department,
        phone,
        role,
        is_active: true
      })
    });

    return response(200, {
      ok: true,
      user_id: userId,
      temporary_password: password
    });
  } catch (error) {
    const createdId = createdAuthUser?.id || createdAuthUser?.user?.id;
    if (createdId) {
      try {
        await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(createdId)}`, {
          method: 'DELETE'
        });
      } catch (_) {}
    }

    if (/already|registered|duplicate|unique/i.test(error.message || '')) {
      return response(409, { error: '이미 등록된 이메일입니다.' });
    }
    throw error;
  }
}

async function setRole(caller, payload) {
  ensureRole(caller.profile, ['admin']);

  const userId = String(payload.user_id || '').trim();
  const role = String(payload.role || '').trim();

  if (!userId || !['staff', 'manager', 'admin'].includes(role)) {
    return response(400, { error: '사용자 ID 또는 권한 값이 올바르지 않습니다.' });
  }

  if (userId === caller.authUser.id && role !== 'admin') {
    return response(400, { error: '현재 로그인한 관리자 자신의 권한은 낮출 수 없습니다.' });
  }

  await supabaseFetch(`/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      role,
      updated_at: new Date().toISOString()
    })
  });

  await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      user_metadata: { role }
    })
  });

  return response(200, { ok: true });
}

async function setActive(caller, payload) {
  ensureRole(caller.profile, ['admin']);

  const userId = String(payload.user_id || '').trim();
  const isActive = Boolean(payload.is_active);

  if (!userId) return response(400, { error: '사용자 ID가 없습니다.' });
  if (userId === caller.authUser.id && !isActive) {
    return response(400, { error: '현재 로그인한 관리자 계정은 중지할 수 없습니다.' });
  }

  await supabaseFetch(`/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      is_active: isActive,
      updated_at: new Date().toISOString()
    })
  });

  return response(200, { ok: true });
}

async function resetPassword(caller, payload) {
  ensureRole(caller.profile, ['admin', 'manager']);

  const userId = String(payload.user_id || '').trim();
  if (!userId) return response(400, { error: '사용자 ID가 없습니다.' });

  const targetRows = await supabaseFetch(
    `/rest/v1/app_users?user_id=eq.${encodeURIComponent(userId)}` +
    '&select=user_id,role&limit=1'
  );
  const target = Array.isArray(targetRows) ? targetRows[0] : null;

  if (!target) return response(404, { error: '사용자를 찾을 수 없습니다.' });

  if (caller.profile.role === 'manager' && target.role !== 'staff') {
    return response(403, { error: '운영 관리자는 일반 사용자 비밀번호만 초기화할 수 있습니다.' });
  }

  const password = temporaryPassword();

  await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      password,
      user_metadata: { must_change_password: true }
    })
  });

  return response(200, {
    ok: true,
    temporary_password: password
  });
}

async function deleteRecord(caller, payload) {
  ensureRole(caller.profile, ['admin']);

  const clientId = Number(payload.client_id);
  if (!Number.isFinite(clientId)) {
    return response(400, { error: '점검 이력 ID가 올바르지 않습니다.' });
  }

  // 프로젝트에서 사용하는 점검 이력 테이블명이 inspection_records인 경우 동작합니다.
  // 다른 테이블명을 사용한다면 아래 이름만 실제 테이블명으로 변경하세요.
  await supabaseFetch(`/rest/v1/inspection_records?client_id=eq.${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' }
  });

  return response(200, { ok: true });
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return response(204, {});

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return response(500, {
      error: 'Netlify 환경변수 SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다.'
    });
  }

  try {
    const caller = await getCaller(event);

    if (event.httpMethod === 'GET') {
      const action = event.queryStringParameters?.action || 'list';
      if (action === 'list') return await listUsers(caller);
      return response(400, { error: '지원하지 않는 조회 작업입니다.' });
    }

    if (event.httpMethod !== 'POST') {
      return response(405, { error: '지원하지 않는 요청 방식입니다.' });
    }

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return response(400, { error: '요청 데이터 형식이 올바르지 않습니다.' });
    }

    switch (payload.action) {
      case 'create':
        return await createUser(caller, payload);
      case 'set_role':
        return await setRole(caller, payload);
      case 'set_active':
        return await setActive(caller, payload);
      case 'reset_password':
        return await resetPassword(caller, payload);
      case 'delete_record':
        return await deleteRecord(caller, payload);
      default:
        return response(400, { error: '지원하지 않는 작업입니다.' });
    }
  } catch (error) {
    console.error('admin-user function error:', error);
    return response(error.status || 500, {
      error: error.message || '서버 처리 중 오류가 발생했습니다.'
    });
  }
};
