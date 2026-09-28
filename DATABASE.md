# DATABASE.md — 데이터 및 저장 구조
## 저장 계층
- localStorage: 설정/가벼운 상태
- IndexedDB: 사진 및 전송 대기 데이터
- Supabase Database: 사용자/현장/작업 메타데이터
- Supabase Storage: 이미지 파일

## 논리 데이터
User/Member, Site, Work Category, Work Area, Photo, Upload/Processing Status.

## 무결성
서버 성공 전 로컬 원본 삭제 금지. 실패 업로드 재시도. 현장/사용자 권한 기준 접근.
실제 Supabase 스키마와 RLS가 이 문서보다 우선한다.

## 보안
Service Role Key 등 비밀키 금지, RLS 검증, 민감정보 캐시 금지, 사용자 입력 검증.
