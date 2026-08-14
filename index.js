import { registerRootComponent } from 'expo';

import App from './App';

// package.json의 main이 이 파일을 가리킨다.
// 커스텀 엔트리에서는 export default만으로 루트 컴포넌트가 등록되지 않고,
// registerRootComponent를 직접 불러야 한다. 이게 없으면 프로덕션 번들에
// AppRegistry 등록이 하나도 들어가지 않아 앱이 빈 화면으로 뜬다.
registerRootComponent(App);
