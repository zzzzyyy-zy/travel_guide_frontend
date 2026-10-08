<template>
  <view class="wrap">
    <!-- ========== 加载中：骨架屏（调研结论：加载态是设计的一部分） ========== -->
    <view v-if="phase === 'loading'">
      <view class="sk-hero">
        <view class="sk-line light" style="width: 30%"></view>
        <view class="sk-line light" style="width: 55%"></view>
      </view>
      <view class="sk-card" v-for="i in 3" :key="i">
        <view class="sk-line" style="width: 35%"></view>
        <view class="sk-line strong" style="width: 60%"></view>
        <view class="sk-line" style="width: 90%"></view>
        <view class="sk-line" style="width: 45%; margin-bottom: 0"></view>
      </view>
      <view class="note sk-tip" v-if="loadingTip">{{ loadingTip }}</view>
    </view>

    <!-- 失败态 -->
    <view v-if="phase === 'failed'">
      <view class="card center-card">
        <image class="big-icon" :src="ICO.alert" mode="aspectFit" />
        <view class="title">加载失败</view>
        <view class="note">{{ errorMsg }}</view>
        <view class="btn" @tap="reload" :class="{ disabled: submitting }">
          {{ submitting ? '加载中…' : '重新加载' }}
        </view>
        <view class="btn ghost" @tap="goHome">返回重新规划</view>
      </view>
    </view>

    <!-- ========== 阶段二：结果展示（结构：接口文档 7.2 result） ========== -->
    <view v-if="phase === 'done' && detail">
      <!-- 示例行程横幅：写死数据只读展示，点击回首页 -->
      <view class="hot-banner" v-if="isHot" @tap="backFromHot"><image class="bn-ico" :src="ICO.book" mode="aspectFit" /><text>示例行程 · 点此回首页创建专属攻略</text></view>
      <!-- 行程头卡：目的地 + 元信息 chips + 预估（调研：总览页先给日期/城市/规模，扫一眼即懂） -->
      <view class="hero">
        <!-- 标题行：城市名居左、操作按钮居右，flex 垂直居中保证同一行 -->
        <view class="hero-top">
          <view class="hero-city">{{ detail.city }}</view>
          <view class="hero-actions" v-if="!isHot">
            <view class="replan-entry" @tap="openReplan"><image class="he-ico" :src="ICO.wand" mode="aspectFit" />AI重排</view>
            <view class="pdf-entry" @tap="exportPdf"><image class="he-ico" :src="pdfBusy ? ICO.loader : ICO.file" mode="aspectFit" />{{ pdfBusy ? '导出中…' : '导出PDF' }}</view>
            <!-- 分享管理仅 owner（2026-09-29 文档）：协作者不给入口，避免点了被 403 -->
            <view class="share-entry" v-if="!isCollaborator" @tap="openShare"><image class="he-ico" :src="ICO.share2" mode="aspectFit" />分享</view>
          </view>
        </view>
        <view class="hero-chips">
          <text class="chip" v-if="startDateLabel">{{ startDateLabel }}</text>
          <text class="chip">{{ detail.days }} 天</text>
          <text class="chip" v-if="detail.peopleCount">{{ detail.peopleCount }} 人</text>
          <text class="chip" v-for="t in transportLabels" :key="t">{{ t }}</text>
        </view>
        <view class="hero-estimate" v-if="budgetInfo.total != null">
          预估 ¥{{ budgetInfo.total }}
          <text class="budget-tag" v-if="budgetInfo.status !== 'unknown'" :class="budgetInfo.status">
            {{ { within: '预算内', over: '已超支' }[budgetInfo.status] }}
          </text>
        </view>
        <view class="hero-overview" v-if="detail.result.overview">{{ detail.result.overview }}</view>
        <view class="hero-diff" v-if="budgetInfo.input != null">
          较你的预算{{ budgetInfo.diff >= 0 ? '少' : '多' }} ¥{{ Math.abs(budgetInfo.diff) }} · 费用为 AI 估算，不含往返大交通
        </view>
      </view>

      <!-- 行程工具条：记账/备忘 进独立页（带 tripId），行李/成员 留在本页、点了滚过去。
           目的：把原来堆在页面里的重功能收进二级页，行程页只保留「看行程」这条主线 -->
      <view class="tool-bar" v-if="!isHot">
        <view class="tool-item" @tap="goExpense">
          <image class="tool-ico" :src="ICO.walletWarm" mode="aspectFit" />
          <text class="tool-txt">记账</text>
        </view>
        <view class="tool-item" @tap="goMemo">
          <image class="tool-ico" :src="ICO.notebookBlue" mode="aspectFit" />
          <text class="tool-txt">备忘</text>
        </view>
        <view class="tool-item" @tap="goPacking">
          <image class="tool-ico" :src="ICO.luggageAmber" mode="aspectFit" />
          <text class="tool-txt">行李</text>
        </view>
        <view class="tool-item" @tap="goNearby">
          <image class="tool-ico" :src="ICO.nearbyTeal" mode="aspectFit" />
          <text class="tool-txt">周边</text>
        </view>
        <view class="tool-item" @tap="scrollToBlock('collab-card')">
          <image class="tool-ico" :src="ICO.usersPurple" mode="aspectFit" />
          <text class="tool-txt">成员</text>
        </view>
      </view>

      <!-- 目的地天气：实况 + 未来 3 天预报（查询失败时后端只回 city，卡片静默隐藏）；
           卡片背景随实时天气类型变化（2026-10-08 用户要求），wxKind 与 wxIcon 同一套关键词口径 -->
      <view class="card wx-card" :class="wxKind(weather.now.text)" v-if="weather && weather.now">
        <view class="wx-head">
          <view class="wx-title"><image class="wx-ico" :src="wxIcon(weather.now.text)" mode="aspectFit" /><text>{{ weather.city }} · 实时天气</text></view>
          <view class="wx-refresh" @tap="loadWeather"><image class="rf-ico" :src="ICO.refresh" mode="aspectFit" /></view>
        </view>
        <view class="wx-now">
          <text class="wx-temp">{{ weather.now.temp }}°</text>
          <view class="wx-now-meta">
            <text class="wx-text">{{ weather.now.text }}</text>
            <text class="wx-sub">体感 {{ weather.now.feelsLike }}° · 湿度 {{ weather.now.humidity }}%</text>
          </view>
        </view>
        <view class="wx-days" v-if="weather.forecast && weather.forecast.length">
          <view class="wx-day" v-for="(f, i) in weather.forecast" :key="i">
            <text class="wx-date">{{ wxDayLabel(f.date, i) }}</text>
            <view class="wx-dtext"><image class="wx-ico" :src="wxIcon(f.text)" mode="aspectFit" /><text>{{ f.text }}</text></view>
            <text class="wx-dtemp">{{ f.tempMin }}~{{ f.tempMax }}°</text>
          </view>
        </view>
      </view>

      <!-- 日子切换：横向滑动胶囊（天数多时可滑，不挤压胶囊） -->
      <scroll-view class="day-tabs" :scroll-x="true" enhanced :show-scrollbar="false">
        <!-- 文档字段是 days[].day，缺省时兜底下标+1；key 用下标防重复 -->
        <view class="day-pill" v-for="(d, idx) in detail.result.days" :key="idx"
          :class="{ active: activeDay === idx }" @tap="switchDay(idx)">
          第{{ d.day || idx + 1 }}天
        </view>
      </scroll-view>

      <!-- 地图：卡片化圆角，marker = 有坐标的景点，polyline = 按当天顺序连线 -->
      <!-- 后端坐标全缺时（7.2 允许个别缺，也可能全缺）整块隐藏，避免展示一个无意义的默认位置地图 -->
      <view class="map-card" v-if="markers.length">
        <map class="map" :latitude="mapCenter.latitude" :longitude="mapCenter.longitude"
          :markers="markers" :polyline="polylines" scale="12" :show-location="false" />
      </view>
      <view class="note warn-note" v-if="dayHasMissingCoord">
        {{ markers.length ? '部分景点缺少坐标，地图仅展示已定位的点位' : '本日景点暂无坐标数据，地图已隐藏' }}
      </view>

      <!-- 当天标题行：主题 + 天级费用（扫读锚点） -->
      <view class="day-head" v-if="currentDay">
        <view class="day-head-l">
          <!-- 点击标题即可编辑（原 ✏️ 图标已删，交互保留） -->
          <text class="day-head-title" @tap="editDayTitle">{{ currentDay.title || '当日行程' }}</text>
        </view>
        <text class="day-cost" v-if="currentDay.estimatedCostCny != null">预估 ¥{{ currentDay.estimatedCostCny }}</text>
        <view class="day-nearby" v-if="!isHot && currentDay.spots && currentDay.spots.length > 1" @tap="openNearby"><image class="dn-ico" :src="ICO.pin" mode="aspectFit" />从我出发</view>
      </view>
      <!-- 当日主题标签：独占一行，位于标题行与景点卡片之间 -->
      <view class="day-theme" v-if="currentDay && currentDay.theme">{{ currentDay.theme }}</view>

      <!-- 时间线：spots + food 合并成一条流；圆点序号与地图 marker 一致（列表↔地图联动） -->
      <view class="timeline" v-if="currentDay">
        <view class="tl-item" v-for="(item, i) in currentItems" :key="i"
          :class="{ 'is-dragging': drag.active && drag.idx === i }" :style="dragStyle(i)">
          <view class="tl-dot" :class="{ 'is-food': item.kind === 'food' }">{{ item.no || '食' }}</view>
          <view class="tl-card" :class="{ 'is-food': item.kind === 'food' }"
          @tap="onCardTap(item, i)">
          <view class="tl-time">
              <image class="tl-ico-img" :src="ICO.cal" mode="aspectFit" />
              <text>{{ item.duration || (item.kind === 'food' ? '用餐时间' : '游玩时间') }}</text>
              <text class="tl-badge" v-if="item.kind === 'food'">美食</text>
              <!-- 拖拽手柄兼可编辑标识：灰色铅笔（✎ 单色字形），贴行最右，按住可上下拖排序 -->
              <view class="tl-grip" v-if="item.kind === 'spot' && !isHot"
                @touchstart.stop="onDragStart(i, $event)"
                @touchmove.stop="onDragMove"
                @touchend="onDragEnd"
                @touchcancel="onDragEnd"><image class="grip-ico" :src="ICO.grip" mode="aspectFit" /></view>
            </view>
            <view class="tl-name"><image class="kind-ico" :src="item.kind === 'food' ? ICO.utensils : ICO.landmark" mode="aspectFit" />{{ item.name }}</view>
            <view class="tl-reason" v-if="item.reason">{{ item.reason }}</view>
            <view class="tl-cost" v-if="item.estimatedCostCny != null">
              <image class="tl-ico-img" :src="ICO.walletG" mode="aspectFit" />
              <text>预估 ¥{{ item.estimatedCostCny }}</text>
            </view>
            <view class="tl-transport" v-if="item.transport">
              <image class="tl-ico-img" :src="ICO.bus" mode="aspectFit" />
              <text>{{ item.transport }}</text>
            </view>
            <view class="tl-tip" v-if="item.tip">避坑：{{ item.tip }}</view>
            <!-- 实用信息（后端 practical）：预约/开放/入口/人流/必带；老攻略无该字段自动跳过，空子字段不显示 -->
            <view class="tl-prac" v-if="item.kind === 'spot' && hasPrac(item)">
              <view class="tl-prac-row" v-if="item.practical.booking"><view class="tl-prac-k"><image class="pk-ico" :src="ICO.ticket" mode="aspectFit" />预约</view><text class="tl-prac-v">{{ item.practical.booking }}</text></view>
              <view class="tl-prac-row" v-if="item.practical.hours"><view class="tl-prac-k"><image class="pk-ico" :src="ICO.clockD" mode="aspectFit" />开放</view><text class="tl-prac-v">{{ item.practical.hours }}</text></view>
              <view class="tl-prac-row" v-if="item.practical.shortcut"><view class="tl-prac-k"><image class="pk-ico" :src="ICO.door" mode="aspectFit" />入口</view><text class="tl-prac-v">{{ item.practical.shortcut }}</text></view>
              <view class="tl-prac-row" v-if="item.practical.crowd"><view class="tl-prac-k"><image class="pk-ico" :src="ICO.usersD" mode="aspectFit" />人流</view><text class="tl-prac-v">{{ item.practical.crowd }}</text></view>
              <view class="tl-prac-row" v-if="item.practical.bring"><view class="tl-prac-k"><image class="pk-ico" :src="ICO.backpack" mode="aspectFit" />必带</view><text class="tl-prac-v">{{ item.practical.bring }}</text></view>
            </view>
            <!-- 图片附件缩略图：点开放大（照片/收据/笔记备忘） -->
            <view class="tl-imgs" v-if="item.kind === 'spot' && item.images && item.images.length" @tap.stop>
              <image class="tl-img" v-for="(u, k) in item.images" :key="u"
                :src="u" mode="aspectFill" @tap="previewItemImages(item, k)" />
            </view>
            <!-- 关联备忘：在备忘录页把备忘挂到该景点，这里直接看到（点在备忘录页里改） -->
            <view class="tl-memo" v-for="m in spotMemos(item.name)" :key="m.id" @tap.stop="goMemo">
              <image class="tm-ico" :src="ICO.notebook" mode="aspectFit" />
              <text class="tm-text" :class="{ done: m.done }">{{ m.content }}</text>
            </view>
          </view>
        </view>
      </view>
      <!-- 当天备忘：关联到「整天」的备忘（写/改在备忘录页） -->
      <view class="card day-memo" v-if="dayMemos.length">
        <view class="dm-title"><image class="dm-ico" :src="ICO.notebook" mode="aspectFit" />当天备忘 · {{ dayMemos.length }}</view>
        <view class="dm-item" v-for="m in dayMemos" :key="m.id" @tap="goMemo">
          <text class="dm-text" :class="{ done: m.done }">{{ m.content }}</text>
        </view>
      </view>
      <!-- 添加景点：地图选点（wx.chooseLocation 拿坐标）或手动填写，走 POST /spot（示例模式隐藏） -->
      <view class="add-spot" v-if="currentDay && !isHot" @tap="chooseAndAddSpot">＋ 添加景点</view>
      <view class="card day-note" v-if="currentDay && currentDay.note"><image class="dn2-ico" :src="ICO.bulb" mode="aspectFit" /><text>{{ currentDay.note }}</text></view>

      <!-- 整体提示（文档 7.2 已无 warnings 字段；信息来源按需求移除） -->
      <view class="card tips-card" v-if="detail.result.tips && detail.result.tips.length">
        <view class="tips-head"><image class="th-ico" :src="ICO.warn" mode="aspectFit" />注意事项</view>
        <view class="tips-item" v-for="(t, i) in detail.result.tips" :key="i">{{ t }}</view>
      </view>

      <!-- 协作成员：owner 可移除协作者；无实时推送，改动靠手动刷新 -->
      <view id="collab-card" class="card collab-card" v-if="!isHot && collaborators.length">
        <view class="collab-head">
          <view class="collab-title"><image class="ct-ico" :src="ICO.handshake" mode="aspectFit" />协作成员 · {{ collaborators.length }}</view>
          <view class="collab-refresh" @tap="loadCollaborators"><image class="rf-ico" :src="ICO.refresh" mode="aspectFit" />刷新</view>
        </view>
        <view class="collab-row" v-for="m in collaborators" :key="m.userId">
          <image class="collab-avatar" v-if="m.avatarUrl" :src="m.avatarUrl" mode="aspectFill" />
          <view class="collab-avatar ph" v-else>{{ (m.nickname || '友')[0] }}</view>
          <text class="collab-name">{{ m.nickname || '微信用户' }}</text>
          <text class="collab-owner" v-if="m.isOwner">创建者</text>
          <text class="collab-remove" v-else-if="isOwnerUser" @tap="removeCollab(m)">移除</text>
          <text class="collab-me" v-else-if="m.userId === myUserId">我</text>
        </view>
        <view class="collab-note" v-if="isOwnerUser && collaborators.length > 1">移除后对方将失去这份行程的编辑权限</view>
        <view class="collab-note" v-else-if="!isOwnerUser">你是协作者，可编辑行程 · 成员改动需下拉或点刷新同步</view>
        <!-- 协作者可自行退出（DELETE /{id}/collaborator/me）；创建者要走删行程 -->
        <view class="collab-quit" v-if="isCollaborator" @tap="quitCollaboration">退出协作</view>
      </view>

      <!-- 行李清单：已迁到独立页 pages/packing（行程头卡下方的工具条进入） -->

      <!-- 开支记账：已迁到独立页 pages/expense（行程头卡下方的工具条进入），
           避免汇总+表单+流水三块把行程页撑得又长又杂 -->
    </view>

    <!-- 分享弹层：小程序码 + 分享口令 + 撤销 -->
    <view class="share-mask" v-if="shareVisible" @tap="shareVisible = false">
      <view class="share-pop" @tap.stop>
        <view class="share-title">分享这份攻略</view>
        <image v-if="shareQr" class="share-qr" :src="shareQr" mode="widthFix" />
        <view v-else class="share-qr-empty">{{ shareLoading ? '生成中…' : '二维码暂不可用' }}</view>
        <view class="share-note" v-if="shareNote">{{ shareNote }}</view>
        <view class="share-token" v-if="shareToken">分享口令 {{ shareToken }}</view>
        <!-- 页内转发：原生 button open-type="share"，点一下直接唤起微信转发面板。
             没开通分享时会自动开通（见 useShare 的 promise 分支）。
             朋友圈不在这里：onShareTimeline 不能改 path，而本页必须带 tripId 才能渲染，
             所以朋友圈统一走「右上角菜单 → 分享到朋友圈」——本页只开转发、不开朋友圈 -->
        <button class="share-btn btn-native" open-type="share" v-if="!isHot">转发给微信好友</button>
        <view class="share-btn" v-if="shareQrFile" @tap="saveQr">保存小程序码</view>
        <view class="share-btn" v-if="shareToken" @tap="copyToken">复制口令</view>
        <view class="share-btn ghost" v-if="shareToken" @tap="revokeShare">撤销分享</view>
        <view class="share-btn ghost" @tap="shareVisible = false">关闭</view>
        <view class="share-tip">好友扫码或通过转发进入，可只读查看完整攻略，无需登录</view>
      </view>
    </view>

    <!-- AI 重排弹层：一句话指令局部重排，返回完整攻略直接替换本地 -->
    <view class="ed-mask" v-if="replanVisible" @tap="replanVisible = false">
      <view class="replan-pop" @tap.stop>
        <view class="replan-title"><image class="rt-ico" :src="ICO.wandG" mode="aspectFit" />AI 重排行程</view>
        <view class="replan-sub">说一句话，AI 只调整涉及的行程，其余尽量保留</view>
        <textarea class="replan-input" v-model="replanText" maxlength="100"
          placeholder="如：下午下雨了，改成室内景点" :disabled="replanning" />
        <view class="replan-chips">
          <view class="replan-chip" v-for="q in quickReplans" :key="q" @tap="replanText = q">{{ q }}</view>
        </view>
        <view class="ed-btns">
          <view class="ed-btn ghost" @tap="replanVisible = false">取消</view>
          <view class="ed-btn" :class="{ disabled: replanning }" @tap="doReplan">
            {{ replanning ? 'AI 重排中…（约需十几秒）' : '开始重排' }}
          </view>
        </view>
      </view>
    </view>

    <!-- 重排对比确认面板：逐天列出差异，确认采用才落库 -->
    <view class="ed-mask" v-if="replanDiffVisible && replanDiff" @tap="dismissReplan">
      <view class="replan-pop diff-pop" @tap.stop>
        <view class="replan-title">重排对比</view>
        <view class="diff-summary">
          <text class="ds-item add">＋{{ replanDiff.addCount }} 新增</text>
          <text class="ds-item del">－{{ replanDiff.delCount }} 移除</text>
          <text class="ds-item">{{ replanDiff.changedDays }} 天有调整</text>
        </view>
        <scroll-view class="diff-list" :scroll-y="true">
          <block v-for="d in replanDiff.days" :key="d.dayNo">
            <!-- 无变化天：一行带过 -->
            <view class="diff-day same" v-if="d.kind === 'same'">第{{ d.dayNo }}天 · 无变化</view>
            <view class="diff-day" v-else>
              <view class="diff-day-head">
                <text class="diff-day-no">第{{ d.dayNo }}天</text>
                <text class="diff-day-title">{{ d.title }}</text>
              </view>
              <view class="diff-row del" v-for="n in d.dels" :key="'d' + n">－ {{ n }}<text class="diff-tag">被移除</text></view>
              <view class="diff-row add" v-for="n in d.adds" :key="'a' + n">＋ {{ n }}<text class="diff-tag">新增</text></view>
              <view class="diff-row order" v-if="d.orderChanged"><image class="df-ico" :src="ICO.rotate" mode="aspectFit" />游览顺序有调整</view>
              <view class="diff-row order" v-if="d.titleChanged"><image class="df-ico" :src="ICO.penG" mode="aspectFit" />主题改为「{{ d.title }}」</view>
              <view class="diff-row order" v-if="d.noteChanged"><image class="df-ico" :src="ICO.penG" mode="aspectFit" />当日备注有更新</view>
            </view>
          </block>
          <view class="diff-row order" v-if="replanDiff.overviewChanged"><image class="df-ico" :src="ICO.penG" mode="aspectFit" />行程总览已更新</view>
          <view class="diff-row order" v-if="replanDiff.daysCountChanged"><image class="df-ico" :src="ICO.penG" mode="aspectFit" />行程天数有变化</view>
        </scroll-view>
        <view class="diff-note">确认前不会改动你当前的行程</view>
        <view class="ed-btns">
          <view class="ed-btn ghost" @tap="dismissReplan">放弃</view>
          <view class="ed-btn" :class="{ disabled: confirmBusy }" @tap="confirmReplan">
            {{ confirmBusy ? '保存中…' : '确认采用' }}
          </view>
        </view>
      </view>
    </view>

    <!-- 地点搜索弹层：输入关键字搜周边 POI（腾讯位置服务），点结果带入添加表单 -->
    <view class="ed-mask" v-if="searchVisible" @tap="searchVisible = false">
      <view class="ed-pop" @tap.stop>
        <view class="ed-title">搜索地点添加</view>
        <view class="se-bar">
          <input class="ed-input se-input" v-model="searchKeyword" maxlength="30"
                 placeholder="输入关键字，如：博物馆" confirm-type="search" @confirm="doSearchPlace" />
          <view class="se-go" :class="{ disabled: searching }" @tap="doSearchPlace">{{ searching ? '…' : '搜索' }}</view>
        </view>
        <scroll-view class="se-list" scroll-y>
          <view v-if="searchScope" class="se-scope"><image class="sc-ico" :src="ICO.searchD" mode="aspectFit" />在「{{ searchScope }}」范围内搜索</view>
          <view v-if="searchTip" class="se-tip">{{ searchTip }}</view>
          <view class="se-item" v-for="(p, i) in searchResults" :key="i" @tap="pickPlace(p)">
            <view class="se-name"><image class="dn-ico" :src="ICO.pin" mode="aspectFit" />{{ p.name }}</view>
            <view class="se-addr">{{ p.address }}</view>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 景点编辑弹层：新增（搜索/地图选点带入坐标）/ 编辑（新 spot 完整覆盖）共用 -->
    <view class="ed-mask" v-if="editVisible" @tap="editVisible = false">
      <view class="ed-pop tall" @tap.stop>
        <view class="ed-title">{{ editIsNew ? '添加景点' : '编辑景点' }}</view>
        <view class="ed-coord" v-if="editForm.hasCoord"><image class="dn-ico" :src="ICO.pin" mode="aspectFit" /><text>{{ editForm.lat.toFixed(4) }}, {{ editForm.lng.toFixed(4) }}</text></view>
        <!-- 手动填写没有坐标：地图画不出这个点，提前告知避免「为什么地图上没有」 -->
        <view class="ed-coord warn" v-if="!editForm.hasCoord && editIsNew"><image class="dn-ico" :src="ICO.bulb" mode="aspectFit" /><text>未选坐标：手动填写的景点不会出现在地图上，建议改用「搜索地点」或「地图选点」</text></view>
        <!-- 内容超高可滚动（图片区在底部也能滚到），按钮固定在弹层底部 -->
        <scroll-view class="ed-body" :scroll-y="true">
        <view class="ed-field">
          <text class="ed-label">名称</text>
          <input class="ed-input" v-model="editForm.name" maxlength="50" placeholder="景点名称（必填）" />
        </view>
        <view class="ed-field">
          <text class="ed-label">游玩时间</text>
          <input class="ed-input" v-model="editForm.duration" maxlength="30" placeholder="如：约2小时" />
        </view>
        <view class="ed-field">
          <text class="ed-label">预估费用</text>
          <input class="ed-input" type="digit" v-model="editForm.cost" placeholder="数字（元），可留空" />
        </view>
        <view class="ed-field col">
          <text class="ed-label">推荐理由</text>
          <textarea class="ed-area" v-model="editForm.reason" maxlength="300" placeholder="为什么要去" />
        </view>
        <view class="ed-field col">
          <text class="ed-label">避坑提示</text>
          <textarea class="ed-area" v-model="editForm.tip" maxlength="300" placeholder="注意事项" />
        </view>
        <!-- 图片附件：照片/收据/笔记，备忘录作用；小图展示点开放大 -->
        <view class="ed-field col">
          <text class="ed-label">图片备忘（{{ editForm.images.length }}/9）</text>
          <view class="img-grid">
            <view class="img-cell" v-for="(u, k) in editForm.images" :key="u">
              <image class="img-thumb" :src="u" mode="aspectFill" @tap="previewSpotImages(k)" />
              <image class="img-del" :src="ICO.closeL" mode="aspectFit" @tap.stop="removeSpotImage(k)" />
            </view>
            <view class="img-add" v-if="editForm.images.length < 9" @tap="pickSpotImage">
              <text class="img-add-ico">{{ uploadingImg ? '…' : '＋' }}</text>
              <text class="img-add-txt">{{ uploadingImg ? '上传中' : '添加' }}</text>
            </view>
          </view>
          <view class="img-hint">照片 / 收据 / 自己的笔记，作备忘用 · 点小图放大查看</view>
        </view>
        </scroll-view>
        <view class="ed-btns">
          <view class="ed-btn ghost" @tap="editVisible = false">取消</view>
          <view class="ed-btn" :class="{ disabled: editSaving }" @tap="saveSpot">{{ editSaving ? '保存中…' : '保存' }}</view>
        </view>
      </view>
    </view>

    <!-- 从我出发重排：最近邻顺序 + 站间步行距离；确认后才套用到当天（后端只算不存） -->
    <view class="ed-mask" v-if="nearby.visible" @tap="nearby.visible = false">
      <view class="ed-pop nb-pop" @tap.stop>
        <view class="ed-title"><image class="dn-ico" :src="ICO.pin" mode="aspectFit" />从当前位置出发 · 第 {{ nearby.dayIndex + 1 }} 天</view>
        <view class="nb-note" v-if="nearby.origin">起点：{{ nearby.originIsFallback ? '演示坐标（定位失败兜底）' : '你所在位置' }}（{{ nearby.origin.lat.toFixed(3) }}, {{ nearby.origin.lng.toFixed(3) }}）</view>
        <view class="g-empty" v-if="nearby.loading">定位 + 计算最优路线中…</view>
        <scroll-view class="ed-body nb-body" v-else :scroll-y="true">
          <view class="nb-item" v-for="(s, k) in nearby.route" :key="k">
            <view class="nb-dot">{{ k + 1 }}</view>
            <view class="nb-mid">
              <text class="nb-name">{{ s.name }}</text>
              <text class="nb-dist">距上一站步行 {{ fmtDist(s.distance) }}</text>
            </view>
          </view>
          <view class="nb-note dim" v-if="nearby.route.some(s => s.distance == null)">带「距离未知」的站点是路线规划失败，仅供参考顺序</view>
        </scroll-view>
        <view class="ed-btns" v-if="!nearby.loading">
          <view class="ed-btn ghost" @tap="nearby.visible = false">看看就好</view>
          <view class="ed-btn" :class="{ disabled: spotBusy }" @tap="applyNearby">按此顺序重排</view>
        </view>
      </view>
    </view>

    <AuthMask />
  </view>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import Taro, { useLoad, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import api from '../../services/api'
import { listMemosSync, refreshMemos } from '../../services/memo'
import { base64ToTempFile, saveImageToAlbum } from '../../utils/file'
import { getPosition } from '../../utils/position'
import { sessionState } from '../../utils/auth'
import { useShare } from '../../utils/share'
import { dedupeMembers } from '../../utils/collab'   // 成员去重：后端可能同一人回多条
import AuthMask from '../../components/AuthMask.vue'
// 图标资源（Iconify Lucide/MDI 预渲染 PNG，见 gen-icons.js）
import alertIco from '../../assets/icons/alert-circle-gray.png'
import bookDark from '../../assets/icons/book-open-dark.png'
import wandW from '../../assets/icons/wand-white.png'
import wandGr from '../../assets/icons/wand-green.png'
import loaderW from '../../assets/icons/loader-white.png'
import fileW from '../../assets/icons/file-text-white.png'
import shareW from '../../assets/icons/share2-white.png'
import refreshGr from '../../assets/icons/refresh-green.png'
import calGray from '../../assets/icons/calendar-days-gray.png'
import walletGrn from '../../assets/icons/wallet-green.png'
import walletWarm from '../../assets/icons/wallet-light.png'      // 工具条·记账 浅色
import notebookBlue from '../../assets/icons/notebook-light.png'  // 工具条·备忘 浅色
import luggageAmber from '../../assets/icons/luggage-light.png'   // 工具条·行李 浅色
import nearbyTeal from '../../assets/icons/nearby-light.png'      // 工具条·周边 浅色
import usersPurple from '../../assets/icons/users-light.png'      // 工具条·成员 浅色
import busGr from '../../assets/icons/bus-gray.png'
import ticketD from '../../assets/icons/ticket-dark.png'
import clockD from '../../assets/icons/clock-dark.png'
import doorD from '../../assets/icons/door-open-dark.png'
import usersD from '../../assets/icons/users-dark.png'
import backpackD from '../../assets/icons/backpack-dark.png'
import landmarkGr from '../../assets/icons/landmark-green.png'
import utensilsW2 from '../../assets/icons/utensils-warm.png'
import utensilsGr from '../../assets/icons/utensils-green.png'
import bulbW from '../../assets/icons/lightbulb-warm.png'
import warnW from '../../assets/icons/triangle-alert-warm.png'
import handshakeGr from '../../assets/icons/handshake-green.png'
import luggageGr from '../../assets/icons/luggage-green-s.png'
import usersGr from '../../assets/icons/users-green.png'
import nearbyGr from '../../assets/icons/nearby-green.png'
import notebookGr from '../../assets/icons/notebook-pen-green.png'
import closeGr from '../../assets/icons/close-gray.png'
import closeLt from '../../assets/icons/close-light.png'
import searchDk from '../../assets/icons/search-dark.png'
import pinGr from '../../assets/icons/map-pin-green.png'
import rotateGd from '../../assets/icons/rotate-ccw-gold.png'
import penGd from '../../assets/icons/pen-line-gold.png'
import gripGr from '../../assets/icons/grip-vertical-gray.png'

import wxSun from '../../assets/icons/wx-sun.png'
import wxCloudSun from '../../assets/icons/wx-cloud-sun.png'
import wxCloud from '../../assets/icons/wx-cloud.png'
import wxRain from '../../assets/icons/wx-cloud-rain.png'
import wxLightning from '../../assets/icons/wx-cloud-lightning.png'
import wxSnow from '../../assets/icons/wx-snowflake.png'
import wxFog from '../../assets/icons/wx-cloud-fog.png'

const ICO = {
  alert: alertIco, book: bookDark, wand: wandW, wandG: wandGr, loader: loaderW, file: fileW,
  share2: shareW, refresh: refreshGr, cal: calGray, walletG: walletGrn, bus: busGr,
  ticket: ticketD, clockD, door: doorD, usersD, backpack: backpackD,
  utensils: utensilsW2, landmark: landmarkGr, bulb: bulbW, warn: warnW,
  handshake: handshakeGr, luggage: luggageGr, close: closeGr, closeL: closeLt,
    users: usersGr, notebook: notebookGr, nearby: nearbyGr,
    walletWarm, notebookBlue, luggageAmber, nearbyTeal, usersPurple,
    searchD: searchDk, pin: pinGr, rotate: rotateGd, penG: penGd, grip: gripGr
}

const tripId = ref('')
const phase = ref('loading') // loading | done | failed
const isHot = ref(false)     // 热门城市示例模式：本地写死行程，只读展示
const submitting = ref(false)
const errorMsg = ref('')

const detail = ref(null)
const activeDay = ref(0)
const markers = ref([])
const polylines = ref([])
const mapCenter = ref({ latitude: 30.25, longitude: 120.15 })

const currentDay = computed(() => {
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  return days[activeDay.value] || days[0] || null
})
// 文档 7.2：景点在 days[].spots，美食单独在 days[].food
// 时间线把两类合并成一条流：景点编序号（与地图 marker 序号一致，列表↔地图联动），美食不编号
const currentItems = computed(() => {
  const d = currentDay.value
  if (!d) return []
  let no = 0
  const spots = (d.spots || []).map(s => { no += 1; return Object.assign({ kind: 'spot', no }, s) })
  const food = (d.food || []).map(f => Object.assign({ kind: 'food' }, f))
  return spots.concat(food)
})

// ---------- 备忘（services/memo，服务端为准 + 本地缓存）：关联到某天/某景点的备忘直接长在时间线上 ----------
// 只看不写：写/删都在备忘录页（pages/memo），这里负责把已关联的展示出来
const tripMemos = ref([])
function loadMemos() {
  // 先吃本地缓存（同步、不闪），再拉一次服务端覆盖 —— 协作者新加的备忘也要长到时间线上
  try { tripMemos.value = listMemosSync('trip', tripId.value) } catch (e) { tripMemos.value = [] }
  refreshMemos('trip', tripId.value).then(l => { tripMemos.value = l }).catch(() => {})
}
const currentDayNo = computed(() => {
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  const d = days[activeDay.value] || days[0]
  return d ? (d.day || activeDay.value + 1) : 0
})
// 天级备忘：当天行程开头单独一条
const dayMemos = computed(() =>
  tripMemos.value.filter(m => m.link && m.link.type === 'day' && m.link.day === currentDayNo.value))
// 景点备忘：按名字挂到对应景点卡片下（同名景点会共享，属可接受的简化）
function spotMemos(name) {
  return tripMemos.value.filter(m =>
    m.link && m.link.type === 'spot' && m.link.day === currentDayNo.value && m.link.name === name)
}

// 实用信息（practical）：5 个固定键 booking/hours/shortcut/crowd/bring，
// 老攻略没有该字段、AI 搜不到的子字段为空 —— 都按「没有就不显示」处理
function hasPrac(it) {
  const p = it && it.practical
  return !!(p && (p.booking || p.hours || p.shortcut || p.crowd || p.bring))
}

// ---------- 行程元信息 chips（详情体里有但旧 UI 没用上的字段） ----------
// 交通枚举 → 中文（文档 7.2 请求体枚举表）
const TRANSPORT_TEXT = { walking: '步行', transit: '公交地铁', taxi: '打车', driving: '自驾', cycling: '骑行' }
const transportLabels = computed(() => {
  const raw = (detail.value && detail.value.transportation) || ''
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => TRANSPORT_TEXT[s] || s)
})
// 出发日期展示为「MM-DD 出发」（完整年份在 chips 里太占位）
const startDateLabel = computed(() => {
  const s = (detail.value && detail.value.startDate) || ''
  const m = s.match(/^\d{4}-(\d{2}-\d{2})$/)
  return m ? `${m[1]} 出发` : ''
})

