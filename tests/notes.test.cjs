const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(require('node:os').homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')); }

const root = path.resolve(__dirname, '..');
const url = pathToFileURL(path.join(root, 'index.html')).href;
const KEY = 'mark-notes-v1';
const results = [];
const errors = [];
async function test(name, fn) {
  await fn(); results.push(name); console.log(`PASS ${name}`);
}
(async () => {
  const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await playwright.chromium.launch({ headless: true, ...(fs.existsSync(edgePath) ? { executablePath: edgePath } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    await test('首次打开：左右布局、三篇示例笔记、无页面报错', async () => {
      assert.equal(await page.locator('.note-card').count(), 3);
      assert.equal(await page.locator('#note-title').inputValue(), '欢迎使用马克笔记');
      const side = await page.locator('#sidebar').boundingBox();
      const editor = await page.locator('#editor').boundingBox();
      assert.ok(editor.x >= side.x + side.width);
      await page.screenshot({ path: path.join(root, 'tests', 'desktop.png'), fullPage: true });
    });
    await test('新建并编辑中文、换行和 emoji，字数正确', async () => {
      await page.locator('#new-note').click();
      await page.locator('#note-title').fill('测试笔记：中文与特殊字符');
      await page.locator('#note-content').fill('第一行\n第二行 😀');
      assert.equal(await page.locator('#word-count').textContent(), '7 字');
      assert.equal(await page.locator('.note-card').count(), 4);
      assert.equal(await page.locator('#save-state').getAttribute('title'), '已保存到当前浏览器');
    });
    await test('刷新恢复内容、选中的笔记和笔记数量', async () => {
      await page.reload();
      assert.equal(await page.locator('#note-title').inputValue(), '测试笔记：中文与特殊字符');
      assert.equal(await page.locator('#note-content').inputValue(), '第一行\n第二行 😀');
      assert.equal(await page.locator('.note-card').count(), 4);
    });
    await test('切换笔记不会覆盖刚编辑的内容', async () => {
      await page.getByRole('button', { name: '灵感收集箱', exact: true }).click();
      assert.equal(await page.locator('#note-title').inputValue(), '灵感收集箱');
      await page.getByRole('button', { name: '测试笔记：中文与特殊字符', exact: true }).click();
      assert.equal(await page.locator('#note-content').inputValue(), '第一行\n第二行 😀');
    });
    await test('搜索标题、正文、空白关键词和无结果状态', async () => {
      for (const query of ['特殊字符', '第二行']) {
        await page.locator('#search').fill(query);
        assert.equal(await page.locator('.note-card').count(), 1);
      }
      await page.locator('#search').fill('没有这个关键词xyz');
      assert.equal(await page.locator('.note-card').count(), 0);
      assert.ok(await page.locator('.empty-list').isVisible());
      await page.locator('#search').fill('   ');
      assert.equal(await page.locator('.note-card').count(), 4);
      await page.locator('#search').fill('');
    });
    await test('收藏筛选、取消收藏和刷新持久化', async () => {
      await page.locator('#favorite').click();
      await page.locator('#star-tab').click();
      assert.equal(await page.locator('.note-card').count(), 2);
      await page.locator('#favorite').click();
      assert.equal(await page.locator('.note-card').count(), 1);
      await page.reload();
      assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'), 'false');
    });
    await test('标题排序正确', async () => {
      await page.locator('#sort').selectOption('title');
      const titles = await page.locator('.card-title span').allTextContents();
      assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'zh-CN')));
      await page.locator('#sort').selectOption('updated');
    });
    await test('导出的 TXT 包含完整中文标题和正文', async () => {
      const downloadEvent = page.waitForEvent('download');
      await page.locator('#export').click();
      const download = await downloadEvent;
      assert.ok(download.suggestedFilename().endsWith('.txt'));
      const content = fs.readFileSync(await download.path(), 'utf8');
      assert.ok(content.includes('测试笔记：中文与特殊字符\n\n第一行\n第二行 😀'));
    });
    await test('删除取消、Escape 取消、确认删除及撤销', async () => {
      await page.locator('#delete').click();
      await page.locator('#cancel-delete').click();
      assert.equal(await page.locator('.note-card').count(), 4);
      await page.locator('#delete').click(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('.note-card').count(), 4);
      await page.locator('#delete').click(); await page.locator('#confirm-delete').click();
      assert.equal(await page.locator('.note-card').count(), 3);
      await page.locator('#undo').click();
      assert.equal(await page.locator('.note-card').count(), 4);
      assert.equal(await page.locator('#note-content').inputValue(), '第一行\n第二行 😀');
    });
    await test('HTML 和脚本作为纯文本显示，不执行', async () => {
      const attack = '<img src=x onerror="window.injected=true">';
      await page.locator('#note-title').fill(attack);
      await page.locator('#note-content').fill('<script>window.injected=true</script>');
      assert.equal(await page.locator('.card-title span').first().textContent(), attack);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.equal(await page.locator('.note-list img,.note-list script').count(), 0);
    });
    await test('空标题有占位名称，键盘快捷键可以新建和保存', async () => {
      await page.keyboard.press('Alt+n');
      assert.equal(await page.locator('#note-title').inputValue(), '');
      assert.equal(await page.locator('#breadcrumb-title').textContent(), '无标题笔记');
      await page.keyboard.press('Control+s');
      assert.equal(await page.locator('#save-state').getAttribute('title'), '已保存到当前浏览器');
    });
    await test('删除全部后刷新仍为空，可重新新建', async () => {
      while (await page.locator('.note-card').count()) {
        await page.locator('#delete').click(); await page.locator('#confirm-delete').click();
      }
      assert.ok(await page.locator('#empty-workspace').isVisible());
      assert.ok(await page.locator('#export').isDisabled());
      await page.reload();
      assert.equal(await page.locator('.note-card').count(), 0);
      await page.locator('#empty-new').click();
      assert.ok(await page.locator('#note-title').isVisible());
    });
    await test('手机 390px：列表开关、搜索、新建和编辑，无横向溢出', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator('#sidebar').evaluate(el => el.inert), true);
      await page.locator('#open-list').click();
      assert.equal(await page.locator('#open-list').getAttribute('aria-expanded'), 'true');
      await page.locator('#search').fill('不存在');
      assert.ok(await page.locator('.empty-list').isVisible());
      await page.locator('#new-note').click();
      assert.equal(await page.locator('#open-list').getAttribute('aria-expanded'), 'false');
      await page.locator('#note-title').fill('随手记');
      await page.locator('#note-content').fill('在手机上，也能留住每个好想法。');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(root, 'tests', 'mobile.png'), fullPage: true, animations: 'disabled' });
      assert.ok((await page.locator('#sidebar').boundingBox()).x + (await page.locator('#sidebar').boundingBox()).width <= 0);
    });
    await test('320px、平板、桌面和 200% 字体不横向溢出', async () => {
      for (const width of [320, 768, 1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => document.documentElement.style.fontSize = '32px');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('#note-content').evaluate(el => getComputedStyle(el).fontSize), '32px');
    });
    await test('本地存储配额不足时显示未保存提醒，内容仍可编辑', async () => {
      const isolated = await browser.newContext(); const p = await isolated.newPage();
      await p.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('QuotaExceeded', 'QuotaExceededError'); }; });
      await p.goto(url);
      await p.locator('#note-content').fill('不能丢失的内容');
      assert.ok(await p.locator('#storage-warning').isVisible());
      assert.equal(await p.locator('#save-state').getAttribute('title'), '未保存，请导出');
      assert.equal(await p.locator('#note-content').inputValue(), '不能丢失的内容');
      await isolated.close();
    });
    await test('损坏存储不被覆盖，明确提示并允许临时编辑', async () => {
      const isolated = await browser.newContext(); const p = await isolated.newPage();
      await p.goto(url); await p.evaluate(key => localStorage.setItem(key, '{broken'), KEY); await p.reload();
      assert.ok(await p.locator('#storage-warning').isVisible());
      await p.locator('#empty-new').click(); await p.locator('#note-content').fill('临时内容');
      assert.equal(await p.evaluate(key => localStorage.getItem(key), KEY), '{broken');
      await isolated.close();
    });
    await test('多窗口变更阻止旧窗口覆盖新内容', async () => {
      const isolated = await browser.newContext(); const p1 = await isolated.newPage(); const p2 = await isolated.newPage();
      await p1.goto(url); await p2.goto(url);
      await p1.locator('#note-content').fill('窗口一的新内容');
      await p2.locator('#storage-warning').waitFor({ state: 'visible' });
      await p2.locator('#note-content').fill('旧窗口内容');
      assert.ok((await p2.locator('#storage-warning').textContent()).includes('其他窗口'));
      assert.equal(await p2.locator('#save-state').getAttribute('title'), '未保存，请导出');
      const data = await p1.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
      assert.equal(data.notes.find(n => n.id === data.selectedId).content, '窗口一的新内容');
      await isolated.close();
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(root, 'tests', 'results.json'), JSON.stringify({ passed: results.length, tests: results, pageErrors: errors, browser: await browser.version(), testedAt: new Date().toISOString() }, null, 2));
    console.log(`\n${results.length}/${results.length} tests passed; zero page errors.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
