
/* ===== v38 Supabase Auth / 사용자 DB 연동 · 세션 유지 · 사진 방향 보정 ===== */
const HOMES_SUPABASE_URL='https://hunoualsfmfckalwbilt.supabase.co';
const HOMES_SUPABASE_KEY='sb_publishable_DFp-SNqkUWJiX4CHLu_gxQ_FrtXHDwg';
const homesSb=window.supabase.createClient(HOMES_SUPABASE_URL,HOMES_SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'homes-fm-auth'}});
// 과거 버전의 기기별 점검 캐시는 더 이상 화면 데이터로 사용하지 않습니다.
localStorage.removeItem('homesFmChecks');
let homesDbUser=null;
let presenceTimer=null;
async function updateMyPresence(markLogin=false){const uid=homesDbUser?.user_id;if(!uid||document.visibilityState==='hidden')return;const now=new Date().toISOString(),values={last_seen_at:now};if(markLogin)values.last_login_at=now;const {error}=await homesSb.from('app_users').update(values).eq('user_id',uid);if(error)console.warn('사용자 접속 상태 갱신 실패',error)}
function startPresenceTracking(markLogin=false){clearInterval(presenceTimer);updateMyPresence(markLogin);presenceTimer=setInterval(async()=>{await updateMyPresence(false);if(isAdmin()&&!document.getElementById('account')?.classList.contains('hide'))renderDbUserList()},60000)}
function stopPresenceTracking(){clearInterval(presenceTimer);presenceTimer=null}
function formatAccessTime(value){return formatKstDateTime(value)||'접속 기록 없음'}
function sortUsersByRecentLogin(users){
  const userTime=person=>{
    const candidates=[person?.last_seen_at,person?.last_login_at,person?.created_at];
    for(const value of candidates){
      const time=value?new Date(value).getTime():0;
      if(Number.isFinite(time)&&time>0)return time;
    }
    return 0;
  };
  return [...(users||[])].sort((a,b)=>{
    const safeATime=userTime(a);
    const safeBTime=userTime(b);
    if(safeATime!==safeBTime)return safeBTime-safeATime;
    return String(a?.display_name||a?.email||'').localeCompare(String(b?.display_name||b?.email||''),'ko');
  });
}
function mapDbRole(role){return role==='admin'?'admin':role==='manager'?'manager':'viewer'}
function cacheDbUser(row){
  if(!row)return null;
  homesDbUser={user_id:row.user_id||row.id,id:row.user_id||row.id,email:row.email,name:row.display_name||row.name||row.email,department:row.department||'',phone:row.phone||'',role:mapDbRole(row.role),dbRole:row.role||'staff',active:row.is_active!==false,mustChangePassword:!!row.must_change_password};
  localStorage.setItem('homesFmSessionEmail',homesDbUser.email);
  let users=[];try{users=JSON.parse(localStorage.getItem('homesFmUsers')||'[]')}catch(e){}
  const i=users.findIndex(x=>x.email===homesDbUser.email);if(i>=0)users[i]={...users[i],...homesDbUser};else users.push(homesDbUser);
  localStorage.setItem('homesFmUsers',JSON.stringify(users));
  return homesDbUser;
}
async function fetchMyDbUser(session){
  if(!session?.user)return null;
  const {data,error}=await homesSb.from('app_users').select('user_id,email,display_name,department,phone,role,is_active').eq('user_id',session.user.id).maybeSingle();
  if(error)throw error;
  const meta=session.user.user_metadata||{};
  return cacheDbUser({...data,user_id:session.user.id,email:session.user.email,display_name:data?.display_name||meta.name||meta.display_name||session.user.email,phone:data?.phone||meta.phone||'',must_change_password:meta.must_change_password===true});
}
currentUser=function(){return homesDbUser};
isAdmin=function(){return homesDbUser?.dbRole==='admin'||homesDbUser?.role==='admin'};
inspectorName=function(){return homesDbUser?.name||homesDbUser?.email||''};
loginUser=async function(){
  const email=loginEmail.value.trim().toLowerCase(),password=loginPassword.value;
  if(!email||!password){alert('이메일과 비밀번호를 입력하세요.');return}
  const {data,error}=await homesSb.auth.signInWithPassword({email,password});
  if(error){alert('이메일 또는 비밀번호가 올바르지 않습니다.');return}
  try{await fetchMyDbUser(data.session)}catch(e){await homesSb.auth.signOut();alert('사용자 DB 정보를 확인할 수 없습니다. 관리자에게 문의하세요.');return}
  if(!homesDbUser.active){await homesSb.auth.signOut();homesDbUser=null;alert('사용 중지된 계정입니다.');return}
  startPresenceTracking(true);
  try{await loadBranchStructureFromDb(false)}catch(e){console.warn('지점·호실 DB 조회 실패',e)}
  loginPassword.value='';applyAuthGate();renderAccount();renderMore();
  go(homesDbUser.mustChangePassword?'firstPassword':'home');
};
logoutUser=async function(){stopPresenceTracking();await homesSb.auth.signOut();homesDbUser=null;localStorage.removeItem('homesFmSessionEmail');applyAuthGate();renderAccount();renderMore();go('account')};
completeFirstPassword=async function(){
  const cur=firstCurrentPassword.value,newPw=firstNewPassword.value,confirmPw=firstConfirmPassword.value;
  if(!passwordValid(newPw)){alert('새 비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.');return}
  if(newPw!==confirmPw){alert('새 비밀번호 확인이 일치하지 않습니다.');return}
  const email=homesDbUser?.email;if(!email)return go('account');
  const check=await homesSb.auth.signInWithPassword({email,password:cur});if(check.error){alert('현재 임시 비밀번호가 올바르지 않습니다.');return}
  const {error}=await homesSb.auth.updateUser({password:newPw,data:{...check.data.user.user_metadata,must_change_password:false}});
  if(error){alert('비밀번호 변경에 실패했습니다: '+error.message);return}
  homesDbUser.mustChangePassword=false;cacheDbUser(homesDbUser);
  firstCurrentPassword.value=firstNewPassword.value=firstConfirmPassword.value='';alert('비밀번호가 변경되었습니다.');applyAuthGate();go('home');
};
adminRegisterUser=async function(){
  if(!isAdmin()){alert('시스템 관리자만 사용자를 등록할 수 있습니다.');return}
  if(location.protocol==='file:'){
    alert('파일을 직접 연 로컬 실행에서는 사용자 등록 서버가 없어 등록할 수 없습니다.\nNetlify에 배포한 주소에서 실행하거나, Netlify CLI의 netlify dev로 실행해 주세요.');
    return
  }
  const email=adminRegEmail.value.trim().toLowerCase(),name=adminRegName.value.trim(),department=adminRegDept.value.trim(),phone=adminRegPhone.value.trim(),uiRole=document.querySelector('input[name="adminRegRole"]:checked')?.value||'viewer';
  if(!email||!name){alert('이메일과 이름은 필수입니다.');return}
  if(!email.endsWith('@homes.global')&&uiRole!=='admin'){alert('일반 계정은 @homes.global 이메일만 등록할 수 있습니다.');return}
  const {data:{session}}=await homesSb.auth.getSession();if(!session){alert('로그인 세션이 만료되었습니다.');return}
  let res;
  try{res=await fetch('/.netlify/functions/admin-user',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+session.access_token},body:JSON.stringify({action:'create',email,name,department,phone,role:uiRole==='admin'?'admin':uiRole==='manager'?'manager':'staff'})})}
  catch(e){alert('사용자 등록 서버에 연결할 수 없습니다. Netlify 배포 상태 또는 로컬 netlify dev 실행 여부를 확인해 주세요.');return}
  const out=await res.json().catch(()=>({}));if(!res.ok){alert(out.error||`사용자 등록에 실패했습니다. (HTTP ${res.status})`);return}
  adminRegEmail.value=adminRegName.value=adminRegDept.value=adminRegPhone.value='';document.querySelector('input[name="adminRegRole"][value="viewer"]').checked=true;
  await renderDbUserList();alert((out.recovered?'이 이메일은 이전 등록 시도에서 계정이 중간에 끊겨(인증 계정만 있고 목록엔 없는 상태) 있었습니다. 자동으로 복구하여 등록을 완료했습니다.\n':'사용자 계정을 DB에 등록했습니다.\n')+'초기 비밀번호: '+(out.temporary_password||'Homes!0338')+'\n최초 로그인 시 비밀번호 변경이 필요합니다.');
};
function driveResult(message,type){
  const result=document.getElementById('driveTestResult');if(!result)return;
  result.className=`driveTestResult show ${type||''}`;result.textContent=message;
}
function connectGoogleDrive(){
  if(location.protocol==='file:'){driveResult('Google 계정 연결은 배포된 Netlify 주소에서 진행할 수 있습니다.','error');return}
  window.open('/.netlify/functions/google-drive-auth','homesFmDriveOAuth','width=720,height=760,noopener');
}
async function testGoogleDriveConnection(){
  if(location.protocol==='file:'){driveResult('테스트 사진 저장은 배포된 Netlify 주소에서 진행할 수 있습니다.','error');return}
  const btn=document.getElementById('driveTestBtn');if(btn)btn.disabled=true;
  driveResult('Google Drive 연결과 폴더 쓰기 권한을 확인하고 있습니다.','');
  try{
    const {data:{session}}=await homesSb.auth.getSession();if(!session)throw new Error('로그인 세션이 만료되었습니다.');
    const response=await fetch('/.netlify/functions/google-drive-test',{method:'POST',headers:{authorization:'Bearer '+session.access_token}});
    const out=await response.json().catch(()=>({}));if(!response.ok)throw new Error(out.error||`연결 검사에 실패했습니다. (HTTP ${response.status})`);
    driveResult(`테스트 사진 저장 완료: ${out.file?.name||'Google Drive 파일 생성 성공'}`,'ok');
  }catch(error){driveResult(error?.message||String(error),'error')}
  finally{if(btn)btn.disabled=false}
}
async function renderDbUserList(){
  // [권한 정리] 이 목록은 이제 화면 자체가 시스템 관리자에게만 보이므로 조회 권한도 시스템 관리자로 제한합니다.
  if(!isAdmin())return;
  const {data:{session}}=await homesSb.auth.getSession();if(!session)return;
  const res=await fetch('/.netlify/functions/admin-user?action=list',{headers:{authorization:'Bearer '+session.access_token}});if(!res.ok)return;
  const out=await res.json();const wrap=document.getElementById('userList');if(!wrap)return;
  // [예외 관리자 비노출] homes-fm은 예외적으로 @homes.global이 아닌 이메일(개인 이메일 등)로 등록된
  // "예외 관리자" 계정을 허용합니다(계정 자체는 정상이며 로그인도 가능합니다). 시스템 관리자가 아닌
  // 사용자에게는 이런 예외 계정이 목록에 보이지 않도록 걸러서 표시합니다. (현재는 이 화면 자체가
  // 시스템 관리자에게만 열려 있지만, 추후 호출 경로가 늘어나도 안전하도록 여기서도 한 번 더 걸러냅니다.)
  const visibleUsers=isAdmin()?out.users:(out.users||[]).filter(u=>String(u.email||'').toLowerCase().endsWith('@homes.global'));
  wrap.innerHTML=sortUsersByRecentLogin(visibleUsers).map(u=>`<div class="userCard" data-user-id="${u.user_id}"><div class="userTop"><div><b>${esc(u.display_name||u.email)}</b><div class="userMeta">${esc(u.email)}${u.phone?`<br>${esc(u.phone)}`:''}${u.department?`<br>${esc(u.department)}`:''}</div><div class="lastAccess">${uiIcon('history')} 마지막 접속 ${formatAccessTime(u.last_seen_at||u.last_login_at)}</div></div><span class="userBadge ${u.role==='admin'?'userAdmin':''}">${u.role==='admin'?'시스템 관리자':u.role==='manager'?'운영 관리자':'일반 사용자'}</span></div><div class="userStatusRow"><span class="statusPill ${u.is_active?'ready':''}">${u.is_active?'사용 중':'사용 중지'}</span><span class="presencePill ${u.is_online?'online':''}">${u.is_online?'현재 접속 중':'오프라인'}</span></div><div class="roleChoice dbRoleChoice"><label><input type="radio" name="dbRole-${u.user_id}" value="staff" ${u.role==='staff'?'checked':''}>${uiIcon('user')}일반 사용자</label><label><input type="radio" name="dbRole-${u.user_id}" value="manager" ${u.role==='manager'?'checked':''}>${uiIcon('settings')}운영 관리자</label><label><input type="radio" name="dbRole-${u.user_id}" value="admin" ${u.role==='admin'?'checked':''}>${uiIcon('shield')}시스템 관리자</label></div><div class="userAdminActions"><button class="btn s roleSaveBtn" onclick="adminSetDbUserRole('${u.user_id}','${esc(u.email)}',this)"><span data-inline-icon="check"></span> 권한 변경 저장</button><button class="btn s passwordResetBtn" onclick="adminResetDbPassword('${u.user_id}','${esc(u.email)}')"><span data-inline-icon="lock"></span> 비밀번호 초기화</button><button class="btn ${u.is_active?'s':'y'} activeToggleBtn" onclick="adminSetDbUserActive('${u.user_id}',${!u.is_active},'${esc(u.email)}')">${u.is_active?'사용 중지':'사용 활성화'}</button></div></div>`).join('')||'<div class="empty">등록된 사용자가 없습니다.</div>';
  if(!isAdmin()){
    [...wrap.querySelectorAll('.userCard')].forEach((card,index)=>{
      card.querySelector('input[value="admin"]')?.closest('label')?.remove();
      const user=visibleUsers.find(item=>String(item.user_id)===String(card.dataset.userId));
      const resetButton=card.querySelector('.passwordResetBtn'),activeButton=card.querySelector('.activeToggleBtn');
      if(user?.role!=='staff'&&resetButton)resetButton.classList.add('hide');
      if(activeButton)activeButton.classList.add('hide');
    });
  }
  refreshIcons();
}
async function adminDbUserAction(payload){
  const {data:{session}}=await homesSb.auth.getSession();if(!session)throw new Error('로그인 세션이 만료되었습니다.');
  const res=await fetch('/.netlify/functions/admin-user',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify(payload)});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw new Error(out.error||`요청에 실패했습니다. (HTTP ${res.status})`);return out;
}
async function adminSetDbUserActive(userId,isActive,email){
  if(!confirm(`${email} 계정을 ${isActive?'사용 활성화':'사용 중지'}할까요?`))return;
  try{await adminDbUserAction({action:'set_active',user_id:userId,is_active:isActive});await renderDbUserList();alert(`계정을 ${isActive?'활성화':'중지'}했습니다.`)}catch(e){alert(e.message)}
}
async function adminSetDbUserRole(userId,email,btn){
  const card=btn.closest('.userCard'),role=card?.querySelector(`input[name="dbRole-${userId}"]:checked`)?.value;
  const label={staff:'일반 사용자',manager:'운영 관리자',admin:'시스템 관리자'}[role];
  if(!role||!confirm(`${email} 계정의 권한을 '${label}'로 변경할까요?`))return;
  try{await adminDbUserAction({action:'set_role',user_id:userId,role});await renderDbUserList();alert(`권한을 '${label}'로 변경했습니다.`)}catch(e){alert(e.message)}
}
async function adminResetDbPassword(userId,email){
  if(!confirm(`${email} 계정의 비밀번호를 Homes!0338로 초기화할까요?`))return;
  try{const out=await adminDbUserAction({action:'reset_password',user_id:userId});alert(`비밀번호를 ${out.temporary_password||'Homes!0338'}로 초기화했습니다.\n다음 로그인 시 새 비밀번호를 설정해야 합니다.`)}catch(e){alert(e.message)}
}
const oldRenderAccountDb=renderAccount;
function filterUserAccounts(){
  const input=document.getElementById('userAccountSearch'),panel=document.getElementById('userAdminPanel'),count=document.getElementById('userSearchCount'),empty=document.getElementById('userSearchEmpty');
  if(!panel)return;
  const query=String(input?.value||'').trim().toLocaleLowerCase('ko-KR');
  const cards=[...panel.querySelectorAll('#userList .userCard')];let visible=0;
  cards.forEach(card=>{const match=!query||String(card.textContent||'').toLocaleLowerCase('ko-KR').includes(query);card.hidden=!match;card.style.display=match?'':'none';if(match)visible++});
  if(count)count.textContent=query?`${visible}명 검색`:`전체 ${cards.length}명`;
  empty?.classList.toggle('show',!!query&&visible===0);
}
function observeUserAccountList(){
  const list=document.getElementById('userList');if(!list||list.dataset.searchObserved==='1')return;
  list.dataset.searchObserved='1';new MutationObserver(()=>requestAnimationFrame(filterUserAccounts)).observe(list,{childList:true});
}
const renderDbUserListBase=renderDbUserList;
renderDbUserList=async function(){try{await renderDbUserListBase()}catch(error){console.warn('사용자 DB 목록 조회 실패',error)}finally{filterUserAccounts()}};
function upgradeLegacyRoleSelectors(){
  document.querySelectorAll('#userList .userActions select:not(.legacyRoleSelect)').forEach((select,index)=>{
    select.classList.add('legacyRoleSelect');
    const options=[...select.options];
    const choices=document.createElement('div');choices.className='roleChoice dbRoleChoice';
    choices.innerHTML=options.map(option=>`<label><input type="radio" name="legacyRole-${index}" value="${esc(option.value)}" ${option.selected?'checked':''}>${uiIcon(option.value==='admin'?'shield':option.value==='manager'?'settings':'user')}${esc(option.textContent)}</label>`).join('');
    choices.addEventListener('change',event=>{const input=event.target.closest('input[type="radio"]');if(!input)return;select.value=input.value;select.dispatchEvent(new Event('change',{bubbles:true}))});
    select.after(choices);
  });
  refreshIcons();
}
renderAccount=function(){
  oldRenderAccountDb();
  renderTopUserIdentity();
  upgradeLegacyRoleSelectors();
  observeUserAccountList();
  filterUserAccounts();
  // [권한 정리] "사용자·권한 관리" 화면과 Google Drive 연결 카드는 운영 관리자(매니저)에게는 보이지
  // 않고, 시스템 관리자에게만 보이도록 합니다. 예전에는 isOpsAdmin()(운영 관리자 포함)으로 열려 있어
  // 매니저 계정에도 다른 직원 권한 변경·삭제가 가능한 이 화면이 노출됐습니다.
  const systemAdmin=homesDbUser&&isAdmin();
  const panel=document.getElementById('userAdminPanel');
  const drivePanel=document.getElementById('driveConnectPanel');
  panel?.classList.toggle('hide',!systemAdmin);
  drivePanel?.classList.toggle('hide',!systemAdmin);
  if(systemAdmin){
    setTimeout(async()=>{await renderDbUserList();filterUserAccounts()},0);
  }
};
async function restoreHomesSession(){
  const {data:{session},error}=await homesSb.auth.getSession();
  if(error){console.warn('세션 확인 오류',error)}
  if(!session){homesDbUser=null;applyAuthGate();go('account');return}
  try{
    await fetchMyDbUser(session);
    if(homesDbUser?.active===false){await homesSb.auth.signOut();homesDbUser=null;applyAuthGate();go('account');return}
  }catch(e){
    // 일시적인 DB/네트워크 오류로 세션까지 삭제하지 않습니다.
    const meta=session.user.user_metadata||{};
    cacheDbUser({user_id:session.user.id,email:session.user.email,display_name:meta.name||meta.display_name||session.user.email,phone:meta.phone||'',department:meta.department||'',role:meta.role||'staff',is_active:true,must_change_password:meta.must_change_password===true});
    console.warn('사용자 프로필 조회 실패 — 인증 세션으로 계속 진행',e);
  }
  try{await loadBranchStructureFromDb(false)}catch(e){console.warn('지점·호실 DB 조회 실패 — 기본 구조로 계속 진행',e)}
  try{await loadChecklistTemplatesFromDb(false);if(isAdmin()&&!checklistTemplateCache.length)await bootstrapChecklistTemplates()}catch(e){console.warn('체크리스트 DB 조회 실패 — 내장 양식으로 계속 진행',e);checklistTemplateCache=[]}
  try{await loadCommonAreaZonesFromDb(false)}catch(e){console.warn('공용부 구역 DB 조회 실패',e);commonAreaZoneCache=[]}
  try{await loadRepairBranchPricesFromDb();await migrateLegacyRepairCatalog()}catch(e){console.warn('지점별 수리 단가 DB 조회 실패',e);repairBranchPriceCache=[]}
  try{await loadMaintenanceVendorsFromDb(false)}catch(e){console.warn('보수 업체 DB 조회 실패',e);maintenanceVendorCache=[]}
  try{await syncRecordsFromDb()}catch(e){console.warn('점검 기록 DB 조회 실패',e);recordsMemory=[]}
  startPresenceTracking(false);
  applyAuthGate();renderAccount();renderMore();
  go(homesDbUser?.mustChangePassword?'firstPassword':'home');
}
homesSb.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT'){
    stopPresenceTracking();homesDbUser=null;localStorage.removeItem('homesFmSessionEmail');applyAuthGate();go('account');return;
  }
  // 사진 선택기에서 앱으로 돌아올 때 TOKEN_REFRESHED가 발생할 수 있습니다.
  // 토큰 갱신만으로 현재 화면을 초기화하지 않고, 실제 신규 로그인일 때만 복원합니다.
  if(session&&event==='SIGNED_IN'&&!homesDbUser)setTimeout(restoreHomesSession,0);
});
/* ---------- branch-specific repair catalog (Supabase) ---------- */
let repairBranchPriceCache=[];