// 文档 7.2 无 budgetSummary：总费用取 result.estimatedTotalCost（全队合计），
// 预算对比在前端算 —— detail.budget 是自由文本，解析出数字才参与比较
const budgetInfo = computed(() => {
  const r = detail.value && detail.value.result
  const total = r && typeof r.estimatedTotalCost === 'number' ? r.estimatedTotalCost : null
  const input = detail.value && detail.value.budget ? parseFloat(detail.value.budget) : NaN
  if (total == null) return { total: null, status: 'unknown', input: null, diff: null }
  if (!isFinite(input) || input <= 0) return { total, status: 'unknown', input: null, diff: null }
  return { total, input, diff: input - total, status: total <= input ? 'within' : 'over' }
})

const dayHasMissingCoord = computed(() =>
  currentDay.value && (currentDay.value.spots || []).some(s => !(typeof s.lat === 'number' && typeof s.lng === 'number'))
)

// ---------- 分享（后端文档 2026-09-20）：qrcode / share 开启撤销 / public 公开访问 ----------
const shareVisible = ref(false)
const shareLoading = ref(false)
const shareQr = ref('')      // 展示用：临时文件路径（转文件失败时兜底 data URL）
const shareQrFile = ref('')  // 保存到相册用：必须是文件路径
const shareToken = ref('')
const shareNote = ref('')

