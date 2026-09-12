import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom'
import Scenes from '../features/scenes/Scenes'
import Foundation from '../features/foundation/Foundation'
import { setBaseUrl } from '../api/client'
import { operatorRequest } from '../api/operator'
import { restoreSceneRevision, type SceneConfig } from '../api/sceneConfig'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
const initial = (id = 'one'): SceneConfig => ({ id, name: id === 'one' ? '测试接待' : '临时展览', active: id === 'one', built_in: false, description: '', capabilities: ['tool'], settings: { tool: { preserved: true } }, flow_id: 'existing-flow', interaction_policy_id: 'policy', provider_mounts: { voice_profile_id: 'voice', interaction_profile_id: 'policy', knowledge_source_ids: ['book'], display_target_ids: [] } })
function backend() {
  setBaseUrl('http://robot.test:8000')
  let active = 'one'
  const records: Record<string, SceneConfig> = { one: initial(), two: initial('two') }
  let rejectPublish = false
  const embodied = { ok: true, global_activity_level: 'normal', scene_activity_levels: {} as Record<string, string>, scene_profiles: {} as Record<string, string>, available_activity_levels: [{ id: 'observe', name: '观察', description: '仅感知' }, { id: 'normal', name: '普通', description: '安全互动' }], available_profiles: [{ id: 'lively', name: '灵动表现', description: '本地表现配置', components: {}, allowed_reactions: [] }] }
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/operator-api/, '')
    const id = path.split('/').slice(-1)[0]
    if (path.endsWith('/embodied-interaction')) {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        if (body.activity_level === 'follow_global') delete embodied.scene_activity_levels[body.scene_id]
        else if (body.activity_level) embodied.scene_activity_levels[body.scene_id] = body.activity_level
        if (body.profile_id === 'auto') delete embodied.scene_profiles[body.scene_id]
        else if (body.profile_id) embodied.scene_profiles[body.scene_id] = body.profile_id
      }
      return Response.json(embodied)
    }
    if (path.endsWith('/scene-flows')) return Response.json({ flows: [{ id: 'none', name: '不使用流程', description: '', stages: [] }, { id: 'existing-flow', name: '已有流程', description: '已有产品流程', stages: [{ id: 'first', name: '第一步', goal: '确认需求', suggested_capabilities: ['tool', 'missing'] }] }] })
    if (path.endsWith('/scene-templates')) return Response.json({ templates: [{ id: 'blank', name: '空白组合', mode: 'blank', source_scene_id: '' }, { id: 'template:one', name: '以接待为模板', mode: 'template', source_scene_id: 'one' }, { id: 'copy:two', name: '复制临时展览', mode: 'copy', source_scene_id: 'two' }] })
    if (path.endsWith('/revisions')) return Response.json({ scene_id: path.split('/').slice(-2)[0], revisions: [{ revision_id: 'revision_1', name: '测试接待', reason: 'before_publish', flow_id: 'existing-flow', capability_count: 1 }] })
    if (path.endsWith('/restore')) return Response.json({ scene_restore: { scene_id: 'one', revision_id: 'revision_1', restored: true } })
    if (init?.method === 'POST' && path.endsWith('/activate')) active = path.split('/').slice(-2)[0]
    if (init?.method === 'PUT') records[id] = { ...records[id], ...JSON.parse(String(init.body)) }
    if (init?.method === 'DELETE') delete records[id]
    if (init?.method === 'POST' && path === '/api/v1/ui/scenes') {
      const body = JSON.parse(String(init.body)); records[body.scene_id] = { ...initial(body.scene_id), name: body.name }
      return Response.json({ ok: true, scene_id: body.scene_id })
    }
    if (path.endsWith('/publish') && rejectPublish) return Response.json({ ok: false }, { status: 500 })
    if (path.endsWith('/runtime')) return Response.json({ ok: true, state: 'ready', scene: { id: active, name: records[active]?.name }, capabilities: [] })
    if (path.startsWith('/api/v1/ui/scenes/') && records[id]) return Response.json({ ok: true, scene: records[id], catalog: [{ id: 'tool', name: '新挂载的能力', scope: 'scene', product_layer: 'capability' }, { id: 'global', name: '全局身份', scope: 'global', product_layer: 'capability' }], interaction_policies: [{ id: 'policy', name: '已有策略' }], provider_mount_catalog: { voice_profiles: [{ id: 'voice', name: '真实语音配置' }], knowledge_sources: [{ id: 'book', name: '展览资料', requires_capability: 'tool' }], display_targets: [] } })
    return Response.json({ ok: true, scenes: Object.values(records).map(scene => ({ ...scene, active: scene.id === active, capability_count: scene.capabilities.length })) })
  })
  vi.stubGlobal('fetch', request)
  return { request, records, embodied, failPublish: () => { rejectPublish = true } }
}
const show = () => render(<MemoryRouter><Scenes/></MemoryRouter>)
const ready = () => screen.findByRole('textbox', { name: '场景名称' })
function RouteProbe() {
  const navigate = useNavigate(), location = useLocation()
  return <><output aria-label="页面地址">{location.search}</output><button onClick={() => navigate('/dashboard/scenes?id=two&capability=tool')}>浏览器切换测试</button></>
}