function activeCatalogBranch(){
  const repairing=currentRepairId?getRec(currentRepairId):null;
  return String(repairing?.branch||branch?.value||commonBranch?.value||'').trim();
}

function activeCatalogScope(){
  const repairing=currentRepairId?getRec(currentRepairId):null;
  return repairing?.inspectionScope||(typeof inspectionScope==='string'?inspectionScope:'private');
}

function groupedBranchPrices(rows){
  const groups=new Map();
  (rows||[]).forEach(row=>{
    const scope=row.inspection_scope||'private',category=row.category_name||'기타',key=[category,row.item_name,row.sub_item,Number(row.price||0),scope].join('||');
    if(!groups.has(key))groups.set(key,{id:row.id,ids:[],category,name:row.item_name,sub:row.sub_item,price:Number(row.price||0),scope,branches:[],source:'homes',lhPrice:null,homesPrice:Number(row.price||0)});
    const group=groups.get(key);group.ids.push(row.id);group.branches.push(row.branch_name);
  });
  return [...groups.values()].map(group=>({...group,branches:[...new Set(group.branches)].sort((a,b)=>a.localeCompare(b,'ko'))}));
}

async function loadRepairBranchPricesFromDb(){
  if(!homesDbUser){repairBranchPriceCache=[];return[]}
  const query=await homesSb.from('repair_branch_prices').select('id,category_name,item_name,sub_item,branch_name,inspection_scope,price,is_active,updated_at').eq('is_active',true).order('category_name').order('item_name').order('sub_item').order('branch_name');
  if(query.error)throw query.error;
  repairBranchPriceCache=query.data||[];
  return repairBranchPriceCache;
}