// ---------- 导出 PDF（后端文档 2026-09-25）：downloadFile 拉流 → openDocument 打开预览 ----------
const pdfBusy = ref(false)
function exportPdf() {
  if (pdfBusy.value) return
  pdfBusy.value = true
  api.trips.pdf(tripId.value).then(filePath => {
    return new Promise((resolve, reject) => {
      Taro.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,   // 允许用户在预览页里转发/保存
        success: resolve,
        fail: () => reject({ code: 'OPEN_FAIL', message: 'PDF 打开失败，当前环境可能不支持文档预览' })
      })
    })
  }).catch(e => {
    Taro.showToast({ title: e.message || '导出失败', icon: 'none' })
  }).finally(() => { pdfBusy.value = false })
}

// 转发给好友时按需开通只读分享（POST /api/trip/{id}/share）：已有 token 就直接用。
// 失败返回空串而不是抛错——分享卡不能被一个接口失败卡死（微信 3 秒兜底会用 pending 参数）
function ensureShareToken() {
  if (shareToken.value) return Promise.resolve(shareToken.value)
  if (!tripId.value) return Promise.resolve('')
  return api.trips.shareOn(tripId.value)
    .then(d => {
      shareToken.value = d.token || ''
      return shareToken.value
    })
    .catch(() => '')
}

function openShare() {
  shareVisible.value = true
  if (shareToken.value || shareLoading.value) return   // 已开启过，直接展示
  shareLoading.value = true
  api.trips.qrcode(tripId.value).then(d => {
    shareToken.value = d.token || ''
    // 纪要 9.3：base64 图片转临时文件再用（保存到相册只认文件路径）
    return base64ToTempFile(d.image, 'png').then(p => {
      shareQrFile.value = p
      shareQr.value = p
    }).catch(() => {
      shareQr.value = 'data:image/png;base64,' + d.image   // 转文件失败兜底：仍能显示
    })
  }).then(() => {
    shareLoading.value = false
  }).catch(e => {
    // 502 = 小程序码生成失败（常见：小程序未发布版本）→ 降级：仅开启分享 token，可转发给好友
    const degraded = e.code === 502
    api.trips.shareOn(tripId.value).then(d => {
      shareToken.value = d.token || ''
      if (degraded) shareNote.value = '小程序未发布，暂无法生成小程序码，可把攻略直接转发给好友'
    }).catch(e2 => {
      shareNote.value = e2.message || '分享开启失败，请稍后重试'
    }).finally(() => { shareLoading.value = false })
  })
}

function saveQr() {
  if (!shareQrFile.value) return
  saveImageToAlbum(shareQrFile.value).then(() => {
    Taro.showToast({ title: '已保存到相册', icon: 'success' })
  }).catch(() => {})
}

