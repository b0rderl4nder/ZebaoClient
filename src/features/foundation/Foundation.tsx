import { useState } from 'react'
import { Link } from 'react-router-dom'

// Navigation to existing configuration owners; this is not a capability catalogue.
const sections = [
  { title: '交互与感知', items: [
    { name: '具身交互', note: '活跃度 · 模仿 · 表达', local: '/dashboard/foundation/interaction', route: '' },
    { name: '呼吸与听声转向', note: '待机开关 · 转向灵敏度', local: '/dashboard/foundation/motion', route: '' },
    { name: '语音与唤醒', note: '默认链路 · 音色 · 唤醒', local: '/dashboard/foundation/voice', route: '' },
    { name: '视觉', note: '环境观察 · 主动开口', local: '/dashboard/foundation/vision', route: '' },
    { name: '人员与身份', note: '人脸 · 声纹 · 能力权限', local: '/dashboard/foundation/people', route: '' },
    { name: '定时静默', note: '暂时安静 · 提前结束', local: '/dashboard/foundation/quiet', route: '' },
    { name: '长期记忆', note: '查找 · 删除已保存记忆', local: '/dashboard/foundation/memory', route: '' },
    { name: '能力管理', note: '全局总开关 · 可用目录', local: '/dashboard/foundation/capabilities', route: '' },
  ] },
  { title: '设备与连接', items: [
    { name: '动作与姿态', note: '身体 · 舵机 · 预录动作', local: '/dashboard/control', route: '' },
    { name: '托管应用', note: '启动 · 停止 · 运行版本', local: '/dashboard/apps', route: '' },
    { name: '声音', note: '麦克风 · 音量', local: '/dashboard/foundation/sound', route: '' },
    { name: '网络与连接', note: 'Wi-Fi · 物联网 · 自启', local: '/dashboard/foundation/network', route: '' },
    { name: '存储', note: '磁盘空间 · 可用余量', local: '/dashboard/foundation/storage', route: '' },
  ] },
  { title: '工程工具', items: [
    { name: '物理仿真', note: '实体镜像 · 动作验证', local: '/dashboard/simulation', route: '' },
    { name: '运行日志', note: '事件 · 故障原因', local: '/dashboard/foundation/logs', route: '' },
    { name: '链路诊断', note: '回合 · 延迟 · 执行结果', local: '/dashboard/foundation/pipeline', route: '' },
    { name: '验收记录', note: '发布版本 · 真实证据', local: '/dashboard/foundation/acceptance', route: '' },
    { name: '提示词', note: '用途 · 版本 · 恢复默认', local: '/dashboard/foundation/prompts', route: '' },
  ] },
]

export default function Foundation({ simulated = false }: { simulated?: boolean }) {
  const [search, setSearch] = useState('')
  const filtered = sections.map(section => ({ ...section, items: section.items.filter(item => `${item.name}${item.note}`.includes(search.trim())) })).filter(section => section.items.length)
  return <div className="workspace-page">
    <header className="product-header"><div><h1>基础系统</h1><p>设备共用，场景按需挂载</p></div><label className="workspace-search"><span className="sr-only">查找设置</span><input type="search" placeholder="查找设置" value={search} onChange={event => setSearch(event.target.value)}/></label></header>
    <div className="workspace-body">
      {simulated && <p className="workspace-empty">连接设备后可打开真实配置。</p>}
      {filtered.map(section => {
        const content = <div className="foundation-list">{section.items.map(item => {
        const content = <><strong>{item.name}</strong><span>{item.note}</span><i aria-hidden="true">→</i></>
        return <Link key={item.name} to={item.local}>{content}</Link>
        })}</div>
        return section.title === '工程工具' ? <details className="foundation-section" key={section.title} open={search.trim() ? true : undefined}><summary>工程工具</summary>{content}</details> : <section className="foundation-section" key={section.title}><h2 className="workspace-section-title">{section.title}</h2>{content}</section>
      })}
      {!filtered.length && <p className="workspace-empty">没有找到相关设置。</p>}
    </div>
  </div>
}