function legacyHomesCatalog(){
  try{const rows=JSON.parse(localStorage.getItem('homesFmCatalog')||'[]');return Array.isArray(rows)?rows:[]}catch(e){return[]}
}

async function migrateLegacyRepairCatalog(){
  if(!isAdmin()||repairBranchPriceCache.length||localStorage.getItem('homesFmCatalogDbMigrated')==='1')return;
  const legacy=legacyHomesCatalog(),branches=branchNames();
  if(!legacy.length||!branches.length){localStorage.setItem('homesFmCatalogDbMigrated','1');return}
  const rows=[];
  legacy.forEach(item=>branches.forEach(branchName=>rows.push({item_name:String(item.name||'').trim(),sub_item:String(item.sub||'').trim(),branch_name:branchName,inspection_scope:'private',price:Number(item.price||0),created_by:homesDbUser.user_id,updated_by:homesDbUser.user_id})));
  const valid=rows.map(row=>({...row,category_name:'기타'})).filter(row=>row.item_name&&row.sub_item&&row.price>0);
  if(valid.length){
    const result=await homesSb.from('repair_branch_prices').upsert(valid,{onConflict:'category_name,item_name,sub_item,branch_name,inspection_scope'});
    if(result.error)throw result.error;
    await loadRepairBranchPricesFromDb();
  }
  localStorage.setItem('homesFmCatalogDbMigrated','1');
}

