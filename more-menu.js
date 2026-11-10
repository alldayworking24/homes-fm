/* ============================================================
 * more-menu.js — 「더보기」 화면 개편 (2026-11)
 * 기존 renderMore()를 감싸서 화면을 다시 구성합니다. 기능은 그대로(계정 관리, 수리 이력, 사용법, 데이터 백업).
 *  - 내 계정 카드(이름·권한 배지) → 현황 요약(합계 + 상태 비율 막대, 수치를 누르면 해당 상태 목록) → 영역별 메뉴(조회·도움말·데이터 관리)
 *  - 기존 마크업(#more 안 .card 2개, #moreStat)은 그대로 두고 숨깁니다(기존 renderMore가 계속 채웁니다).
 * index.html 의 앱 스크립트 뒤에서 로드됩니다. 의존: renderMore, loadAll, recStatus, currentUser, uiIcon, go, showHelp, exportData.
 * ============================================================ */
(function(global){
'use strict';
var ROLE_LABEL={admin:'시스템 관리자',manager:'운영 관리자',staff:'일반 사용자'};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ic(n){try{return typeof uiIcon==='function'?uiIcon(n):''}catch(e){return ''}}
var CHEV='<svg class="mmChev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

var CSS=''
+'#more .mmWrap{display:grid;gap:12px}'
+'#more.mmOn>.card{display:none}'
+'.mmCard{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px}'
+'.mmSec{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.02em;margin:0 0 8px}'
+'.mmAccount{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit}'
+'.mmAccount:hover,.mmRow:hover,.mmKpi:hover{border-color:#cfd6df}'
+'.mmAvatar{flex:0 0 44px;width:44px;height:44px;border-radius:50%;background:#FFF3C4;color:#8a6200;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px}'
+'.mmAccBody{flex:1;min-width:0}.mmAccName{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:700;font-size:15px}'
+'.mmBadge{display:inline-block;padding:1px 9px;border-radius:99px;font-size:11px;font-weight:700;background:#E9EEF9;color:#2B4C8C}'
+'.mmSub{font-size:12px;color:var(--muted);margin-top:2px}'
+'.mmChev{flex:0 0 auto;color:#9aa3ad}'
+'.mmTotal{display:flex;align-items:baseline;justify-content:space-between}.mmTotal .l{font-size:13px;color:var(--muted);font-weight:600}.mmTotal .n{font-size:26px;font-weight:800;color:var(--navy)}.mmTotal .u{font-size:12px;color:var(--muted);margin-left:3px;font-weight:600}'
+'.mmBar{display:flex;height:8px;border-radius:99px;overflow:hidden;background:#eef0f3;margin:8px 0}.mmBar i{display:block;height:100%}'
+'.mmLegend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)}.mmLegend b{color:var(--text);font-weight:700}.mmDot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:0}'
+'.mmKpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}'
+'.mmKpi{border:1px solid var(--line);border-radius:12px;background:#fff;padding:9px 6px;text-align:center;cursor:pointer;font:inherit;color:inherit;min-width:0}'
+'.mmKpi .l{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}.mmKpi .n{font-size:22px;font-weight:800;margin-top:1px}.mmKpi .h{font-size:11px;color:#9aa3ad;margin-top:1px}'
+'.mmGroups{display:grid;gap:12px}'
+'.mmRow{display:flex;align-items:center;gap:12px;width:100%;border:1px solid var(--line);border-radius:12px;background:#fff;padding:11px 12px;cursor:pointer;text-align:left;font:inherit;color:inherit;min-height:56px}'
+'.mmIc{flex:0 0 36px;width:36px;height:36px;border-radius:10px;background:#FFF3C4;color:#8a6200;display:flex;align-items:center;justify-content:center}.mmIc .uiIcon{width:20px;height:20px}'
+'.mmRowBody{flex:1;min-width:0}.mmRowTitle{font-weight:700;font-size:14px}.mmRowDesc{font-size:12px;color:var(--muted);margin-top:1px}'
+'.mmFoot{text-align:center;font-size:11px;color:#9aa3ad;padding:2px 0 8px}'
+'@media(min-width:700px){.mmGroups{grid-template-columns:1fr 1fr;align-items:start}.mmGroups .mmGroupWide{grid-column:1/-1}}';

function injectCss(){
 if(document.getElementById('mm-css'))return;
 var s=document.createElement('style');s.id='mm-css';s.textContent=CSS;document.head.appendChild(s);
}
function counts(){
 var recs=[];try{recs=loadAll()||[]}catch(e){}
 var c={total:recs.length,need:0,repair:0,done:0,check:0};
 recs.forEach(function(r){var s='';try{s=recStatus(r)}catch(e){}if(c[s]!==undefined)c[s]++});
 return c;
}
function seg(w,color){return w>0?'<i style="width:'+w+'%;background:'+color+'"></i>':''}
function row(act,icon,title,desc,cls){
 return '<button type="button" class="mmRow" data-mm="'+act+'"><span class="mmIc">'+ic(icon)+'</span><span class="mmRowBody"><div class="mmRowTitle">'+esc(title)+'</div><div class="mmRowDesc">'+esc(desc)+'</div></span>'+CHEV+'</button>';
}
function build(){
 var u=null;try{u=currentUser()}catch(e){}
 var role='';try{role=(typeof homesDbUser!=='undefined'&&homesDbUser&&homesDbUser.dbRole)||(u&&u.role)||''}catch(e){}
 var c=counts(),T=c.total||1;
 var pct=function(n){return Math.round(n/T*1000)/10};
 var name=u?String(u.name||u.email||''):'';
 var h='<div class="mmWrap">';
 h+='<button type="button" class="mmCard mmAccount" data-mm="account"><span class="mmAvatar">'+esc(name?name.slice(0,1):'?')+'</span><span class="mmAccBody"><div class="mmAccName">'
  +(u?esc(name)+(ROLE_LABEL[role]?'<span class="mmBadge">'+esc(ROLE_LABEL[role])+'</span>':''):'로그인 / 계정')
  +'</div><div class="mmSub">'+(u?'계정 정보 · 비밀번호 변경':'로그인이 필요합니다')+'</div></span>'+CHEV+'</button>';
 h+='<div class="mmCard"><div class="mmSec">현황 요약</div>'
  +'<div class="mmTotal"><span class="l">전체 기록</span><span><span class="n">'+c.total+'</span><span class="u">건</span></span></div>'
  +'<div class="mmBar" role="img" aria-label="상태별 비율">'+seg(pct(c.done),'#0f8a5f')+seg(pct(c.repair),'#b45309')+seg(pct(c.need),'#D99E00')+seg(pct(c.check),'#b8c0cb')+'</div>'
  +'<div class="mmLegend"><span><i class="mmDot" style="background:#0f8a5f"></i>보수완료 <b>'+c.done+'</b></span><span><i class="mmDot" style="background:#b45309"></i>보수중 <b>'+c.repair+'</b></span><span><i class="mmDot" style="background:#D99E00"></i>보수 예정 <b>'+c.need+'</b></span><span><i class="mmDot" style="background:#b8c0cb"></i>룸체크 완료 <b>'+c.check+'</b></span></div>'
  +'<div class="mmKpis">'
  +'<button type="button" class="mmKpi" data-mm="list:need"><div class="l">보수 예정</div><div class="n" style="color:#B8891A">'+c.need+'</div><div class="h">목록 보기</div></button>'
  +'<button type="button" class="mmKpi" data-mm="list:repair"><div class="l">보수중</div><div class="n">'+c.repair+'</div><div class="h">목록 보기</div></button>'
  +'<button type="button" class="mmKpi" data-mm="list:done"><div class="l">보수완료</div><div class="n" style="color:#0f8a5f">'+c.done+'</div><div class="h">목록 보기</div></button>'
  +'</div></div>';
 h+='<div class="mmGroups">'
  +'<div><div class="mmSec">조회</div>'+row('history','history','지점·호실별 수리 이력','호실마다 보수 내용과 비용 확인')+'</div>'
  +'<div><div class="mmSec">도움말</div>'+row('help','info','사용법 보기','화면별 설명 가이드')+'</div>'
  +'<div class="mmGroupWide"><div class="mmSec">데이터 관리</div>'+row('export','download','데이터 백업','점검·보수 기록을 파일로 저장')+'</div>'
  +'</div>';
 h+='<div class="mmFoot">HOMES FM · 현장 점검·보수 관리</div></div>';
 return h;
}
function render(){
 var sec=document.getElementById('more');if(!sec)return;
 injectCss();
 var holder=document.getElementById('mmHolder');
 if(!holder){holder=document.createElement('div');holder.id='mmHolder';sec.appendChild(holder)}
 holder.innerHTML=build();sec.classList.add('mmOn');
}
function onClick(e){
 var b=e.target.closest&&e.target.closest('#mmHolder [data-mm]');if(!b)return;
 var a=b.getAttribute('data-mm');
 if(a==='account')go('account');
 else if(a==='history')go('history');
 else if(a==='help')showHelp();
 else if(a==='export')exportData();
 else if(a.indexOf('list:')===0){
  var st=a.slice(5),sel=document.getElementById('fStatus');
  if(sel)sel.value=st; /* 목록 화면의 상태 필터를 맞춘 뒤 이동(go('list')가 목록을 다시 그림) */
  go('list');
 }
}
function hook(){
 if(typeof global.renderMore==='function'&&!global.renderMore.__mm){
  var o=global.renderMore;
  var w=function(){var r=o.apply(this,arguments);try{render()}catch(e){if(global.console)console.warn('more-menu',e)}return r};
  w.__mm=true;global.renderMore=w;
 }
 document.addEventListener('click',onClick);
}
hook();
global.MORE_MENU={render:render,build:build,counts:counts};
})(window);
