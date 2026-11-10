-- =====================================================================
-- 2026-11 fm_taxonomy 변경안 (소분류 14개 신설 + 욕실 분류 정리)
-- DB 관리자 검토용입니다. AI가 실행하지 않았고, 실행 전 반드시 백업·검토하세요.
--
-- 전제 (homes-fm-admin 의 supabase-api.js 기준으로 추정한 구조 — 실제 컬럼·제약은 DB에서 확인 필요):
--   public.fm_taxonomy(id, level, parent_id, name, icon, color, description, sort_order, is_active, ...)
--   level 1 = 대분류, 2 = 중분류, 3 = 소분류. parent_id 는 상위 행의 id.
--   id 는 DB 기본값(자동 생성)으로 채워진다고 가정합니다(id 를 직접 넣지 않음).
--   created_by / updated_by 등 NOT NULL 컬럼이 있으면 아래 INSERT 에 값을 추가해야 합니다.
-- 특징: 이름으로 상위(대›중분류)를 찾고, WHERE NOT EXISTS 로 이미 있으면 건너뛰므로 여러 번 실행해도 안전합니다.
--       삭제는 하지 않습니다(욕실 정리는 is_active=false 로만 비활성).
-- 승인: 2026-11-10 FM 총괄 (스튜디오 FM 부담주체 규칙표 「신설_소분류_14」 시트)
-- =====================================================================

-- [0] 사전 점검: 상위 중분류가 모두 존재하는지 (결과가 0행이어야 정상. 행이 나오면 그 대›중분류를 먼저 만드세요)
SELECT v.major, v.middle AS missing_middle
FROM (VALUES
  ('설비','전기'),('설비','급배수'),('설비','환기'),('설비','냉난방'),
  ('마감재','문·창호'),('가구·가전','수납가구'),('가구·가전','생활가전')
) AS v(major, middle)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.fm_taxonomy maj
  JOIN public.fm_taxonomy mid ON mid.parent_id = maj.id AND mid.level = 2 AND mid.name = v.middle
  WHERE maj.level = 1 AND maj.name = v.major
);

-- [1] 신설 소분류 14개 추가 (이미 있으면 건너뜀)
INSERT INTO public.fm_taxonomy (level, parent_id, name, sort_order, is_active)
SELECT 3,
       mid.id,
       v.sub_name,
       COALESCE((SELECT MAX(c.sort_order) FROM public.fm_taxonomy c WHERE c.parent_id = mid.id), 0) + v.ord,
       true
FROM (VALUES
  ('설비',      '전기',     '소모품 교체(건전지·전구)',      1),
  ('설비',      '급배수',   '도기(변기·세면대) 파손·누수',   1),
  ('설비',      '급배수',   '샤워기',                        2),
  ('설비',      '급배수',   '수전류',                        3),
  ('마감재',    '문·창호',  '문 경첩·손잡이',                1),
  ('설비',      '환기',     '후드 모터 불량',                1),
  ('가구·가전', '수납가구', '싱크대 파손',                   1),
  ('가구·가전', '생활가전', '소모품 교체',                   1),
  ('가구·가전', '생활가전', 'TV 불량',                       2),
  ('마감재',    '문·창호',  '방충망 찢김',                   2),
  ('마감재',    '문·창호',  '창호 결로·노후',                3),
  ('마감재',    '문·창호',  '창호 잠금장치',                 4),
  ('설비',      '냉난방',   '필터 청소',                     1),
  ('가구·가전', '생활가전', '가스렌지 불량',                 3)
) AS v(major, middle, sub_name, ord)
JOIN public.fm_taxonomy maj ON maj.level = 1 AND maj.name = v.major
JOIN public.fm_taxonomy mid ON mid.level = 2 AND mid.parent_id = maj.id AND mid.name = v.middle
WHERE NOT EXISTS (
  SELECT 1 FROM public.fm_taxonomy x
  WHERE x.level = 3 AND x.parent_id = mid.id AND x.name = v.sub_name
);

-- [2] 위생·해충›욕실 정리: 욕실에는 곰팡이·배수구 악취·실리콘 오염(위생)만 남김.
--     변기·세면대·샤워기류는 설비›급배수로 이동했으므로 욕실 아래의 해당 소분류는 삭제하지 않고 비활성 처리.
--     (먼저 아래 SELECT 로 대상 행을 확인하세요. 이동 전 이 소분류로 접수된 기존 요청은 name 문자열로 남아 있어 영향 없음)
SELECT c.id, c.name, c.is_active
FROM public.fm_taxonomy c
JOIN public.fm_taxonomy mid ON mid.id = c.parent_id AND mid.level = 2 AND mid.name = '욕실'
JOIN public.fm_taxonomy maj ON maj.id = mid.parent_id AND maj.level = 1 AND maj.name = '위생·해충'
WHERE c.level = 3
  AND c.name NOT IN ('곰팡이','배수구 악취','실리콘 오염');

UPDATE public.fm_taxonomy c
SET is_active = false
FROM public.fm_taxonomy mid, public.fm_taxonomy maj
WHERE c.level = 3
  AND mid.id = c.parent_id AND mid.level = 2 AND mid.name = '욕실'
  AND maj.id = mid.parent_id AND maj.level = 1 AND maj.name = '위생·해충'
  AND c.name NOT IN ('곰팡이','배수구 악취','실리콘 오염')
  AND c.name ~ '변기|세면|샤워|수전|도기'
  AND c.is_active IS DISTINCT FROM false;

-- [3] 결과 확인: 신설 14개가 모두 활성 상태로 존재하는지 (14행이 나와야 정상)
SELECT maj.name AS major, mid.name AS middle, c.name AS sub, c.is_active
FROM public.fm_taxonomy c
JOIN public.fm_taxonomy mid ON mid.id = c.parent_id AND mid.level = 2
JOIN public.fm_taxonomy maj ON maj.id = mid.parent_id AND maj.level = 1
WHERE c.level = 3 AND (maj.name, mid.name, c.name) IN (
  ('설비','전기','소모품 교체(건전지·전구)'),('설비','급배수','도기(변기·세면대) 파손·누수'),('설비','급배수','샤워기'),('설비','급배수','수전류'),
  ('마감재','문·창호','문 경첩·손잡이'),('설비','환기','후드 모터 불량'),('가구·가전','수납가구','싱크대 파손'),('가구·가전','생활가전','소모품 교체'),
  ('가구·가전','생활가전','TV 불량'),('마감재','문·창호','방충망 찢김'),('마감재','문·창호','창호 결로·노후'),('마감재','문·창호','창호 잠금장치'),
  ('설비','냉난방','필터 청소'),('가구·가전','생활가전','가스렌지 불량')
);