loadHomesCatalog=function(branchName='',scope=branchName?activeCatalogScope():''){
  const rows=repairBranchPriceCache.filter(row=>(!branchName||row.branch_name===branchName)&&(!scope||(row.inspection_scope||'private')===scope));
  return branchName?rows.map(row=>({id:row.id,ids:[row.id],name:row.item_name,sub:row.sub_item,price:Number(row.price||0),scope:row.inspection_scope||'private',branches:[row.branch_name],source:'homes',homesPrice:Number(row.price||0),lhPrice:null})):groupedBranchPrices(rows);
};

loadCatalog=function(branchName=activeCatalogBranch(),scope=branchName?activeCatalogScope():''){
  const lh=DEFAULT_LH_CATALOG.map(item=>({...item,lhPrice:Number(item.price||0),homesPrice:null,branches:[]}));
  const homes=loadHomesCatalog(branchName,scope);
  if(!branchName)return[...lh,...homes];
  const homeMap=new Map(homes.map(item=>[catalogKey(item),item]));
  const merged=lh.map(item=>{const override=homeMap.get(catalogKey(item));return override?{...item,...override,source:'homes',lhPrice:Number(item.price||0),homesPrice:Number(override.price||0)}:item});
  const lhKeys=new Set(lh.map(catalogKey));
  homes.filter(item=>!lhKeys.has(catalogKey(item))).forEach(item=>merged.push(item));
  return merged;
};

getCatalogFor=function(name){return loadCatalog(activeCatalogBranch()).filter(item=>item.name===name||item.name==='기타')};
suggestedCost=function(){return 0};

function catalogBranchChecks(selected=[],className='catalogBranchCheck'){
  const chosen=new Set(selected);
  return `<div class="catalogBranchGrid">${branchNames().map(name=>`<label><input type="checkbox" class="${className}" value="${esc(name)}" ${chosen.has(name)?'checked':''}><span>${esc(name)}</span></label>`).join('')}</div>`;
}

function ensureCatalogBranchSelector(){
  if(document.getElementById('catBranchChoices'))return;
  const nameInput=document.getElementById('catName');if(!nameInput)return;
  const box=document.createElement('div');box.className='full catalogBranchSelector';box.innerHTML=`<div class="catalogBranchTitle"><div><b>${uiIcon('branch')} 적용할 지점 <small>(복수 선택)</small></b><span>선택한 지점의 체크 항목에만 이 단가가 표시됩니다.</span></div><button type="button" class="dbMiniBtn" onclick="toggleAllCatalogBranches(true)">전체 선택</button></div><div id="catBranchChoices"></div>`;
  nameInput.closest('.full')?.after(box);
  document.getElementById('catBranchChoices').innerHTML=catalogBranchChecks(branchNames(),'catBranchCheck');
  refreshIcons();
}

function toggleAllCatalogBranches(checked){document.querySelectorAll('#catBranchChoices .catBranchCheck').forEach(input=>input.checked=checked)}
function selectedCatalogBranches(root=document){return[...root.querySelectorAll('.catBranchCheck:checked,.catalogEditBranch:checked')].map(input=>input.value)}

async function upsertBranchPrices(category,name,pairs,branches,scope='private'){
  if(!homesDbUser)throw new Error('로그인이 필요합니다.');
  const rows=[];
  pairs.forEach(pair=>branches.forEach(branchName=>rows.push({category_name:category,item_name:name,sub_item:pair.sub,branch_name:branchName,inspection_scope:scope,price:Number(pair.price||0),is_active:true,created_by:homesDbUser.user_id,updated_by:homesDbUser.user_id,updated_at:new Date().toISOString()})));
  const result=await homesSb.from('repair_branch_prices').upsert(rows,{onConflict:'category_name,item_name,sub_item,branch_name,inspection_scope'});
  if(result.error)throw result.error;
}

function catalogLhPrice(item){const row=DEFAULT_LH_CATALOG.find(base=>base.name===item.name&&base.sub===item.sub);return row?Number(row.price||0):(item.source==='lh'?Number(item.price||0):0)}
function catalogHomesPrice(item){return item.source==='homes'?Number(item.price||0):0}
function catalogPriceValueHtml(amount){return Number(amount)>0?`<b>${won(amount)}</b>`:`<span class="catalogMissingPrice">${uiIcon('minus')}<span>0원</span></span>`}
function catalogPriceCompareHtml(item){return `<div class="catalogCompare"><div><small>LH 기준금액</small>${catalogPriceValueHtml(catalogLhPrice(item))}</div><div><small>지점별 HOMES 단가</small>${catalogPriceValueHtml(catalogHomesPrice(item))}</div></div>`}

renderCatalog=function(){
  if(!document.getElementById('catBranchChoices'))ensureCatalogBranchSelector();
  const selectedBranches=new Set(catalogSelectedAddBranches()),scope=catalogSelectedScope(),category=catalogCurrentItemName(),detail=catalogCurrentDetailName();
  let rows=[];
  if(selectedBranches.size&&category&&detail){
    rows=groupedBranchPrices(repairBranchPriceCache.filter(row=>selectedBranches.has(row.branch_name)&&(row.inspection_scope||'private')===scope&&(row.category_name||'기타')===category&&row.item_name===detail));
    const lh=DEFAULT_LH_CATALOG.filter(item=>item.name===detail).map(item=>({...item,lhPrice:Number(item.price||0),homesPrice:null,branches:[]}));
    if(!rows.length)rows=lh;
  }
  rows.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ko')||(a.sub||'').localeCompare(b.sub||'','ko')||(a.source||'').localeCompare(b.source||''));
  catalogCount.textContent=`세부 항목 ${new Set(rows.map(item=>item.name)).size}개 · 단가 설정 ${rows.length}개`;
  const groups={};rows.forEach(item=>(groups[item.name]??=[]).push(item));
  catalogWrap.innerHTML=!selectedBranches.size?'<div class="empty">상단에서 적용할 지점을 선택하세요.</div>':!category?'<div class="empty">상단에서 전용부·공용부와 체크 항목을 선택하세요.</div>':!detail?'<div class="empty">세부 항목을 선택하면 해당 조건의 등록 단가가 표시됩니다.</div>':Object.entries(groups).length?Object.entries(groups).map(([name,tasks])=>`<div class="catalogGroup"><div class="catalogGroupHead"><b>${esc(name)}</b><div class="catalogGroupActions"><span>단가 ${tasks.length}개</span><button type="button" class="catalogAddSubBtn" onclick="toggleInlineCatalogAdd('${esc(name)}',this)">${uiIcon('plus')}<span>수리 작업 추가</span></button></div></div><div class="inlineCatalogAddSlot"></div>${tasks.map(item=>`<div class="catalogTask" data-name="${esc(item.name)}" data-sub="${esc(item.sub||'')}" data-scope="${esc(item.scope||'private')}" data-ids="${esc((item.ids||[]).join(','))}"><div class="catalogTaskTop"><div><div class="catalogTaskName">${esc(item.sub||'세부 작업 없음')}</div><span class="catalogSource ${item.source}">${catalogSourceLabel(item)}</span></div><div class="catalogTaskPrice">${won(item.price)}</div></div><div class="catalogBranchSummary">${item.source==='lh'?`<span class="branchTag all">전체 지점 공통</span>`:`<span class="branchTag scope">${item.scope==='common'?'공용부':'전용부'}</span>`+(item.branches||[]).map(branchName=>`<span class="branchTag">${esc(branchName)}</span>`).join('')}</div>${catalogPriceCompareHtml(item)}${item.source==='homes'?`<div class="catalogTaskGrid"><div><label>수리 작업</label><input class="catalogEditSub" value="${esc(item.sub||'')}"></div><div><label>HOMES 적용금액</label><input class="moneyInput catalogEditPrice" inputmode="numeric" value="${formatMoney(item.price)}" oninput="moneyTyping(this)"></div></div><div class="catalogEditBranches"><label>적용 지점</label>${catalogBranchChecks(item.branches||[],'catalogEditBranch')}</div><div class="catalogTaskActions"><button class="btn s" onclick="saveCatalogTask('',this)">${uiIcon('check')} 저장</button><button class="btn dangerOutlineBtn" onclick="deleteCatalog(this)">${uiIcon('trash')} 삭제</button></div>`:''}</div>`).join('')}</div>`).join(''):`<div class="catalogGroup"><div class="catalogGroupHead"><b>${esc(detail)}</b><div class="catalogGroupActions"><span>단가 0개</span><button type="button" class="catalogAddSubBtn" onclick="toggleInlineCatalogAdd('${esc(detail)}',this)">${uiIcon('plus')}<span>수리 작업 추가</span></button></div></div><div class="inlineCatalogAddSlot"></div><div class="catalogExistingEmpty">해당 조건에 등록된 수리 작업이 없습니다.</div></div>`;
  catalogWrap.querySelectorAll('.catalogAddSubBtn span:last-child').forEach(label=>label.textContent='수리 작업 추가');
  catalogWrap.querySelectorAll('.catalogTaskGrid>div:first-child>label').forEach(label=>label.textContent='수리 작업');
  initCatalogSubRows();refreshIcons();
};

