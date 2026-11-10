/* ============================================================
 * fm-rules-ui.js — homes-fm 화면용 FM 부담주체 규칙 UI (2026-11)
 * 의존: fm-rules.js (window.FM_RULES). index.html 의 앱 스크립트 뒤에서 로드됩니다.
 * 하는 일(모두 기존 함수를 감싸는 방식, 앱 코드는 거의 건드리지 않음):
 *   1) 보수 상세(openRepairDetail) 항목마다 「부담주체 추천·청구」 블록 추가 + 저장(saveRepair) 시 항목 필드에 기록
 *   2) 점검 위치의 지점 선택 아래에 접힌 「지점 운영 정보」 카드 추가 (계약 정보는 admin/manager 만)
 *   3) 룸체크를 다시 저장할 때 부담주체 필드가 사라지지 않도록 carry() 제공 (index.html 에서 1줄 호출)
 * 추천값은 참고용입니다. 부담주체는 반드시 담당자가 직접 선택하며 자동으로 채우지 않습니다.
 * 분류 체계: homes-fm 에는 대·중·소분류 DB(fm_taxonomy)가 없어(관리자 앱 전용) 아래 TAXONOMY 를 로컬 기준표로 둡니다.
 * ============================================================ */
(function(global){
'use strict';
var FR=global.FM_RULES;
var FIELDS=['burdenCategory','burdenCause','burdenPayer','claimStatus','claimAmount','burdenMemo','burdenConfirmedBy','burdenConfirmedAt'];
var PAYERS=['홈즈','투자사','세입자','갑(임대인)','을(홈즈)/전차인','협의 필요'];
var CLAIMS=['해당 없음','선지출','청구 준비','청구중','회수','미회수'];

/* 분류 기준표(관리자 앱 fm_taxonomy 와 같은 구조). 2026-11 승인: 신설 소분류 14개 추가, 욕실은 위생 3개만. */
var TAXONOMY=[
 {major:'설비',middle:'냉난방',subs:['보일러 고장','난방 불량','에어컨 고장','필터 청소']},
 {major:'설비',middle:'전기',subs:['콘센트 불량','조명 고장','차단기 이상','소모품 교체(건전지·전구)']},
 {major:'설비',middle:'급배수',subs:['누수','배관 막힘','수압 불량','도기(변기·세면대) 파손·누수','샤워기','수전류']},
 {major:'설비',middle:'환기',subs:['환풍기 불량','환기구 소음','후드 모터 불량']},
 {major:'마감재',middle:'벽·천장',subs:['벽지 오염','벽지 훼손','도장 갈라짐']},
 {major:'마감재',middle:'바닥',subs:['장판 들뜸','타일 파손','몰딩 파손']},
 {major:'마감재',middle:'문·창호',subs:['문틀 손상','창문 파손','문 경첩·손잡이','방충망 찢김','창호 결로·노후','창호 잠금장치']},
 {major:'가구·가전',middle:'수납가구',subs:['붙박이장 파손','선반 파손','경첩 불량','싱크대 파손']},
 {major:'가구·가전',middle:'생활가전',subs:['냉장고 불량','세탁기 고장','인덕션 고장','소모품 교체','TV 불량','가스렌지 불량']},
 {major:'가구·가전',middle:'비품',subs:['침대 파손','의자 파손']},
 {major:'잠금·보안',middle:'출입문',subs:['도어락 작동 불량','문 잠김 불량']},
 {major:'잠금·보안',middle:'도어락',subs:['배터리 방전','비밀번호 오류']},
 {major:'잠금·보안',middle:'인터폰',subs:['인터폰 불량','영상 송출 불량']},
 {major:'위생·해충',middle:'욕실',subs:['곰팡이','배수구 악취','실리콘 오염']},
 {major:'위생·해충',middle:'주방 위생',subs:['후드 오염','싱크대 악취']},
 {major:'위생·해충',middle:'악취',subs:['하수구 악취','원인 미상 악취']},
 {major:'위생·해충',middle:'해충',subs:['바퀴벌레','개미 발생','날벌레']}
];
var LEAVES=[];
TAXONOMY.forEach(function(t){t.subs.forEach(function(s){LEAVES.push({major:t.major,middle:t.middle,sub:s,path:t.major+'›'+t.middle+'›'+s})})});
function leafByPath(p){for(var i=0;i<LEAVES.length;i++)if(LEAVES[i].path===p)return LEAVES[i];return null}

/* homes-fm 체크리스트 항목명(예: 변기, 욕실 수전) → 분류 추정. 추정일 뿐이며 담당자가 바꿀 수 있습니다. */
var ALIAS=[
 ['변기','설비›급배수›도기(변기·세면대) 파손·누수'],['세면','설비›급배수›도기(변기·세면대) 파손·누수'],
 ['샤워','설비›급배수›샤워기'],['수전','설비›급배수›수전류'],['싱크대 배관','설비›급배수›누수'],['누수','설비›급배수›누수'],
 ['배관','설비›급배수›배관 막힘'],['수압','설비›급배수›수압 불량'],
 ['보일러','설비›냉난방›보일러 고장'],['에어컨','설비›냉난방›에어컨 고장'],['필터','설비›냉난방›필터 청소'],['난방','설비›냉난방›난방 불량'],
 ['콘센트','설비›전기›콘센트 불량'],['조명','설비›전기›조명 고장'],['전구','설비›전기›소모품 교체(건전지·전구)'],['차단기','설비›전기›차단기 이상'],
 ['환풍','설비›환기›환풍기 불량'],['후드','설비›환기›후드 모터 불량'],
 ['벽지','마감재›벽·천장›벽지 훼손'],['도배','마감재›벽·천장›벽지 훼손'],['장판','마감재›바닥›장판 들뜸'],['타일','마감재›바닥›타일 파손'],['몰딩','마감재›바닥›몰딩 파손'],
 ['방충망','마감재›문·창호›방충망 찢김'],['창문','마감재›문·창호›창문 파손'],['문틀','마감재›문·창호›문 틀 손상'],
 ['붙박이장','가구·가전›수납가구›붙박이장 파손'],['선반','가구·가전›수납가구›선반 파손'],['싱크대','가구·가전›수납가구›싱크대 파손'],
 ['냉장고','가구·가전›생활가전›냉장고 불량'],['세탁기','가구·가전›생활가전›세탁기 고장'],['인덕션','가구·가전›생활가전›인덕션 고장'],
 ['TV','가구·가전›생활가전›TV 불량'],['티비','가구·가전›생활가전›TV 불량'],['텔레비전','가구·가전›생활가전›TV 불량'],['가스렌지','가구·가전›생활가전›가스렌지 불량'],['가스레인지','가구·가전›생활가전›가스렌지 불량'],
 ['침대','가구·가전›비품›침대 파손'],['의자','가구·가전›비품›의자 파손'],
 ['도어락','잠금·보안›출입문›도어락 작동 불량'],['인터폰','잠금·보안›인터폰›인터폰 불량'],
 ['곰팡이','위생·해충›욕실›곰팡이'],['실리콘','위생·해충›욕실›실리콘 오염'],['배수구','위생·해충›욕실›배수구 악취']
];
ALIAS.forEach(function(a){if(a[1]==='마감재›문·창호›문 틀 손상')a[1]='마감재›문·창호›문틀 손상'});
function guess(it){
 it=it||{};
 var t=[it.name,it.sub,it.category].filter(Boolean).join(' ');
 for(var i=0;i<LEAVES.length;i++){if(it.name&&LEAVES[i].sub===it.name)return LEAVES[i].path}
 for(var j=0;j<ALIAS.length;j++){if(t.indexOf(ALIAS[j][0])>=0&&leafByPath(ALIAS[j][1]))return ALIAS[j][1]}
 return '';
}

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function opts(list,sel,blank){return '<option value="">'+blank+'</option>'+list.map(function(x){return '<option value="'+esc(x)+'"'+(x===sel?' selected':'')+'>'+esc(x)+'</option>'}).join('')}
function digits(v){return String(v==null?'':v).replace(/[^0-9]/g,'')}

/* 권한: 앱의 로그인 사용자(app_users.role) 중 admin / manager 만 계약 상세(건물주·기간·메모)를 봅니다. */
function isPrivileged(){
 try{if(typeof homesDbUser!=='undefined'&&homesDbUser)return ['admin','manager'].indexOf(homesDbUser.dbRole)>=0}catch(e){}
 return false;
}

var CSS='.fmrBlock{border:1px dashed #d8c25a;border-radius:10px;padding:10px 12px;background:#fffdf3}.fmrBlock>summary{cursor:pointer;font-weight:700;font-size:13px}'
+'.fmrBlock .fmrGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.fmrBlock .fmrGrid .fmrWide{grid-column:1/-1}'
+'.fmrBlock label{display:block;font-size:12px;color:#555;margin-bottom:3px}.fmrBlock select,.fmrBlock input{width:100%;box-sizing:border-box}'
+'.fmrHint{font-size:12px;color:#6F7A83;margin-top:6px}.fmrWarn{font-size:12px;color:#8a6200;background:#FFF6DE;border-radius:6px;padding:4px 8px;margin-top:6px}'
+'.fmrBranch{margin:8px 0 4px;border:1px solid #e6e8ec;border-radius:10px;background:#fafbfc;font-size:13px}.fmrBranch>summary{cursor:pointer;padding:8px 12px;font-weight:600}'
+'.fmrBranch .fmrBody{padding:2px 12px 10px;line-height:1.6}.fmrBranch dl{margin:0;display:grid;grid-template-columns:76px 1fr;gap:2px 8px}.fmrBranch dt{color:#6F7A83}.fmrBranch dd{margin:0;word-break:keep-all}'
+'.fmrBranch .fmrAdmin{margin-top:6px;padding-top:6px;border-top:1px dashed #ddd}.fmrBranch .fmrNote{font-size:12px;color:#6F7A83;margin-top:6px}'
+'@media(max-width:420px){.fmrBlock .fmrGrid{grid-template-columns:1fr}}';
function injectCss(){
 if(typeof document==='undefined'||document.getElementById('fmr-ui-css'))return;
 var s=document.createElement('style');s.id='fmr-ui-css';s.textContent=CSS;document.head.appendChild(s);
}

/* ---------- 1) 보수 상세 블록 ---------- */
var BEARER_MAP={'홈즈':['당사(홈즈)'],'투자사':['투자사(임대인)'],'갑(임대인)':['투자사(임대인)'],'세입자':['세입자'],'을(홈즈)/전차인':['당사(홈즈)','세입자']};
function mismatchText(block){
 var payer=block.querySelector('.fmrPayer').value;
 var wrap=block.closest('.repItem');var cb=wrap&&wrap.querySelector('.costBearer');
 var out=block.querySelector('.fmrMismatch');if(!out)return;
 var ok=!payer||!cb||!cb.value||!BEARER_MAP[payer]||BEARER_MAP[payer].indexOf(cb.value)>=0||cb.value==='기타'||cb.value==='미정'||cb.value==='보수 불필요';
 out.style.display=ok?'none':'block';
 out.textContent=ok?'':'참고: 위 「비용 부담 주체」('+cb.value+')와 다릅니다. 두 값 모두 입력한 그대로 저장되며 서로 덮어쓰지 않습니다.';
}
function blockHtml(it,locked){
 var dis=locked?' disabled':'';
 var path=it.burdenCategory&&leafByPath(it.burdenCategory)?it.burdenCategory:guess(it);
 var leafOpts='<option value="">분류 선택(규칙 조회용)</option>'+TAXONOMY.map(function(t){
  return '<optgroup label="'+esc(t.major+' › '+t.middle)+'">'+t.subs.map(function(s){var p=t.major+'›'+t.middle+'›'+s;return '<option value="'+esc(p)+'"'+(p===path?' selected':'')+'>'+esc(s)+'</option>'}).join('')+'</optgroup>';
 }).join('');
 var h='<details class="fmrBlock" open><summary>부담주체 추천 · 청구 <span style="font-weight:400;color:#6F7A83">(참고용)</span></summary>'
  +'<div class="fmrHint">분류를 고르면 지점별 규칙 추천이 표시됩니다. 추천은 자동 입력되지 않으며, 아래 「부담주체」는 직접 선택해 주세요.</div>'
  +'<div class="fmrGrid"><div class="fmrWide"><label>분류(대›중›소)'+(it.burdenCategory?'':(path?' · 항목명으로 추정':''))+'</label><select class="fmrLeaf"'+dis+'>'+leafOpts+'</select></div></div>'
  +'<div class="fmrPanel"></div>'
  +'<div class="fmrGrid">'
  +'<div><label>부담주체 (직접 선택)</label><select class="fmrPayer"'+dis+'>'+opts(PAYERS,it.burdenPayer||'','선택 안 함')+'</select></div>'
  +'<div><label>청구 상태</label><select class="fmrClaim"'+dis+'>'+opts(CLAIMS,it.claimStatus||'','선택 안 함')+'</select></div>'
  +'<div><label>금액(원)</label><input class="fmrAmount" type="text" inputmode="numeric" value="'+esc(it.claimAmount===undefined||it.claimAmount===''||it.claimAmount===null?'':Number(it.claimAmount).toLocaleString('ko-KR'))+'" placeholder="청구·정산 금액"'+dis+'></div>'
  +'<div><label>메모</label><input class="fmrMemo" type="text" value="'+esc(it.burdenMemo||'')+'" placeholder="협의 내용·근거 등"'+dis+'></div>'
  +'</div><div class="fmrWarn fmrMismatch" style="display:none"></div>'
  +(it.burdenConfirmedAt?'<div class="fmrHint">마지막 저장: '+esc(it.burdenConfirmedBy||'')+' · '+esc(String(it.burdenConfirmedAt).slice(0,16).replace('T',' '))+'</div>':'')
  +'</details>';
 return h;
}
function mountBlock(el,rec,it,locked){
 var holder=document.createElement('div');holder.className='wide fmrHolder';
 holder.innerHTML=blockHtml(it,locked);
 var block=holder.firstChild;
 var anchor=el.querySelector('.costBearer');anchor=anchor&&anchor.closest('.wide');
 if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(holder,anchor.nextSibling);else el.appendChild(holder);
 var state={touchedCause:false,cause:it.burdenCause||'자연 노후'};
 block._fmr=state;
 var leafSel=block.querySelector('.fmrLeaf'),panel=block.querySelector('.fmrPanel');
 function ctxFor(){
  var leaf=leafByPath(leafSel.value);
  return {branch:rec.branch,major:leaf?leaf.major:'',middle:leaf?leaf.middle:'',sub:leaf?leaf.sub:'',item:leaf?'':(it.name||''),cause:state.cause,
   onChange:function(){}};
 }
 function draw(){
  var ctx=ctxFor();
  try{
   if(!leafSel.value&&!ctx.item){panel.innerHTML='<div class="fmrHint">분류를 선택하면 추천이 표시됩니다.</div>';return}
   FR.mountPanel(panel,ctx);
   var cs=panel.querySelector('[data-fmr-cause]');
   if(cs){cs.value=state.cause;cs.disabled=!!locked;cs.addEventListener('change',function(){state.cause=cs.value;state.touchedCause=true})}
  }catch(e){panel.innerHTML='<div class="fmrWarn">추천을 불러오지 못했습니다. 담당자 판단으로 입력하세요.</div>';if(global.console)console.warn('fm-rules panel',e)}
 }
 leafSel.addEventListener('change',draw);
 block.querySelector('.fmrPayer').addEventListener('change',function(){mismatchText(block)});
 var cb=el.querySelector('.costBearer');if(cb)cb.addEventListener('change',function(){mismatchText(block)});
 draw();mismatchText(block);
}
function decorateRepairDetail(id){
 var rec=typeof getRec==='function'?getRec(id):null;
 var wrap=document.getElementById('repairDetailWrap');
 if(!rec||!wrap||!FR)return;
 injectCss();
 var locked=false;try{locked=!!currentRepairLocked}catch(e){}
 Array.prototype.forEach.call(wrap.querySelectorAll('.repItem'),function(el){
  if(el.querySelector('.fmrBlock'))return;
  var it=(rec.items||[])[Number(el.dataset.idx)];if(!it)return;
  try{mountBlock(el,rec,it,locked)}catch(e){if(global.console)console.warn('fm-rules block',e)}
 });
}
/* 저장: 화면 값을 먼저 읽어 두고, 앱의 updateRec 콜백 안에서 항목 필드에 반영(기존 저장 경로 그대로 사용) */
function collectBlocks(){
 var wrap=document.getElementById('repairDetailWrap'),out={};
 if(!wrap)return out;
 Array.prototype.forEach.call(wrap.querySelectorAll('.repItem'),function(el){
  var b=el.querySelector('.fmrBlock');if(!b||b.querySelector('.fmrPayer').disabled)return;
  out[Number(el.dataset.idx)]={
   category:b.querySelector('.fmrLeaf').value,cause:b._fmr?{value:b._fmr.cause,touched:b._fmr.touchedCause}:{value:'',touched:false},
   payer:b.querySelector('.fmrPayer').value,claim:b.querySelector('.fmrClaim').value,
   amount:digits(b.querySelector('.fmrAmount').value),memo:b.querySelector('.fmrMemo').value.trim()
  };
 });
 return out;
}
function applyToItem(it,v,by,nowIso){
 var prev={cat:it.burdenCategory||'',cause:it.burdenCause||'',payer:it.burdenPayer||'',claim:it.claimStatus||'',amount:(it.claimAmount===undefined||it.claimAmount===null||it.claimAmount==='')?'':String(it.claimAmount),memo:it.burdenMemo||''};
 var hasPrev=!!(prev.cause||prev.payer||prev.claim||prev.amount||prev.memo||prev.cat);
 var touched=!!(v.payer||v.claim||v.amount||v.memo||v.cause.touched);
 if(!hasPrev&&!touched)return false; /* 아무것도 입력하지 않았으면 필드를 만들지 않음 */
 /* 분류는 직접 입력한 값이 있을 때만 저장(추정값만으로 저장하지 않음) */
 var nextCat=(touched||hasPrev)?(v.category||''):'';
 var nextCause=(v.cause.touched||prev.cause||v.payer||v.claim)?v.cause.value:'';
 var next={cat:nextCat,cause:nextCause,payer:v.payer,claim:v.claim,amount:v.amount,memo:v.memo};
 var changed=Object.keys(next).some(function(k){return next[k]!==prev[k]});
 if(!changed)return false;
 it.burdenCategory=next.cat;it.burdenCause=next.cause;it.burdenPayer=next.payer;it.claimStatus=next.claim;
 it.claimAmount=next.amount===''?'':Number(next.amount);it.burdenMemo=next.memo;
 /* 담당자가 부담주체를 선택·변경해 저장한 경우에만 확인자/일시를 기록(규칙 확정이 아니라 담당자 입력 기록) */
 if(next.payer&&(next.payer!==prev.payer||!it.burdenConfirmedAt)){it.burdenConfirmedBy=by;it.burdenConfirmedAt=nowIso}
 return true;
}
var pending=null;
function hookRepair(){
 if(typeof global.openRepairDetail==='function'&&!global.openRepairDetail.__fmr){
  var o1=global.openRepairDetail;
  var w1=function(id){var r=o1.apply(this,arguments);try{decorateRepairDetail(id)}catch(e){if(global.console)console.warn(e)}return r};
  w1.__fmr=true;global.openRepairDetail=w1;
 }
 if(typeof global.updateRec==='function'&&!global.updateRec.__fmr){
  var o2=global.updateRec;
  var w2=function(id,fn){
   var p=pending;
   if(p&&Number(id)===p.id&&typeof fn==='function'){
    var f2=function(rec){
     fn(rec);
     var by='';try{by=(typeof inspectorName==='function'?inspectorName():'')||rec.updatedBy||''}catch(e){}
     var now=new Date().toISOString();
     Object.keys(p.values).forEach(function(k){var it=(rec.items||[])[Number(k)];if(it)applyToItem(it,p.values[k],by,now)});
    };
    return o2.call(this,id,f2);
   }
   return o2.apply(this,arguments);
  };
  w2.__fmr=true;global.updateRec=w2;
 }
 if(typeof global.saveRepair==='function'&&!global.saveRepair.__fmr){
  var o3=global.saveRepair;
  var w3=async function(){
   var cid=null;try{cid=Number(currentRepairId)}catch(e){}
   pending={id:cid,values:collectBlocks()};
   try{return await o3.apply(this,arguments)}finally{pending=null}
  };
  w3.__fmr=true;global.saveRepair=w3;
 }
}

/* ---------- 2) 지점 운영 정보 카드 ---------- */
var PRINCIPLE={
 '선정릉':'홈즈 선지출 후 투자사 재청구(‡). 재청구 조항 번호 확인 필요.',
 '안암':'투자사 부담(†). 서일개발 계약 유지.',
 '아코모가산':'투자사 부담 원칙. 협의로 예외가 되면 그 내용을 기록.',
 '아코모회기':'투자사 부담 원칙. 협의로 예외가 되면 그 내용을 기록.',
 '남영':'갑/을 구분표 우선(수선=을(홈즈)/전차인, 교체=갑 등). 표에 없으면 담당자 확인.',
 '원효로240':'과실·소모품만 확정, 나머지는 보류(계약 확인 필요).'
};
function dText(d){return d==null?'':(d>=0?' (D-'+d+')':' (D+'+(-d)+')')}
function branchCardHtml(name,priv){
 var b=FR.normBranch(name),c=null;
 (FR.contracts||[]).forEach(function(x){if(x.branch===b)c=x});
 if(!c)return '<summary>지점 운영 정보</summary><div class="fmrBody"><div class="fmrNote">「'+esc(name)+'」은 규칙표에 없는 지점입니다. 담당자 판단이 필요합니다.</div></div>';
 var h='<summary>지점 운영 정보 · '+esc(b)+'</summary><div class="fmrBody"><dl>'
  +'<dt>구조</dt><dd>'+esc(c.structure||'확인 필요')+'</dd>'
  +'<dt>FM 업체</dt><dd>'+esc(c.fm||'확인 필요')+'</dd>'
  +'<dt>부담 원칙</dt><dd>'+esc(PRINCIPLE[b]||'확인 필요')+'</dd></dl>';
 if(priv){
  h+='<div class="fmrAdmin"><dl>'
   +'<dt>건물주·투자사</dt><dd>'+esc(c.owner||'확인 필요')+'</dd>'
   +'<dt>계약 시작</dt><dd>'+esc(c.start||'확인 필요')+'</dd>'
   +'<dt>계약 만기</dt><dd>'+esc(c.end||'확인 필요')+esc(FR.dDay(c.end)!=null?dText(FR.dDay(c.end)):'')+'</dd>'
   +'<dt>해지 통보</dt><dd>'+esc(c.notice||'확인 필요')+esc(FR.dDay(c.notice)!=null?dText(FR.dDay(c.notice)):'')+'</dd>'
   +'<dt>갱신</dt><dd>'+esc(c.autoRenew||'확인 필요')+'</dd>'
   +'<dt>메모</dt><dd>'+esc(c.note||'')+'</dd></dl></div>';
 }
 h+='<div class="fmrNote">참고용 정보입니다. 계약 원문 확인 전 항목은 담당자·조직장 확인이 필요합니다.</div></div>';
 return h;
}
function ensureCard(afterId,cardId){
 var anchor=document.getElementById(afterId);if(!anchor)return null;
 var card=document.getElementById(cardId);
 if(!card){card=document.createElement('details');card.id=cardId;card.className='fmrBranch';card.style.display='none';anchor.parentNode.insertBefore(card,anchor.nextSibling)}
 return card;
}
function refreshCard(afterId,cardId,selectId){
 if(!FR)return;
 var card=ensureCard(afterId,cardId);if(!card)return;
 var sel=document.getElementById(selectId),v=sel?String(sel.value||'').trim():'';
 if(!v){card.style.display='none';return}
 injectCss();
 var open=card.open&&card.getAttribute('data-b')===v; /* 지점이 바뀌면 다시 접음 */
 card.innerHTML=branchCardHtml(v,isPrivileged());
 card.setAttribute('data-b',v);card.open=open;card.style.display='';
}
function refreshCards(){
 try{refreshCard('branchStep','fmrBranchCard','branch')}catch(e){if(global.console)console.warn(e)}
 try{refreshCard('commonBranchStep','fmrBranchCardCommon','commonBranch')}catch(e){if(global.console)console.warn(e)}
}
function hookBranch(){
 ['setBranch','chooseCommonBranch','commonBranchChanged','chooseBranch'].forEach(function(n){
  var f=global[n];if(typeof f!=='function'||f.__fmr)return;
  var w=function(){var r=f.apply(this,arguments);refreshCards();return r};w.__fmr=true;global[n]=w;
 });
 refreshCards();
}

/* ---------- 3) 룸체크 재저장 시 부담주체 필드 보존 ---------- */
function carry(oldRec,items){
 try{
  var map={};((oldRec&&oldRec.items)||[]).forEach(function(it){map[(it.category||'')+'/'+(it.name||'')]=it});
  (items||[]).forEach(function(it){
   var p=map[(it.category||'')+'/'+(it.name||'')];if(!p)return;
   FIELDS.forEach(function(k){if(p[k]!==undefined&&it[k]===undefined)it[k]=p[k]});
  });
 }catch(e){if(global.console)console.warn('fm-rules carry',e)}
}

function init(){hookRepair();hookBranch()}
global.FM_RULES_UI={taxonomy:TAXONOMY,leaves:LEAVES,guess:guess,carry:carry,isPrivileged:isPrivileged,applyToItem:applyToItem,
 branchCardHtml:branchCardHtml,decorateRepairDetail:decorateRepairDetail,collectBlocks:collectBlocks,init:init,fields:FIELDS,payers:PAYERS,claims:CLAIMS,refreshCards:refreshCards};
if(!FR){if(global.console)console.warn('FM_RULES 가 없어 부담주체 UI를 건너뜁니다.');return}
init();
})(typeof window!=='undefined'?window:this);