function copyToken() {
  if (!shareToken.value) return
  Taro.setClipboardData({ data: shareToken.value })
}

function revokeShare() {
  Taro.showModal({ title: '撤销分享', content: '撤销后原二维码和口令立即失效，确定撤销吗？' }).then(r => {
    if (!r.confirm) return
    api.trips.shareOff(tripId.value).then(() => {
      shareToken.value = ''
      shareQr.value = ''
      shareNote.value = ''
      shareVisible.value = false
      Taro.showToast({ title: '已撤销', icon: 'success' })
    }).catch(e => Taro.showToast({ title: e.message || '撤销失败', icon: 'none' }))
  })
}

// ---------- AI 重排（POST /api/trip/{id}/replan）----------
// 一句话指令局部重排：后端返回调整后的完整攻略对象（结构同 result），直接替换本地
const replanVisible = ref(false)
const replanText = ref('')
const replanning = ref(false)
const quickReplans = ['下午下雨了，改成室内景点', '父母走累了，节奏慢一点', '太赶了，帮我轻松点', '预算砍一半，帮我省着玩']
const replanDiffVisible = ref(false)  // 对比确认面板
const replanDiff = ref(null)          // diffResults() 的结果
const replanResult = ref(null)        // 待确认的新 result
const confirmBusy = ref(false)

function openReplan() {
  replanText.value = ''
  replanVisible.value = true
}

function doReplan() {
  const cmd = replanText.value.trim()
  if (!cmd) { Taro.showToast({ title: '先写一句调整指令', icon: 'none' }); return }
  if (replanning.value || isHot.value) return
  replanning.value = true
  api.trips.replan(tripId.value, cmd).then(data => {
    if (!data || !Array.isArray(data.days) || !data.days.length) {
      throw { message: '重排结果为空' }
    }
    // 不直接应用：先算出与当前结果的差异，进对比确认面板，用户点「确认采用」才落库
    replanDiff.value = diffResults(detail.value.result, data)
    replanResult.value = data
    replanVisible.value = false
    replanDiffVisible.value = true
  }).catch(e => {
    Taro.showToast({ title: e.message || '重排失败，稍后再试', icon: 'none' })
  }).finally(() => {
    replanning.value = false
  })
}

// ---------- 重排对比：新旧结果逐天 diff，让用户看清改了什么 ----------
// 天级对比：按景点名配对（重名按出现次数），得出 新增/移除/保留 + 顺序/标题/备注变化
function diffResults(oldR, newR) {
  const oldDays = (oldR && oldR.days) || []
  const newDays = (newR && newR.days) || []
  const max = Math.max(oldDays.length, newDays.length)
  const days = []
  let addCount = 0
  let delCount = 0
  for (let i = 0; i < max; i++) {
    const od = oldDays[i], nd = newDays[i]
    const dayNo = (nd && nd.day) || (od && od.day) || i + 1
    if (od && !nd) {   // 天被整删
      days.push({ dayNo, kind: 'del', dels: (od.spots || []).map(s => s.name) })
      delCount += (od.spots || []).length
      continue
    }
    if (!od && nd) {   // 天为新增
      days.push({ dayNo, kind: 'new', title: nd.title, adds: (nd.spots || []).map(s => s.name) })
      addCount += (nd.spots || []).length
      continue
    }
    // 同一天：按名字配对（重复名按剩余池匹配）
    const oldPool = (od.spots || []).map(s => s.name)
    const keptInOldOrder = []
    const adds = []
    ;(nd.spots || []).forEach(s => {
      const idx = oldPool.indexOf(s.name)
      if (idx >= 0) { keptInOldOrder.push({ name: s.name, oldIdx: idx }); oldPool.splice(idx, 1) }
      else { adds.push(s.name); addCount++ }
    })
    const dels = oldPool
    dels.forEach(() => delCount++)
    // 顺序变化：保留的景点在新结果里的先后相对旧结果是否被打乱
    const newOrderNames = keptInOldOrder.map(k => k.name)
    const oldOrderNames = [...keptInOldOrder].sort((a, b) => a.oldIdx - b.oldIdx).map(k => k.name)
    const orderChanged = newOrderNames.length > 1 && newOrderNames.join('|') !== oldOrderNames.join('|')
    const titleChanged = (od.title || '') !== (nd.title || '')
    const noteChanged = (od.note || '') !== (nd.note || '')
    const dirty = adds.length || dels.length || orderChanged || titleChanged || noteChanged
    days.push({
      dayNo, kind: dirty ? 'dirty' : 'same',
      title: nd.title, adds, dels, orderChanged, titleChanged, noteChanged
    })
  }
  return {
    days,
    addCount,
    delCount,
    changedDays: days.filter(d => d.kind !== 'same').length,
    overviewChanged: ((oldR && oldR.overview) || '') !== ((newR && newR.overview) || ''),
    daysCountChanged: oldDays.length !== newDays.length
  }
}

function dismissReplan() {
  replanDiffVisible.value = false
  replanDiff.value = null
  replanResult.value = null
}

// 确认采用：先 PUT /result 落库（后端 replan 只算不存），成功后才替换本地并重渲染
function confirmReplan() {
  const r = replanResult.value
  if (!r || confirmBusy.value) return
  confirmBusy.value = true
  api.trips.putResult(tripId.value, r).then(() => {
    detail.value.result = r
    if (r.city) detail.value.city = r.city
    dismissReplan()
    renderDay(0)
    Taro.showToast({ title: '已按重排结果更新', icon: 'success' })
  }).catch(e => {
    Taro.showToast({ title: e.message || '保存失败，可重试', icon: 'none' })
  }).finally(() => {
    confirmBusy.value = false
  })
}

// ---------- 协作成员（GET /{id}/collaborators · DELETE /{id}/collaborator/{userId}）----------
const collaborators = ref([])
const myUserId = computed(() => (sessionState.user && sessionState.user.id) || null)
// 我是不是 owner：成员列表里「自己那条」的 isOwner（比单看 user.isAdmin 之类的字段可靠）
const isOwnerUser = computed(() =>
  collaborators.value.some(m => m.isOwner && m.userId === myUserId.value)
)
// 我是不是协作者：成员表已加载 且 我不是创建者
// 成员表未加载 / 404 时按「自己创建的」处理，避免分享入口先隐藏再出现的闪烁
const isCollaborator = computed(() => collaborators.value.length > 0 && !isOwnerUser.value)

function loadCollaborators() {
  if (isHot.value || !tripId.value) return
  api.trips.collaborators(tripId.value).then(list => {
    // 按 userId 去重：后端同一人回多条（重复行/行放大）时，「协作成员 · N」与成员列表都会被算重
    collaborators.value = dedupeMembers(list)
  }).catch(() => {})   // 404（非成员）等静默，成员卡隐藏即可
}

function removeCollab(m) {
  Taro.showModal({
    title: '移除协作者',
    content: `移除「${m.nickname || '该成员'}」？移除后对方将失去这份行程的编辑权限`,
    confirmText: '移除'
  }).then(r => {
    if (!r.confirm) return
    api.trips.removeCollaborator(tripId.value, m.userId).then(() => {
      loadCollaborators()
      Taro.showToast({ title: '已移除', icon: 'success' })
    }).catch(e => {
      Taro.showToast({ title: e.message || '移除失败', icon: 'none' })
    })
  })
}

// 退出协作：协作者自行退出（DELETE /api/trip/{id}/collaborator/me）
// 退出后该行程从列表消失、详情不可见 → 直接返回列表页（历史页 useDidShow 会重新拉取）
function quitCollaboration() {
  Taro.showModal({
    title: '退出协作',
    content: '退出后这份行程会从你的列表消失，需要重新用口令加入。确定退出吗？',
    confirmText: '退出'
  }).then(r => {
    if (!r.confirm) return
    api.trips.exitCollaboration(tripId.value).then(() => {
      Taro.showToast({ title: '已退出协作', icon: 'success' })
      // 稍等让 toast 露个面；navigateBack 失败（无可返回页）时兜底回历史 tab
      setTimeout(() => {
        Taro.navigateBack().catch(() => Taro.switchTab({ url: '/pages/history/history' }))
      }, 600)
    }).catch(e => {
      // 400=创建者不能退出 / 不是协作者；404=行程不存在（非成员）
      Taro.showToast({ title: e.message || '退出失败', icon: 'none' })
    })
  })
}

// ---------- 工具条：重功能出口（记账 / 备忘 / 行李走独立页，成员滚到本页卡片）----------
function goExpense() {
  if (!tripId.value) return
  const city = encodeURIComponent((detail.value && detail.value.city) || '')
  Taro.navigateTo({ url: `/pages/expense/expense?tripId=${tripId.value}&city=${city}` })
}
function goMemo() {
  if (!tripId.value) return
  const city = encodeURIComponent((detail.value && detail.value.city) || '')
  Taro.navigateTo({ url: `/pages/memo/memo?tripId=${tripId.value}&city=${city}` })
}
function goPacking() {
  if (!tripId.value) return
  const city = encodeURIComponent((detail.value && detail.value.city) || '')
  Taro.navigateTo({ url: `/pages/packing/packing?tripId=${tripId.value}&city=${city}` })
}
// 周边设施（独立页，按当前定位查 1km 内最近的公厕/民宿/停车场/充电桩）。
// tripId 仅作来源标记；定位失败时页面内提示重试，这里不需要传 city 做兜底
function goNearby() {
  if (!tripId.value) return
  Taro.navigateTo({ url: `/pages/nearby/nearby?tripId=${tripId.value}` })
}
// 成员留在本页，用锚点滚过去；卡片不存在时（没协作者/示例模式）给个提示
function scrollToBlock(id) {
  Taro.pageScrollTo({ selector: `#${id}`, duration: 300 }).catch(() => {
    Taro.showToast({ title: '这块暂时没有内容', icon: 'none' })
  })
}
// ---------- 目的地天气（GET /{id}/weather）：实况 + 3 天预报；降级（仅 city）时整卡隐藏 ----------
const weather = ref(null)

function loadWeather() {
  if (isHot.value || !tripId.value) return
  api.trips.weather(tripId.value).then(d => {
    // 降级响应 data 仅含 city（无 now）→ 不展示卡片
    weather.value = d && d.now ? d : null
  }).catch(() => {})
}

// 天气现象 → 图标路径（按关键字粗匹配即可）
function wxIcon(text) {
  const t = text || ''
  if (t.includes('雷')) return wxLightning
  if (t.includes('雨')) return wxRain
  if (t.includes('雪')) return wxSnow
  if (t.includes('雾') || t.includes('霾')) return wxFog
  if (t.includes('阴')) return wxCloud
  if (t.includes('云')) return wxCloudSun
  return wxSun
}

// 天气 → 卡片背景主题类名（2026-10-08 用户要求背景随天气变化）：
// 与 wxIcon 同一套关键词口径，返回 wx-sun/wx-cloud/wx-rain/wx-snow/wx-fog/wx-storm，
// 对应样式见 .wx-card.wx-*（全部浅底渐变，深色文字保持可读）
function wxKind(text) {
  const t = text || ''
  if (t.includes('雷')) return 'wx-storm'
  if (t.includes('雨')) return 'wx-rain'
  if (t.includes('雪')) return 'wx-snow'
  if (t.includes('雾') || t.includes('霾')) return 'wx-fog'
  if (t.includes('阴')) return 'wx-cloud'
  if (t.includes('云')) return 'wx-cloud'
  return 'wx-sun'
}

// 预报日期标签：首日=今天，次日=明天，其余显示 MM/DD
function wxDayLabel(date, idx) {
  if (idx === 0) return '今天'
  if (idx === 1) return '明天'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  return m ? `${Number(m[2])}/${Number(m[3])}` : (date || '')
}

// 从备忘录页返回时刷新关联备忘（纯本地读，不发请求，可放心每次显示都跑）
useDidShow(() => { loadMemos() })

// 右上角菜单转发 / 聊天转发 / 页内「转发给好友」按钮：都带只读 token 进公开分享页。
// 还没开通过分享时走「边转边开通」：先给 pending 兜底参数，promise 拿到 token 后覆盖
// （微信允许 onShareAppMessage 返回 promise，3 秒内 resolve 生效）
useShare(() => {
  const city = (detail.value && detail.value.city) || ''
  const days = (detail.value && detail.value.days) || ''
  const title = city ? `${city}${days ? days + '天' : ''}旅行攻略，分享给你` : '我的旅行攻略'
  // 示例行程（hot）是本地写死数据、没有 tripId，只能引导去首页自己生成
  if (isHot.value) return { title, city, path: '/pages/home/home' }
  if (shareToken.value) return { title, city, path: `/pages/share/share?token=${shareToken.value}` }
  return {
    pending: { title, city, path: '/pages/home/home' },
    promise: ensureShareToken().then(t => ({
      title,
      city,
      path: t ? `/pages/share/share?token=${t}` : '/pages/home/home'
    }))
  }
})

useLoad(options => {
  // 热门城市示例模式：详情来自本地写死数据（home.vue 点城市卡时存入 storage），不调后端
  if (options && options.hot === '1') {
    isHot.value = true
    const hot = Taro.getStorageSync('hotTripDetail')
    if (hot && hot.result) {
      detail.value = hot
      phase.value = 'done'
      renderDay(0)
    } else {
      phase.value = 'failed'
      errorMsg.value = '示例行程丢失，请回首页重进'
    }
    return
  }
  tripId.value = (options && options.tripId) || Taro.getStorageSync('currentTripId') || ''
  if (!tripId.value) {
    Taro.showToast({ title: '缺少行程，先去规划', icon: 'none' })
    return
  }
  loadDetail()
})