function toggleInlineCatalogAdd(name,button){
  const slot=button.closest('.catalogGroup')?.querySelector('.inlineCatalogAddSlot');if(!slot)return;
  if(slot.children.length){slot.innerHTML='';return}
  slot.innerHTML=`<div class="inlineCatalogAdd"><div><label>새 수리 작업</label><input class="inlineCatalogSub" placeholder="수리 작업명을 입력하세요"></div><div><label>예상금액</label><input class="inlineCatalogPrice moneyInput" inputmode="numeric" placeholder="0" oninput="moneyTyping(this)"></div><button type="button" class="btn y" onclick="saveInlineCatalogAdd('${esc(name)}',this)">${uiIcon('check')} 등록</button></div>`;
  refreshIcons();slot.querySelector('.inlineCatalogSub')?.focus();
}
async function saveInlineCatalogAdd(name,button){
  const box=button.closest('.inlineCatalogAdd'),sub=box?.querySelector('.inlineCatalogSub')?.value.trim()||'',price=parseMoney(box?.querySelector('.inlineCatalogPrice')?.value||0),branches=catalogSelectedAddBranches(),category=catalogCurrentItemName(),scope=catalogSelectedScope();
  if(!branches.length)return alert('적용할 지점을 선택하세요.');if(!category||!name)return alert('체크 항목과 세부 항목을 선택하세요.');if(!sub)return alert('수리 작업명을 입력하세요.');if(price<=0)return alert('예상금액을 입력하세요.');
  try{button.disabled=true;await upsertBranchPrices(category,name,[{sub,price}],branches,scope);await loadRepairBranchPricesFromDb();renderCatalog();catalogExistingPricesHtml();alert('수리 작업 단가를 등록했습니다.')}catch(error){button.disabled=false;alert('단가 등록에 실패했습니다: '+(error.message||error))}
}

addCatalogSubForItem=function(name){
  catName.value=name;
  ensureCatalogBranchSelector();
  document.querySelector('.catalogAddBox')?.scrollIntoView({behavior:'smooth',block:'start'});
  document.querySelector('#catSubRows .catSubName')?.focus();
};

addCatalog=async function(){
  const name=catName.value.trim();
  const pairs=[...document.querySelectorAll('#catSubRows .catalogSubRow')].map(row=>({sub:row.querySelector('.catSubName').value.trim(),price:parseMoney(row.querySelector('.catSubPrice').value)})).filter(item=>item.sub&&item.price>0);
  const branches=selectedCatalogBranches(document.getElementById('catBranchChoices'));
  if(!name)return alert('체크 항목을 입력하세요.');
  if(!pairs.length)return alert('세부 작업과 예상금액을 한 개 이상 입력하세요.');
  if(!branches.length)return alert('단가를 적용할 지점을 한 곳 이상 선택하세요.');
  try{
    await upsertBranchPrices('기타',name,pairs,branches);
    await loadRepairBranchPricesFromDb();
    catName.value='';catSubRows.innerHTML='';addCatalogSubRow();addCatalogSubRow();toggleAllCatalogBranches(true);renderCatalog();
    alert(`${branches.length}개 지점에 ${pairs.length}개 단가를 등록했습니다.`);
  }catch(error){alert('단가 저장에 실패했습니다: '+(error.message||error))}
};

saveCatalogTask=async function(id,button){
  const card=button.closest('.catalogTask'),oldIds=(card.dataset.ids||'').split(',').filter(Boolean);
  const name=card.dataset.name,scope=card.dataset.scope||'private',oldSub=card.dataset.sub,sub=card.querySelector('.catalogEditSub').value.trim(),price=parseMoney(card.querySelector('.catalogEditPrice').value);
  const category=repairBranchPriceCache.find(row=>oldIds.includes(String(row.id)))?.category_name||'기타';
  const branches=selectedCatalogBranches(card);
  if(!sub||!price)return alert('세부 작업과 적용금액을 입력하세요.');
  if(!branches.length)return alert('적용할 지점을 한 곳 이상 선택하세요.');
  try{
    if(oldIds.length){const removed=await homesSb.from('repair_branch_prices').delete().in('id',oldIds);if(removed.error)throw removed.error}
    await upsertBranchPrices(category,name,[{sub,price}],branches,scope);
    await loadRepairBranchPricesFromDb();renderCatalog();alert('지점별 단가를 저장했습니다.');
  }catch(error){alert('단가 수정에 실패했습니다: '+(error.message||error))}
};

deleteCatalog=async function(button){
  const card=button.closest('.catalogTask'),ids=(card.dataset.ids||'').split(',').filter(Boolean);
  if(!ids.length||!confirm('선택한 지점별 HOMES 단가를 삭제할까요?'))return;
  const result=await homesSb.from('repair_branch_prices').delete().in('id',ids);
  if(result.error)return alert('단가 삭제에 실패했습니다: '+result.error.message);
  await loadRepairBranchPricesFromDb();renderCatalog();
};

catalogOptionsHtml=function(name,current){
  const branchName=activeCatalogBranch(),rows=loadCatalog(branchName).filter(item=>item.name===name);
  if(!rows.length)return `<div class="catalogChoices"><div class="catalogChoicesTitle">등록 단가 세부 작업</div><div class="catalogChoiceEmpty">${esc(branchName||'선택 지점')}에 등록된 세부 작업 단가가 없습니다.</div></div>`;
  return `<div class="catalogChoices"><div class="catalogChoicesTitle">${esc(branchName)} 적용 단가 · HOMES 우선 / 미설정 시 LH</div>${rows.map(item=>`<button type="button" class="catalogChoice ${Number(current)===Number(item.price)?'on':''}" onclick="chooseCatalogPrice(this,${Number(item.price)})"><b>${esc(item.sub||'세부 작업')} <em class="catalogSource ${item.source}">${catalogSourceLabel(item)}</em></b><span>${won(item.price)}</span></button>`).join('')}</div>`;
};

repairCatalogOptionsHtml=function(name,current){
  const branchName=activeCatalogBranch(),rows=loadCatalog(branchName).filter(item=>item.name===name);
  if(!rows.length)return'';
  return `<div class="catalogChoices repairCatalogChoices"><div class="catalogChoicesTitle">${esc(branchName)} 적용 단가</div>${rows.map(item=>`<button type="button" class="catalogChoice ${Number(current)===Number(item.price)?'on':''}" onclick="chooseRepairCatalogPrice(this,${Number(item.price)})"><b>${esc(item.sub||'세부 작업')} <em class="catalogSource ${item.source}">${catalogSourceLabel(item)}</em></b><span>${won(item.price)}</span></button>`).join('')}</div>`;
};

applyCatalogAccess=async function(){
  const allowed=isAdmin();adminLock.classList.toggle('hide',allowed);catalogAdmin.classList.toggle('hide',!allowed);if(!allowed)return;
  try{await loadRepairBranchPricesFromDb();await migrateLegacyRepairCatalog();renderCatalog();initCatalogSubRows()}catch(error){catalogWrap.innerHTML=`<div class="empty">단가 DB를 불러오지 못했습니다.<br>${esc(error.message||error)}</div>`}
};

const catalogBranchStyle=document.createElement('style');
catalogBranchStyle.textContent=`.catalogBranchSelector{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.catalogBranchTitle{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.catalogBranchTitle b{display:flex;align-items:center;gap:7px;color:var(--navy)}.catalogBranchTitle small,.catalogBranchTitle span{font-size:11px;color:var(--muted);font-weight:700}.catalogBranchTitle>div>span{display:block;margin-top:3px}.catalogBranchGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.catalogBranchGrid label{display:flex;align-items:center;gap:7px;min-width:0;padding:9px 10px;border:1px solid #dbe4ef;border-radius:10px;background:#f8fafc;font-size:12px;font-weight:850;color:var(--navy)}.catalogBranchGrid input{width:17px;height:17px;flex:0 0 auto;accent-color:#0d4f87}.catalogBranchSummary{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.branchTag{display:inline-flex;padding:5px 8px;border-radius:999px;background:#eaf3ff;color:#155a92;font-size:10px;font-weight:900}.branchTag.all{background:#f3f1eb;color:#5f6368}.catalogEditBranches{margin-top:10px}.catalogEditBranches>label{display:block;margin-bottom:6px;font-size:11px;font-weight:900;color:#64748b}@media(max-width:520px){.catalogBranchTitle{align-items:flex-start}.catalogBranchGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.catalogBranchGrid label{padding:9px 7px;font-size:11px}}`;
document.head.appendChild(catalogBranchStyle);

