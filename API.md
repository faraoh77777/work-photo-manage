# API.md — API 및 브라우저 기능
## Supabase
Auth, Database, Storage, RLS.

## Browser
MediaDevices/Camera, File/Blob, Canvas, IndexedDB, localStorage, Service Worker/Cache, 필요 시 Speech API.

## Android
React Native WebView, BackHandler, Linking, onMessage/onOpenWindow.

## 외부 라이브러리
실제 HTML/package 파일에서 사용하는 Supabase JS, piexifjs, jsPDF, html2canvas 및 React Native 의존성을 기준으로 관리한다.

## 변경 원칙
DB/RLS/API 변경 전 호출부와 데이터 흐름을 검색한다. 변경 후 로그인/촬영/저장/전송/관리자/앱 흐름을 회귀 테스트한다.