// 下拉刷新：多人协作无实时推送，靠手动同步（loadDetail 就绪后会级联拉成员/清单/开支/天气）
usePullDownRefresh(() => {
  if (isHot.value) {          // 热门城市示例：本地数据无需刷新
    Taro.stopPullDownRefresh()
    return
  }
  const p = loadDetail()
  if (p && typeof p.finally === 'function') {
    p.finally(() => Taro.stopPullDownRefresh())
  } else {
    setTimeout(() => Taro.stopPullDownRefresh(), 1000)   // 兜底：万一没拿到 Promise
  }
})

// ---------- 详情：GET /api/trip/{id} ----------
// 已知竞态：流式 done 事件可能先于后端把 result 落库（生成刚结束就查详情），
// 也可能 result 是 TEXT 字段直出的 JSON 字符串 → 都在这里兜住，别直接判失败
const RESULT_RETRY_MAX = 5        // 无结果时最多重试 5 次（2s 间隔 ≈ 10s 窗口）
let resultRetry = 0
const loadingTip = ref('')

function loadDetail(isRetry) {
  phase.value = 'loading'
  if (!isRetry) { resultRetry = 0; loadingTip.value = '' }
  // 返回 Promise 供下拉刷新收尾（usePullDownRefresh 靠它 stopPullDownRefresh）
  return api.trips.detail(tripId.value).then(d => {
    // 排查用：把原始返回打到控制台（真机 vConsole 可见），result 结构对不对一眼看出
    try { console.warn('[itinerary] detail 返回', JSON.stringify(d).slice(0, 600)) } catch (e) {}
    // 后端 result 列是 TEXT 时会直出 JSON 字符串，补一层解析
    if (d && typeof d.result === 'string') {
      try { d.result = JSON.parse(d.result) } catch (e) { /* 不是 JSON 就保持原样走失败态 */ }
    }
    detail.value = d
    // result 可空（生成中/生成失败/落库延迟），先重试再判失败
    if (!d || !d.result || !Array.isArray(d.result.days) || !d.result.days.length) {
      if (resultRetry < RESULT_RETRY_MAX) {
        resultRetry += 1
        loadingTip.value = `生成结果还在写入，第 ${resultRetry}/${RESULT_RETRY_MAX} 次重试…`
        setTimeout(() => loadDetail(true), 2000)
        return
      }
      phase.value = 'failed'
      errorMsg.value = '这份行程还没有生成结果'
      return
    }
    loadingTip.value = ''
    phase.value = 'done'
    renderDay(0)
    loadCollaborators()   // 详情就绪后拉协作成员（失败静默，卡片不显示）
    loadWeather()         // 目的地天气同步加载
  }).catch(e => {
    phase.value = 'failed'
    errorMsg.value = e.message || '读取结果失败'
  })
}

function reload() {
  if (isHot.value) return   // 示例行程本地数据，无需刷新
  if (submitting.value) return
  submitting.value = true
  loadDetail()
  submitting.value = false
}

// 示例横幅：回首页
function backFromHot() {
  Taro.switchTab({ url: '/pages/home/home' })
}

function renderDay(idx) {
  activeDay.value = idx
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  const day = days[idx]
  if (!day) return
  // 新结构无 routeSegments：marker 取有坐标的景点，polyline 按当天顺序直线连点
  const located = (day.spots || []).filter(s => typeof s.lat === 'number' && typeof s.lng === 'number')
  markers.value = located.map((s, i) => ({
    id: i,
    latitude: s.lat,
    longitude: s.lng,
    width: 26, height: 26,
    callout: { content: `${i + 1} ${s.name}`, padding: 6, borderRadius: 6, display: 'ALWAYS' }
  }))
  polylines.value = located.length >= 2
    ? [{
        points: located.map(s => ({ latitude: s.lat, longitude: s.lng })),
        color: '#22C55E', width: 4
        // ⚠️ 不加 arrowLine：安卓真机不支持，会导致整条 polyline 渲染不出来（iOS/工具正常）
      }]
    : []
  if (markers.value.length) {
    mapCenter.value = { latitude: markers.value[0].latitude, longitude: markers.value[0].longitude }
  }
}

function switchDay(idx) { renderDay(Number(idx)) }

// ---------- 行程编辑（后端文档 2026-09-24）：spot 增删改移 + result 整体覆盖 ----------
// 定位口径：dayIndex/spotIndex 都是数组下标从 0 起；spots 在 days[].spots（food 不参与编辑）
// 编辑操作只改库，不触发 RAG 摄入；成功后统一静默刷新详情
const editVisible = ref(false)
const editSaving = ref(false)
const editIsNew = ref(false)
const editSpotIndex = ref(0)  // 编辑已有景点时的 spots 下标
const editForm = ref({ name: '', duration: '', cost: '', reason: '', tip: '', images: [], lat: null, lng: null, hasCoord: false, raw: null })
const spotBusy = ref(false)   // 删除/移动操作互斥锁

// 操作成功后静默拉详情：保持当前天不跳，地图/时间线随新数据重渲染
function refreshCurrent() {
  Taro.showLoading({ title: '刷新中…', mask: true })
  api.trips.detail(tripId.value).then(d => {
    if (d && typeof d.result === 'string') { try { d.result = JSON.parse(d.result) } catch (e) {} }
    if (d && d.result && Array.isArray(d.result.days) && d.result.days.length) {
      detail.value = d
      renderDay(Math.min(activeDay.value, d.result.days.length - 1))
    }
  }).catch(e => Taro.showToast({ title: e.message || '刷新失败，请下拉重进', icon: 'none' }))
    .finally(() => Taro.hideLoading())
}

// 点景点卡 → 操作菜单（food 项不参与；显式函数 + 内部守卫，不用行内 && 表达式）
function onCardTap(item, i) {
  if (isHot.value) { Taro.showToast({ title: '示例行程不可编辑', icon: 'none' }); return }
  if (item.kind !== 'spot') return
  Taro.showActionSheet({ itemList: ['编辑景点', '删除景点', '上移', '下移', '移到其他天…'] }).then(r => {
    const t = r.tapIndex
    if (t === 0) openEdit(item, i)
    else if (t === 1) confirmRemove(item, i)
    else if (t === 2 || t === 3) moveWithin(i, t === 2 ? i - 1 : i + 1)
    else if (t === 4) moveToOtherDay(i)
  }).catch(err => {
    // 用户点取消也会走到 fail（errMsg 带 cancel），属正常不提示
    const msg = (err && err.errMsg) || String(err || '')
    if (/cancel/i.test(msg)) return
    console.warn('[itinerary] showActionSheet 失败', err)
    Taro.showToast({ title: '菜单打开失败：' + msg, icon: 'none', duration: 3000 })
  })
}

function openEdit(item, i) {
  editIsNew.value = false
  editSpotIndex.value = i
  editForm.value = {
    name: item.name || '',
    duration: item.duration || '',
    cost: item.estimatedCostCny != null ? String(item.estimatedCostCny) : '',
    reason: item.reason || '',
    tip: item.tip || '',
    images: Array.isArray(item.images) ? item.images.slice() : [],
    lat: typeof item.lat === 'number' ? item.lat : null,
    lng: typeof item.lng === 'number' ? item.lng : null,
    hasCoord: typeof item.lat === 'number' && typeof item.lng === 'number',
    raw: Object.assign({}, item)
  }
  editVisible.value = true
}

// 添加景点入口：搜索地点（关键字搜 POI）/ 地图选点 / 手动填写，三者都进同一个编辑表单
function chooseAndAddSpot() {
  if (isHot.value) { Taro.showToast({ title: '示例行程不可编辑', icon: 'none' }); return }
  Taro.showActionSheet({ itemList: ['搜索地点添加', '地图选点添加', '手动填写'] }).then(r => {
    if (r.tapIndex === 0) {
      openSearch()
    } else if (r.tapIndex === 1) {
      // chooseLocation 限制不了选点范围 → 软限制：
      // ① 初始视野定在旅游城市中心（cityCenter，失败退回当前定位）
      // ② 选完后校验：距城市中心 >80km 判定不在旅游城市，拦截不进表单
      const city = (detail.value && detail.value.city) || ''
      console.warn('[itinerary] 地图选点 city =', JSON.stringify(city))
      Promise.all([
        city ? api.trips.cityCenter(city).catch(e => {
          // 不再静默：取不到城市中心要能看出来（否则地图会落到当前定位，看起来像「没生效」）
          console.warn('[itinerary] 城市中心获取失败', e)
          Taro.showToast({ title: (e && e.message) || '无法获取城市中心，地图将定位到当前位置', icon: 'none', duration: 2500 })
          return null
        }) : Promise.resolve(null),
        getPosition()
      ]).then(([center, pos]) => {
        const start = center || pos
        console.warn('[itinerary] 地图选点初始视野 =', start.lat, start.lng, center ? '（城市中心）' : '（当前定位兜底）')
        Taro.chooseLocation({
          latitude: start.lat,
          longitude: start.lng,
          success: loc => {
            if (center) {
              const dist = haversineKm(center.lat, center.lng, loc.latitude, loc.longitude)
              if (dist > 80) {
                Taro.showToast({ title: `所选位置距${city}约${Math.round(dist)}公里，请在${city}市内选点`, icon: 'none', duration: 2500 })
                return
              }
            }
            editIsNew.value = true
            editForm.value = {
              name: loc.name || loc.address || '',
              duration: '', cost: '', reason: '', tip: '', images: [],
              lat: loc.latitude, lng: loc.longitude, hasCoord: true, raw: null
            }
            editVisible.value = true
          },
          fail: () => Taro.showToast({ title: '未选择位置', icon: 'none' })
        })
      })
    } else if (r.tapIndex === 2) {
      editIsNew.value = true
      editForm.value = { name: '', duration: '', cost: '', reason: '', tip: '', images: [], lat: null, lng: null, hasCoord: false, raw: null }
      editVisible.value = true
    }
  }).catch(() => {})
}

// ---------- 地点搜索添加（api.trips.searchPlace → 腾讯位置服务，key 在 config.js 的 LBS_KEY） ----------
const searchVisible = ref(false)
const searchKeyword = ref('')
const searching = ref(false)
const searchResults = ref([])
const searchTip = ref('')
const searchScope = ref('')   // 展示实际搜索范围：城市名（region 模式）或「你周边5公里」（定位兜底）

function openSearch() {
  searchKeyword.value = ''
  searchResults.value = []
  searchTip.value = ''
  searchScope.value = ''
  searchVisible.value = true
}

// 搜索：优先按行程所在城市全城搜（模拟器定位必失败，设备定位不可靠）；无城市信息才退回周边 5km
function doSearchPlace() {
  const kw = (searchKeyword.value || '').trim()
  if (!kw) { Taro.showToast({ title: '请输入关键字', icon: 'none' }); return }
  if (searching.value) return
  searching.value = true
  searchTip.value = ''
  const city = (detail.value && detail.value.city) || ''
  // 排查用：city 为空说明后端详情没返回城市字段 → 会退回定位周边 5km（界面上能看到）
  console.warn('[itinerary] 搜索范围 city =', JSON.stringify(city))
  searchScope.value = city ? city + '（全城）' : '你周边 5 公里'
  getPosition().then(pos => api.trips.searchPlace(kw, { city: city, lat: pos.lat, lng: pos.lng })).then(list => {
    // auto_extend 会在本市结果不足时扩展到全国 → 按 POI 所属城市过滤外地结果，并提醒用户
    let inCity = list
    let filtered = 0
    if (city) {
      const norm = s => (s || '').replace(/(特别行政区|自治州|市)$/, '')
      const target = norm(city)
      inCity = list.filter(p => !p.city || norm(p.city).indexOf(target) !== -1 || target.indexOf(norm(p.city)) !== -1)
      filtered = list.length - inCity.length
    }
    searchResults.value = inCity
    if (inCity.length) {
      searchTip.value = ''
      if (filtered) searchScope.value += `，已隐藏 ${filtered} 个外地结果`
    } else {
      searchTip.value = filtered
        ? `没找到${city}的相关景点（${filtered} 个其他城市的已过滤），换个关键字试试`
        : '没找到相关地点，换个关键字试试'
    }
  }).catch(e => {
    searchResults.value = []
    searchTip.value = (e && e.message) || '搜索失败，请稍后再试'
  }).finally(() => { searching.value = false })
}

// 两点球面距离（km）：地图选点后校验是否落在旅游城市附近
function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLng / 2), 2)
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 选中搜索结果 → 带坐标进编辑表单（同地图选点的落点）
function pickPlace(p) {  searchVisible.value = false
  editIsNew.value = true
  editForm.value = {
    name: p.name, duration: '', cost: '', reason: '', tip: '', images: [],
    lat: p.lat, lng: p.lng, hasCoord: true, raw: null
  }
  editVisible.value = true
}