/* Repair price add flow: branches -> checklist item -> detail work */
function catalogSelectedAddBranches(){return[...document.querySelectorAll('#catBranchChoices .catBranchCheck:checked')].map(input=>input.value)}
function catalogSelectedScope(){return document.querySelector('input[name="catalogScope"]:checked')?.value||'private'}
function catalogChecklistSourceRows(){return(checklistTemplateCache&&checklistTemplateCache.length?checklistTemplateCache:initialChecklistTemplateRows()).filter(row=>row.is_active!==false)}
function catalogChecklistItemNames(branches=catalogSelectedAddBranches()){
  const selected=new Set(branches),scope=catalogSelectedScope(),names=new Set();
  catalogChecklistSourceRows().filter(row=>selected.has(row.branch_name)&&(row.inspection_scope||'private')===scope&&row.context_key!=='manual-floor').forEach(row=>(row.definition||[]).forEach(category=>{if(category.name)names.add(String(category.name).trim())}));
  const preferred=['복도','입구','현관/입구','주방','화장실','욕실/화장실','실내','침실/거실','보일러실','옵션','가구/비품','안전/기타','전체'];
  return[...names].filter(Boolean).sort((a,b)=>{const ai=preferred.indexOf(a),bi=preferred.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b,'ko')});
}
function catalogCurrentItemName(){
  return(document.getElementById('catItemSelect')?.value||'').trim();
}
function catalogChecklistDetailNames(category=catalogCurrentItemName(),branches=catalogSelectedAddBranches()){
  if(!category)return[];const selected=new Set(branches),scope=catalogSelectedScope(),names=new Set();
  catalogChecklistSourceRows().filter(row=>selected.has(row.branch_name)&&(row.inspection_scope||'private')===scope&&row.context_key!=='manual-floor').forEach(row=>(row.definition||[]).filter(group=>group.name===category).forEach(group=>(group.items||[]).forEach(item=>{if(item.name)names.add(String(item.name).trim())})));
  return[...names].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ko'));
}
function catalogCurrentDetailName(){return(document.getElementById('catDetailSelect')?.value||'').trim()}
function catalogExistingPricesHtml(){
  const category=catalogCurrentItemName(),itemName=catalogCurrentDetailName(),scope=catalogSelectedScope(),selected=new Set(catalogSelectedAddBranches()),box=document.getElementById('catalogExistingPrices');if(!box)return;
  if(!category||!itemName){box.innerHTML='<div class="catalogExistingEmpty">체크 항목과 세부 항목을 선택하면 등록된 수리 작업과 금액이 표시됩니다.</div>';return}
  const rows=repairBranchPriceCache.filter(row=>selected.has(row.branch_name)&&(row.inspection_scope||'private')===scope&&(row.category_name||'기타')===category&&row.item_name===itemName).sort((a,b)=>a.sub_item.localeCompare(b.sub_item,'ko')||a.branch_name.localeCompare(b.branch_name,'ko'));
  if(!rows.length){box.innerHTML='<div class="catalogExistingEmpty">선택한 세부 항목에 등록된 단가가 없습니다. 아래에서 새 수리 작업을 등록하세요.</div>';return}
  const groups=new Map();rows.forEach(row=>{const key=`${row.sub_item}||${Number(row.price||0)}`;if(!groups.has(key))groups.set(key,{sub:row.sub_item,price:Number(row.price||0),branches:[]});groups.get(key).branches.push(row.branch_name)});
  box.innerHTML=`<div class="catalogExistingTitle">${uiIcon('list')} 등록된 수리 작업과 단가 <span>${rows.length}건</span></div><div class="catalogExistingGrid">${[...groups.values()].map(row=>`<button type="button" onclick="useExistingCatalogDetail('${esc(row.sub)}',${row.price})"><span><b>${esc(row.sub)}</b><small>${[...new Set(row.branches)].map(esc).join(' · ')}</small></span><strong>${won(row.price)}</strong></button>`).join('')}</div>`;refreshIcons();
}
function useExistingCatalogDetail(sub,price){const row=document.querySelector('#catSubRows .catalogSubRow')||null;if(!row)return;row.querySelector('.catSubName').value=sub;row.querySelector('.catSubPrice').value=formatMoney(price);row.scrollIntoView({behavior:'smooth',block:'center'})}
function catalogItemOptionsHtml(current=''){
  const items=catalogChecklistItemNames();
  return `<option value="">체크 항목을 선택하세요</option>${items.map(name=>`<option value="${esc(name)}" ${name===current?'selected':''}>${esc(name)}</option>`).join('')}`;
}
function refreshCatalogItemChoices(preserve=true){
  const select=document.getElementById('catItemSelect'),custom=document.getElementById('catName');if(!select||!custom)return;
  const current=preserve?catalogCurrentItemName():'';select.innerHTML=catalogItemOptionsHtml(current);custom.classList.add('hide');custom.value='';
  refreshCatalogDetailChoices(false);refreshCatalogDetailRows();catalogExistingPricesHtml();
}
function catalogItemSelectionChanged(){
  const select=document.getElementById('catItemSelect'),custom=document.getElementById('catName');if(!select||!custom)return;
  custom.classList.add('hide');custom.value='';refreshCatalogDetailChoices(false);refreshCatalogDetailRows(true);catalogExistingPricesHtml();renderCatalog();
}
function refreshCatalogDetailChoices(preserve=true){const select=document.getElementById('catDetailSelect');if(!select)return;const current=preserve?catalogCurrentDetailName():'';const names=catalogChecklistDetailNames();select.innerHTML=`<option value="">세부 항목을 선택하세요</option>${names.map(name=>`<option value="${esc(name)}" ${name===current?'selected':''}>${esc(name)}</option>`).join('')}`;select.disabled=!catalogCurrentItemName();if(!names.includes(current))select.value=''}
function catalogDetailSelectionChanged(){refreshCatalogDetailRows(true);catalogExistingPricesHtml();renderCatalog()}
function catalogBranchesChanged(){refreshCatalogItemChoices(true);renderCatalog()}
function catalogScopeChanged(){refreshCatalogItemChoices(false);renderCatalog()}
function refreshCatalogDetailRows(reset=false){if(reset)document.querySelectorAll('#catSubRows .catSubName').forEach(input=>input.value='')}

