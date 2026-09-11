# HOMES FM / ADMIN 역할 분리 설계 문서 (초안 v1)

- 작성일: 2026-09-08
- 대상 저장소: `alldayworking24/homes-fm` (FM), 신규 `homes-fm-admin` (ADMIN, 별도 저장소 예정)
- 작업 브랜치: `claude/fm-admin-role-separation-01jgea`
- 이 문서는 **코드 변경 전 합의용 설계 문서**입니다. 실제 리팩터링은 이 문서 확정 후 진행합니다.

---

## 1. 배경 및 현황 진단

### 1.1 원래 기획 의도
- **FM**: 현장 실무자(룸체크 담당자, 시설 담당자)가 매일 쓰는 도구. 점검 입력, 사진 촬영, 보수 처리가 빠르고 편해야 함.
- **ADMIN**: 관리자가 전체 지점 운영 현황을 조망하고 통제하는 관제탑.

### 1.2 실제 코드 상태 (업로드된 두 압축파일 분석 결과)

**FM (`index.html`, 단일 SPA, 약 3,650줄)** 은 실무자 화면 외에 아래와 같은 **관리자 전용 통제 기능**을 role lock(`isAdmin()/isOpsAdmin()`)으로 감싸서 그대로 포함하고 있습니다.

| FM 내부 화면(section id) | 실제 성격 | 권한 |
|---|---|---|
| `account` 내 `userAdminPanel` | 사용자 등록/권한변경/비번초기화/계정삭제 | 시스템 관리자 전용 |
| `account` 내 `recordAdminPanel` | 룸체크·보수 이력 소프트삭제/복구/영구삭제 | 시스템 관리자 전용 |
| `branchAdmin` | 지점·동·층·호실 마스터 구조 편집 | 시스템 관리자 전용 |
| `checklistAdmin` | 체크리스트 양식(DB) 관리 | 운영/시스템 관리자 |
| `vendorAdmin` | 보수 업체 마스터 등록/수정/삭제 | 운영/시스템 관리자 |
| `catalogAdmin` / `catalogAddAdmin` | LH 기준단가 + HOMES 조정단가 등록/수정 | 시스템 관리자 전용 |

**ADMIN (`homes-fm-admin`, `app.js`+`index.html`, 약 1,400줄)** 은 이미 "관제탑"에 가까운 화면을 갖추고 있으나, 관리자 전용 통제 기능 상당수가 **아직 FM 쪽 기능을 그대로 참조하는 조회 위주**이고, 일부는 FM과 **중복 구현**되어 있습니다.

| ADMIN 화면(data-view) | 현재 구현 상태 |
|---|---|
| `dashboard` | 실데이터 기반 KPI/지점별 차트/유형 도넛/우선확인 목록 — 정상 구현 |
| `taxonomy` | 대/중/소분류 관리, `fm_taxonomy` 테이블에 실제 저장 — ADMIN 전용으로 잘 분리됨 |
| `requests` | 보드/목록 보기 — 실데이터는 조회, "요청 등록"은 로컬 메모리에만 쌓이는 데모 폼(미저장) |
| `calendar`, `sla`, `quality` | 조회/집계 위주 — 정상 |
| `sites` | 호실별 이력·지점 비교 — 조회 위주 |
| `settings`(업체·단가) | 업체 목록·평균단가 **조회** + 업체 등록 모달 있음 → **FM `vendorAdmin`과 동일 테이블(`maintenance_vendors`)에 중복 CRUD 존재** |
| `users`(사용자 등록) | 계정 등록/목록 있음 → **FM `account` 내 사용자 관리와 동일 대상(계정 시스템)에 중복 CRUD 존재** |