describe('场景原位配置', () => {
  it('复制规则保留场景草稿，跨页签不丢策略编辑，不自动发布场景', async () => {
    const api = backend(), original = api.request.getMockImplementation()!
    const policy = { id: 'policy', name: '已有策略', description: '', built_in: true }
    const policies = [policy]
    api.request.mockImplementation(async (url, init) => {
      if (url.endsWith('/ui/interaction-policies')) return Response.json({ ok: true, policies, fields: [{ key: 'name', label: '策略名称', kind: 'text', max_length: 30 }, { key: 'description', label: '说明', kind: 'text', max_length: 160 }], defaults: policy, preserved_fields: [] })
      if (url.includes('/interaction-policies/') && init?.method === 'PUT') {
        policies.push({ ...JSON.parse(String(init.body)), id: url.split('/').pop(), built_in: false }); return Response.json({ ok: true })
      }
      return original(url, init)
    })
    show(); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '尚未保存的场景名称' } })
    fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.click(await screen.findByRole('button', { name: /查看与管理策略/ }))
    fireEvent.click(await screen.findByRole('button', { name: '复制策略' }))
    fireEvent.change(screen.getByRole('textbox', { name: '策略名称' }), { target: { value: '为此场景复制的规则' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '这个场景使用的语音' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '能力' }))
    fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    expect(screen.getByRole('textbox', { name: '策略名称' })).toHaveValue('为此场景复制的规则')
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }))
    await screen.findByText(/策略已创建；/)
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('尚未保存的场景名称')
    expect(screen.getByRole('combobox', { name: '交互策略' })).toHaveDisplayValue('为此场景复制的规则')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(api.request.mock.calls.filter(call => call[1]?.method)).toHaveLength(1)
    expect(api.records.one.name).toBe('测试接待')
  })
  it('整机设置链接直接定位所选场景的交互页签，不切换运行场景', async () => {
    const api = backend()
    render(<MemoryRouter initialEntries={['/dashboard/scenes?id=two&tab=interaction']}><Scenes/></MemoryRouter>)
    await screen.findByRole('combobox', { name: '主动程度' })
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览')
    expect(screen.getByRole('button', { name: '语音与交互' })).toHaveAttribute('aria-pressed', 'true')
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('具身设置按需读取，切换页签保留草稿，统一保存只写所选场景', async () => {
    const api = backend(); show(); await ready()
    expect(api.request.mock.calls.some(call => call[0].endsWith('/embodied-interaction'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览'))
    fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '主动程度' }), { target: { value: 'observe' } })
    fireEvent.change(screen.getByRole('combobox', { name: '动作表现' }), { target: { value: 'lively' } })
    fireEvent.click(screen.getByRole('button', { name: '知识与展示' }))
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
    expect(screen.getByRole('button', { name: '设为当前' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    expect(screen.getByRole('combobox', { name: '主动程度' })).toHaveValue('observe')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('此场景的具身设置已保存并回读')
    const writes = api.request.mock.calls.filter(call => call[1]?.method)
    expect(writes).toHaveLength(1)
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ scene_id: 'two', activity_level: 'observe', profile_id: 'lively' })
    expect(api.embodied.global_activity_level).toBe('normal')
    expect(api.embodied.scene_activity_levels.one).toBeUndefined()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
  it('恢复跟随只清除场景覆盖，不改变其他场景或全局', async () => {
    const api = backend(); api.embodied.scene_activity_levels = { one: 'observe', two: 'observe' }; api.embodied.scene_profiles = { one: 'lively' }
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '主动程度' }), { target: { value: 'follow_global' } })
    fireEvent.change(screen.getByRole('combobox', { name: '动作表现' }), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('此场景的具身设置已保存并回读')
    expect(api.embodied.scene_activity_levels).toEqual({ two: 'observe' })
    expect(api.embodied.scene_profiles).toEqual({})
  })
  it('具身草稿离开前确认，拒绝离开保持修改；还原不写设备', async () => {
    const api = backend(); vi.spyOn(window, 'confirm').mockReturnValue(false)
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '主动程度' }), { target: { value: 'observe' } })
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('测试接待')
    expect(screen.getByRole('combobox', { name: '主动程度' })).toHaveValue('observe')
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '还原' }))
    expect(screen.getByRole('combobox', { name: '主动程度' })).toHaveValue('follow_global')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('具身配置冲突在任何写入前阻止保存', async () => {
    const api = backend(); show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '主动程度' }), { target: { value: 'observe' } })
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '未提交名称' } })
    api.embodied.scene_activity_levels.one = 'normal'
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(/此场景的具身设置已在别处修改/)
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
    expect(screen.getByRole('combobox', { name: '主动程度' })).toHaveValue('observe')
  })
  it('部分保存失败明确回执，不伪报成功或丢弃具身草稿', async () => {
    const api = backend(), original = api.request.getMockImplementation()!
    api.request.mockImplementation(async (url, init) => url.endsWith('/embodied-interaction') && init?.method === 'PATCH' ? Response.json({ ok: false }, { status: 503 }) : original(url, init))
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    fireEvent.change(await screen.findByRole('combobox', { name: '主动程度' }), { target: { value: 'observe' } })
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '已提交名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText(/场景基础配置已保存；/)
    expect(screen.queryByText('已保存并发布')).not.toBeInTheDocument()
    expect(api.records.one.name).toBe('已提交名称')
    expect(screen.getByRole('combobox', { name: '主动程度' })).toHaveValue('observe')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })
  it('具身字段缺失只显示重试，不生成默认覆盖；其他场景参数仍可编辑', async () => {
    const api = backend(), original = api.request.getMockImplementation()!
    api.request.mockImplementation(async (url, init) => url.endsWith('/embodied-interaction') ? Response.json({ ok: true }) : original(url, init))
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    await screen.findByRole('button', { name: '重试具身设置' })
    expect(screen.queryByRole('combobox', { name: '主动程度' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('流程按需读取和原位编辑，选择不运行，不自动添加建议能力', async () => {
    const api = backend(); show(); await ready()
    expect(api.request.mock.calls.some(call => call[0].endsWith('/scene-flows'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /流程配置/ }))
    await screen.findByRole('option', { name: '已有流程' })
    expect(screen.getByText(/流程建议但尚未挂载/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('查看流程步骤'))
    expect(screen.getByText('确认需求')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '使用哪个流程' }), { target: { value: 'none' } })
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('已保存并发布')
    const body = JSON.parse(String(api.request.mock.calls.find(call => call[1]?.method === 'PUT')?.[1]?.body))
    expect(body).toMatchObject({ flow_id: 'none', capabilities: ['tool'], settings: { tool: { preserved: true } } })
    expect(api.request.mock.calls.some(call => /\/flow$|\/activate$/.test(call[0]))).toBe(false)
    expect(screen.queryByRole('link', { name: /流程与高级参数/ })).not.toBeInTheDocument()
  })
  it('流程接口缺失保留原场景与重试，不加载完整场景状态', async () => {
    const api = backend(); const original = api.request.getMockImplementation()!
    api.request.mockImplementation(async (url, init) => url.endsWith('/scene-flows') ? Response.json({ ok: false }, { status: 404 }) : original(url, init))
    show(); await ready()
    const previousFullReads = api.request.mock.calls.filter(call => call[0].endsWith('/api/v1/scenes')).length
    fireEvent.click(screen.getByRole('button', { name: /流程配置/ }))
    await screen.findByRole('button', { name: '重试流程目录' })
    expect(api.request.mock.calls.filter(call => call[0].endsWith('/api/v1/scenes'))).toHaveLength(previousFullReads)
    expect(api.records.one.flow_id).toBe('existing-flow')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })
  it('所选链路决定显示哪个交互说明，不受另一场景当前链路污染', async () => {
    const api = backend(); const original = api.request.getMockImplementation()!
    api.request.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      const data = await response.json()
      if (url.includes('/ui/scenes/one')) {
        data.voice_pipeline_provider = 'aliyun_native_omni'
        data.shared_voice_pipeline_provider = 'aliyun_native_omni'
        data.provider_mount_catalog.voice_profiles = [{ id: 'voice', name: '平台选择', provider: 'platform_ws' }, { id: 'shared', name: '跟随系统' }, { id: 'aliyun_native_omni', name: '云端选择' }]
      }
      return Response.json(data)
    })
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '语音与交互' }))
    expect(screen.getByRole('combobox', { name: '交互策略' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '这个场景使用的语音' }), { target: { value: 'shared' } })
    expect(screen.queryByRole('combobox', { name: '交互策略' })).not.toBeInTheDocument()
    expect(screen.getByText(/实体麦克风先说/)).toBeInTheDocument()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('深链接直接打开指定场景能力，未挂载时仅展示禁用参数且不激活', async () => {
    const api = backend(); api.records.two.capabilities = []
    render(<MemoryRouter initialEntries={['/dashboard/scenes?id=two&capability=tool']}><Scenes/></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览'))
    expect(screen.getByLabelText('新挂载的能力参数')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '新挂载的能力' })).not.toBeChecked()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('无效能力链接明确提示，不自动挂载替代能力', async () => {
    const api = backend()
    render(<MemoryRouter initialEntries={['/dashboard/scenes?id=one&capability=missing']}><Scenes/></MemoryRouter>)
    await ready(); expect(screen.getByText(/链接中的能力不在当前可配置目录/)).toBeInTheDocument()
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('无效场景返回不完整对象时显示错误，不回退到当前场景', async () => {
    backend(); render(<MemoryRouter initialEntries={['/dashboard/scenes?id=missing']}><Scenes/></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('场景的配置未能确认')
    expect(screen.queryByRole('textbox', { name: '场景名称' })).not.toBeInTheDocument()
  })
  it('选场景同步地址，同页路由切换时保护未保存的草稿', async () => {
    const api = backend(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter initialEntries={['/dashboard/scenes?id=one']}><Scenes/><RouteProbe/></MemoryRouter>)
    await ready(); fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '待保存' } })
    fireEvent.click(screen.getByRole('button', { name: '浏览器切换测试' }))
    await waitFor(() => expect(screen.getByLabelText('页面地址')).toHaveTextContent('?id=one'))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('待保存')
    confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: '浏览器切换测试' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览'))
    expect(screen.getByLabelText('新挂载的能力参数')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /测试接待/ }))
    await waitFor(() => expect(screen.getByLabelText('页面地址')).toHaveTextContent('?id=one'))
    expect(api.request.mock.calls.some(call => call[1]?.method)).toBe(false)
  })
  it('恢复接口没有确认凭据时不把普通 200 当成功', async () => {
    setBaseUrl('http://robot.test:8000')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true })))
    await expect(restoreSceneRevision('one', { revision_id: 'rev1', name: '测试', flow_id: 'none', capability_count: 0, reason: '' })).rejects.toThrow('恢复结果未确认')
  })
  it('恢复后实际配置不匹配时不报成功', async () => {
    setBaseUrl('http://robot.test:8000')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/restore') ? { scene_restore: { scene_id: 'one', revision_id: 'rev1', restored: true } } : { scene: initial(), catalog: [], interaction_policies: [], shared_voice_pipeline_provider: 'composed' })))
    await expect(restoreSceneRevision('one', { revision_id: 'rev1', name: '另一个版本', flow_id: 'none', capability_count: 0, reason: '' })).rejects.toThrow('不一致')
  })
  it('模板目录失败时保留名称且不能提交凭空创建来源', async () => {
    const api = backend(); const original = api.request.getMockImplementation()!
    api.request.mockImplementation(async (url, init) => url.endsWith('/scene-templates') ? Response.json({ ok: false }, { status: 503 }) : original(url, init))
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: '新建场景' }))
    await screen.findByRole('button', { name: '重试读取来源' })
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '保留名称' } })
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('保留名称')
  })
  it('模板来源直接在创建表单内读取，创建走原接口且不激活', async () => {
    const { request } = backend(); show(); await ready()
    expect(request.mock.calls.some(call => call[0].endsWith('scene-templates'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '新建场景' }))
    await screen.findByRole('option', { name: '以接待为模板' })
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '新接待' } })
    fireEvent.change(screen.getByRole('combobox', { name: '从哪里开始' }), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('新接待'))
    const call = request.mock.calls.find(call => call[1]?.method === 'POST' && call[0].endsWith('/ui/scenes'))!
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ mode: 'template', source_scene_id: 'one', name: '新接待' })
    expect(request.mock.calls.some(call => call[0].endsWith('/activate'))).toBe(false)
  })
  it('历史按需读取，取消恢复不写入，确认后需回读', async () => {
    const { request } = backend(); show(); await ready()
    expect(request.mock.calls.some(call => call[0].endsWith('/revisions'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /历史版本/ }))
    await screen.findByRole('button', { name: '恢复历史 1' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '恢复历史 1' }))
    expect(request.mock.calls.some(call => call[0].endsWith('/restore'))).toBe(false)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '恢复历史 1' }))
    expect(await screen.findByText('历史版本已恢复并回读')).toBeInTheDocument()
    expect(request.mock.calls.filter(call => call[0].endsWith('/restore'))).toHaveLength(1)
  })
  it('删除提示不虚构归档恢复，也不凭 built_in 禁止删除', async () => {
    const { records } = backend(); records.one.built_in = true; show(); await ready()
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('group', { name: '删除确认' })).toHaveTextContent('没有删除恢复入口')
    expect(screen.queryByText('模板与归档 ↗')).not.toBeInTheDocument()
  })
  it('直接编辑真实挂载，卸载能力连带移除知识挂载且保留未编辑字段', async () => {
    const { request } = backend(); show(); await ready()
    expect(screen.getByRole('checkbox', { name: '新挂载的能力' })).toBeChecked()
    expect(screen.queryByText('全局身份')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '新挂载的能力' }))
    fireEvent.click(screen.getByRole('button', { name: '知识与展示' }))
    expect(screen.getByRole('checkbox', { name: /展览资料/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /展览资料/ })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('已保存并发布')).toBeInTheDocument()
    const body = JSON.parse(String(request.mock.calls.find(call => call[1]?.method === 'PUT')?.[1]?.body))
    expect(body).toMatchObject({ capabilities: [], flow_id: 'existing-flow', settings: { tool: { preserved: true } }, provider_mounts: { knowledge_source_ids: [] } })
    expect(request.mock.calls.some(call => call[0].endsWith('/activate'))).toBe(false)
  })
  it('选择其他场景不会激活，明确切换后必须回读成功', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('临时展览'))
    expect(request.mock.calls.some(call => call[1]?.method === 'POST')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))
    expect(await screen.findByText('已切换')).toBeInTheDocument()
  })
  it('复制在本页创建，调用原有组合接口', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('测试接待副本')
    await screen.findByRole('option', { name: '以接待为模板' })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1]?.body?.toString().includes('"mode":"template"'))).toBe(true))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('测试接待副本'))
  })
  it('删除运行场景必须选择替代，取消不发送请求', async () => {
    const { request } = backend(); show(); await ready()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: '替代运行场景' }), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(request.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.change(screen.getByRole('combobox', { name: '替代运行场景' }), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(request.mock.calls.some(call => call[1]?.method === 'DELETE' && call[0].endsWith('?replacement_scene_id=two'))).toBe(true))
  })
  it('发布失败不报成功，外部变更不覆盖', async () => {
    const { records, request } = backend(); show(); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '本地修改' } })
    records.one.description = '其他管理员修改'
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('已在其他页面修改')
    expect(request.mock.calls.some(call => call[1]?.method === 'PUT')).toBe(false)
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('本地修改')
  })
  it('发布失败保留草稿和错误，不显示已保存', async () => {
    const api = backend(); show(); await ready(); api.failPublish()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '修改名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('已保存并发布')).not.toBeInTheDocument()
  })
  it('读取失败有重试，预览不发送配置请求', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    show(); expect(await screen.findByRole('alert')).toHaveTextContent('无法连接机器人应用')
    expect(screen.getByRole('button', { name: '重新读取' })).toBeInTheDocument()
  })
  it('未保存的修改可以阻止选另一个场景', async () => {
    backend(); vi.spyOn(window, 'confirm').mockReturnValue(false); show(); await ready()
    fireEvent.change(screen.getByRole('textbox', { name: '场景名称' }), { target: { value: '保留我' } })
    fireEvent.click(screen.getByRole('button', { name: /临时展览/ }))
    expect(screen.getByRole('textbox', { name: '场景名称' })).toHaveValue('保留我')
  })
  it('基础系统使用可搜索设置行，工程工具默认折叠', () => {
    render(<MemoryRouter><Foundation/></MemoryRouter>)
    expect(screen.getByText('工程工具').closest('details')).not.toHaveAttribute('open')
    fireEvent.change(screen.getByRole('searchbox', { name: '查找设置' }), { target: { value: '呼吸' } })
    expect(screen.getByRole('link', { name: /呼吸与听声转向/ })).toHaveAttribute('href', '/dashboard/foundation/motion')
    expect(screen.queryByText('提示词')).not.toBeInTheDocument()
  })
  it('请求有超时边界', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))) })))
    const result = expect(operatorRequest('/api/v1/ui/runtime')).rejects.toThrow('连接超时')
    await vi.advanceTimersByTimeAsync(8000); await result
  })
})
