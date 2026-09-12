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
        ['scenes', '/dashboard/scenes', '[aria-label="场景配置"]'],
        ['scene-profiles', '/dashboard/scenes', '[aria-label="场景配置"]'],
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
        ['interaction', '/dashboard/foundation/interaction', 'select[aria-label="当前场景活跃度"]'],
        ['voice', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
        ['voice-edit', '/dashboard/foundation/voice', '[aria-label="系统默认链路"]'],
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
        await page.goto(base + route)
        try { await page.locator(ready).first().waitFor({ timeout: 15000 }) }
        catch (error) {
          await page.screenshot({ path: path.join(output, `${name}-${width}-failed.png`), fullPage: true })
          console.error(JSON.stringify(failures))
          throw error
        }
        if (name === 'scene-profiles') await page.getByRole('button', { name: '语音与交互', exact: true }).click()
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
          await page.getByRole('button', { name: '编辑连接与音色', exact: true }).click()
          await page.locator('.settings-fields').scrollIntoViewIfNeeded()
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
      await context.close()
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2))
    console.log(JSON.stringify({ screenshots: results.length, failures }))
    if (failures.length) process.exitCode = 1
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
