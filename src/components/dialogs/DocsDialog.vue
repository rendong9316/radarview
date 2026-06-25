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
                <tr><td>标题栏</td><td>顶部</td><td>菜单栏（文件 / 编辑 / 视图 / 工具 / 帮助） + 窗口控制按钮</td></tr>
                <tr><td>活动栏</td><td>最左侧竖条</td><td>48px 图标栏，点击切换右侧面板；再次点击当前图标可关闭面板</td></tr>
                <tr><td>侧边栏</td><td>活动栏右侧</td><td>显示当前面板内容，可拖拽右侧边缘调整宽度（200–900px）</td></tr>
                <tr><td>地图区</td><td>中央</td><td>Cesium 3D 地球，核心显示区域，支持拖拽文件导入</td></tr>
                <tr><td>状态栏</td><td>底部</td><td>回放控制 + 进度条 + 时间显示 + 倍速 + 相机高度 / 经纬度 / FPS + 数据源统计 + 主题切换</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 二、数据导入 -->
          <div class="doc-section">
            <h3 class="section-title">二、数据导入</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>操作</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单栏 → 文件 → 导入 ADS-B 数据</td><td><kbd>Ctrl+O</kbd></td><td>选择 CSV 文件导入 ADS-B 航迹</td></tr>
                <tr><td>菜单栏 → 文件 → 导入雷达数据</td><td><kbd>Ctrl+Shift+O</kbd></td><td>选择 MAT 文件导入雷达航迹</td></tr>
                <tr><td>菜单栏 → 文件 → 导入雷达原始测量数据</td><td>无快捷键</td><td>导入雷达原始测量数据（点迹）</td></tr>
                <tr><td>拖拽文件到地图区域</td><td>直接拖入</td><td>自动识别文件类型并导入；拖入时地图显示虚线边框提示</td></tr>
              </tbody>
            </table>
            <p class="doc-para">导入时状态栏显示进度百分比；导入完成后数据自动在后台保存到 SQLite 数据库。同键航迹（ICAO + 数据源）再次导入时自动合并新时间点。</p>
          </div>

          <!-- 三、侧边面板 -->
          <div class="doc-section">
            <h3 class="section-title">三、侧边面板（活动栏切换）</h3>
            <table class="doc-table">
              <thead>
                <tr><th>面板</th><th>快捷键</th><th>功能概览</th></tr>
              </thead>
              <tbody>
                <tr><td>轨迹面板</td><td><kbd>Ctrl+Shift+T</kbd></td><td>搜索 ICAO/航班号/注册号/机型/航司/航线；查看轨迹详情（航线、接收站、数据源）；点击隔离单独显示</td></tr>
                <tr><td>航迹管理</td><td><kbd>Ctrl+Shift+M</kbd></td><td>数据库统计概览；多条件筛选（来源/航司/机型/批次/点数/时间）；分页浏览；批量显隐/删除/导出；列排序</td></tr>
                <tr><td>图层控制</td><td><kbd>Ctrl+Shift+L</kbd></td><td>按数据源（ADS-B / Radar / Raw）独立开关可见性；城市标注开关</td></tr>
                <tr><td>旗标面板</td><td><kbd>Ctrl+Shift+F</kbd></td><td>手动输入经纬度放置旗标；列表管理（重命名/删除）；多选旗标自动测距 + 方位角</td></tr>
                <tr><td>时间筛选</td><td><kbd>Ctrl+Shift+E</kbd></td><td>时间范围过滤（datetime-local 选择器）；航迹点数量范围筛选（按数据源独立设置最小/最大值）</td></tr>
                <tr><td>设置</td><td><kbd>Ctrl+,</kbd></td><td>线条颜色 / 线宽 / 行政边界 / 城市标注 / 瓦片来源 / 圆球直径 / 旗标大小 / 字号 / 点迹显示 / 点迹颜色 / 工具入口</td></tr>
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
                <tr><td>鼠标滚轮</td><td>缩放地图（拉近/拉远视角）</td></tr>
                <tr><td>鼠标左键拖拽</td><td>旋转 / 平移地球视角</td></tr>
                <tr><td>左键点击航迹</td><td>选中并隔离该航迹（地图仅显示该航迹，顶部出现「← 返回全部」按钮）</td></tr>
                <tr><td>左键点击空白</td><td>清除选中，恢复显示全部航迹</td></tr>
                <tr><td>双击空地</td><td>放置旗标（默认图钉样式，自动命名）</td></tr>
                <tr><td>双击已有旗标</td><td>删除该旗标</td></tr>
                <tr><td>右上角「← 返回全部」按钮</td><td>退出隔离模式，恢复显示全部</td></tr>
                <tr><td><kbd>Esc</kbd> 键</td><td>退出隔离模式 / 退出套索绘制 / 退出标尺模式</td></tr>
                <tr><td><kbd>Ctrl+R</kbd></td><td>重置地图视角到默认位置</td></tr>
                <tr><td><kbd>Ctrl+T</kbd></td><td>切换航迹标签（ICAO/航班号）显示 / 隐藏</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">空间套索（<kbd>Ctrl+Shift+S</kbd>）</p>
            <table class="doc-table">
              <thead>
                <tr><th>操作</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>启用套索</td><td>筛选面板点击「启用套索」或按 <kbd>Ctrl+Shift+S</kbd></td></tr>
                <tr><td>顶点模式</td><td>单击地图依次放置顶点，双击最后一个顶点闭合多边形</td></tr>
                <tr><td>自由绘制模式</td><td>按住左键拖动绘制连续曲线，松手自动闭合；绘制时相机锁定不旋转</td></tr>
                <tr><td>拖拽顶点</td><td>闭合后左键按住顶点圆圈拖动，实时更新坐标、边长、面积</td></tr>
                <tr><td>应用空间筛选</td><td>点击「应用空间筛选」按钮，地图仅显示多边形内的航迹片段</td></tr>
                <tr><td>重新绘制</td><td>清除当前多边形并重新进入绘制模式</td></tr>
                <tr><td>清除空间筛选</td><td>移除空间筛选条件，恢复显示全部航迹（多边形仍保留）</td></tr>
                <tr><td>取消绘制</td><td>绘制中途点击「取消绘制」或按 <kbd>Esc</kbd> 放弃当前多边形</td></tr>
                <tr><td>顶点圆圈大小</td><td>筛选面板滑块调节顶点圆圈直径（2–18 px），实时生效</td></tr>
                <tr><td>区域信息</td><td>闭合后显示周长、面积、顶点坐标表、各边长</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">航线标尺（<kbd>Ctrl+Shift+R</kbd>）</p>
            <table class="doc-table">
              <thead>
                <tr><th>操作</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>启用标尺</td><td>按 <kbd>Ctrl+Shift+R</kbd> 进入标尺模式</td></tr>
                <tr><td>放置航点</td><td>单击地图依次放置航点，每个航点显示序号标签</td></tr>
                <tr><td>测距显示</td><td>相邻航点之间实时显示大地线距离；悬停线段高亮显示精确数值</td></tr>
                <tr><td>拖拽航点</td><td>左键按住航点拖动，距离实时更新</td></tr>
                <tr><td>删除航点</td><td>右键航点删除</td></tr>
                <tr><td>清除全部</td><td>点击标尺面板「清除」或再次按 <kbd>Ctrl+Shift+R</kbd></td></tr>
                <tr><td>退出标尺</td><td>按 <kbd>Esc</kbd> 退出标尺模式，标尺线保留</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">右键上下文菜单</p>
            <table class="doc-table">
              <thead>
                <tr><th>右键对象</th><th>菜单项</th></tr>
              </thead>
              <tbody>
                <tr><td>旗标</td><td>重命名 / 切换样式（图钉、标准旗、三角旗、方旗、菱形、圆形） / 删除</td></tr>
                <tr><td>航迹（高亮悬停状态）</td><td>显示所有对应点迹 / 隐藏所有对应点迹 / 详细信息 / 查看点迹数据 / 删除该航迹</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 五、航迹回放 -->
          <div class="doc-section">
            <h3 class="section-title">五、航迹回放（底部状态栏）</h3>
            <table class="doc-table">
              <thead>
                <tr><th>控件</th><th>操作说明</th></tr>
              </thead>
              <tbody>
                <tr><td>播放 / 暂停 按钮</td><td>点击开始/暂停回放；无数据时禁用</td></tr>
                <tr><td>进度条</td><td>显示当前回放位置；点击跳转、拖拽圆形滑块定位；悬停时滑块显示</td></tr>
                <tr><td>时间显示</td><td>格式「当前时间 / 总时长」，精确到秒</td></tr>
                <tr><td>倍速下拉框</td><td>1x / 2x / 4x / 8x / 16x 预设倍速；选择「自定义...」出现数字输入框</td></tr>
                <tr><td>自定义倍速输入框</td><td>输入任意正整数后回车生效</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 六、航迹管理系统 -->
          <div class="doc-section">
            <h3 class="section-title">六、航迹管理系统（侧边栏 → 航迹管理）</h3>
            <table class="doc-table">
              <thead>
                <tr><th>功能区域</th><th>操作说明</th></tr>
              </thead>
              <tbody>
                <tr><td>统计栏</td><td>显示总计航迹数、各数据源数量、唯一 ICAO 数、时间范围、批次数、地图可见数</td></tr>
                <tr><td>搜索框</td><td>全文搜索 ICAO / 航班号 / 注册号 / 机型 / 航司 / 起降地（300ms 防抖）</td></tr>
                <tr><td>筛选下拉框</td><td>按来源（全部/ADS-B/雷达/原始）、航司、机型、批次过滤</td></tr>
                <tr><td>点数筛选</td><td>设置航迹点数的最小值/最大值范围</td></tr>
                <tr><td>快捷筛选按钮</td><td>「24h内」：近24小时；「≥100点」：点数不少于100；「重置全部」：清除所有筛选</td></tr>
                <tr><td>列排序</td><td>点击表头 ICAO / 航班号 / 注册号 / 机型 / 航司 / 点数 / 时间 列进行排序</td></tr>
                <tr><td>眼睛图标</td><td>点击切换该航迹在地图上的可见性；可见行高亮显示</td></tr>
                <tr><td>删除按钮</td><td>软删除单条航迹（可撤销），支持撤销提示</td></tr>
                <tr><td>右键行</td><td>查看点迹数据 / 删除该航迹</td></tr>
                <tr><td>工具栏 — 本页全显</td><td>将当前页所有航迹设为地图可见</td></tr>
                <tr><td>工具栏 — 清空地图</td><td>清除所有航迹的地图可见性（不删除数据）</td></tr>
                <tr><td>工具栏 — 删可见</td><td>批量软删除所有地图可见的航迹（需确认，带撤销提示）</td></tr>
                <tr><td>工具栏 — 导出</td><td>导出当前可见航迹数据</td></tr>
                <tr><td>工具栏 — 刷新</td><td>重新加载数据库统计和元数据</td></tr>
                <tr><td>分页控件</td><td>底部页码切换，支持调整每页条数</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 七、旗标操作 -->
          <div class="doc-section">
            <h3 class="section-title">七、旗标操作</h3>
            <table class="doc-table">
              <thead>
                <tr><th>操作</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>双击地图空地</td><td>放置旗标，默认图钉样式，自动命名</td></tr>
                <tr><td>手动输入坐标放置</td><td>旗标面板输入纬度（-90~90）和经度（-180~180），点击「放置旗标」</td></tr>
                <tr><td>点击旗标标签</td><td>进入重命名编辑模式，回车或失焦确认，Esc 取消</td></tr>
                <tr><td>右键旗标 → 重命名</td><td>同点击标签重命名</td></tr>
                <tr><td>右键旗标 → 切换样式</td><td>六种样式可选：图钉 / 标准旗 / 三角旗 / 方旗 / 菱形 / 圆形</td></tr>
                <tr><td>删除单个旗标</td><td>双击旗标，或旗标面板点 X，或右键 → 删除</td></tr>
                <tr><td>测距功能</td><td>旗标面板勾选两个旗标复选框，自动显示距离（km）和方位角</td></tr>
                <tr><td>清除全部旗标</td><td>旗标面板「清除全部旗标」按钮，或菜单 工具 → 清除所有旗标（需确认）</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 八、筛选面板 -->
          <div class="doc-section">
            <h3 class="section-title">八、筛选面板（侧边栏 → 筛选 <kbd>Ctrl+Shift+E</kbd>）</h3>
            <p class="doc-para">筛选面板集成三种独立的筛选方式，可自由组合使用。每种筛选激活时各自显示独立的绿色指示灯。</p>

            <p class="doc-para doc-subtitle">时间筛选</p>
            <table class="doc-table">
              <thead>
                <tr><th>功能</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>时间范围过滤</td><td>设置起止时间，点击「应用过滤」；过滤后仅显示该时段内有位置的航迹点</td></tr>
                <tr><td>清除时间过滤</td><td>点击「清除」恢复显示全部时间范围</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">点数筛选</p>
            <table class="doc-table">
              <thead>
                <tr><th>功能</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>按数据源独立设置</td><td>ADS-B / Radar / Raw 各自独立开关，设置最小/最大点数范围</td></tr>
                <tr><td>与时间筛选独立</td><td>点数筛选始终基于航迹总点数，不受时间窗口影响</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">空间套索</p>
            <table class="doc-table">
              <thead>
                <tr><th>功能</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>绘制多边形</td><td>顶点模式（单击放置）或自由绘制模式（按住拖动）在地图上圈出区域</td></tr>
                <tr><td>应用空间筛选</td><td>闭合后点击「应用空间筛选」，地图仅显示多边形内的航迹片段</td></tr>
                <tr><td>区域信息</td><td>自动计算并显示周长、面积、各顶点坐标、各边长</td></tr>
                <tr><td>筛选交集</td><td>时间、点数、空间三种筛选取交集，互不干扰</td></tr>
                <tr><td>跨会话记忆</td><td>套索形状和筛选状态自动持久化，重启软件后自动恢复</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 九、批量数据管理 -->
          <div class="doc-section">
            <h3 class="section-title">九、批量数据管理</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单 → 工具 → 批量数据管理</td><td>地图右上角弹出批次列表悬浮窗</td></tr>
                <tr><td>设置面板 → 工具 → 数据管理</td><td>同上（显示已保存批次数量的角标）</td></tr>
                <tr><td>点击批次行</td><td>加载该批次数据到地图（与已有数据合并）</td></tr>
                <tr><td>点击 X 删除按钮</td><td>从数据库删除该批次及所有关联航迹（需确认，不可撤销）</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 十、数据源控制 -->
          <div class="doc-section">
            <h3 class="section-title">十、数据源控制</h3>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>状态栏底部 ADS-B / Radar / Raw 标签</td><td>点击切换该数据源全局可见性；圆点灰色表示隐藏</td></tr>
                <tr><td>图层控制面板</td><td>同上，带开关滑块；同时控制城市标注层的显示</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 十一、外观设置 -->
          <div class="doc-section">
            <h3 class="section-title">十一、外观设置（设置面板）</h3>
            <p class="doc-para">以下参数可在 <b>设置面板</b> 中分组调节，所有修改自动记忆。点击分组标题可折叠/展开。</p>
            <table class="doc-table">
              <thead>
                <tr><th>分组</th><th>参数</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>线条颜色</td><td>ADS-B / Radar / Raw</td><td>各自定义轨迹线条颜色（取色器）；点恢复按钮恢复主题默认色</td></tr>
                <tr><td>线宽调节</td><td>ADS-B / Radar / Raw</td><td>各自调节轨迹线粗细（0.5–8 px）滑块</td></tr>
                <tr><td>行政边界</td><td>国界 / 海岸 / 省界</td><td>独立开关可见性；独立调节线宽（0.2–5.0）和颜色（取色器）</td></tr>
                <tr><td>城市标注</td><td>图层 / 中文标签 / 各级别 / 人口</td><td>整体开关；中文标签开关；首都/省会/地级市/主要城市四级独立开关；最小人口阈值滑块；圆点大小(2–12px)；标签字号(9–24px)；圆点/标签颜色；高级：各等级显示高度阈值</td></tr>
                <tr><td>瓦片来源</td><td>地图源下拉框</td><td>切换当前使用的 MBTiles 离线地图源</td></tr>
                <tr><td>圆球直径</td><td>ADS-B / Radar / Raw</td><td>各自调节航迹点图标大小（0.2–3.0 倍）滑块</td></tr>
                <tr><td>旗标大小</td><td>图标&文字</td><td>调节地图上旗标图标和文字的缩放比例（0.5–3.0）</td></tr>
                <tr><td>字号大小</td><td>应用字号</td><td>调节应用全局字体大小（10–20 px）滑块</td></tr>
                <tr><td>点迹显示</td><td>全局显示 / 圆球大小</td><td>开关所有航迹点的圆点渲染；调节点迹圆球大小（0.2–5.0）；「清空所有点迹」按钮</td></tr>
                <tr><td>点迹颜色</td><td>ADS-B / Radar / Raw</td><td>各自定义点迹圆球颜色（取色器）；点恢复按钮恢复自动对比色</td></tr>
              </tbody>
            </table>

            <p class="doc-para doc-subtitle">主题切换</p>
            <table class="doc-table">
              <thead>
                <tr><th>入口</th><th>选项</th></tr>
              </thead>
              <tbody>
                <tr><td>菜单 → 视图 → 外观</td><td>暗色 / 亮色 / 高对比度</td></tr>
                <tr><td>状态栏最右侧主题按钮</td><td>循环切换三种主题（暗色 / 亮色 / 高对比度）</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 十二、状态栏信息 -->
          <div class="doc-section">
            <h3 class="section-title">十二、状态栏信息</h3>
            <table class="doc-table">
              <thead>
                <tr><th>显示项</th><th>说明</th></tr>
              </thead>
              <tbody>
                <tr><td>导入进度</td><td>导入文件时显示旋转动画 + 百分比；保存中显示「保存中」</td></tr>
                <tr><td>错误提示</td><td>红色警告图标 + 错误消息，8 秒后自动消失</td></tr>
                <tr><td>相机高度</td><td>当前视角距地面高度（单位 km），实时更新</td></tr>
                <tr><td>经纬度</td><td>鼠标所在位置经纬度（精度 4 位小数），实时更新</td></tr>
                <tr><td>FPS</td><td>渲染帧率，实时更新；无数据时显示「--」</td></tr>
                <tr><td>数据源统计</td><td>ADS-B: N / Radar: N / Raw: N，点击切换可见性</td></tr>
                <tr><td>航迹总数</td><td>当前加载的航迹总数</td></tr>
              </tbody>
            </table>
          </div>

          <!-- 十三、键盘快捷键 -->
          <div class="doc-section">
            <h3 class="section-title">十三、键盘快捷键</h3>
            <table class="doc-table">
              <thead>
                <tr><th>快捷键</th><th>功能</th></tr>
              </thead>
              <tbody>
                <tr><td><kbd>Ctrl+O</kbd></td><td>导入 ADS-B 数据</td></tr>
                <tr><td><kbd>Ctrl+Shift+O</kbd></td><td>导入雷达数据</td></tr>
                <tr><td><kbd>Ctrl+R</kbd></td><td>重置地图视角</td></tr>
                <tr><td><kbd>Ctrl+T</kbd></td><td>切换航迹标签显示 / 隐藏</td></tr>
                <tr><td><kbd>Ctrl+,</kbd></td><td>打开设置面板</td></tr>
                <tr><td><kbd>Ctrl+Shift+T</kbd></td><td>打开轨迹面板</td></tr>
                <tr><td><kbd>Ctrl+Shift+M</kbd></td><td>打开航迹管理系统</td></tr>
                <tr><td><kbd>Ctrl+Shift+L</kbd></td><td>打开图层控制</td></tr>
                <tr><td><kbd>Ctrl+Shift+F</kbd></td><td>打开旗标面板</td></tr>
                <tr><td><kbd>Ctrl+Shift+E</kbd></td><td>打开筛选面板</td></tr>
                <tr><td><kbd>Ctrl+Shift+S</kbd></td><td>切换空间套索</td></tr>
                <tr><td><kbd>Ctrl+Shift+R</kbd></td><td>切换航线标尺</td></tr>
                <tr><td><kbd>Esc</kbd></td><td>退出隔离 / 退出套索绘制 / 退出标尺模式 / 清除选中</td></tr>
                <tr><td><kbd>F12</kbd></td><td>开发工具（仅开发模式）</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <button class="dialog-btn" @click="$emit('close')" title="关闭使用文档">关闭</button>
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
  border-radius: 4px;
  padding: 24px 32px;
  width: 680px;
  max-width: 92vw;
  max-height: 88vh;
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

.doc-subtitle {
  font-weight: 600;
  color: var(--text-primary);
  margin: 12px 0 6px;
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
