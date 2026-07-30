# HOMES FM v38 배포본

GitHub `alldayworking24/homes-fm` 저장소의 기존 파일을 이 압축파일의 내용으로 교체한 뒤 Commit 하세요. Netlify가 자동 배포합니다.

## 주요 반영사항
- Supabase Auth 로그인 및 `app_users` 사용자 정보 조회
- 관리자 신규 사용자 등록 시 Supabase Auth + `app_users` DB 저장
- 새로고침/브라우저 재접속 시 로그인 세션 유지
- `아래에서 동을 선택하세요.` 안내 문구 제거
- 갤러리 사진의 EXIF 방향 자동 보정
- 앱 카메라 가로 촬영 시 가로 방향으로 저장
- 기존 룸체크·보수·PDF·지점/호실 기능 유지

## Netlify 환경변수
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HOMES_FM_DEFAULT_PASSWORD` = `Homes!0338` (8자 이상, 영문·숫자·특수문자 포함)

## 배포 방법
1. ZIP 압축 해제
2. GitHub 저장소의 기존 파일 전체를 같은 경로로 덮어쓰기
3. Commit changes
4. Netlify Deploy 완료 확인

## 사용자 등록 테스트
- `index.html`을 파일로 직접 열면 Netlify Function이 실행되지 않으므로 사용자 등록은 동작하지 않습니다.
- 배포된 Netlify 주소에서 테스트하거나 Netlify CLI로 `netlify dev`를 실행하세요.
- Netlify 환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HOMES_FM_DEFAULT_PASSWORD`가 필요합니다.

## v44 사용자 관리
- 새 형식 Supabase Secret 키는 서버에서 `apikey` 헤더로만 전송합니다.
- 시스템 관리자는 사용자 계정을 활성화하거나 중지할 수 있습니다.
- 비밀번호 분실 시 `Homes!0338`로 초기화하며 다음 로그인 때 새 비밀번호 설정을 강제합니다.


## v39 수정
- 아코모가산 선택 시 101동/201동 라디오 카드 표시
- 동 선택 후 해당 동의 실제 층·호실 목록 표시
- 다른 지점 선택 시 동 선택 자동 초기화·숨김
- 저장·수정·임시저장·리포트에 동 정보 포함

## v45 보수 내역 저장 오류 수정 (2026-07-30)
- 보수 상세 화면의 `보수 내역 저장` 클릭 시 JavaScript `inProgress is not defined` 오류로 저장이 중단되던 문제 수정
- 저장 중 버튼 잠금 및 `저장 중...` 표시 추가
- 저장 실패 시 실제 오류 메시지 표시 및 콘솔 기록 추가
- 저장 완료·실패 후 버튼 상태 복구 처리 추가