### 1.3 진단 요약
1. **관리자 전용 통제 기능(구조/양식/업체/단가/계정/이력삭제)이 FM 안에 갇혀 있어**, 실무자 앱이 무거워지고 화면 수가 많아졌습니다.
2. **사용자 등록/업체 관리는 FM과 ADMIN에 이중 구현**되어 있어 유지보수 시 로직이 어긋날 위험이 있습니다(예: 이메일 도메인 제한 규칙이 서로 다르게 바뀔 수 있음).
3. **지점·호실 구조 관리, 체크리스트 양식 관리, 단가표(원본) 관리**는 ADMIN에 아예 없고 FM에만 있어, "관제탑에서 전체를 통제"한다는 원래 취지에 맞지 않습니다.
4. ADMIN의 "보수 요청 등록" 폼은 실제 저장 로직이 없는 데모 상태입니다 — 정리 대상입니다(실무자가 실제 접수하는 경로는 FM `form`이 유일해야 함).

---

## 2. 재정의: FM vs ADMIN

| 구분 | FM (실무자용) | ADMIN (관리자용) |
|---|---|---|
| 사용자 | 현장 실무자(일반 사용자), 운영 관리자도 겸용 로그인 | 운영 관리자, 시스템 관리자 |
| 목적 | 내가 담당한 지점의 점검·보수를 빠르게 처리 | 전체 지점 운영 현황 파악 + 마스터데이터/권한 통제 |
| 데이터 방향 | 새 기록 생성(쓰기 중심): 룸체크, 보수 진행, 사진 | 기존 기록 조회·분석·감사(읽기 중심) + 마스터데이터 쓰기 |
| 기기 | 모바일 우선(카메라 사용) | PC 우선(표, 대시보드) |

### 확정된 전제(사용자 확인 완료)
- **저장소는 분리**한다 (`homes-fm` ↔ 신규 `homes-fm-admin`). 이 세션에는 아직 `homes-fm-admin` 저장소가 연결되어 있지 않으므로, 실제 코드 작업 전 저장소를 새로 만들거나 연결해야 합니다.
- **로그인 계정은 공유**한다 (Supabase Auth 동일, 앱만 분리 — 현재 방식 유지). `viewer`는 FM만, `manager`/`admin`은 FM+ADMIN 모두 접근 가능하도록 안내.

---

## 3. 기능 이관 매핑표 (핵심 산출물)

범례: **이관** = FM에서 제거하고 ADMIN으로 완전 이동 / **참조만 유지** = FM은 읽기 전용으로만 남기고 편집은 ADMIN에서 / **중복 제거** = 양쪽에 있던 것을 ADMIN 하나로 통합

| 기능 | 현재 위치 | 신규 위치 | 처리 |
|---|---|---|---|
| 룸체크 입력(사진 포함) | FM `form` | FM | 유지 (FM 핵심) |
| 룸체크 목록/필터 | FM `list` | FM | 유지 (FM 핵심) |
| 보수 진행 처리(상태 변경, 완료 처리) | FM `repair`/`repairDetail` | FM | 유지 (FM 핵심) |
| 리포트/PDF 인쇄 | FM `report` | FM | 유지 (FM 핵심) |
| 룸체크·보수 이력 열람 | FM `history` | FM | 유지 (FM 핵심, 본인/소속 지점 범위) |
| 수리 단가 **조회**(보수 처리 시 예상비용 표시용) | FM `catalog` | FM | **참조만 유지** (읽기 전용, 편집 버튼 제거) |
| 수리 단가(LH/HOMES 조정) **등록·수정** | FM `catalogAdmin`/`catalogAddAdmin` | ADMIN | **이관** |
| 지점·동·층·호실 마스터 구조 관리 | FM `branchAdmin` | ADMIN | **이관** |
| 체크리스트 양식(DB) 관리 | FM `checklistAdmin` | ADMIN | **이관** |
| 보수 업체 마스터 등록/수정/삭제 | FM `vendorAdmin` + ADMIN `settings` 중복 | ADMIN `settings` | **중복 제거** → ADMIN으로 단일화, FM은 업체 **선택(드롭다운)만** 가능 |
| 사용자 계정 등록/권한변경/비번초기화/삭제 | FM `account`(userAdminPanel) + ADMIN `users` 중복 | ADMIN `users` | **중복 제거** → ADMIN으로 단일화, FM 계정 화면은 "내 정보/비밀번호 변경"만 남김 |
| 룸체크·보수 이력 소프트삭제/복구/영구삭제(감사) | FM `account`(recordAdminPanel) | ADMIN | **이관** (감사/데이터 정정은 관제탑 업무) |
| 보수 유형(대/중/소분류) 체계 관리 | ADMIN `taxonomy` | ADMIN | 유지 (이미 올바르게 분리됨) |
| 운영 KPI/지점별·유형별 대시보드 | ADMIN `dashboard` | ADMIN | 유지 |
| 지점 비교, SLA/처리기한 관리, 데이터 품질 | ADMIN `sites`/`sla`/`quality` | ADMIN | 유지 |
| 보수 요청 파이프라인 **조회**(보드/목록) | ADMIN `requests` | ADMIN | 유지 |
| 보수 요청 "신규 등록" 데모 폼(미저장) | ADMIN `requests` 내 모달 | — | **제거**. 신규 접수는 FM `form`이 유일 경로. ADMIN은 조회·재분류·업체 배정만 담당 |
| 엑셀(CSV) 다운로드 | ADMIN | ADMIN | 유지 |

