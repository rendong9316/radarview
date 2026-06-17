// ============================================================
// workers/index.ts - Worker 统一导出
// ============================================================

// 直接导出 Worker 构造函数
export { default as ReplayWorker } from './replay.worker?worker'

// 或者使用 Vite 的 ?worker 导入方式
// 在 Vue 组件中：
// import ReplayWorker from './workers/replay.worker?worker'