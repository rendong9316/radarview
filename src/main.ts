import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// 禁用浏览器原生右键菜单，保持桌面应用原生感
document.addEventListener('contextmenu', (e) => e.preventDefault())

createApp(App).mount('#app')