ensureCatalogBranchSelector=function(){
  const grid=document.querySelector('.catalogAddGrid'),nameInput=document.getElementById('catName');if(!grid||!nameInput)return;
  let itemField=document.getElementById('catalogItemField');
  if(!itemField){itemField=nameInput.closest('.full');itemField.id='catalogItemField';itemField.innerHTML=`<label class="iconLabel"><span data-inline-icon="category"></span>체크 항목</label><select id="catItemSelect" onchange="catalogItemSelectionChanged()"></select><input id="catName" class="hide catalogCustomInput" placeholder="새 체크 항목명을 입력하세요">`}
  let detailField=document.getElementById('catalogDetailField');
  if(!detailField){detailField=document.createElement('div');detailField.id='catalogDetailField';detailField.className='full';detailField.innerHTML=`<label class="iconLabel"><span data-inline-icon="list"></span>세부 항목</label><select id="catDetailSelect" onchange="catalogDetailSelectionChanged()" disabled><option value="">체크 항목을 먼저 선택하세요</option></select>`}
  let branchBox=document.querySelector('.catalogBranchSelector');
  if(!branchBox){branchBox=document.createElement('div');branchBox.className='full catalogBranchSelector';branchBox.innerHTML=`<div class="catalogBranchTitle"><div><b>${uiIcon('branch')} 적용할 지점 <small>(복수 선택)</small></b><span>먼저 지점을 선택하면 해당 지점의 체크 항목만 표시됩니다.</span></div><button type="button" id="catalogSelectAllBtn" class="dbMiniBtn" onclick="toggleCatalogAllBranches()">전체 선택</button></div><div id="catBranchChoices"></div>`}
  grid.insertBefore(branchBox,itemField);grid.insertBefore(itemField,branchBox.nextSibling);
  const choices=document.getElementById('catBranchChoices');
  if(choices&&!choices.children.length)choices.innerHTML=catalogBranchChecks([],'catBranchCheck');
  if(choices&&!choices.dataset.bound){choices.dataset.bound='1';choices.addEventListener('change',()=>{updateCatalogSelectAllButton();catalogBranchesChanged()})}
  let scopeBox=document.getElementById('catalogScopeField');
  if(!scopeBox){scopeBox=document.createElement('div');scopeBox.id='catalogScopeField';scopeBox.className='full catalogScopeField';scopeBox.innerHTML=`<label class="iconLabel"><span data-inline-icon="building"></span>점검 대상</label><div class="catalogScopeGrid"><label><input type="radio" name="catalogScope" value="private" checked onchange="catalogScopeChanged()"><span>${uiIcon('door')} 전용부</span></label><label><input type="radio" name="catalogScope" value="common" onchange="catalogScopeChanged()"><span>${uiIcon('building')} 공용부</span></label></div>`}
  grid.insertBefore(scopeBox,itemField);grid.insertBefore(itemField,scopeBox.nextSibling);
  grid.insertBefore(detailField,itemField.nextSibling);
  let existing=document.getElementById('catalogExistingPanel'),builder=grid.querySelector('.catalogSubBuilder');
  if(!existing){existing=document.createElement('div');existing.id='catalogExistingPanel';existing.className='full catalogExistingPanel';existing.innerHTML='<div id="catalogExistingPrices"></div>'}
  grid.insertBefore(existing,builder);
  updateCatalogSelectAllButton();refreshCatalogItemChoices(true);refreshIcons();
};
function updateCatalogSelectAllButton(){const inputs=[...document.querySelectorAll('#catBranchChoices .catBranchCheck')],allSelected=inputs.length>0&&inputs.every(input=>input.checked),button=document.getElementById('catalogSelectAllBtn');if(button){button.textContent=allSelected?'전체 해제':'전체 선택';button.setAttribute('aria-pressed',String(allSelected))}}
function toggleCatalogAllBranches(){const inputs=[...document.querySelectorAll('#catBranchChoices .catBranchCheck')],allSelected=inputs.length>0&&inputs.every(input=>input.checked);inputs.forEach(input=>input.checked=!allSelected);updateCatalogSelectAllButton();catalogBranchesChanged()}
toggleAllCatalogBranches=function(checked){document.querySelectorAll('#catBranchChoices .catBranchCheck').forEach(input=>input.checked=checked);updateCatalogSelectAllButton();catalogBranchesChanged()};
initCatalogSubRows=function(){const wrap=document.getElementById('catSubRows');if(wrap&&!wrap.children.length)addCatalogSubRow()};
addCatalogSubRow=function(sub='',price=0){
  const wrap=document.getElementById('catSubRows');if(!wrap)return;const row=document.createElement('div');row.className='catalogSubRow';
  row.innerHTML=`<div class="catalogSubChoice"><label>수리 작업</label><input class="catSubName" value="${esc(sub)}" placeholder="예: 리모컨 교체, 커버 교체, 전체 교체"></div><div><label>예상금액</label><input class="catSubPrice moneyInput" inputmode="numeric" value="${formatMoney(price)}" placeholder="0" oninput="moneyTyping(this)"></div><button type="button" class="catalogSubDelete" aria-label="작업 삭제" onclick="removeCatalogSubRow(this)">×</button>`;
  wrap.appendChild(row);refreshIcons();
};
addCatalogSubForItem=function(name){
  ensureCatalogBranchSelector();const row=repairBranchPriceCache.find(item=>item.item_name===name),select=document.getElementById('catItemSelect'),detail=document.getElementById('catDetailSelect'),custom=document.getElementById('catName');
  if(row){document.querySelectorAll('#catBranchChoices .catBranchCheck').forEach(input=>input.checked=repairBranchPriceCache.some(item=>item.item_name===name&&item.branch_name===input.value));const scope=document.querySelector(`input[name="catalogScope"][value="${row.inspection_scope||'private'}"]`);if(scope)scope.checked=true;refreshCatalogItemChoices(false);select.value=row.category_name||'기타';catalogItemSelectionChanged();detail.value=name;catalogDetailSelectionChanged()}else{select.value='';detail.value=''}
  custom.classList.add('hide');custom.value='';updateCatalogSelectAllButton();document.querySelector('.catalogAddBox')?.scrollIntoView({behavior:'smooth',block:'start'});document.querySelector('#catSubRows .catSubName')?.focus();
};
addCatalog=async function(){
  const category=catalogCurrentItemName(),name=catalogCurrentDetailName(),branches=catalogSelectedAddBranches();
  const pairs=[...document.querySelectorAll('#catSubRows .catalogSubRow')].map(row=>({sub:row.querySelector('.catSubName').value.trim(),price:parseMoney(row.querySelector('.catSubPrice').value)})).filter(item=>item.sub&&item.price>0);
  if(!branches.length)return alert('단가를 적용할 지점을 한 곳 이상 선택하세요.');if(!category)return alert('체크 항목을 선택하세요.');if(!name)return alert('세부 항목을 선택하세요.');if(!pairs.length)return alert('수리 작업과 예상금액을 한 개 이상 입력하세요.');
  try{await upsertBranchPrices(category,name,pairs,branches,catalogSelectedScope());await loadRepairBranchPricesFromDb();document.getElementById('catName').value='';document.getElementById('catSubRows').innerHTML='';refreshCatalogItemChoices(false);addCatalogSubRow();renderCatalog();alert(`${branches.length}개 지점의 ${catalogSelectedScope()==='common'?'공용부':'전용부'}에 ${pairs.length}개 단가를 등록했습니다.`)}catch(error){alert('단가 저장에 실패했습니다: '+(error.message||error))}
};
const catalogChoiceStyle=document.createElement('style');
catalogChoiceStyle.textContent=`#catalogItemField select,#catalogItemField input,.catalogSubChoice select,.catalogSubChoice input{width:100%}.catalogCustomInput,.catalogSubChoice .catSubName{margin-top:7px}.catalogSubRow{align-items:end}.catalogSubDelete{color:#c81e1e!important;border-color:#fecaca!important;background:#fff7f7!important}.catalogSubChoice{min-width:0}.catalogBranchGrid input[type="checkbox"]{appearance:auto!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important}.catalogBranchGrid input[type="checkbox"]:focus,.catalogBranchGrid input[type="checkbox"]:focus-visible{outline:0!important;box-shadow:none!important}.catalogScopeField{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.catalogScopeGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:7px}.catalogScopeGrid label{position:relative;cursor:pointer}.catalogScopeGrid input{position:absolute;opacity:0;pointer-events:none}.catalogScopeGrid span{display:flex;align-items:center;justify-content:center;gap:7px;min-height:48px;border:1px solid #dbe4ef;border-radius:11px;background:#f8fafc;color:var(--navy);font-weight:900}.catalogScopeGrid input:checked+span{background:var(--navy);border-color:var(--navy);color:#fff;box-shadow:0 5px 12px rgba(2,4,37,.14)}.catalogExistingPanel{border:1px solid #d9e3ed;border-radius:14px;padding:12px;background:#f8fafc}.catalogExistingTitle{display:flex;align-items:center;gap:7px;margin-bottom:9px;color:var(--navy);font-size:13px;font-weight:950}.catalogExistingTitle span{margin-left:auto;color:#64748b;font-size:11px}.catalogExistingGrid{display:grid;gap:7px}.catalogExistingGrid button{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:10px 11px;border:1px solid #dbe4ef;border-radius:10px;background:#fff;text-align:left}.catalogExistingGrid button:hover{border-color:#6b94bb;background:#f7fbff}.catalogExistingGrid button span{min-width:0}.catalogExistingGrid b{display:block;color:var(--navy);font-size:12px}.catalogExistingGrid small{display:block;margin-top:3px;color:#64748b;font-size:10px}.catalogExistingGrid strong{color:#0d4f87;white-space:nowrap}.catalogExistingEmpty{padding:10px;color:#64748b;font-size:12px;text-align:center}@media(max-width:520px){.catalogSubRow{grid-template-columns:minmax(0,1fr) 112px 42px}.catalogBranchSelector,#catalogScopeField,#catalogItemField,.catalogExistingPanel,.catalogSubBuilder{grid-column:1/-1}}`;
catalogChoiceStyle.textContent+=`#catalogDetailField select{width:100%}.inlineCatalogAddSlot:empty{display:none}.inlineCatalogAdd{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(150px,.6fr) auto;gap:8px;align-items:end;margin:0 0 12px;padding:12px;border:1px solid #b8d3ea;border-radius:12px;background:#f4f9fd}.inlineCatalogAdd label{display:block;margin:0 0 6px;font-size:11px;font-weight:900;color:#536477}.inlineCatalogAdd input{width:100%;min-height:46px}.inlineCatalogAdd .btn{min-height:46px;white-space:nowrap}@media(max-width:520px){.inlineCatalogAdd{grid-template-columns:minmax(0,1fr) 115px}.inlineCatalogAdd .btn{grid-column:1/-1;width:100%}}`;
document.head.appendChild(catalogChoiceStyle);