---

## 4. 화면 재설계 초안 (정보 구조)

### 4.1 FM 신규 하단/사이드 내비게이션
1. 홈(오늘 할 일 요약)
2. 룸체크(목록/입력)
3. 보수관리(내 지점 보수 진행)
4. 캘린더
5. 리포트
6. 더보기 → 계정(내 정보/비밀번호 변경), 단가표 조회(읽기 전용), 사용법

> FM 화면에서 `사용자·권한 관리`, `지점·호실 관리`, `체크리스트 DB 관리`, `보수 업체 관리`, `단가 등록/수정`, `이력 관리(삭제/복구)` 항목 및 관련 잠금 패널(`adminLock`, `branchAdminLock`, `checklistAdminLock`, `vendorAdminLock`)은 전부 제거합니다.

### 4.2 ADMIN 신규 사이드 내비게이션
1. 운영 대시보드
2. 보수 요청(파이프라인 조회 + 업체 배정)
3. 유형화 관리
4. 지점·호실 관리 *(신규 이관)*
5. 체크리스트 양식 관리 *(신규 이관)*
6. 업체·단가 관리 *(단가 등록·수정 포함으로 확장)*
7. 지점 비교 / SLA / 데이터 품질
8. 캘린더
9. 사용자·권한 관리 *(FM 기능 흡수: 등록/권한변경/비번초기화/삭제/이력 소프트삭제·복구)*

---

## 5. 데이터 / 권한(RLS) 영향

현재 `supabase_schema.sql` 정책 기준으로, **테이블별 RLS는 이미 역할(role) 기준으로 나뉘어 있어** 이번 분리는 대부분 **UI 이관**이며 스키마 변경은 최소화할 수 있습니다. 다만 아래는 확인/조정이 필요합니다.

| 테이블 | 현재 정책 | 이관 후 필요 조정 |
|---|---|---|
| `repair_price_catalog`, `lh_repair_price_catalog`, `homes_repair_price_overrides` | `admin`만 write, 전체 read | 변경 불필요(정책 그대로 사용, UI만 ADMIN으로 이동) |
| `repair_history`, `repair_photos` | `admin`/`manager` write | 변경 불필요 |
| `user_profiles` | 본인 또는 `admin` read/update, `admin`만 insert | 변경 불필요 — 단, FM 쪽 UI 제거 후에도 정책 자체는 유지(향후 필요시 서버 API로만 접근) |
| `app_users`(레거시 Auth 연동 테이블) | 별도 확인 필요 | ADMIN 전용 Netlify Function에서만 접근하도록 FM 쪽 `SUPABASE_SERVICE_ROLE_KEY` 참조 제거 필요 여부 확인 |
| `maintenance_vendors` | 문서 미확인(스키마에 없음, ADMIN/FM 양쪽에서 직접 참조) | 정책 존재 여부 확인 후 `admin`/`manager` write, 전체 read로 통일 |
| 지점·호실 마스터(`branches`, `branch_units`) | `RLS` 정책 문서 확인 필요 | ADMIN 전용 write로 좁히고 FM은 read-only 참조만 |
| 체크리스트 템플릿(`checklist_templates`) | 문서 미확인 | ADMIN 전용 write로 좁히고 FM은 해당 지점 템플릿만 read |

