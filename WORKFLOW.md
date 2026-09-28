# WORKFLOW.md — 업무 흐름
## 회원
회원가입 → 관리자 승인 → 로그인 → 권한에 따른 기능 사용.

## 사진
현장 연결 → 작업정보 입력 → 카메라/갤러리 → 이미지 처리 → IndexedDB 백업 → Supabase 업로드 → 성공 확인 → 성공한 대기 데이터 정리.

## 현장 전환/폐쇄
이전 현장의 사용자·작업분류·구역(custom_categories_by_menu/custom_areas/default_area) 상태가 새 현장에 남지 않도록 검증한다.

## 관리자
관리자 로그인 → 회원/현장/작업분류/구역 → 사진 조회/공유.

## PWA/Android
Service Worker 업데이트와 WebView의 모달 뒤로가기, 외부 링크, 새 창 요청을 회귀 테스트한다.
