import { useEffect, useRef } from 'react';
import { WebView } from 'react-native-webview';
import {
  SafeAreaView,
  StyleSheet,
  StatusBar,
  Platform,
  PermissionsAndroid,
  BackHandler,
} from 'react-native';

// shaheen-photo 저장소는 구버전 페이지만 있고 푸시 권한이 없어 갱신할 수 없다.
// work-photo-manage가 현재 index.html과 동일한 내용을 이미 서빙 중이라 이쪽을 쓴다.
const SITE_URL = 'https://faraoh77777.github.io/work-photo-manage/';

export default function App() {
  const webRef = useRef(null);
  const canGoBack = useRef(false);

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
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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
        mediaCapturePermissionGrantType="grant"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        allowFileAccess={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onNavigationStateChange={(nav) => { canGoBack.current = nav.canGoBack; }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:'#1E3A5F' },
  webview:   { flex:1, backgroundColor:'#1E3A5F' },
});
