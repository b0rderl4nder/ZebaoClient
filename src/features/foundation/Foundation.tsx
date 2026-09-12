import { useState } from 'react'
import { Link } from 'react-router-dom'
import { operatorPage } from '../../api/operator'

// Navigation to existing configuration owners; this is not a capability catalogue.
const sections = [
  { title: '交互与感知', items: [
    { name: '具身交互', note: '活跃度 · 模仿 · 表达', local: '/dashboard/foundation/interaction', route: '' },
    { name: '呼吸与听声转向', note: '待机开关 · 转向灵敏度', route: 'device/motion' },
    { name: '语音与唤醒', note: '链路 · 音色 · 激活状态', route: 'device/voice' },
    { name: '视觉', note: '摄像头 · 环境观察', route: 'device/vision' },
    { name: '人员与身份', note: '人脸 · 声纹 · 能力权限', route: 'people' },
  ] },
  { title: '设备与连接', items: [
    { name: '声音', note: '麦克风 · 音量', route: 'device/sound' },
    { name: '网络与物联网', note: 'Wi-Fi · 提供方连接', route: 'device/network' },
    { name: '存储', note: '空间 · 运行数据', route: 'device/storage' },
  ] },
  { title: '工程工具', items: [
    { name: '物理仿真', note: '实体镜像 · 动作验证', local: '/dashboard/simulation', route: '' },
    { name: '运行日志', note: '事件 · 故障原因', route: 'engineering/logs' },
    { name: '链路诊断', note: '回合 · 延迟 · 执行结果', route: 'engineering/pipeline' },
    { name: '验收记录', note: '发布版本 · 真实证据', route: 'engineering/acceptance' },
    { name: '提示词', note: '场景 · 用途 · 版本', route: 'engineering/prompts' },
  ] },
]

export default function Foundation({ simulated = false }: { simulated?: boolean }) {
  const [search, setSearch] = useState('')
  const filtered = sections.map(section => ({ ...section, items: section.items.filter(item => `${item.name}${item.note}`.includes(search.trim())) })).filter(section => section.items.length)
  return <div className="workspace-page">
    <header className="product-header"><div><h1>基础系统</h1><p>设备共用，场景按需挂载</p></div><label className="workspace-search"><span className="sr-only">查找设置</span><input type="search" placeholder="查找设置" value={search} onChange={event => setSearch(event.target.value)}/></label></header>
    <div className="workspace-body">
      {simulated && <p className="workspace-empty">连接设备后可打开真实配置。</p>}
      {filtered.map(section => <section className="foundation-section" key={section.title}><h2 className="workspace-section-title">{section.title}</h2><div className="foundation-grid">{section.items.map(item => {
        const content = <><strong>{item.name}</strong><span>{item.note}</span><i aria-hidden="true">{'local' in item ? '→' : '↗'}</i></>
        return 'local' in item && item.local ? <Link key={item.name} to={item.local}>{content}</Link> : simulated ? <div key={item.name} aria-disabled="true">{content}</div> : <a key={item.name} href={operatorPage(item.route)} target="_blank" rel="noreferrer">{content}</a>
      })}</div></section>)}
      {!filtered.length && <p className="workspace-empty">没有找到相关设置。</p>}
    </div>
  </div>
}
