// Read-only browser verification. Requires Playwright and axe-core in NODE_PATH.
// node tools/ui/verify-workspace.cjs <client-url> <robot-host> <output-directory>
const { chromium } = require('playwright')
const fs = require('node:fs/promises')
const path = require('node:path')

async function main() {
  const [base = 'http://127.0.0.1:5178', robot = '192.168.3.83', output = 'ui-baselines/workspace'] = process.argv.slice(2)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const failures = []
  const results = []
  try {
    await fs.mkdir(output, { recursive: true })
    for (const [width, height] of [[390, 844], [768, 1024], [1280, 720], [1440, 900]]) {
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
      let activeCase = ''
      await context.addInitScript(host => {
        localStorage.setItem('zebao_current_robot', JSON.stringify({ host, port: 8000 }))
        localStorage.removeItem('zebao_simulated_mode')
      }, robot)
      await context.route('**/*', async route => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
          failures.push(`unexpected write ${route.request().method()}`)
          return route.abort()
        }
        // Never capture personal memory in screenshot artifacts.
        const pathname = new URL(route.request().url()).pathname
        const policyFixture = activeCase.startsWith('scene-policy-')
        const policy = { id: 'fixture-policy', name: '兼容交互（模拟规则）', description: '仅验证配置页面，不修改机器人运行规则。', built_in: true, entry_mode: 'wake_or_owner', identity_mode: 'continuation_owner', language_mode: 'mirror_turn', acknowledgement_mode: 'after_admission', interruption_mode: 'confirmed_speaker_or_stop', allow_owned_follow_up: true, require_physical_speech: true, require_attention_gate: false, require_fresh_doa: false, front_sector_degrees: 55 }
        if (policyFixture && pathname === '/operator-api/api/v1/ui/interaction-policies') {
          const fields = [{ key: 'name', label: '策略名称', kind: 'text', max_length: 30 }, { key: 'description', label: '说明', kind: 'text', max_length: 160 }]
          for (const [key, label, options] of [
            ['entry_mode', '怎样开始交谈', [['wake_or_owner', '唤醒后可续聊'], ['front_walk_up', '前方真人可交谈'], ['explicit_only', '每次明确触发']]],
            ['language_mode', '回答语言', [['mirror_turn', '跟随本轮语言'], ['fixed_zh', '固定中文'], ['fixed_en', '固定英文']]],
            ['identity_mode', '身份要求', [['optional', '不要求身份'], ['continuation_owner', '用于区分续聊者'], ['required', '必须确认身份']]],
            ['acknowledgement_mode', '听见反馈时机', [['after_admission', '准入后'], ['after_final', '终稿确认后'], ['disabled', '不播报反馈']]],
            ['interruption_mode', '怎样打断', [['confirmed_speaker_or_stop', '确认说话人或明确停止'], ['explicit_stop_only', '仅明确停止']]],
          ]) fields.push({ key, label, kind: 'select', options: options.map(([value, label]) => ({ value, label })) })
          for (const [key, label] of [['allow_owned_follow_up', '允许同一说话人续聊'], ['require_physical_speech', '必须有真人语音证据'], ['require_attention_gate', '必须通过注意力检查'], ['require_fresh_doa', '必须有新鲜声源方向']]) fields.push({ key, label, kind: 'boolean', advanced: true })
          fields.push({ key: 'front_sector_degrees', label: '前向角度范围（度）', kind: 'number', minimum: 15, maximum: 90, advanced: true })
          return route.fulfill({ json: { ok: true, policies: [policy], defaults: policy, fields, preserved_fields: [] } })
        }
        if (policyFixture && /^\/operator-api\/api\/v1\/ui\/scenes\/[^/]+$/.test(pathname)) {
          const response = await context.request.get(`http://${robot}:7862${pathname.replace('/operator-api', '')}`)
          const data = await response.json()
          data.scene = { ...data.scene, interaction_policy_id: policy.id, provider_mounts: { ...data.scene.provider_mounts, voice_profile_id: 'platform_ws', interaction_profile_id: policy.id } }
          data.interaction_policies = [policy]
          return route.fulfill({ json: data })
        }
        if (pathname === '/operator-api/api/v1/ui/scene-flows') return route.fulfill({ json: { ok: true, flows: [{ id: 'none', name: '不使用流程（模拟目录）', description: '不启用多步骤流程。', stages: [] }, { id: 'fixture-flow', name: '接待流程（模拟目录）', description: '仅验证配置展示，不执行接待动作。', stages: [{ id: 'first', name: '确认需求', goal: '确认当前客户需要的资料（模拟步骤）。', suggested_capabilities: [] }] }] } })
        if (pathname.startsWith('/operator-api/api/v1/settings/voice-connections/')) {
          const provider = pathname.split('/').pop()
          const fields = provider === 'platform_ws' ? [['REACHY_PLATFORM_TERMINAL_WS_URL', '平台地址（模拟）', '连接', 'ws'], ['ASR_BASE_URL', '识别服务（模拟）', '语音识别', 'url'], ['ASR_MODEL', '识别模型（模拟）', '语音识别', 'text'], ['INTENT_MODEL', '意图模型（模拟）', '意图识别', 'text'], ['TTS_BASE_URL', '合成地址（模拟）', '语音合成', 'url']] : [[`${provider.toUpperCase()}_WS_URL`, '服务地址（模拟）', '连接', 'ws'], [`${provider.toUpperCase()}_MODEL`, '模型名称（模拟）', '连接', 'text']]
          return route.fulfill({ json: { ok: true, provider, revision: 'fixture-revision', persistent: true, pending_restart: false, apply_mode: 'app_restart', fields: fields.map(([id,label,group,kind]) => ({ id,label,group,kind,value: kind === 'ws' ? 'ws://fixture.invalid/stream' : kind === 'url' ? 'http://fixture.invalid/api' : 'fixture-model', configured: true })) } })
        }
        if (pathname === '/operator-api/api/v1/operations/logs') return route.fulfill({ json: { ok: true, entries: [{ id: 2, timestamp_utc: '2026-09-12T01:00:00Z', level: 'warning', category: 'service', summary: '服务连接暂时中断，正在恢复（模拟事件）', stage: 'reconnecting', latency_ms: 350, details: { reason: 'connection_interrupted' } }, { id: 1, timestamp_utc: '2026-09-12T00:59:00Z', level: 'info', category: 'tool', summary: '展示资料已更新（模拟事件）', stage: 'completed', latency_ms: 120 }], has_more: false, next_before_id: null, total_matching: 2 } })
        if (pathname === '/operator-api/api/v1/debug/diagnostic_snapshot') return route.fulfill({ json: { ok: false, captured_at_utc: '2026-09-12T01:00:00Z', failed_checks: ['模拟兼容服务未连接'], self_check: { checks: [{ name: '模拟兼容服务', ok: false }] } } })
        if (pathname === '/operator-api/api/v1/acceptance/runs') return route.fulfill({ json: { ok: true, count: 1, stages: [{ id: 'voice', label: '语音（模拟记录）' }, { id: 'tools', label: '能力执行（模拟记录）' }], runs: [{ run_id: 'fixture', recorded_at: '2026-09-12T01:00:00Z', passed: false, scene: { id: '模拟场景', generation: 'fixture-generation' }, release: { git_commit: 'fixture-commit', artifact_sha256: 'fixture-sha256' }, voice_mode: 'aliyun_native_omni', stages: { voice: true, tools: false }, capability_results: [{ capability_id: '模拟展示能力', ok: false, status: '尚未确认', provider: 'fixture' }], device_results: [], display_revision: 'fixture-revision', latency_ms: { first_audio: 1200 } }] } })
        if (new URL(route.request().url()).pathname === '/operator-api/api/v1/memory') return route.fulfill({ json: { facts: [{ id: 'fixture-1', text: '验收示例记忆（模拟）', createdAt: '' }] } })
        // Prompt bodies can contain administrator content. Render a declared fixture instead.
        if (new URL(route.request().url()).pathname === '/operator-api/api/v1/prompts') {
          const base = { category: '对话', description: '截图验收模拟内容，不是设备实际提示词。', editable: true, used_by: ['语音会话'], variables: ['context'], max_chars: 800, apply_mode: 'hot_reconnect', default_text: '请结合当前场景回答问题。\n{context}\n（模拟内容）', effective_text: '请结合当前场景回答问题。\n{context}\n（模拟内容）', active_variant_id: 'default', variants: [] }
          return route.fulfill({ json: { ok: true, persistent: true, slots: [{ ...base, id: 'conversation.aliyun_native_omni', name: '云端原生对话（模拟）' }, { ...base, id: 'vision.explicit', name: '视觉理解（模拟）', category: '视觉' }, { ...base, id: 'platform.dialogue', name: '平台托管（模拟）', editable: false }] } })
        }
        // Local asset preview only: emulate the tested fixed-upstream transport.
        // Deployed verification uses the real Client proxy with no interception.
        if (base.includes('127.0.0.1') && new URL(route.request().url()).pathname.startsWith('/operator-api/')) {
          const requestUrl = new URL(route.request().url())
          const response = await context.request.get(`http://${robot}:7862${requestUrl.pathname.replace('/operator-api', '')}${requestUrl.search}`)
          return route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } })
        }
        return route.continue()
      })
      const page = await context.newPage()
      page.on('pageerror', error => failures.push(error.message))
      page.on('requestfailed', request => failures.push(`request failed ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
      for (const [name, route, ready] of [
        ['overview', '/dashboard', '[aria-label="当前场景运行时"]'],
        ['scene-flow-fixture', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['capabilities-scene-links', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['capabilities-to-scene', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['network-iot-direct', '/dashboard/foundation/network?tab=iot', '.network-tabs'],
        ['scenes', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-profiles', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-embodied-draft', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-policy-view-fixture', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-policy-edit-fixture', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-resources', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-create', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-history', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['foundation', '/dashboard/foundation', '[aria-label="查找设置"], input[type="search"]'],
        ['logs-fixture', '/dashboard/foundation/logs', '[aria-label="运行日志时间轴"]'],
        ['logs-detail-fixture', '/dashboard/foundation/logs', '[aria-label="运行日志时间轴"]'],
        ['pipeline', '/dashboard/foundation/pipeline', '.diagnostic-facts'],
        ['pipeline-extended-fixture', '/dashboard/foundation/pipeline', '.diagnostic-facts'],
        ['acceptance-fixture', '/dashboard/foundation/acceptance', '[aria-label="验收运行记录"]'],
        ['acceptance-detail-fixture', '/dashboard/foundation/acceptance', '[aria-label="验收运行记录"]'],
        ['capabilities-global', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['capabilities-detail', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['capabilities-scene', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['capabilities-deleted', '/dashboard/foundation/capabilities', '.catalog-list'],
        ['quiet', '/dashboard/foundation/quiet', '.settings-current strong'],
        ['memory-fixture', '/dashboard/foundation/memory', '.scene-history-row'],
        ['prompts-list-fixture', '/dashboard/foundation/prompts', '.prompt-list button'],
        ['prompts-detail-fixture', '/dashboard/foundation/prompts?slot=conversation.aliyun_native_omni', '.prompt-editor h2'],
        ['prompts-edit-fixture', '/dashboard/foundation/prompts?slot=conversation.aliyun_native_omni', '.prompt-editor h2'],
        ['prompts-readonly-fixture', '/dashboard/foundation/prompts?slot=platform.dialogue', '.prompt-editor h2'],
        ['interaction', '/dashboard/foundation/interaction', 'select[aria-label="整机默认主动程度"]'],
        ['voice', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-edit', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-wake', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-local-fixture', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-platform-fixture', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-compatible-fixture', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['capability-settings', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['sound', '/dashboard/foundation/sound', 'input[aria-label="扬声器音量滑杆"]'],
        ['motion', '/dashboard/foundation/motion', 'input[role="switch"]'],
        ['vision', '/dashboard/foundation/vision', 'input[role="switch"]'],
        ['motion-parameters', '/dashboard/foundation/motion', 'input[role="switch"]'],
        ['people', '/dashboard/foundation/people', '.people-directory a'],
        ['people-create', '/dashboard/foundation/people', '.people-directory a'],
        ['person-profile', '/dashboard/foundation/people', '.people-directory a'],
        ['person-identity', '/dashboard/foundation/people', '.people-directory a'],
        ['person-greeting', '/dashboard/foundation/people', '.people-directory a'],
        ['person-enroll', '/dashboard/foundation/people', '.people-directory a'],
        ['network', '/dashboard/foundation/network', '.network-tabs'],
        ['network-wifi', '/dashboard/foundation/network', '.network-tabs'],
        ['network-iot', '/dashboard/foundation/network', '.network-tabs'],
        ['network-startup', '/dashboard/foundation/network', '.network-tabs'],
        ['storage', '/dashboard/foundation/storage', '.settings-current'],
      ]) {
        if (process.env.ZEBAO_UI_CASES && !process.env.ZEBAO_UI_CASES.split(',').includes(name)) continue
        activeCase = name
        await page.goto(base + route)
        try { await page.locator(ready).first().waitFor({ timeout: 15000 }) }
        catch (error) {
          await page.screenshot({ path: path.join(output, `${name}-${width}-failed.png`), fullPage: true })
          console.error(JSON.stringify(failures))
          throw error
        }
        if (name === 'scene-profiles' || name === 'scene-embodied-draft') {
          await page.getByRole('button', { name: '语音与交互', exact: true }).click()
          try { await page.getByRole('combobox', { name: '主动程度', exact: true }).waitFor({ timeout: 12000 }) }
          catch (error) {
            await page.screenshot({ path: path.join(output, `${name}-${width}-failed.png`), fullPage: true })
            console.error(JSON.stringify({ failures, alerts: await page.getByRole('alert').allTextContents(), status: await page.getByRole('status').allTextContents() }))
            throw error
          }
        }
        if (name === 'scene-embodied-draft') {
          const choice = page.getByRole('combobox', { name: '主动程度', exact: true })
          const previous = await choice.inputValue()
          const alternate = await choice.locator('option').evaluateAll((options, value) => options.find(option => !option.disabled && option.value !== value)?.value, previous)
          if (!alternate) throw new Error('scene activity catalogue has no selectable alternative')
          await choice.selectOption(alternate)
          await page.getByRole('button', { name: '能力', exact: true }).click()
          await page.getByRole('button', { name: '语音与交互', exact: true }).click()
          if (await choice.inputValue() !== alternate) failures.push(`embodied draft lost on tab change/${width}`)
          if (!(await page.getByRole('button', { name: '保存', exact: true }).isEnabled())) failures.push(`embodied save not available/${width}`)
          await page.getByText('这两项影响什么？', { exact: true }).click()
          await page.locator('[aria-label="场景具身设置"]').scrollIntoViewIfNeeded()
        }
        if (name.startsWith('scene-policy-')) {
          await page.getByRole('button', { name: '语音与交互', exact: true }).click()
          await page.getByRole('button', { name: /^查看与管理策略/ }).click()
          await page.getByRole('button', { name: '复制策略', exact: true }).waitFor()
          if (name === 'scene-policy-edit-fixture') {
            await page.getByRole('button', { name: '复制策略', exact: true }).click()
            await page.getByRole('textbox', { name: '策略名称', exact: true }).fill('展厅接待（模拟草稿）')
            await page.getByText('高级准入检查', { exact: true }).click()
            await page.locator('[aria-label="策略编辑"]').scrollIntoViewIfNeeded()
          } else await page.locator('[aria-label="交互策略管理"]').scrollIntoViewIfNeeded()
        }
        if (name === 'scene-flow-fixture') {
          await page.getByRole('button', { name: /^流程配置/ }).click()
          await page.getByLabel('使用哪个流程').selectOption('fixture-flow')
          await page.getByText('查看流程步骤', { exact: true }).click()
          await page.locator('.scene-flow-settings').scrollIntoViewIfNeeded()
        }
        if (name === 'capabilities-scene-links' || name === 'capabilities-to-scene') {
          await page.getByRole('button', { name: '场景能力', exact: true }).click()
          await page.locator('.catalog-list > details > summary').first().click()
          const link = page.locator('.catalog-mounts a').first()
          const target = new URL(await link.getAttribute('href'), base)
          if (name === 'capabilities-to-scene') {
            await link.click()
            await page.locator('.capability-parameters').waitFor()
            if (new URL(page.url()).searchParams.get('capability') !== target.searchParams.get('capability')) failures.push(`wrong capability target/${width}`)
            if (new URL(page.url()).searchParams.get('id') !== target.searchParams.get('id')) failures.push(`wrong scene target/${width}`)
            await page.locator('.capability-parameters').scrollIntoViewIfNeeded()
          } else {
            if (await page.locator('.catalog-list a[target="_blank"]').count()) failures.push(`legacy capability link/${width}`)
            await page.locator('.catalog-mounts').first().scrollIntoViewIfNeeded()
          }
        }
        if (name === 'network-iot-direct') {
          await page.getByLabel('启用物联网服务').waitFor()
          if (await page.locator('[aria-label="网络连接"]').count()) failures.push(`unrelated wifi loaded/${width}`)
        }
        if (name === 'logs-detail-fixture' || name === 'acceptance-detail-fixture') await page.locator('.diagnostic-list > details > summary').first().click()
        if (name === 'pipeline-extended-fixture') {
          await page.getByText('兼容链路完整诊断', { exact: true }).click()
          await page.getByRole('button', { name: '读取完整诊断', exact: true }).click()
          await page.getByText('模拟兼容服务未连接', { exact: true }).waitFor()
        }
        if (name === 'capabilities-detail') await page.locator('.catalog-list > details > summary').first().click()
        if (name === 'capabilities-scene') await page.getByRole('button', { name: '场景能力', exact: true }).click()
        if (name === 'capabilities-deleted') await page.getByRole('button', { name: '已删除', exact: true }).click()
        if (name === 'quiet') await page.waitForFunction(() => !document.querySelector('.settings-current strong')?.textContent.includes('等待读取'))
        if (name === 'scene-resources') await page.getByRole('button', { name: '知识与展示', exact: true }).click()
        if (name === 'scene-create') {
          await page.getByRole('button', { name: '新建场景', exact: true }).click()
          await page.getByRole('option', { name: /以.*为模板/ }).first().waitFor({ state: 'attached' })
        }
        if (name === 'scene-history') {
          await page.getByRole('button', { name: /^历史版本/ }).click()
          await page.getByRole('button', { name: '恢复历史 1', exact: true }).waitFor()
          await page.locator('.scene-history').scrollIntoViewIfNeeded()
        }
        if (name === 'voice-edit') {
          await page.getByRole('button', { name: '连接参数', exact: true }).click()
          await page.getByRole('button', { name: '编辑连接与音色', exact: true }).click()
          await page.locator('.settings-fields').scrollIntoViewIfNeeded()
        }
        if (['voice-local-fixture', 'voice-platform-fixture', 'voice-compatible-fixture'].includes(name)) {
          await page.getByRole('button', { name: '连接参数', exact: true }).click()
          await page.getByLabel('要配置的链路').selectOption(name === 'voice-local-fixture' ? 'local_omni' : name === 'voice-platform-fixture' ? 'platform_ws' : 'cloud_omni')
          await page.getByRole('button', { name: '编辑所选连接', exact: true }).click()
          if (name === 'voice-platform-fixture') await page.getByText('语音识别', { exact: true }).click()
          await page.locator('[aria-label="所选链路连接设置"]').scrollIntoViewIfNeeded()
        }
        if (name === 'voice-wake') {
          await page.getByRole('button', { name: '唤醒设置', exact: true }).click()
          await page.getByRole('switch', { name: '启用本地唤醒' }).waitFor()
        }
        if (name === 'capability-settings') {
          await page.getByRole('button', { name: /^设置办公室物联网$/ }).click()
          await page.locator('.capability-parameters').scrollIntoViewIfNeeded()
        }
        if (name === 'motion-parameters') {
          await page.getByText('转向幅度与响应参数', { exact: true }).click()
          await page.locator('.settings-parameter').first().scrollIntoViewIfNeeded()
        }
        if (name === 'people-create') await page.getByRole('button', { name: '添加人员', exact: true }).click()
        if (name.startsWith('person-')) {
          await page.locator('.people-directory a').first().click()
          await page.getByRole('textbox', { name: '姓名', exact: true }).waitFor()
          if (name === 'person-identity' || name === 'person-enroll') await page.getByRole('button', { name: '身份与权限', exact: true }).click()
          if (name === 'person-greeting') await page.getByRole('button', { name: '主动协作', exact: true }).click()
          if (name === 'person-enroll') {
            await page.getByRole('button', { name: /^(补录|录入)声纹$/ }).click()
            await page.getByRole('button', { name: '录入当前句', exact: true }).waitFor()
          }
        }
        if (name === 'network' || name === 'network-wifi') {
          await page.waitForFunction(() => {
            const section = document.querySelector('[aria-label="网络连接"]')
            return section && !section.textContent.includes('正在读取')
          })
          if (name === 'network-wifi') await page.getByText('连接或更换 Wi-Fi', { exact: true }).click()
        }
        if (name === 'network-iot') {
          await page.getByRole('button', { name: '物联网', exact: true }).click()
          await page.getByLabel('启用物联网服务').waitFor()
          await page.getByText('编辑地址与凭据', { exact: true }).click()
        }
        if (name === 'network-startup') {
          await page.getByRole('button', { name: '开机启动', exact: true }).click()
          await page.getByLabel('开机后自动启动 App').waitFor()
        }
        if (name === 'prompts-edit-fixture') await page.getByRole('button', { name: '复制此版本', exact: true }).click()
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
        const violations = await page.evaluate(async () => (await axe.run(document.body, { rules: { region: { enabled: false } } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight }))
        const navigationOverlap = await page.evaluate(() => {
          const nav = document.querySelector('.client-shell__mobile-nav')
          const main = document.querySelector('.client-shell__content')
          return nav && main && getComputedStyle(nav).display !== 'none' && main.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 1
        })
        if (navigationOverlap) failures.push(`${name}/${width}: navigation covers content`)
        if (dimensions.document > dimensions.viewport) failures.push(`${name}/${width}: horizontal overflow`)
        if (width <= 820 && dimensions.documentHeight > dimensions.height + 1) failures.push(`${name}/${width}: outer document overflows the mobile scroll container`)
        if (violations.length) failures.push(`${name}/${width}: ${JSON.stringify(violations)}`)
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
        results.push({ name, width, height, dimensions, violations })
        if (name === 'motion-parameters' && width <= 820) {
          await page.getByRole('button', { name: '恢复设备推荐值', exact: true }).scrollIntoViewIfNeeded()
          await page.screenshot({ path: path.join(output, `${name}-bottom-${width}.png`) })
        }
        if (name === 'prompts-edit-fixture' && width <= 820) {
          const save = page.getByRole('button', { name: '保存版本', exact: true })
          await save.scrollIntoViewIfNeeded()
          const bounds = await save.boundingBox()
          const nav = await page.locator('.client-shell__mobile-nav').boundingBox()
          if (!bounds || nav && bounds.y + bounds.height > nav.y) failures.push(`prompt save obscured/${width}`)
          await page.screenshot({ path: path.join(output, `${name}-bottom-${width}.png`) })
        }
      }
      // A short selected run may end while a read-only proxy request is in flight.
      // Drain handlers before disposing their request context; do not hide failures.
      await context.unrouteAll({ behavior: 'wait' })
      await context.close()
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2))
    console.log(JSON.stringify({ screenshots: results.length, failures }))
    if (failures.length) process.exitCode = 1
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
