import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    if (name === 'business-process') {
      const results = await page.evaluate(() => window.bpmnDiagramsReady);
      assert.equal(results?.length, 2, 'both BPMN diagrams render in the reader browser');
      assert.ok(results.every(result => result.ok), JSON.stringify(results));
      assert.equal(await page.locator('[data-bpmn-state="ready"] > svg').count(), 2);
      assert.equal(await page.locator('[data-bpmn-state="error"]').count(), 0);
      assert.equal(await page.locator('.bpmn-attribution .bjs-powered-by').count(), 2, 'retain required upstream attribution');
      for (const logo of await page.locator('.bpmn-attribution .bjs-powered-by').all()) {
        assert.equal(await logo.isVisible(), true);
        assert.equal(await logo.evaluate(node => {
          const box = node.getBoundingClientRect();
          const viewport = node.closest('figure').querySelector('.diagram-viewport').getBoundingClientRect();
          const figure = node.closest('figure').getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.top >= viewport.bottom && box.left >= figure.left && box.right <= figure.right;
        }), true, 'watermark must be visible without overlapping the diagram');
      }
    }
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
test('semantic callouts keep natural flow and structured variants keep intentional columns', async t => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'documentation-layout-'));
  t.after(() => rm(fixtureDir, { recursive: true, force: true }));
  const [theme, components] = await Promise.all([
    readFile(path.join(toolkitRoot, 'assets/theme.css'), 'utf8'),
    readFile(path.join(toolkitRoot, 'assets/components.css'), 'utf8'),
  ]);
  const fixturePath = path.join(fixtureDir, 'layout-regression.html');
  await writeFile(fixturePath, `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${theme}\n${components}</style><title>Layout regression</title></head><body>
<details class="topic-panel" id="topic-panel" open><summary class="topic-toggle"><span class="topic-icon">☰</span><span class="topic-label">Содержание</span></summary><nav class="toc"><ul><li><a href="#ordinary">Обычный контент</a></li><li><a href="#structured">Структурный контент</a></li></ul></nav></details>
<header class="site-header"><div class="page masthead-grid"><h1>Общий канонический холст документа</h1><p class="lead fixture-header-lead">Вводный текст шапки использует ту же ограниченную ширину страницы, а не отдельную узкую полосу.</p></div></header>
<main class="page document-content">
<p class="document-intro">Введение документа выровнено с секциями и не получает независимое ограничение длины строки.</p>
<section id="ordinary"><h2><code>explanatory-html-pages-with-an-intentionally-long-skill-name</code>: офлайн-документ через общий design system</h2>
<p class="section-intro">Секция, обычный текст и широкие содержательные элементы используют общий адаптивный холст.</p>
<div class="table-frame fixture-captioned-table"><table class="boundary-table"><caption>Сопоставление вариантов</caption><thead><tr><th scope="col">Вариант</th><th scope="col">Результат</th></tr></thead><tbody><tr><td>Канонический</td><td>Проверяемый документ</td></tr></tbody></table></div>
<p class="fixture-after-table">Следующий абзац отделён от нижней границы таблицы единым межблочным интервалом.</p>
<figure class="diagram fixture-diagram"><div class="diagram-viewport"><svg width="1080" height="80" viewBox="0 0 1080 80" role="img" aria-label="Тестовая широкая диаграмма"><rect width="1080" height="80" fill="#eeeeee"/><path d="M20 40H1060" stroke="#191919" stroke-width="3"/></svg></div></figure>
<p class="fixture-prose">Абзац сразу после диаграммы занимает доступную ширину секции. Он больше не выглядит узкой левой полосой с огромным пустым полем справа.</p>
<ul class="fixture-list"><li>Обычные списки выровнены с абзацами и широкими элементами секции.</li></ul>
<div class="definition"><p class="definition-label">Главный принцип</p><p>Выбирайте скилл по требуемому результату и типу доказательств, а не по сходству названия с темой задачи.</p></div>
<dl class="doc-facts"><dt><span>Когда выбрать</span></dt><dd><span>Нужен содержательный офлайн HTML с общей темой и семантическими компонентами.</span></dd><dt><span>Ожидаемый результат</span></dt><dd><span><code>document.json</code>, обычный <code>content.html</code> и собранный автономный HTML.</span></dd></dl>
<aside class="note-strip" id="inline-note"><strong>Важно:</strong> при отсутствующих или неоднозначных критериях скилл не должен додумывать их; итогом будет <code>NOT VERIFIED</code>, а не оптимистичная готовность.</aside>
<div class="takeaway" id="plain-takeaway"><p><strong>Практический вывод:</strong> начните с таблицы выбора, затем передайте агенту входы из карточки и явно разрешите только необходимые инструменты.</p></div></section>
<section id="structured"><h2>Поддерживаемые структурные варианты</h2>
<div class="definition" id="rich-definition"><div><p class="important">A reservation is a temporary promise.</p><p class="definition-detail">It is not a completed sale. Confirmation and expiry still need explicit outcomes.</p></div><dl class="signal-list"><div><dt>Claim</dt><dd>An item and quantity.</dd></div><div><dt>Exit</dt><dd>Confirm, cancel, or expire.</dd></div></dl></div>
<aside class="note-strip" id="paragraph-note"><p>Один абзац с <code>NOT VERIFIED</code> не требует отдельной колонки.</p></aside>
<aside class="note-strip" id="structured-note"><strong>Reuse the key.</strong><p>Retry the identical request with its original idempotency key.</p></aside>
<h3 class="fixture-after-note">Следующий смысловой блок</h3>
<div class="takeaway" id="structured-takeaway"><span class="takeaway-label">Key conclusion</span><p>A hold protects stock, not the whole purchase.</p></div>
<div class="doc-table-scroll" tabindex="0"><table class="doc-table"><tr><th>Wide data remains wide</th><td>Tables retain their available measure rather than inheriting prose width.</td></tr></table></div>
</section></main></body></html>`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  await page.goto(pathToFileURL(fixturePath).href);

  const relativeLuminance = value => {
    const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrastRatio = (foreground, background) => {
    const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  const assertLayout = async (width, open) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.locator('#topic-panel').evaluate((node, shouldOpen) => { node.open = shouldOpen; }, open);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}px: page does not overflow`);

    const metrics = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const firstRect = node => {
        const range = document.createRange(); range.selectNode(node);
        return [...range.getClientRects()].find(rect => rect.width > 0 && rect.height > 0);
      };
      const note = document.querySelector('#inline-note');
      const noteParts = [...note.childNodes].filter(node => node.nodeType === Node.ELEMENT_NODE || node.textContent.trim()).map(firstRect);
      const followsInReadingOrder = (current, previous) => {
        const sharesLine = current.top < previous.bottom && current.bottom > previous.top;
        return sharesLine ? current.left >= previous.left : current.top >= previous.bottom - 2;
      };
      const section = box('#ordinary');
      const definition = box('#ordinary .definition');
      const definitionLabel = box('#ordinary .definition-label');
      const definitionCopy = box('#ordinary .definition > p:last-child');
      const takeaway = box('#plain-takeaway');
      const takeawayCopy = box('#plain-takeaway > p');
      const heading = document.querySelector('#ordinary h2');
      const headingCode = heading.querySelector('code');
      const prose = box('.fixture-prose');
      const facts = box('.doc-facts');
      const inlineNote = box('#inline-note');
      const factsCopy = box('.doc-facts dt:first-child > span');
      const richCopy = box('#rich-definition > div');
      const signals = box('#rich-definition > .signal-list');
      const structuredLabel = box('#structured-takeaway > .takeaway-label');
      const structuredCopy = box('#structured-takeaway > p');
      const noteLabel = box('#structured-note > strong');
      const noteCopy = box('#structured-note > p');
      const header = box('.site-header');
      const intro = box('.document-intro');
      const captionedTable = box('.fixture-captioned-table');
      const afterTable = box('.fixture-after-table');
      const structuredNote = box('#structured-note');
      const afterNote = box('.fixture-after-note');
      const tableHead = document.querySelector('.fixture-captioned-table thead th');
      const tableHeadStyle = getComputedStyle(tableHead);
      return {
        noteDisplay: getComputedStyle(note).display,
        paragraphNoteDisplay: getComputedStyle(document.querySelector('#paragraph-note')).display,
        noteText: note.textContent.replace(/\s+/g, ' ').trim(),
        noteOrder: noteParts.every((rect, index, all) => index === 0 || followsInReadingOrder(rect, all[index - 1])),
        noteRects: noteParts.map(({ top, right, bottom, left }) => ({ top, right, bottom, left })),
        definitionRatio: definitionCopy.width / (definition.width - 40),
        definitionGap: definitionCopy.top - definitionLabel.bottom,
        takeawayRatio: takeawayCopy.width / (takeaway.width - 35.2),
        headingFits: heading.scrollWidth <= heading.clientWidth + 1,
        headingCode: { border: getComputedStyle(headingCode).borderTopWidth, padding: getComputedStyle(headingCode).paddingLeft, background: getComputedStyle(headingCode).backgroundColor },
        sectionWidth: section.width,
        sharedWidths: {
          headerLead: box('.fixture-header-lead').width,
          documentIntro: box('.document-intro').width,
          sectionIntro: box('.section-intro').width,
          diagram: box('.fixture-diagram').width,
          followingParagraph: prose.width,
          list: box('.fixture-list').width,
          definition: definition.width,
          facts: facts.width,
          note: inlineNote.width,
          takeaway: takeaway.width,
          table: box('.doc-table-scroll').width,
        },
        sharedLefts: {
          followingParagraph: prose.left,
          list: box('.fixture-list').left,
          definition: definition.left,
          facts: facts.left,
          note: inlineNote.left,
          takeaway: takeaway.left,
        },
        sectionLeft: section.left,
        interiorPadding: {
          definition: definitionCopy.left - definition.left,
          facts: factsCopy.left - facts.left,
          note: parseFloat(getComputedStyle(note).paddingLeft),
          takeaway: takeawayCopy.left - takeaway.left,
        },
        richColumns: signals.left > richCopy.right - 2,
        structuredTakeawayColumns: structuredCopy.left > structuredLabel.right - 2,
        structuredNoteColumns: noteCopy.left > noteLabel.right - 2,
        richGrid: getComputedStyle(document.querySelector('#rich-definition')).gridTemplateColumns,
        takeawayGrid: getComputedStyle(document.querySelector('#structured-takeaway')).gridTemplateColumns,
        noteGrid: getComputedStyle(document.querySelector('#structured-note')).gridTemplateColumns,
        rhythm: {
          headerToIntro: intro.top - header.bottom,
          tableToParagraph: afterTable.top - captionedTable.bottom,
          noteToHeading: afterNote.top - structuredNote.bottom,
          structuredInternal: innerWidth >= 768 ? Math.abs(noteCopy.top - noteLabel.top) : noteCopy.top - noteLabel.bottom,
        },
        tableHead: { background: tableHeadStyle.backgroundColor, color: tableHeadStyle.color },
      };
    });

    assert.equal(metrics.noteDisplay, 'block', `${width}px: an inline note uses natural flow`);
    assert.equal(metrics.paragraphNoteDisplay, 'block', `${width}px: a one-paragraph note must not reserve an empty column`);
    assert.match(metrics.noteText, /^Важно: при .* NOT VERIFIED, а не оптимистичная готовность\.$/);
    assert.equal(metrics.noteOrder, true, `${width}px: inline note fragments retain reading order (${JSON.stringify(metrics.noteRects)})`);
    assert.ok(metrics.definitionRatio > 0.85, `${width}px: plain definition copy occupies its useful measure`);
    assert.ok(metrics.definitionGap >= 0 && metrics.definitionGap <= 32, `${width}px: plain definition has a compact stack gap`);
    assert.ok(metrics.takeawayRatio > 0.85, `${width}px: single-child takeaway occupies its useful measure`);
    assert.equal(metrics.headingFits, true, `${width}px: long code heading wraps inside its heading`);
    assert.deepEqual(metrics.headingCode, { border: '0px', padding: '0px', background: 'rgba(0, 0, 0, 0)' }, `${width}px: heading code is not a padded chip`);
    assert.ok(metrics.rhythm.headerToIntro >= 16 && metrics.rhythm.headerToIntro <= 24, `${width}px: introduction clears the header rule (${metrics.rhythm.headerToIntro}px)`);
    assert.ok(metrics.rhythm.tableToParagraph >= 16 && metrics.rhythm.tableToParagraph <= 24, `${width}px: table and following prose use the inter-block rhythm (${metrics.rhythm.tableToParagraph}px)`);
    assert.ok(metrics.rhythm.noteToHeading >= 28 && metrics.rhythm.noteToHeading <= 36, `${width}px: note and next heading use a section-level break (${metrics.rhythm.noteToHeading}px)`);
    assert.ok(metrics.rhythm.structuredInternal >= -1 && metrics.rhythm.structuredInternal <= 12, `${width}px: structured note internals stay compact (${metrics.rhythm.structuredInternal}px)`);
    assert.ok(relativeLuminance(metrics.tableHead.background) > 0.75, `${width}px: table heading uses a light neutral background (${metrics.tableHead.background})`);
    assert.ok(contrastRatio(metrics.tableHead.color, metrics.tableHead.background) >= 7, `${width}px: table heading remains legible (${metrics.tableHead.color} on ${metrics.tableHead.background})`);
    for (const [name, actualWidth] of Object.entries(metrics.sharedWidths)) {
      assert.ok(Math.abs(actualWidth - metrics.sectionWidth) <= 2, `${width}px/${open ? 'open' : 'closed'}: ${name} shares the section canvas (${actualWidth} vs ${metrics.sectionWidth})`);
    }
    for (const [name, actualLeft] of Object.entries(metrics.sharedLefts)) {
      assert.ok(Math.abs(actualLeft - metrics.sectionLeft) <= 2, `${width}px/${open ? 'open' : 'closed'}: ${name} has no per-element left strip`);
    }
    for (const [name, inset] of Object.entries(metrics.interiorPadding)) {
      assert.ok(inset >= 10, `${width}px/${open ? 'open' : 'closed'}: ${name} preserves interior padding (${inset})`);
    }
    if (width >= 768) {
      assert.equal(metrics.richColumns, true, `${width}px: rich definition retains columns`);
      assert.equal(metrics.structuredTakeawayColumns, true, `${width}px: labelled takeaway retains columns`);
      assert.equal(metrics.structuredNoteColumns, true, `${width}px: paragraph note retains columns`);
    } else {
      assert.equal(metrics.richGrid.split(/\s+/).length, 1, `mobile: rich definition stacks (${metrics.richGrid})`);
      assert.equal(metrics.takeawayGrid.split(/\s+/).length, 1, `mobile: labelled takeaway stacks (${metrics.takeawayGrid})`);
      assert.equal(metrics.noteGrid.split(/\s+/).length, 1, `mobile: paragraph note stacks (${metrics.noteGrid})`);
    }
  };

  for (const width of [1920, 1440, 768, 390]) {
    await assertLayout(width, true);
    await assertLayout(width, false);
  }
  await assertLayout(1440, true);
  await page.screenshot({ path: '/tmp/documentation-layout-regression-desktop.png', fullPage: true });
  await assertLayout(390, false);
  await page.screenshot({ path: '/tmp/documentation-layout-regression-mobile.png', fullPage: true });
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
  await page.goto(pathToFileURL(path.join(toolkitRoot, 'examples/business-process.html')).href);
  assert.equal(await page.locator('[data-bpmn-runtime] svg').count(), 0);
  assert.equal(await page.locator('[data-bpmn-runtime] noscript').count(), 2);
  assert.ok(await page.locator('[data-bpmn-runtime] noscript').first().isVisible());
  assert.match(await page.locator('.diagram-source code').first().textContent(), /BPMNDiagram/);
  assert.equal(await page.locator('.diagram-source a[download]').count(), 2);
});
