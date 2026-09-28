import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import {
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Platform,
  PermissionsAndroid,
  BackHandler,
  Linking,
} from 'react-native';

// shaheen-photo 저장소는 구버전 페이지만 있고 푸시 권한이 없어 갱신할 수 없다.
// work-photo-manage가 현재 index.html과 동일한 내용을 이미 서빙 중이라 이쪽을 쓴다.
const SITE_URL = 'https://faraoh77777.github.io/work-photo-manage/';

export default function App() {
  const webRef = useRef(null);
  const canGoBack = useRef(false);
  const modalOpen = useRef(false);

  // 촬영 영역을 누르면 <input type="file" capture="environment">가 열리고,
  // 안드로이드는 이때 ACTION_IMAGE_CAPTURE 인텐트를 띄운다.
  // CAMERA를 매니페스트에 선언한 앱은 이 권한이 런타임에 승인돼 있지 않으면
  // 인텐트가 조용히 실패해서 아무 반응이 없다(원스토어 반려 사유).
  // 그래서 앱을 열자마자 한 번 요청해 둔다.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).catch(() => {});
  }, []);

  // 하드웨어 뒤로가기로 앱이 바로 종료되지 않고 웹 히스토리를 따라가게 한다.
  // 카메라 촬영 모달·개인정보처리방침 모달은 실제 페이지 이동이 아니라 화면 안 오버레이라
  // canGoBack에 안 잡힌다 — 그대로면 뒤로가기 한 번에 모달이 안 닫히고 앱이 바로 꺼졌다.
  // index.html/login.html이 모달을 열고 닫을 때마다 postMessage('modal:open'/'modal:close')로
  // 알려주면 그 상태를 modalOpen에 저장해뒀다가, 뒤로가기가 눌리면 모달부터 닫게 한다.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (modalOpen.current && webRef.current) {
        webRef.current.injectJavaScript(
          "window.__closeTopOverlay && window.__closeTopOverlay(); true;"
        );
        return true;
      }
      if (canGoBack.current && webRef.current) {
        webRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor="#1E3A5F" barStyle="light-content"/>
      <WebView
        ref={webRef}
        source={{ uri: SITE_URL }}
        style={styles.webview}
        allowsInlineMediaPlayback={true}
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onNavigationStateChange={(nav) => {
          canGoBack.current = nav.canGoBack;
          // 새 페이지로 이동하면 이전 페이지의 모달은 더 이상 존재하지 않으므로 초기화.
          modalOpen.current = false;
        }}
        onMessage={(event) => {
          const data = event.nativeEvent.data;
          if (data === 'modal:open') modalOpen.current = true;
          else if (data === 'modal:close') modalOpen.current = false;
        }}
        // 아래 두 핸들러는 짝을 이룬다: target="_blank"/window.open()은 이 WebView가
        // 새 창을 만들지 않아 예전엔 탭해도 반응이 없었다(원스토어 반려 사유와 같은 패턴).
        // onOpenWindow로 그 요청을 가로채 같은 사이트(faraoh77777.github.io)면 현재
        // 화면에서 그대로 이동시키고, supabase.com 같은 진짜 외부 링크는 시스템
        // 브라우저로 열어준다. onShouldStartLoadWithRequest는 target="_blank" 없이
        // 바로 걸린 외부 링크(있다면)까지 같은 규칙으로 잡아준다(2026-09-28).
        onOpenWindow={(event) => {
          const url = event.nativeEvent.targetUrl;
          if (!url) return;
          try {
            if (new URL(url).hostname !== new URL(SITE_URL).hostname) {
              Linking.openURL(url).catch(() => {});
              return;
            }
          } catch (e) {}
          webRef.current && webRef.current.injectJavaScript(
            `location.href=${JSON.stringify(url)}; true;`
          );
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (!/^https?:\/\//i.test(req.url)) return true;
          try {
            if (new URL(req.url).hostname !== new URL(SITE_URL).hostname) {
              Linking.openURL(req.url).catch(() => {});
              return false;
            }
          } catch (e) {}
          return true;
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:'#1E3A5F' },
  webview:   { flex:1, backgroundColor:'#1E3A5F' },
});
