<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="dialog-box">
        <h2 class="dialog-title">使用文档</h2>

        <div class="doc-body">
          <!-- 一、界面布局 -->
          <div class="doc-section">
            <h3 class="section-title">一、界面布局</h3>
            <table class="doc-table">
              <thead>
                <tr><th>区域</th><th>位置</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>标题栏</td><td>顶部</td><td>菜单栏 + 窗口控制（最小化 / 最大化 / 关闭）</td></tr>
                <tr><td>活动栏</td><td>最左侧竖条</td><td>48px 图标栏，切换右侧面板</td></tr>
                <tr><td>侧边栏</td><td>活动栏右侧</td><td>显示当前面板内容，可拖拽调整宽度</td></tr>
                <tr><td>地图区</td><td>中央</td><td>Cesium 3D 地球，核心显示区域</td></tr>
                <tr><td>状态栏</td><td>底部</td><td>回放控制 + 进度条 + 数据源 + 航迹统计</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 二、数据导入 -->
          <div class="doc-section">
            <h3 class="section-title">二、数据导入</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单栏 → 文件 → 导入 ADS-B 数据</td><td><kbd>Ctrl+O</kbd></td></tr>
                <tr><td>菜单栏 → 文件 → 导入雷达数据</td><td><kbd>Ctrl+Shift+O</kbd></td></tr>
                <tr><td>菜单栏 → 文件 → 导入雷达原始测量数据</td><td>无快捷键</td></tr>
                <tr><td>拖拽文件到地图区域</td><td>直接拖入</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 三、侧边面板 -->
          <div class="doc-section">
            <h3 class="section-title">三、侧边面板（活动栏切换）</h3>
            <table class="doc-table">
              <thead>
                <tr><th>面板</th><th>图标</th><th>快捷键</th><th>功能</th></tr>
              </thead>
              <tbody>
                <tr><td>轨迹面板</td><td>📋</td><td><kbd>Ctrl+Shift+T</kbd></td><td>搜索 / 查看轨迹、隔离单独显示</td></tr>
                <tr><td>航迹管理</td><td>📊</td><td><kbd>Ctrl+Shift+M</kbd></td><td>数据库统计、筛选、分页、批量显隐 / 删除 / 导出</td></tr>
                <tr><td>图层控制</td><td>🗺</td><td><kbd>Ctrl+Shift+L</kbd></td><td>按数据源（ADS-B / Radar / Raw）开关可见性</td></tr>
                <tr><td>旗标面板</td><td>🏴</td><td><kbd>Ctrl+Shift+F</kbd></td><td>手动输入坐标放置、测距、重命名、删除</td></tr>
                <tr><td>时间筛选</td><td>⏱</td><td><kbd>Ctrl+Shift+E</kbd></td><td>时间范围过滤 + 航迹点数量筛选</td></tr>
                <tr><td>设置</td><td>⚙</td><td><kbd>Ctrl+,</kbd></td><td>线条颜色 / 线宽 / 圆球 / 旗标 / 字号调节 + 工具快捷入口</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 四、地图操作 -->
          <div class="doc-section">
            <h3 class="section-title">四、地图操作</h3>
            <table class="doc-table">
              <thead>
                <tr><th>操作</th><th>效果</th></tr>
              </thead>
              <tbody>
                <tr><td>左键点击航迹</td><td>选中并隔离该航迹（地图只显示它）</td></tr>
                <tr><td>左键点击空白</td><td>清除选中，恢复显示全部</td></tr>
                <tr><td>双击空地</td><td>放置旗标（红色图钉）</td></tr>
                <tr><td>双击已有旗标</td><td>删除该旗标</td></tr>
                <tr><td>鼠标滚轮</td><td>缩放地图</td></tr>
                <tr><td>鼠标拖拽</td><td>旋转 / 平移视角</td></tr>
                <tr><td>右上角「← 返回全部」按钮</td><td>退出隔离模式</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 五、航迹回放 -->
          <div class="doc-section">
            <h3 class="section-title">五、航迹回放（底部状态栏）</h3>
            <table class="doc-table">
              <thead>
                <tr><th>控件</th><th>操作</th></tr>
              </thead>
              <tbody>
                <tr><td>▶ / ⏸ 按钮</td><td>播放 / 暂停</td></tr>
                <tr><td>进度条</td><td>点击跳转、拖拽滑块定位</td></tr>
                <tr><td>倍速按钮</td><td>1x / 2x / 4x / 8x / 16x</td></tr>
                <tr><td>自定义倍速输入框</td><td>输入数值后回车生效</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 六、批量数据管理 -->
          <div class="doc-section">
            <h3 class="section-title">六、批量数据管理</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单 → 工具 → 批量数据管理</td><td>地图右上角弹出批次列表</td></tr>
                <tr><td>设置面板 → 💾 数据管理</td><td>同上</td></tr>
                <tr><td>点击批次行</td><td>加载该批次数据到地图</td></tr>
                <tr><td>点击 × 按钮</td><td>从数据库删除该批次（不可撤销）</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 七、数据源控制 -->
          <div class="doc-section">
            <h3 class="section-title">七、数据源控制</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>状态栏底部 ADS-B / Radar / Raw 标签</td><td>点击切换该数据源全局可见性</td></tr>
                <tr><td>图层控制面板</td><td>同上，带开关滑块</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 八、外观 -->
          <div class="doc-section">
            <h3 class="section-title">八、外观设置</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>选项</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单 → 视图 → 外观</td><td>暗色 / 亮色 / 高对比度</td></tr>
                <tr><td>状态栏最右侧主题按钮</td><td>循环切换三种主题</td></tr>
              </tbody>
            </table>
            <p class="doc-para">以下视觉参数可在 <b>设置面板</b>（⚙）中调节，所有修改自动记忆：</p>
            <table class="doc-table">
              <thead>
                <tr><th>参数</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>线条颜色</td><td>按 ADS-B / Radar / Raw 分别自定义轨迹线条和圆点颜色，点 ↺ 可恢复主题默认色</td></tr>
                <tr><td>线宽</td><td>按数据源调节轨迹线粗细（0.5–8 px）</td></tr>
                <tr><td>圆球直径</td><td>按数据源调节航迹点图标大小（0.2–3.0 倍）</td></tr>
                <tr><td>旗标大小</td><td>调节地图上旗标图标和文字的缩放比例</td></tr>
                <tr><td>字号大小</td><td>调节应用全局字体大小（10–20 px）</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 九、其他快捷键 -->
          <div class="doc-section">
            <h3 class="section-title">九、其他快捷键</h3>
            <table class="doc-table">
              <thead>
                <tr><th>快捷键</th><th>功能</th></tr>
              </thead>
              <tbody>
                <tr><td><kbd>Ctrl+R</kbd></td><td>重置地图视角</td></tr>
                <tr><td><kbd>Ctrl+T</kbd></td><td>切换航迹标签显示 / 隐藏</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>清除选中 / 退出隔离</td></tr>
                <tr><td><kbd>F12</kbd></td><td>开发工具（仅开发模式）</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <button class="dialog-btn" @click="$emit('close')">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineEmits<{ close: [] }>()
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-box {
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: 6px;
  padding: 24px 32px;
  width: 600px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-title {
  font-size: 1.143rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
  text-align: center;
  flex-shrink: 0;
}

.doc-body {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
}

.doc-section {
  margin-bottom: 14px;
}

.section-title {
  font-size: 0.929rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-secondary);
}

.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.786rem;
}

.doc-table th {
  text-align: left;
  padding: 3px 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 0.714rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border-primary);
}

.doc-table td {
  padding: 3px 8px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-secondary);
  vertical-align: top;
}

.doc-table tr:last-child td {
  border-bottom: none;
}

.doc-para {
  font-size: 0.786rem;
  color: var(--text-secondary);
  margin: 10px 0 6px;
}

.doc-table kbd {
  display: inline-block;
  padding: 1px 5px;
  font-size: 0.714rem;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-primary);
  border-radius: 3px;
  color: var(--text-primary);
  white-space: nowrap;
}

.dialog-btn {
  display: block;
  margin: 16px auto 0;
  padding: 6px 24px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: 3px;
  font-size: 0.929rem;
  cursor: pointer;
  flex-shrink: 0;
}
.dialog-btn:hover {
  opacity: 0.9;
}

/* scrollbar */
.doc-body::-webkit-scrollbar {
  width: 6px;
}
.doc-body::-webkit-scrollbar-track {
  background: transparent;
}
.doc-body::-webkit-scrollbar-thumb {
  background: var(--border-primary);
  border-radius: 3px;
}
</style>