function catalogBrowseDefinitions(branchName,scope){
  const groups=[];
  catalogChecklistSourceRows().filter(row=>row.branch_name===branchName&&(row.inspection_scope||'private')===scope&&row.context_key!=='manual-floor').forEach(row=>(row.definition||[]).forEach(category=>(category.items||[]).forEach(item=>{if(item.name&&!groups.some(x=>x.name===item.name))groups.push({category:category.name||'기타',name:item.name})})));
  return groups;
}
function catalogBrowseTaskHtml(item){return `<div class="catalogTask" data-name="${esc(item.name)}" data-sub="${esc(item.sub||'')}" data-scope="${esc(item.scope||'private')}" data-ids="${esc((item.ids||[]).join(','))}"><div class="catalogTaskTop"><div><div class="catalogTaskName">${esc(item.sub||'수리 작업 미등록')}</div><span class="catalogSource ${item.source}">${catalogSourceLabel(item)}</span></div><div class="catalogTaskPrice">${won(item.price||0)}</div></div><div class="catalogBranchSummary">${item.source==='lh'?'<span class="branchTag all">LH 공통 기준</span>':(item.branches||[]).map(name=>`<span class="branchTag">${esc(name)}</span>`).join('')}</div>${catalogPriceCompareHtml(item)}${item.source==='homes'?`<div class="catalogTaskGrid"><div><label>수리 작업</label><input class="catalogEditSub" value="${esc(item.sub||'')}"></div><div><label>HOMES 적용금액</label><input class="moneyInput catalogEditPrice" inputmode="numeric" value="${formatMoney(item.price)}" oninput="moneyTyping(this)"></div></div><div class="catalogEditBranches"><label>적용 지점</label>${catalogBranchChecks(item.branches||[],'catalogEditBranch')}</div><div class="catalogTaskActions"><button class="btn s" onclick="saveCatalogTask('',this)">${uiIcon('check')} 저장</button><button class="btn dangerOutlineBtn" onclick="deleteCatalog(this)">${uiIcon('trash')} 삭제</button></div>`:''}</div>`}
renderCatalog=function(){
  const branchSelect=document.getElementById('catalogBrowseBranch'),scopeSelect=document.getElementById('catalogBrowseScope');if(!branchSelect||!scopeSelect)return;
  const previous=branchSelect.value,names=branchNames();branchSelect.innerHTML='<option value="">지점을 선택하세요</option>'+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');branchSelect.value=names.includes(previous)?previous:'';
  const branchName=branchSelect.value,scope=scopeSelect.value||'private';
  if(!branchName){
    if(!names.length){catalogCount.textContent='';catalogWrap.innerHTML='<div class="empty">등록된 지점이 없습니다. 지점·호실 관리에서 지점을 먼저 추가하세요.</div>';return}
    catalogCount.textContent=`전체 지점 ${names.length}개 · 지점을 선택하면 상세 체크 항목과 단가를 확인할 수 있습니다.`;
    catalogWrap.innerHTML=`<div class="catalogBranchOverview">${names.map(name=>{
      const defCount=catalogBrowseDefinitions(name,scope).length;
      const priceCount=repairBranchPriceCache.filter(row=>row.branch_name===name&&(row.inspection_scope||'private')===scope).length;
      return `<button type="button" class="catalogBranchOverviewCard" onclick="document.getElementById('catalogBrowseBranch').value='${esc(name)}';renderCatalog()"><div class="catalogBranchOverviewHead"><span class="catalogBranchOverviewIcon">${uiIcon('branch')}</span><b>${esc(name)}</b></div><div class="catalogBranchOverviewStats"><span><strong>${defCount}</strong>체크 항목</span><span><strong>${priceCount}</strong>등록 단가</span></div></button>`;
    }).join('')}</div>`;
    return;
  }
  const definitions=catalogBrowseDefinitions(branchName,scope),homeRows=groupedBranchPrices(repairBranchPriceCache.filter(row=>row.branch_name===branchName&&(row.inspection_scope||'private')===scope));
  catalogCount.textContent=`체크 항목 ${definitions.length}개 · 등록 단가 ${homeRows.length}개`;
  catalogWrap.innerHTML=definitions.length?definitions.map(def=>{const homes=homeRows.filter(item=>item.category===def.category&&item.name===def.name),lh=DEFAULT_LH_CATALOG.filter(item=>item.name===def.name&&!homes.some(home=>home.sub===item.sub)).map(item=>({...item,scope,branches:[],lhPrice:Number(item.price||0),homesPrice:null})),tasks=[...homes,...lh];return `<div class="catalogGroup"><div class="catalogGroupHead"><div><small>${esc(def.category)}</small><b>${esc(def.name)}</b></div><div class="catalogGroupActions"><span>단가 ${tasks.length}개</span><button type="button" class="catalogAddSubBtn" onclick="openCatalogAddPage('${esc(def.name)}','${esc(def.category)}')">${uiIcon('plus')}<span>수리 작업 추가</span></button></div></div>${tasks.length?tasks.map(catalogBrowseTaskHtml).join(''):'<div class="catalogExistingEmpty">등록된 수리 작업이 없습니다.</div>'}</div>`}).join(''):'<div class="empty">선택한 지점과 점검 대상에 등록된 체크 항목이 없습니다.</div>';
  refreshIcons();
};
async function applyCatalogAddAccess(){const allowed=isAdmin();document.getElementById('catalogAddAdmin')?.classList.toggle('hide',!allowed);if(!allowed){alert('관리자만 신규 단가를 등록할 수 있습니다.');return go('catalog')}try{await loadRepairBranchPricesFromDb();ensureCatalogBranchSelector();initCatalogSubRows();refreshIcons()}catch(error){alert('단가 등록 정보를 불러오지 못했습니다: '+(error.message||error))}}
async function openCatalogAddPage(itemName='',category=''){
  const branchName=document.getElementById('catalogBrowseBranch')?.value||'',scope=document.getElementById('catalogBrowseScope')?.value||'private';await go('catalogAdd');
  document.querySelectorAll('#catBranchChoices .catBranchCheck').forEach(input=>input.checked=!!branchName&&input.value===branchName);const scopeInput=document.querySelector(`input[name="catalogScope"][value="${scope}"]`);if(scopeInput)scopeInput.checked=true;updateCatalogSelectAllButton();refreshCatalogItemChoices(false);
  const itemSelect=document.getElementById('catItemSelect'),detailSelect=document.getElementById('catDetailSelect');if(category&&itemSelect){itemSelect.value=category;refreshCatalogDetailChoices(false)}if(itemName&&detailSelect){detailSelect.value=itemName;catalogExistingPricesHtml()}document.querySelector('#catSubRows .catSubName')?.focus();
}
const inspectionFormPage=document.getElementById('form');
inspectionFormPage?.addEventListener('input',scheduleAutoDraft);
inspectionFormPage?.addEventListener('change',scheduleAutoDraft);
inspectionFormPage?.addEventListener('click',e=>{if(e.target.closest('.status button,.choiceMenu button,.typeBtn,.scopeBtn,.urgencyBtn,.customAddIcon'))scheduleAutoDraft()});
setTimeout(restoreHomesSession,0);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&homesDbUser){updateMyPresence(false);refreshAllDbData(false);if(isAdmin()&&!document.getElementById('account')?.classList.contains('hide'))renderDbUserList()}});
