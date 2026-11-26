import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const url = process.env.MAP_URL || process.argv[2];
if (!url) throw new Error('Set MAP_URL or pass the map URL as the first argument.');
const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1180, height: 780}});
const hiker = page.locator('.tileflow-hiker');
const tool = page.locator('#place-person');
const card = page.locator('#card');
const ghost = page.locator('.placement-ghost');

// Count actual DEM requests without exposing application state in the published map.
await page.addInitScript(() => {
  window.relocationLoads = [];
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'load' && Number.isFinite(message.lat)) {
      window.relocationLoads.push({lat: message.lat, lon: message.lon});
    }
    return post.call(this, message, ...rest);
  };
});

async function ready() {
  await page.waitForFunction(() => /^(Visible|Blocked|Hidden)\b/.test(
    document.querySelector('.profile-answer')?.textContent || '',
  ), null, {timeout: 90000});
}

async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box);
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function view() {
  return page.evaluate(() => ({
    name: document.querySelector('#place').textContent,
    distance: document.querySelector('.profile-distance').textContent,
    verdict: document.querySelector('.profile-answer').textContent,
    locked: document.querySelector('.profile-lock').getAttribute('aria-pressed'),
    observer: document.querySelector('.tileflow-hiker').style.transform,
    loads: window.relocationLoads,
  }));
}

async function lift(source, destination) {
  const start = await center(source);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, {steps: 8});
  await ghost.waitFor();
  assert.equal(await page.locator('body').getAttribute('data-placement'), 'dragging');
  assert.equal(await ghost.getAttribute('data-valid'), 'true');
  assert.equal(await card.isVisible(), false);
  assert.equal(await tool.locator('.observer-portrait').isVisible(), false);
  assert.equal(await hiker.evaluate(el => getComputedStyle(el).opacity), '0');
  assert.equal(await page.locator('.live-aim').evaluate(el => getComputedStyle(el).opacity), '0');
}

try {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await ready();
  await page.getByRole('button', {name: 'Lock view', exact: true}).click();
  const before = await view();
  assert.equal(before.locked, 'true');
  assert.equal(before.loads.length, 1);
  const marker = await center(hiker);
  const ground = {x: marker.x + 64, y: marker.y - 24};

  await lift(hiker, ground);
  assert.deepEqual((await view()).loads, before.loads);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await ghost.waitFor({state: 'detached'});
  assert.ok(await card.isVisible());
  assert.deepEqual(await view(), before);

  await lift(tool, ground);
  const invalid = await center(page.getByRole('combobox'));
  await page.mouse.move(invalid.x, invalid.y);
  assert.equal(await ghost.getAttribute('data-valid'), 'false');
  await page.mouse.up();
  await ghost.waitFor({state: 'detached'});
  assert.deepEqual(await view(), before);
  assert.ok(await card.isVisible());

  await lift(hiker, ground);
  const final = {x: ground.x + 12, y: ground.y + 4};
  await page.mouse.move(final.x, final.y);
  assert.deepEqual((await view()).loads, before.loads);
  await page.mouse.up();
  await ghost.waitFor({state: 'detached'});
  await page.getByRole('heading', {name: 'Observer', exact: true}).waitFor();
  await ready();
  const after = await view();
  assert.equal(after.loads.length, 2);
  assert.notDeepEqual(after.loads[1], before.loads[0]);
  assert.notEqual(after.observer, before.observer);
  assert.ok(await card.isVisible());
  console.log('Observer relocation, cancellation and invalid drop passed at ' + url);
} finally {
  await browser.close();
}