// 保存：新增走 POST /spot，编辑走 PUT /spot（新 spot 完整覆盖）
function saveSpot() {
  const f = editForm.value
  const name = (f.name || '').trim()
  if (!name) { Taro.showToast({ title: '请填写景点名称', icon: 'none' }); return }
  if (editSaving.value) return
  editSaving.value = true
  // 从原 spot 复制保留未知字段（transport 等），再覆盖表单字段；剔除时间线的展示字段
  const spot = Object.assign({}, f.raw || {})
  delete spot.kind; delete spot.icon; delete spot.no
  spot.name = name
  spot.duration = (f.duration || '').trim()
  spot.reason = (f.reason || '').trim()
  spot.tip = (f.tip || '').trim()
  spot.images = Array.isArray(f.images) ? f.images.slice() : []   // 图片附件（OSS URL 数组）
  const cost = parseFloat(f.cost)
  spot.estimatedCostCny = isFinite(cost) ? cost : null
  if (f.hasCoord) { spot.lat = f.lat; spot.lng = f.lng }
  const req = editIsNew.value
    ? api.trips.spotAdd(tripId.value, activeDay.value, spot)
    : api.trips.spotEdit(tripId.value, activeDay.value, editSpotIndex.value, spot)
  req.then(() => {
    editSaving.value = false
    editVisible.value = false
    refreshCurrent()
  }).catch(e => {
    editSaving.value = false
    Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
  })
}

// ---------- 图片附件（选图 → base64 → POST /api/upload/image 换 OSS URL）----------
const uploadingImg = ref(false)

function pickSpotImage() {
  if (uploadingImg.value || isHot.value) return
  const remain = 9 - editForm.value.images.length
  if (remain <= 0) { Taro.showToast({ title: '最多 9 张', icon: 'none' }); return }
  Taro.chooseImage({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'] }).then(res => {
    uploadingImg.value = true
    const fsm = Taro.getFileSystemManager()
    Promise.all(res.tempFilePaths.map(p => new Promise((resolve, reject) => {
      fsm.readFile({ filePath: p, encoding: 'base64', success: r => resolve(r.data), fail: reject })
    }))).then(list => {
      // 逐张上传（后端单图接口），全部成功后一次性并入表单
      return Promise.all(list.map(b64 => api.upload.image(b64).then(d => {
        if (!d || !d.url) throw { message: '上传返回为空' }
        return d.url
      })))
    }).then(urls => {
      editForm.value.images = editForm.value.images.concat(urls)
      Taro.showToast({ title: `已上传 ${urls.length} 张`, icon: 'success' })
    }).catch(e => {
      Taro.showToast({ title: (e && e.message) || '图片上传失败', icon: 'none' })
    }).finally(() => { uploadingImg.value = false })
  }).catch(() => {})   // 用户取消选图
}
function removeSpotImage(k) {
  editForm.value.images.splice(k, 1)
}
// 预览：编辑表单内看当前表单的图；时间线上看景点已保存的图
function previewSpotImages(k) {
  Taro.previewImage({ current: editForm.value.images[k], urls: editForm.value.images })
}
function previewItemImages(item, k) {
  const urls = (item && item.images) || []
  if (!urls.length) return
  Taro.previewImage({ current: urls[k], urls })
}

// ---------- 从我出发重排（最近邻：定位 → 后端算顺序+步行距离 → 确认后套用）----------
const nearby = reactive({ visible: false, loading: false, dayIndex: 0, route: [], origin: null, originIsFallback: false })

