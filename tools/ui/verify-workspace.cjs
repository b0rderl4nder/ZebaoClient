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
        ['foundation', '/dashboard/foundation', '[aria-label="查找设置"], input[type="search"]'],
        ['interaction', '/dashboard/foundation/interaction', 'select[aria-label="当前场景活跃度"]'],
      ]) {
        await page.goto(base + route)
        try { await page.locator(ready).first().waitFor({ timeout: 15000 }) }
        catch (error) {
          await page.screenshot({ path: path.join(output, `${name}-${width}-failed.png`), fullPage: true })
          console.error(JSON.stringify(failures))
          throw error
        }
        if (name === 'scene-profiles') await page.getByRole('button', { name: '语音与交互', exact: true }).click()
        if (name === 'scene-resources') await page.getByRole('button', { name: '知识与展示', exact: true }).click()
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
        const violations = await page.evaluate(async () => (await axe.run(document.body, { rules: { region: { enabled: false } } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
        if (dimensions.document > dimensions.viewport) failures.push(`${name}/${width}: horizontal overflow`)
        if (violations.length) failures.push(`${name}/${width}: ${JSON.stringify(violations)}`)
        await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true })
        results.push({ name, width, height, dimensions, violations })
      }
      await context.close()
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2))
    console.log(JSON.stringify({ screenshots: results.length, failures }))
    if (failures.length) process.exitCode = 1
  } finally { await browser.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
