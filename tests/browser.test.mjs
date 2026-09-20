import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { toolkitRoot } from '../scripts/lib/paths.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(toolkitRoot, '.tools/ms-playwright');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const examples = ['technical-explainer', 'business-process', 'integration-spec', 'component-catalog'];
test.after(() => browser.close());

test('standalone examples remain usable offline on desktop, mobile and print', async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const network = [];
  await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
  for (const name of examples) {
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(toolkitRoot, 'examples', `${name}.html`)).href);
    await page.locator('main section').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.topic-toggle').hasAttribute('aria-label'));
    assert.equal(await page.locator('h1').count(), 1, name);
    assert.equal(await page.locator('#topic-panel').evaluate(node => node.open), true, name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: desktop width`);
    await page.locator('.topic-toggle').focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#topic-panel').evaluate(node => node.open), false, `${name}: keyboard collapse`);
    await page.keyboard.press('Enter');
    const last = page.locator('.toc a').last(); const href = await last.getAttribute('href');
    await last.click();
    await page.waitForFunction(value => document.querySelector('.toc a[aria-current="location"]')?.getAttribute('href') === value, href);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SECTION');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('#topic-panel').open);
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.locator('#topic-panel').evaluate(node => node.open), false, `${name}: mobile initially closed`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: mobile width`);
    await page.locator('.topic-toggle').click();
    assert.equal(await page.locator('#topic-panel').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#topic-panel').evaluate(node => node.open), false);
    assert.equal(await page.locator('.topic-toggle').evaluate(node => node === document.activeElement), true);
    await page.screenshot({ path: path.join('/tmp', `documentation-${name}-mobile.png`), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => {
      const panel = document.querySelector('#topic-panel');
      return panel.open && document.querySelector('.reading-pane').getBoundingClientRect().left >= panel.getBoundingClientRect().right;
    });
    await page.screenshot({ path: path.join('/tmp', `documentation-${name}-desktop.png`), fullPage: true });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto', 'reduced motion disables smooth scrolling');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).transitionDuration), '0s', 'reduced motion disables sidebar layout transitions');
    if (name === 'component-catalog') {
      const dark = page.locator('.node--dark p').first();
      const selection = await dark.evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        const style = getComputedStyle(node, '::selection');
        return { background: style.backgroundColor, color: style.color };
      });
      assert.notEqual(selection.background, 'rgba(0, 0, 0, 0)');
      assert.notEqual(selection.background, selection.color);
      await dark.scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/documentation-selection.png' });
    }
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#topic-panel').evaluate(node => getComputedStyle(node).display), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).paddingLeft), '0px', 'print does not reserve a sidebar gutter');
    for (const region of await page.locator('.diagram-source').all()) assert.equal(await region.evaluate(node => getComputedStyle(node).display), 'none');
    for (const detail of await page.locator('.deep-dive:not(.diagram-source) .deep-dive-content').all()) assert.equal(await detail.isVisible(), true, 'print includes explanatory disclosure content');
    await page.pdf({ path: path.join('/tmp', `documentation-${name}.pdf`), format: 'A4', printBackground: true });
    assert.deepEqual(errors, [], `${name}: page errors`);
    await page.close();
  }
  assert.deepEqual(network, [], 'Reading documents must not request network assets.');
});
test('native topics remain available with JavaScript disabled', async t => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(toolkitRoot, 'examples/technical-explainer.html')).href);
  assert.equal(await page.locator('.toc a').first().isVisible(), true);
  // Use a native pointer: locator stability checks rely on animation frames,
  // which Chromium can suppress in a script-disabled document.
  const box = await page.locator('.toc a').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForURL(/#model$/);
  assert.match(page.url(), /#model$/);
});