> **결론: 테이블 자체를 새로 만들 필요는 없고, "누가 쓸 수 있는가"의 RLS 정책과 "어느 화면에 노출되는가"만 정리하면 됩니다.** 단, `app_users`/`maintenance_vendors`/`branches`/`checklist_templates`의 정확한 RLS 정책 원문은 이번 조사에서 스키마 파일 일부만 확인했으므로, 실제 작업 착수 시 Supabase 대시보드에서 최신 정책을 한 번 더 확인해야 합니다.

---

## 6. 저장소 / 배포 구조

- `homes-fm` (기존, 이 저장소): 실무자 FM 앱만 남김. Netlify 사이트 1개 그대로 사용.
- `homes-fm-admin` (신규): ADMIN 앱 전용 저장소. 별도 Netlify 사이트로 배포(현재 ADMIN README 상 로컬 실행 방식과 동일하게 `SUPABASE` 퍼블리셔블 키만 프론트에 포함, service role key는 사용 안 함 원칙 유지).
- 두 저장소 모두 **동일 Supabase 프로젝트**를 백엔드로 공유(계정 공유 전제와 일치).
- ADMIN 저장소는 사용자가 별도로 GitHub에 생성 후 이 세션에 연결해 주셔야 실제 코드 작업이 가능합니다(현재 세션은 `alldayworking24/homes-fm`만 접근 가능).

---

## 7. 마이그레이션 단계(안)

1. **Phase 0 (현재 문서)**: 기능 이관 매핑표 확정, 미결정 사항 답변.
2. **Phase 1**: ADMIN 저장소 생성/연결. ADMIN에 이관 대상 4개 기능(지점·호실 구조 관리, 체크리스트 양식 관리, 단가 등록·수정, 이력 소프트삭제/복구·영구삭제) 신규 구현.
3. **Phase 2**: 사용자 등록·업체 관리 중복 제거 → ADMIN 단일화, ADMIN `users`/`settings` 화면 보강(권한변경/비번초기화/삭제, 업체 수정/삭제 포함하도록 확장).
4. **Phase 3**: FM에서 관리자 전용 화면·코드·잠금 패널 전부 제거, FM 내비게이션 단순화. FM 단가표는 읽기 전용 조회로 축소.
5. **Phase 4**: RLS 정책 재확인 및 필요 시 조정(섹션 5 표 기준), 두 앱 동시 QA(계정 공유 시나리오: viewer/manager/admin 각각 FM·ADMIN 접근 테스트).
6. **Phase 5**: Netlify 배포 분리 확인, 기존 FM 사용자 대상 공지(관리자 기능은 이제 ADMIN에서, URL 안내).

각 Phase는 별도 PR로 나눠 진행하는 것을 권장합니다(한 PR에 FM 삭제 + ADMIN 신규 구현을 같이 넣지 않기).

---

## 8. 확인이 필요한 미결정 사항

1. `homes-fm-admin` GitHub 저장소를 새로 만들어야 합니다 — 기존 계정(`alldayworking24`)에 새 repo를 만들어도 될까요, 아니면 이미 어딘가에 만들어두신 저장소가 있나요?
2. FM에서 단가표를 "읽기 전용 참고"로 남기는 안(3장 표)에 동의하시나요, 아니면 아예 FM에서 단가 관련 화면을 완전히 제거해도 되나요?
3. 체크리스트 양식은 실무자가 점검할 때 FM에서 "적용된 양식"을 봐야 하므로 read-only는 필수로 남습니다 — 이 부분은 그대로 유지하는 것으로 확정해도 될까요?
4. `maintenance_vendors`, `branches`, `branch_units`, `checklist_templates` 테이블의 실제 RLS 정책 원문을 Supabase 대시보드에서 공유해 주실 수 있나요? (현재 저장소의 `supabase_schema.sql`에는 일부만 포함되어 있어, 정확한 이관 작업을 위해 필요합니다.)
5. Phase 1부터 바로 코드 작업을 시작할까요, 아니면 이 문서를 팀 내부 검토(다른 실무자·관리자 의견 수렴) 후 진행할까요?