function fmtDist(m) {
  if (m == null || !isFinite(m)) return '距离未知'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function openNearby() {
  if (nearby.loading || spotBusy.value || isHot.value) return
  nearby.visible = true
  nearby.loading = true
  nearby.route = []
  nearby.dayIndex = activeDay.value
  nearby.origin = null
  getPosition(true).then(pos => {   // force=true：绕过 5 秒缓存，每次都是新的定位意图
    if (!pos || !isFinite(pos.lat) || !isFinite(pos.lng)) throw { message: '定位失败，请重试' }
    // 诊断日志：与后端 [route] 日志对表；isFallback=定位失败回退的演示坐标 (23.5, 113.6)
    console.log('[reorder] 前端发出 lat,lng:', pos.lat, pos.lng, pos.isFallback ? '·(演示兜底坐标！非真实定位)' : '')
    nearby.origin = { lat: pos.lat, lng: pos.lng }
    nearby.originIsFallback = !!pos.isFallback   // 演示坐标时弹层里明示，避免误以为定位准
    return api.trips.reorderFrom(tripId.value, pos.lat, pos.lng, activeDay.value)
  }).then(d => {
    nearby.route = (d && d.route) || []
    if (!nearby.route.length) throw { message: '本天没有可排序的景点' }
  }).catch(e => {
    nearby.visible = false
    Taro.showToast({ title: (e && e.message) || '路线计算失败', icon: 'none' })
  }).finally(() => { nearby.loading = false })
}
// 套用顺序：route 只含 spots（food 不参与），按 name 匹配重排；确认前不动本地数据
function applyNearby() {
  if (spotBusy.value) return
  const day = currentDay.value
  if (!day || !Array.isArray(day.spots) || !nearby.route.length) return
  const byName = {}
  day.spots.forEach(s => { if (byName[s.name] == null) byName[s.name] = s })   // 同名取第一个
  const ordered = []
  const used = new Set()
  nearby.route.forEach(r => {
    const s = byName[r.name]
    if (s && !used.has(s)) { ordered.push(s); used.add(s) }
  })
  // 后端漏掉的景点（无坐标等）追加到末尾，不丢数据
  day.spots.forEach(s => { if (!used.has(s)) ordered.push(s) })
  const snapshot = JSON.parse(JSON.stringify(detail.value.result))
  day.spots = ordered
  renderDay(activeDay.value)
  nearby.visible = false
  spotBusy.value = true
  api.trips.putResult(tripId.value, detail.value.result).then(() => {
    Taro.showToast({ title: '已按最优顺序重排', icon: 'success' })
  }).catch(e => {
    detail.value.result = snapshot
    renderDay(activeDay.value)
    Taro.showToast({ title: e.message || '保存顺序失败', icon: 'none' })
  }).finally(() => { spotBusy.value = false })
}

function confirmRemove(item, i) {  if (spotBusy.value) return
  Taro.showModal({ title: '删除景点', content: `确定从行程中删除「${item.name}」吗？` }).then(r => {
    if (!r.confirm) return
    spotBusy.value = true
    api.trips.spotRemove(tripId.value, activeDay.value, i).then(refreshCurrent)
      .catch(e => Taro.showToast({ title: e.message || '删除失败', icon: 'none' }))
      .finally(() => { spotBusy.value = false })
  })
}

// 同天移动：toSpot 是插入位置；上移/下移各 ±1，越界直接忽略
// ⚠️ 后端 move 的插入语义对「下移」存在 off-by-one（实测：上移正常、下移不动/报越界）。
// 规避：「把 i 下移」≡「把 i+1 上移」（最终顺序等价），改发上移参数，复用已验证可用的路径；
// 后端若修正语义，这段写法在「先移出再按 toSpot 插入」口径下结果同样正确，无需回改。
function moveWithin(i, to) {
  const spots = (currentDay.value && currentDay.value.spots) || []
  if (to < 0 || to >= spots.length) return
  if (spotBusy.value) return
  const down = to > i
  const from = down ? i + 1 : i
  const dest = down ? i : to
  spotBusy.value = true
  api.trips.spotMove(tripId.value, activeDay.value, from, activeDay.value, dest).then(refreshCurrent)
    .catch(e => Taro.showToast({ title: e.message || '移动失败', icon: 'none' }))
    .finally(() => { spotBusy.value = false })
}

// ---------- 拖拽排序（长按/按住 ⋮⋮ 手柄上下拖，松手落位）----------
// 视觉层：拖拽期间只做 transform 位移（被拖卡跟手、中间卡让位），松手才真正重排数组；
// 持久化：一次 PUT /result 整体覆盖——绕开 spot/move 对「下移」的 off-by-one（单次调用最稳）
const drag = reactive({ active: false, idx: -1, target: -1, startY: 0, dy: 0, h: 40 })
let dragRows = []   // 拖拽开始时测的每行 {top, height}（视口坐标，拖拽期间页面不滚动故稳定）

function onDragStart(i, e) {
  if (isHot.value || spotBusy.value) return
  const touch = e.touches && e.touches[0]
  if (!touch) return
  const total = currentItems.value.length
  Taro.createSelectorQuery().selectAll('.tl-item').boundingClientRect(rects => {
    if (!rects || rects.length !== total) return   // 界面刚变过，本次放弃（再按一次即可）
    dragRows = rects.map(r => ({ top: r.top, height: r.height }))
    drag.active = true
    drag.idx = i
    drag.target = i
    drag.startY = touch.clientY
    drag.dy = 0
    drag.h = dragRows[i].height
    Taro.vibrateShort({ type: 'medium' })
  }).exec()
}

function onDragMove(e) {
  if (!drag.active) return
  const touch = e.touches && e.touches[0]
  if (!touch) return
  drag.dy = touch.clientY - drag.startY
  // 目标位：被拖卡中心落在哪一行的中线之后
  const n = ((currentDay.value && currentDay.value.spots) || []).length
  const r0 = dragRows[drag.idx]
  const center = r0.top + r0.height / 2 + drag.dy
  let t = 0
  for (let k = 0; k < n; k++) {
    if (center > dragRows[k].top + dragRows[k].height / 2) t = k
  }
  drag.target = t
}

function onDragEnd() {
  if (!drag.active) return
  const from = drag.idx
  const to = drag.target
  drag.active = false
  drag.dy = 0
  if (from === to) return
  const day = currentDay.value
  if (!day || !Array.isArray(day.spots)) return
  const snapshot = JSON.parse(JSON.stringify(detail.value.result))   // 失败回滚用
  // 本地重排（乐观）：先移出再插入
  const moved = day.spots.splice(from, 1)[0]
  day.spots.splice(to, 0, moved)
  renderDay(activeDay.value)   // 地图 marker/polyline 顺序同步
  spotBusy.value = true
  api.trips.putResult(tripId.value, detail.value.result).then(() => {
    Taro.showToast({ title: '顺序已更新', icon: 'success' })
  }).catch(e => {
    detail.value.result = snapshot
    renderDay(activeDay.value)
    Taro.showToast({ title: e.message || '保存顺序失败', icon: 'none' })
  }).finally(() => {
    spotBusy.value = false
  })
}

// 各行拖拽中的位移样式：被拖卡跟手；中间卡按被拖卡高度整体让位
function dragStyle(j) {
  if (!drag.active || drag.idx < 0) return ''
  const n = ((currentDay.value && currentDay.value.spots) || []).length
  const di = drag.idx
  const t = drag.target
  if (j === di) {
    return `transform: translateY(${drag.dy}px); z-index: 9;`
  }
  if (j < n) {
    if (di < t && j > di && j <= t) return `transform: translateY(${-drag.h}px);`
    if (t < di && j >= t && j < di) return `transform: translateY(${drag.h}px);`
  }
  return ''
}

// 跨天移动：插入到目标天景点末尾
function moveToOtherDay(i) {
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  const others = days.map((d, idx) => ({ idx, label: `第${d.day || idx + 1}天${d.title ? ' · ' + d.title : ''}` })).filter(x => x.idx !== activeDay.value)
  if (!others.length) { Taro.showToast({ title: '只有一天，无需移动', icon: 'none' }); return }
  Taro.showActionSheet({ itemList: others.map(x => x.label) }).then(r => {
    const toDay = others[r.tapIndex].idx
    const toSpot = (days[toDay].spots || []).length
    if (spotBusy.value) return
    spotBusy.value = true
    api.trips.spotMove(tripId.value, activeDay.value, i, toDay, toSpot).then(refreshCurrent)
      .catch(e => Taro.showToast({ title: e.message || '移动失败', icon: 'none' }))
      .finally(() => { spotBusy.value = false })
  }).catch(() => {})
}

// 天标题编辑：走 PUT /result 整体覆盖（深拷贝改一处，避免脏改本地引用）
function editDayTitle() {
  if (isHot.value) { Taro.showToast({ title: '示例行程不可编辑', icon: 'none' }); return }
  const d = currentDay.value
  if (!d) return
  Taro.showModal({
    title: '编辑当日标题',
    editable: true,
    placeholderText: '如：西湖环湖一日',
    content: d.title || ''
  }).then(r => {
    if (!r.confirm) return
    const val = (r.content || '').trim()
    if (!val || val === d.title) return
    const result = JSON.parse(JSON.stringify(detail.value.result))
    result.days[activeDay.value].title = val
    api.trips.putResult(tripId.value, result).then(refreshCurrent)
      .catch(e => Taro.showToast({ title: e.message || '保存失败', icon: 'none' }))
  })
}

function goHome() {
  // 表单页已移出 tabBar，改用 navigateTo（tab 页才需要 switchTab）
  Taro.navigateTo({ url: '/pages/index/index' })
}
</script>

<style>
/* ========== 配色规范（2026-09-22 定稿）：主色浅湖绿 #22C55E · 暖浅橙 #F29979 · 卡片 #FFF · 底 #F7F9F9 · 正文 #333 · 次要 #868E96 ========== */
.wrap { background: #F7F9F9; min-height: 100vh; }
.center-card { text-align: center; padding: 60rpx 40rpx; }
.big-icon { width: 96rpx; height: 96rpx; margin: 0 auto 16rpx; display: block; }
.btn.ghost { background: #fff; color: #22C55E; border: 1rpx solid #22C55E; }
.warn-note { color: #F29979; }

/* ---------- 日子胶囊切换（scroll-view 横滑） ---------- */
/* scroll-view 内不能用 flex（flex 子项会把横向滚动撑死），用 inline-block + nowrap */
.day-tabs { margin-top: 32rpx; margin-bottom: 24rpx; white-space: nowrap; }
.day-pill {
  display: inline-block;
  padding: 12rpx 40rpx; margin-right: 16rpx; border-radius: 999rpx;
  font-size: 26rpx; color: #868E96;
  white-space: nowrap;
  background: #fff; border: 1rpx solid #E8E8E8;
}
.day-pill.active {
  background: #22C55E; color: #fff;
  border-color: #22C55E; font-weight: 600;
}

/* ---------- 行程头卡（渐变 hero：目的地 + 元信息 + 预算） ---------- */
/* 热门城市示例横幅 */
.hot-banner {
  margin-top: 16rpx; padding: 14rpx 24rpx;
  background: #E7F9EE; color: #15803D;
  font-size: 24rpx; text-align: center; border-radius: 12rpx;
  display: flex; align-items: center; justify-content: center; gap: 8rpx;
}
.bn-ico { width: 28rpx; height: 28rpx; flex-shrink: 0; }
/* 头部胶囊按钮内图标（白）与各地图钉/刷新等内联图标 */
.he-ico { width: 26rpx; height: 26rpx; flex-shrink: 0; }
.replan-entry, .pdf-entry, .share-entry { display: flex; align-items: center; gap: 6rpx; }
.wx-title, .wx-dtext { display: flex; align-items: center; gap: 8rpx; }
.wx-ico { width: 30rpx; height: 30rpx; flex-shrink: 0; }
.rf-ico { width: 26rpx; height: 26rpx; flex-shrink: 0; }
.day-nearby { display: flex; align-items: center; gap: 4rpx; }
.dn-ico { width: 26rpx; height: 26rpx; flex-shrink: 0; }
.tl-ico-img { width: 26rpx; height: 26rpx; flex-shrink: 0; }
.grip-ico { width: 30rpx; height: 30rpx; }
.tl-name { display: flex; align-items: center; gap: 8rpx; }
.kind-ico { width: 28rpx; height: 28rpx; flex-shrink: 0; }
.tl-prac-k { display: flex; align-items: center; gap: 6rpx; }
.pk-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; }
.day-note { display: flex; align-items: flex-start; gap: 8rpx; }
.dn2-ico { width: 28rpx; height: 28rpx; flex-shrink: 0; margin-top: 4rpx; }
.tips-card .tips-head { display: flex; align-items: center; gap: 8rpx; }
.th-ico { width: 30rpx; height: 30rpx; }
.collab-title { display: flex; align-items: center; gap: 8rpx; }
.ct-ico { width: 30rpx; height: 30rpx; }
.collab-refresh { display: flex; align-items: center; gap: 4rpx; }
.replan-title { display: flex; align-items: center; gap: 8rpx; }
.rt-ico { width: 30rpx; height: 30rpx; }
.df-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; }
.se-scope { display: flex; align-items: center; justify-content: center; gap: 6rpx; }
.sc-ico { width: 26rpx; height: 26rpx; }
.se-name { display: flex; align-items: center; gap: 6rpx; }
.ed-coord { display: flex; align-items: center; justify-content: center; gap: 6rpx; }
.ed-coord.warn { justify-content: flex-start; }
.ed-title { display: flex; align-items: center; justify-content: center; gap: 8rpx; }
.hero {
  position: relative;
  /* 柔和灰绿主题（2026-10-08 用户反馈原 #4ADE80→#22C55E 太亮刺眼）：降饱和、压明度，
     与首页 hero 卡（#52B788→#2D6A4F）同一色系 */
  background: linear-gradient(135deg, #57B98A 0%, #3F9168 55%, #2D6A4F 100%);
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  color: #fff;
  overflow: hidden;
}
/* 标题行：城市名与操作按钮同一行，两端对齐、垂直居中 */
.hero-top {
  display: flex; align-items: center; justify-content: space-between;
}
.hero-city { font-size: 44rpx; font-weight: 700; letter-spacing: 2rpx; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 18rpx; }
.chip {
  font-size: 20rpx; color: #eafff6;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 999rpx; padding: 4rpx 16rpx;
  white-space: nowrap;
}
.hero-estimate { display: flex; align-items: center; gap: 14rpx; margin-top: 22rpx; font-size: 38rpx; font-weight: 700; }
.hero-overview { font-size: 26rpx; line-height: 1.7; color: rgba(255, 255, 255, 0.88); margin-top: 18rpx; }
.hero-diff { font-size: 22rpx; color: rgba(255, 255, 255, 0.66); margin-top: 10rpx; }
.budget-tag { font-size: 22rpx; font-weight: 400; padding: 4rpx 16rpx; border-radius: 20rpx; }
.budget-tag.within { background: #ffffff; color: #15803D; }
.budget-tag.over { background: #ffffff; color: #F29979; }

/* ---------- 地图卡片化 ---------- */
.map-card { border-radius: 20rpx; overflow: hidden; margin-bottom: 16rpx; }
.map-card .map { width: 100%; height: 380rpx; display: block; }

/* ---------- 当天标题行 ---------- */
.day-head { display: flex; align-items: center; gap: 16rpx; margin: 8rpx 0 20rpx; }
.day-head-l { flex: 1; display: flex; align-items: center; gap: 12rpx; min-width: 0; }
.day-head-title {
  font-size: 30rpx; font-weight: 600; color: #333333;
  /* 一行放不下时两行自动平分（避免「日」单字孤行）；不支持该属性的内核回落普通换行 */
  text-wrap: balance;
}
.day-theme {
  display: inline-block;
  align-self: flex-start;
  font-size: 20rpx; color: #15803D;
  background: #E7F9EE; border-radius: 8rpx; padding: 6rpx 16rpx;
  margin: -8rpx 0 16rpx;
}
.day-cost { font-size: 26rpx; font-weight: 600; color: #22C55E; }

/* ---------- 骨架屏 ---------- */
.sk-hero {
  background: linear-gradient(135deg, #22C55E 0%, #3A8A7C 100%);
  border-radius: 24rpx; padding: 36rpx 32rpx; margin-bottom: 24rpx;
}
.sk-card { background: #fff; border-radius: 20rpx; padding: 28rpx; margin-bottom: 24rpx; }
.sk-line {
  height: 26rpx; border-radius: 8rpx; margin-bottom: 18rpx;
  background: linear-gradient(90deg, #eef1f0 25%, #f8fbfa 45%, #eef1f0 65%);
  background-size: 200% 100%;
  animation: sk-shine 1.2s infinite;
}
.sk-line.strong { height: 32rpx; }
.sk-line.light { background: rgba(255, 255, 255, 0.25); background-size: 200% 100%; }
.sk-tip { text-align: center; }
@keyframes sk-shine {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ---------- 时间线（左侧竖线 + 圆点 + 卡片） ---------- */
.timeline { position: relative; padding-left: 36rpx; margin-bottom: 8rpx; }
/* 竖线贯穿整个时间轴 */
.timeline::before {
  content: ''; position: absolute; left: 8rpx; top: 16rpx; bottom: 16rpx;
  width: 4rpx; border-radius: 2rpx; background: #C9E4E0;
}
.tl-item { position: relative; margin-bottom: 24rpx; }
/* 轴点：数字圆点，与地图 marker 序号一致；美食项用暖色「食」 */
.tl-dot {
  position: absolute; left: -44rpx; top: 24rpx;
  width: 36rpx; height: 36rpx; border-radius: 50%;
  background: #22C55E; border: 4rpx solid #DDF0ED;
  color: #fff; font-size: 20rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box;
}
.tl-dot.is-food { background: #F29979; }
.tl-card {
  background: #fff; border-radius: 20rpx; padding: 28rpx;
}
/* 美食卡：暖色浅底 + 左侧暖色描边，与景点区分（调研：不同类型的卡片要有差异化） */
.tl-card.is-food { background: #FEF6F2; border-left: 6rpx solid #F29979; }
.tl-time { display: flex; align-items: center; gap: 10rpx; font-size: 28rpx; font-weight: 600; color: #333333; }
.tl-ico { font-size: 26rpx; }
.tl-badge {
  font-size: 20rpx; font-weight: 400; color: #F29979;
  background: #FEF6F2; border-radius: 8rpx; padding: 2rpx 12rpx;
}
.tl-name { font-size: 30rpx; font-weight: 600; color: #333333; margin-top: 14rpx; }
.tl-reason { font-size: 26rpx; color: #868E96; line-height: 1.7; margin-top: 10rpx; }
.tl-cost { display: flex; align-items: center; gap: 10rpx; font-size: 26rpx; color: #333333; margin-top: 12rpx; }
.tl-transport { display: flex; align-items: center; gap: 10rpx; font-size: 24rpx; color: #22C55E; margin-top: 10rpx; }
/* 避坑提示：暖浅橙重点文字（规范：次要强调色用于提示） */
.tl-tip {
  margin-top: 14rpx; font-size: 24rpx; color: #F29979; line-height: 1.6;
  background: #FEF6F2; border-radius: 10rpx; padding: 12rpx 16rpx;
}
/* 实用信息（practical）：浅绿信息块，标签定宽对齐 */
.tl-prac { margin-top: 14rpx; background: #E7F9EE; border-radius: 10rpx; padding: 12rpx 16rpx; }
.tl-prac-row { display: flex; font-size: 24rpx; line-height: 1.7; }
.tl-prac-k { flex: none; width: 116rpx; color: #15803D; }
.tl-prac-v { flex: 1; color: #333333; }

/* ---------- 当天备注 / 注意事项 ---------- */
.day-note { font-size: 26rpx; color: #868E96; line-height: 1.7; }
.tips-card .tips-head { font-size: 30rpx; font-weight: 600; color: #F29979; margin-bottom: 14rpx; }
.tips-item {
  position: relative; padding-left: 28rpx;
  font-size: 26rpx; color: #868E96; line-height: 1.7; margin-bottom: 10rpx;
}
.tips-item::before {
  content: ''; position: absolute; left: 6rpx; top: 18rpx;
  width: 8rpx; height: 8rpx; border-radius: 50%; background: #F29979;
}

/* ---------- 行程编辑 ---------- */
/* 卡片右上角编辑提示（弱化显示，不打断扫读） */
/* 添加景点：虚线边框的轻量入口 */
.add-spot {
  margin: 8rpx 0 24rpx; padding: 24rpx 0; text-align: center;
  border: 2rpx dashed #9CCFC7; border-radius: 20rpx;
  color: #22C55E; font-size: 28rpx; background: rgba(34, 197, 94, 0.04);
}
/* 天标题可编辑提示：右下角小铅笔 */
.day-title-edit { font-size: 22rpx; opacity: 0.45; margin-left: 6rpx; }
/* 景点编辑弹层 */
.ed-mask {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.ed-pop {
  width: 620rpx; max-height: 82vh; box-sizing: border-box;
  background: #fff; border-radius: 24rpx; padding: 36rpx 32rpx;
  display: flex; flex-direction: column;
}
/* 编辑景点弹层：固定高度 + 滚动区给确定高度（flex 撑高在 WXSS 里对 scroll-view 不可靠） */
.ed-pop.tall { height: 82vh; }
.ed-body { height: 56vh; }
.ed-title { font-size: 32rpx; font-weight: 700; color: #333333; text-align: center; }
.ed-coord {
  margin-top: 12rpx; text-align: center;
  font-size: 22rpx; color: #15803D; background: #E7F9EE;
  border-radius: 8rpx; padding: 6rpx 0;
}
.ed-coord.warn { color: #B36A3D; background: #FBEFE7; text-align: left; padding: 10rpx 16rpx; line-height: 1.6; }
.ed-field { display: flex; align-items: center; margin-top: 22rpx; }
.ed-field.col { flex-direction: column; align-items: stretch; }
.ed-label { width: 140rpx; font-size: 26rpx; color: #333333; flex-shrink: 0; }
.ed-field.col .ed-label { width: auto; margin-bottom: 10rpx; }
.ed-input {
  flex: 1; font-size: 26rpx; color: #333333; height: 64rpx;
  background: #F7F9F9; border-radius: 12rpx; padding: 0 20rpx; box-sizing: border-box;
}
.ed-area {
  width: 100%; box-sizing: border-box; min-height: 100rpx;
  font-size: 26rpx; color: #333333; line-height: 1.6;
  background: #F7F9F9; border-radius: 12rpx; padding: 16rpx 20rpx;
}
.ed-btns { display: flex; gap: 20rpx; margin-top: 32rpx; }
.ed-btn {
  flex: 1; text-align: center; padding: 18rpx 0;
  background: #22C55E; color: #fff; border-radius: 16rpx; font-size: 28rpx;
}
.ed-btn.ghost { background: #fff; color: #868E96; border: 1rpx solid #E8E8E8; }
.ed-btn.disabled { opacity: 0.6; }

/* 地点搜索弹层：搜索条 + 结果列表 */
.se-bar { display: flex; align-items: center; gap: 16rpx; margin-top: 24rpx; }
.se-input { flex: 1; }
.se-go {
  flex-shrink: 0; padding: 14rpx 28rpx;
  background: #22C55E; color: #fff; border-radius: 12rpx; font-size: 26rpx;
}
.se-go.disabled { opacity: 0.6; }
.se-list { margin-top: 20rpx; max-height: 52vh; }
.se-tip { padding: 40rpx 0; text-align: center; color: #868E96; font-size: 26rpx; }
.se-scope {
  padding: 12rpx 8rpx; font-size: 22rpx; color: #15803D;
  background: #E7F9EE; border-radius: 8rpx; text-align: center;
}
.se-item { padding: 20rpx 8rpx; border-bottom: 1rpx solid #E8E8E8; }
.se-item:last-child { border-bottom: none; }
.se-name { font-size: 28rpx; color: #333333; font-weight: 500; }
.se-addr { font-size: 24rpx; color: #868E96; margin-top: 6rpx; }

/* ---------- 分享 ---------- */
/* 分享徽标挂在渐变 hero 上 → 白色描边样式 */
/* 头卡操作组：跟随标题行 flex 排列（间距用 margin，兼容性比 gap 稳） */
.hero-actions {
  display: flex; align-items: center;
}
.share-entry {
  margin-left: 16rpx;
  font-size: 24rpx; color: #fff;
  padding: 8rpx 20rpx; border: 1rpx solid rgba(255, 255, 255, 0.6); border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  white-space: nowrap;
}
.pdf-entry {
  margin-left: 16rpx;
  font-size: 24rpx; color: #fff;
  padding: 8rpx 20rpx; border: 1rpx solid rgba(255, 255, 255, 0.6); border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  white-space: nowrap;
}
.replan-entry {
  font-size: 24rpx; color: #fff;
  padding: 8rpx 20rpx; border: 1rpx solid rgba(255, 255, 255, 0.6); border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
  white-space: nowrap;
}
/* AI 重排弹层 */
.replan-pop {
  width: 620rpx; background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx;
  box-sizing: border-box;
}
.replan-title { font-size: 34rpx; font-weight: 600; color: #333; }
.replan-sub { font-size: 24rpx; color: #868E96; margin-top: 10rpx; }
.replan-input {
  width: 100%; height: 140rpx; margin-top: 24rpx; padding: 20rpx;
  background: #F6F7F5; border-radius: 14rpx; font-size: 28rpx; color: #333;
  box-sizing: border-box;
}
.replan-chips { display: flex; flex-wrap: wrap; gap: 14rpx; margin-top: 20rpx; }
.replan-chip {
  font-size: 22rpx; color: #15803D; background: #E7F9EE;
  padding: 10rpx 20rpx; border-radius: 999rpx;
}
/* 重排对比确认面板 */
.diff-pop { width: 660rpx; max-height: 80vh; display: flex; flex-direction: column; }
.diff-summary { display: flex; gap: 16rpx; margin-top: 18rpx; }
.ds-item { font-size: 22rpx; padding: 6rpx 18rpx; border-radius: 999rpx; background: #F1EFE8; color: #868E96; }
.ds-item.add { background: #E7F9EE; color: #15803D; }
.ds-item.del { background: #FBECE7; color: #C75B39; }
.diff-list { flex: 1; max-height: 46vh; margin-top: 20rpx; }
.diff-day { padding: 16rpx 4rpx; border-bottom: 1rpx solid #F0EFEB; }
.diff-day.same { font-size: 24rpx; color: #B4B2A9; }
.diff-day-head { display: flex; align-items: baseline; gap: 12rpx; margin-bottom: 8rpx; }
.diff-day-no { font-size: 26rpx; font-weight: 600; color: #333; }
.diff-day-title { font-size: 22rpx; color: #868E96; }
.diff-row { font-size: 24rpx; padding: 6rpx 0; display: flex; align-items: center; gap: 10rpx; }
.diff-row.add { color: #15803D; }
.diff-row.del { color: #C75B39; text-decoration: line-through; }
.diff-row.del .diff-tag { text-decoration: none; }
.diff-row.order { color: #B0813C; }
.diff-tag { font-size: 20rpx; color: #868E96; }
.diff-note { font-size: 22rpx; color: #868E96; text-align: center; margin-top: 16rpx; }
/* 协作成员卡 */
.collab-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18rpx; }
.collab-title { font-size: 28rpx; font-weight: 600; color: #333333; }
.collab-refresh { font-size: 24rpx; color: #22C55E; }
.collab-row { display: flex; align-items: center; gap: 16rpx; padding: 12rpx 0; }
.collab-avatar { width: 64rpx; height: 64rpx; border-radius: 50%; flex-shrink: 0; }
.collab-avatar.ph {
  background: #E7F9EE; color: #15803D; font-size: 28rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.collab-name { flex: 1; font-size: 28rpx; color: #333333; }
.collab-owner { font-size: 20rpx; color: #F29979; border: 1rpx solid #F29979; border-radius: 999rpx; padding: 4rpx 14rpx; }
.collab-remove { font-size: 24rpx; color: #C75B39; padding: 6rpx 18rpx; }
.collab-me { font-size: 20rpx; color: #22C55E; border: 1rpx solid #22C55E; border-radius: 999rpx; padding: 4rpx 14rpx; }
.collab-note { font-size: 22rpx; color: #868E96; margin-top: 10rpx; }
/* 协作者的退出入口：描边小按钮，不与 owner 的移除混淆 */
.collab-quit {
  margin-top: 20rpx; text-align: center; font-size: 24rpx; color: #C75B39;
  border: 1rpx solid #E8C4B8; border-radius: 999rpx; padding: 14rpx 0;
}
/* 行程工具条：记账 / 备忘 / 行李 / 成员（前三个进独立页，成员滚到页内卡片） */
/* 工具条（2026-10-08 最终版）：恢复浅绿渐变卡衔接上下两张渐变卡；
   图标一图标一色（暖橙/宝蓝/琥珀/青绿/紫，与首页周边图标同色标），压在绿底上层次清楚 */
.tool-bar {
  display: flex;
  background: linear-gradient(180deg, #CDEBDC 0%, #EAF7F0 100%);
  border-radius: 24rpx;
  padding: 24rpx 8rpx;
  margin-top: 20rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 4rpx 16rpx rgba(21, 128, 61, 0.06);
}
.tool-item { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8rpx; }
.tool-item:active { opacity: 0.7; }
.tool-ico { width: 42rpx; height: 42rpx; }
.tool-txt { font-size: 22rpx; color: #2F5D46; }

/* 关联备忘：景点卡片内的小条 + 当天备忘卡 */
.tl-memo { display: flex; align-items: flex-start; gap: 10rpx; background: #E7F9EE; border-radius: 12rpx; padding: 12rpx 16rpx; margin-top: 12rpx; }
.tm-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; margin-top: 4rpx; }
.tm-text { flex: 1; font-size: 24rpx; color: #15803D; line-height: 1.5; }
.tm-text.done { color: #ADB5BD; text-decoration: line-through; }
.day-memo { margin-top: 20rpx; }
.dm-title { display: flex; align-items: center; gap: 8rpx; font-size: 26rpx; font-weight: 600; color: #15803D; margin-bottom: 12rpx; }
.dm-ico { width: 26rpx; height: 26rpx; }
.dm-item { padding: 10rpx 0; border-bottom: 1rpx solid #F1F3F5; }
.dm-item:last-child { border-bottom: none; }
.dm-text { font-size: 26rpx; color: #333333; line-height: 1.55; }
.dm-text.done { color: #ADB5BD; text-decoration: line-through; }


/* 图片附件：表单九宫格 + 时间线缩略行 */
.img-grid { display: flex; flex-wrap: wrap; gap: 14rpx; }
.img-cell { position: relative; width: 128rpx; height: 128rpx; }
.img-thumb { width: 100%; height: 100%; border-radius: 12rpx; }
.img-del { position: absolute; top: -10rpx; right: -10rpx; width: 36rpx; height: 36rpx; padding: 9rpx; box-sizing: border-box; background: rgba(51, 51, 51, 0.75); border-radius: 50%; }
.img-add { width: 128rpx; height: 128rpx; border: 2rpx dashed #B2C9C4; border-radius: 12rpx; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #15803D; }
.img-add-ico { font-size: 40rpx; line-height: 1; }
.img-add-txt { font-size: 20rpx; margin-top: 6rpx; }
.img-hint { font-size: 20rpx; color: #ADB5BD; margin-top: 12rpx; }
.tl-imgs { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 12rpx; }
.tl-img { width: 120rpx; height: 120rpx; border-radius: 10rpx; }

/* 从我出发重排弹层 */
.day-nearby { font-size: 22rpx; color: #22C55E; margin-left: 16rpx; white-space: nowrap; }
.nb-pop { padding-bottom: 32rpx; }
.nb-body { height: 46vh; margin-top: 16rpx; }
.nb-note { font-size: 22rpx; color: #868E96; margin-top: 10rpx; }
.nb-note.dim { color: #ADB5BD; margin: 16rpx 0 0; }
.nb-item { display: flex; align-items: center; gap: 18rpx; padding: 18rpx 0; border-bottom: 1rpx solid #F1F3F5; }
.nb-dot { width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center; font-size: 24rpx; font-weight: 700; color: #fff; background: #22C55E; border-radius: 50%; flex-shrink: 0; }
.nb-mid { flex: 1; display: flex; flex-direction: column; }
.nb-name { font-size: 26rpx; font-weight: 600; color: #333333; }
.nb-dist { font-size: 22rpx; color: #F29979; margin-top: 4rpx; }
/* 目的地天气卡 */
.wx-card { margin-bottom: 20rpx; }
/* ---------- 天气卡背景随天气类型变化（2026-10-08）：六类浅底渐变，深色文字不换色即保持可读 ---------- */
.wx-card.wx-sun   { background: linear-gradient(165deg, #FFF7E0 0%, #FFFFFF 70%); }  /* 晴：暖阳米黄 */
.wx-card.wx-cloud { background: linear-gradient(165deg, #EDF3F8 0%, #FFFFFF 70%); }  /* 多云/阴：灰蓝云层 */
.wx-card.wx-rain  { background: linear-gradient(165deg, #E3EEF9 0%, #F6FAFE 70%); }  /* 雨：清凉水蓝 */
.wx-card.wx-snow  { background: linear-gradient(165deg, #EAF3FB 0%, #FFFFFF 70%); }  /* 雪：冰晶浅蓝 */
.wx-card.wx-fog   { background: linear-gradient(165deg, #F1F0EC 0%, #FFFFFF 70%); }  /* 雾霾：暖灰 */
.wx-card.wx-storm { background: linear-gradient(165deg, #ECE8F6 0%, #FFFFFF 70%); }  /* 雷：灰紫 */
.wx-head { display: flex; justify-content: space-between; align-items: center; }
.wx-title { font-size: 26rpx; font-weight: 600; color: #333333; }
.wx-refresh { font-size: 24rpx; color: #22C55E; }
.wx-now { display: flex; align-items: center; gap: 24rpx; margin: 20rpx 0; }
.wx-temp { font-size: 72rpx; font-weight: 700; color: #15803D; line-height: 1; }
.wx-now-meta { display: flex; flex-direction: column; gap: 6rpx; }
.wx-text { font-size: 30rpx; color: #333333; font-weight: 600; }
.wx-sub { font-size: 22rpx; color: #868E96; }
.wx-days { display: flex; border-top: 1rpx solid #F0EFEB; padding-top: 18rpx; }
.wx-day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.wx-date { font-size: 22rpx; color: #868E96; }
.wx-dtext { font-size: 24rpx; color: #333333; }
.wx-dtemp { font-size: 22rpx; color: #868E96; }
/* 拖拽排序 */
.tl-item { transition: transform 0.15s ease; }
.tl-item.is-dragging { transition: none; opacity: 0.88; }
.tl-item.is-dragging .tl-card { box-shadow: 0 8rpx 28rpx rgba(46, 110, 99, 0.35); }
/* 拖拽手柄（原 ⋮⋮ 六点）改为灰色铅笔 ✎：视觉上就是「可编辑」标识，按住仍是拖拽排序手柄 */
.tl-grip {
  margin-left: auto; padding: 6rpx 12rpx; font-size: 30rpx; line-height: 1;
  color: #C3CACE;
}
.tl-grip:active { color: #22C55E; }
.share-mask {
  position: fixed; inset: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.share-pop {
  width: 580rpx; box-sizing: border-box;
  background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx;
  display: flex; flex-direction: column; align-items: center;
}
.share-title { font-size: 32rpx; font-weight: 700; color: #333333; margin-bottom: 24rpx; }
.share-qr { width: 360rpx; height: 360rpx; border-radius: 12rpx; }
.share-qr-empty {
  width: 360rpx; height: 360rpx; border-radius: 12rpx;
  background: #F7F9F9; color: #868E96; font-size: 26rpx;
  display: flex; align-items: center; justify-content: center;
}
.share-note { font-size: 24rpx; color: #F29979; margin: 16rpx 0 0; text-align: center; }
.share-token { font-size: 26rpx; color: #333333; margin: 20rpx 0 4rpx; letter-spacing: 2rpx; }
.share-btn {
  width: 100%; margin-top: 20rpx; text-align: center; padding: 18rpx 0;
  background: #22C55E; color: #fff; border-radius: 16rpx; font-size: 28rpx;
}
.share-btn.ghost { background: #fff; color: #868E96; border: 1rpx solid #E8E8E8; }
/* 原生 <button open-type="share"> 自带默认样式（圆角灰底、::after 描边、行高 2.55），必须显式重置 */
.share-btn.btn-native { line-height: 1.5; box-sizing: border-box; border: none; }
.share-btn.btn-native::after { border: none; }
.share-tip { font-size: 22rpx; color: #868E96; margin-top: 20rpx; text-align: center; }
</style>
