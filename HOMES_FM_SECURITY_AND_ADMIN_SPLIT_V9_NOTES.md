# HOMES FM v9 수정 메모 — 보안(P0) 정리

## 수정 목적
담당자 요청으로 (1) 코드/문서에 평문으로 박혀 있는 기본·초기화 비밀번호 제거, (2) 공유기
비밀번호(routerPw)가 보수 상세·리포트·PDF에 그대로 노출되던 문제 차단, (3) homes-fm-admin에
이미 동일하게 구현돼 있는 관리자 전용 화면(수리 단가/지점·호실/체크리스트/업체 관리)을
실무자 계정에서 더 이상 쓸 수 없도록 1단계(링크 숨김 + 라우팅 가드) 정리를 진행했습니다.
DB 스키마·데이터는 전혀 바꾸지 않았습니다.

## P0-1. 평문 비밀번호 제거
- README.md, supabase_schema.sql 주석, 로그인 화면 안내문, 사용자 등록/비밀번호 초기화
  관련 alert·confirm 문구, `netlify/functions/admin-user.js`의 서버측 폴백 등 코드 전체에
  하드코딩돼 있던 실제 비밀번호 문자열을 모두 지웠습니다.
- 안내 문구는 전부 "Netlify 환경변수 `HOMES_FM_DEFAULT_PASSWORD` 값 사용"으로 통일했고,
  실제 발급되는 임시 비밀번호는 서버가 계정 생성/초기화 시 반환하는
  `out.temporary_password`로만 안내합니다(이 값은 계정마다 1회성으로 화면에 표시되는
  정상 기능이라 그대로 유지했습니다).
- `netlify/functions/admin-user.js`: 환경변수가 비어있거나 보안 조건(8자 이상+영문+숫자+
  특수문자)을 만족하지 못할 때 쓰던 고정 폴백 문자열을, 매번 새로 생성하는 안전한 임시
  비밀번호(`generateFallbackPassword()`, Node `crypto.randomBytes` 사용)로 바꿨습니다.
- 레거시(localStorage 기반, 실제 로그인 경로는 아님) 코드에 있던 `DEFAULT_PASSWORD` 상수는
  빈 문자열로 바꿨습니다. 이 상수를 쓰는 `prefillFirstPassword()`(최초 로그인 비밀번호
  변경 화면의 "현재 비밀번호" 자동 채움)는 더 이상 고정값을 채우지 않고, 사용자가 직접
  입력해야 합니다 — 원래도 `lastLoginPw`가 실제로는 항상 비어 있어(레거시 로그인 경로가
  현재 로그인 흐름에서 쓰이지 않음) 이 자동 채움은 실질적으로 항상 고정값만 채우고
  있었으므로 동작상 거의 영향이 없습니다.

## P0-2. 공유기 비밀번호(routerPw) 노출 차단
- 룸체크 입력 화면의 "공유기 PW" 입력칸을 `type="text"` → `type="password"`로 바꾸고,
  옆에 "보기/숨기기" 토글 버튼(`toggleRouterPwVisibility`)을 추가했습니다.
- 보수 상세 화면(`openRepairDetail`)과 리포트 화면(`openReport`)에 평문으로 찍히던
  `PW: ${값}` 표시를 제거하고, 등록 여부만 "등록됨(비공개)"로 보여주도록 바꿨습니다 —
  `openReport`가 만드는 화면을 그대로 캡처하는 PDF 내보내기에도 함께 반영됩니다.
- 엑셀 내보내기(`exportRoomCheckExcel`/`exportHistoryExcel`)에는 애초에 routerPw 컬럼이
  없어 추가 조치가 필요 없었습니다.
- 기존에 저장된 routerPw 값 자체는 삭제하지 않았습니다(삭제 여부는 별도 결정 사항).

## P0-3. 남아있는 관리자 전용 화면 1단계 정리
- **비교 결과**: homes-fm-admin에 지점·호실 관리, 체크리스트 템플릿 관리, 단가표(LH/HOMES)
  관리, 업체 관리 4개 기능이 모두 이미 구현돼 있는 것을 `supabase-api.js`에서 직접
  확인했습니다(`loadAllBranches`/`saveBranch`, `loadAllChecklistTemplates`/
  `saveChecklistTemplateRow`, `loadLhCatalog`/`saveHomesOverride`, `updateVendor` 등).
  중복 기능이므로 실무자 앱에서 안전하게 숨길 수 있습니다.
- '더보기' 메뉴에서 수리 단가 관리/지점·호실 관리/체크리스트 DB 관리/보수 업체 관리 4개
  버튼을 `moreAdminLinks`라는 하나의 영역으로 묶고, `renderMore()`에서
  `isOpsAdmin()`(운영 관리자 이상)일 때만 보이도록 했습니다. "데이터 백업" 버튼은 이번
  정리 대상이 아니라서 그대로 두었습니다.
- `go(id)` 화면 전환 함수에 2차 방어를 추가했습니다: `catalog`/`catalogAdd`/
  `branchAdmin`/`checklistAdmin`/`vendorAdmin` 화면으로 이동하려는데 운영 관리자가
  아니면 안내 후 홈으로 돌려보냅니다(과거에 북마크해 둔 링크 등으로 직접 접근하는
  경우까지 막기 위함). 각 화면 자체에 있던 기존 가드(`applyCatalogAddAccess` 등)는
  그대로 두어 이중 방어를 유지합니다.
- **페이지 자체(HTML)는 이번에 제거하지 않았습니다.** 완전 삭제는 다음 단계에서 별도
  승인 후 진행합니다.

## 검증
- 로컬 정적 서버로 직접 열어 브라우저 콘솔에서 확인했습니다:
  - 일반(staff) 계정으로 `go('branchAdmin')` 호출 시 안내 후 `home`으로 이동함.
  - 운영 관리자(manager/admin) 계정으로는 정상 진입됨.
  - `renderMore()` 호출 시 staff는 관리 메뉴 묶음이 숨겨지고, admin은 보임.
  - 공유기 PW 입력칸의 보기/숨기기 토글이 `type`을 정상적으로 전환함.
- Supabase 로그인이 필요한 실제 저장·배포 흐름은 이 환경(오프라인 샌드박스)에서 끝까지
  확인할 수 없어, **배포 후 아래를 직접 확인해 주세요**:
  - [ ] 신규 계정 등록 시 알림에 뜨는 임시 비밀번호로 실제 로그인이 되는지
  - [ ] 공유기 PW 보기 토글이 실제 저장된 값으로 정상 동작하는지
  - [ ] 일반 계정으로 '더보기'에 관리 메뉴가 안 보이는지, 직접 URL/해시 이동으로도
        들어가지지 않는지
