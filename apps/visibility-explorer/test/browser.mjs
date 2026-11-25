import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Run against the development server, a deployment preview, or the public demo.
const url = process.env.MAP_URL || process.argv[2];
if (!url) throw new Error('Set MAP_URL or pass the map URL as the first argument.');
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

const terrainChart = 'canvas[aria-label="Explore the terrain profile"]';
const distance = '.profile-distance';
const observer = '#world .tileflow-hiker';
const worldCanvas = '#world canvas.maplibregl-canvas';
const decimalDistance = /^\d[\d,]*(?:\.\d+)?\s+(?:km|m)$/;

async function waitForProfile(page) {
  await page.locator(terrainChart).waitFor({ state: 'visible', timeout: 90000 });
  await page.waitForFunction(() => {
    const result = document.querySelector('.profile-answer')?.textContent || '';
    return /^(Visible|Blocked|Hidden)\b/.test(result);
  }, null, { timeout: 90000 });
  assert.match((await page.locator(distance).innerText()).trim(), decimalDistance);
}

async function changedDistance(page, previous) {
  await page.waitForFunction(old => {
    const reading = document.querySelector('.profile-distance')?.textContent.trim();
    return reading && reading !== '—' && reading !== old;
  }, previous);
}

async function freeGround(page, dx, dy) {
  // The observer is a visible map marker. Probe nearby screen pixels for a clear
  // canvas hit so panels and the two draggable handles cannot swallow the gesture.
  return page.locator(observer).evaluate((el, [dx,dy]) => {
    const box = el.getBoundingClientRect();
    const x0 = box.left + box.width / 2 + dx;
    const y0 = box.bottom + dy;
    for (const [ox,oy] of [[0,0],[14,-10],[-16,9],[22,19],[-27,-16]]) {
      const x = Math.round(x0 + ox), y = Math.round(y0 + oy);
      if (document.elementFromPoint(x, y)?.matches('#world canvas.maplibregl-canvas')) return {x,y};
    }
    throw new Error('No unobstructed terrain near the observer.');
  }, [dx,dy]);
}

async function waitForObserverMap(page) {
  const canvas = page.locator('.eye-panel[data-map-state="ready"] .eye-map canvas.maplibregl-canvas');
  await canvas.waitFor({state:'visible',timeout:90000});
  assert.ok(await canvas.evaluate(el => {
    const gl = el.getContext('webgl2');
    return gl && !gl.isContextLost() && gl.drawingBufferWidth >= el.clientWidth - 1 &&
      gl.drawingBufferHeight >= el.clientHeight - 1 && el.clientHeight > 40;
  }), 'The observer map needs a live WebGL drawing buffer at its displayed size.');
}

async function readMapColors(page) {
  // Read the composed browser image. WebGL does not retain its drawing buffer
  // between frames, and pixel reads directly from the live context can be blank.
  const png = await page.locator('.eye-map canvas.maplibregl-canvas').screenshot();
  return page.evaluate(async base64 => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + base64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 12;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const {data} = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = [];
    for (let i = 0; i < data.length; i += 4) {
      colors.push(((data[i] >> 4) << 8) | ((data[i+1] >> 4) << 4) | (data[i+2] >> 4));
    }
    return colors;
  }, png.toString('base64'));
}

async function checkObserverLayout(page, mobile, expanded) {
  const chart = await page.locator(terrainChart).boundingBox();
  const frame = page.locator('.eye-frame');
  if (mobile && !expanded) {
    assert.equal(await frame.isVisible(), false, 'The mobile map opens on demand.');
    return;
  }
  await waitForObserverMap(page);
  const map = await frame.boundingBox();
  const card = await page.locator('#card').boundingBox();
  assert.ok(map.width >= 80);
  if (mobile) {
    assert.ok(map.x >= card.x && map.x + map.width <= card.x + card.width + 1);
    assert.ok(map.y >= chart.y + chart.height - 1, 'The open mobile map belongs below the profile.');
  } else {
    const panel = await page.locator('.eye-panel').boundingBox();
    const {width, height} = page.viewportSize();
    assert.ok(panel.x >= card.x + card.width && width - (panel.x + panel.width) <= 36,
      'The desktop map belongs in the right corner beyond the profile card.');
    assert.ok(Math.abs(panel.y + panel.height - (card.y + card.height)) < 4 &&
      height - (panel.y + panel.height) <= 48, 'Both desktop panels belong along the lower edge.');
  }
}

async function touchDrag(page, start, end) {
  const session = await page.context().newCDPSession(page);
  const point = (x,y) => [{x: Math.round(x), y: Math.round(y), radiusX: 2, radiusY: 2}];
  try {
    await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:point(start.x,start.y)});
    for (let step=1; step<=6; step++) {
      const x = start.x + (end.x-start.x)*step/6;
      const y = start.y + (end.y-start.y)*step/6;
      await session.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:point(x,y)});
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  } finally {
    await session.detach();
  }
}

async function checkView(browser, mobile, profileLayout) {
  const layout = profileLayout ? 'profile' : 'compact';
  const name = (mobile ? 'mobile' : 'desktop') + '-' + layout;
  const address = new URL(url);
  if (profileLayout) address.searchParams.set('layout','profile');
  else address.searchParams.delete('layout');
  const viewport = mobile ? {width:profileLayout ? 320 : 390,height:844} : {width:1180,height:780};
  const context = await browser.newContext({viewport, isMobile:mobile, hasTouch:mobile, locale:'en-US'});
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text() + ' ' + message.location().url);
  });
  page.on('response', response => {
    const type = response.request().resourceType();
    if (response.status() >= 400 && ['document','script','stylesheet'].includes(type)) {
      errors.push(type + ' ' + response.status() + ' ' + response.url());
    }
  });
  const button = label => page.getByRole('button', {name:label,exact:true});
  const activate = locator => mobile ? locator.tap() : locator.click();
  const more = button('More');
  async function showMenu() {
    if (await more.getAttribute('aria-expanded') === 'false') await activate(more);
    await page.locator('#observer-actions').waitFor();
  }
  async function menuAction(label) {
    await showMenu();
    await activate(page.locator('#observer-actions').getByRole('button',{name:label,exact:true}));
  }
  let step = 'open map';
  try {
    const response = await page.goto(address.href,{waitUntil:'domcontentloaded',timeout:90000});
    assert.ok(!response || response.ok(), 'Map entry returned ' + response?.status());
    assert.equal(await page.locator('html').getAttribute('lang'),'en');
    assert.match(await page.title(),/visibilit/i);
    await page.getByRole('heading',{name:'Pico do Arieiro',exact:true}).waitFor();
    await waitForProfile(page);
    assert.ok(await page.locator(worldCanvas).isVisible());
    assert.equal(await page.locator('html').getAttribute('data-layout'),layout);
    const searchForm = page.getByRole('search');
    assert.ok(await searchForm.getByRole('combobox',{name:'Search for a mountain or enter coordinates'}).isVisible());
    assert.equal((await searchForm.innerText()).trim(),'');
    assert.equal(await searchForm.locator('img, .wordmark, .brand').count(),0);
    assert.equal(await page.locator('#card #terrain-profile').count(),1);
    assert.equal(await page.locator('#settings #location').isVisible(),false);
    assert.equal(await page.locator('#settings #observer-stats').isVisible(),false);
    assert.equal(await more.getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#observer-actions').isVisible(),false);
    assert.doesNotMatch(await page.locator('#card').innerText(),/View from|visible area|farthest visible|observer height/i);
    assert.equal(await button('Lock view').getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('.tf-probe-pin').count(),0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),viewport.width);
    const preview = page.locator('.observer-view'), eyePanel = page.locator('.eye-panel');
    const compass = eyePanel.locator('.eye-compass');
    assert.equal(await preview.getAttribute('aria-expanded'),'false');
    assert.equal(await preview.getAttribute('aria-label'),mobile ? 'Open observer map' : 'Expand observer map');
    await checkObserverLayout(page,mobile,false);
    if (mobile) assert.equal(await eyePanel.locator('.eye-map canvas').count(),0);
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,name+'-madeira.png')});

    step = 'open the Outdoors observer map';
    await activate(preview);
    assert.equal(await preview.getAttribute('aria-expanded'),'true');
    assert.equal(await preview.getAttribute('aria-label'),mobile ? 'Close observer map' : 'Reduce observer map');
    await checkObserverLayout(page,mobile,true);
    assert.ok(Math.abs(Number(await eyePanel.getAttribute('data-observer-lat')) - 32.7355) < .001);
    assert.ok(Math.abs(Number(await eyePanel.getAttribute('data-observer-lon')) + 16.9289) < .001);
    assert.match(await compass.textContent(), /\d+°/);
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,name+'-map-open.png')});
    if (mobile) await activate(preview);
    else await page.keyboard.press('Escape');
    assert.equal(await preview.getAttribute('aria-expanded'),'false');
    await checkObserverLayout(page,mobile,false);

    step = 'card controls and keyboard';
    const layoutBounds = await page.locator('#card').boundingBox();
    assert.ok(layoutBounds.x>=0 && layoutBounds.x+layoutBounds.width<=viewport.width+1);
    assert.ok(layoutBounds.y>=0 && layoutBounds.y+layoutBounds.height<=viewport.height+1);
    await activate(button('Collapse profile'));
    assert.equal(await page.locator(terrainChart).isVisible(),false);
    assert.ok(await page.locator(distance).isVisible());
    assert.ok(await page.locator('.profile-answer').isVisible());
    await activate(button('Expand profile'));
    await waitForProfile(page);
    if (mobile) await showMenu();
    else { await more.focus(); await page.keyboard.press('Enter'); }
    assert.equal(await more.getAttribute('aria-expanded'),'true');
    for (const label of ['Visible peaks','360° horizon','Settings','Close-up','Remove observer']) {
      assert.ok(await page.locator('#observer-actions').getByRole('button',{name:label,exact:true}).isVisible());
    }
    if (mobile) await activate(more);
    else { await more.focus(); await page.keyboard.press('Space'); }
    assert.equal(await more.getAttribute('aria-expanded'),'false');

    step = 'explore terrain';
    const before = (await page.locator(distance).innerText()).trim();
    const start = await freeGround(page, mobile ? 45 : 80, -26);
    if (mobile) await page.touchscreen.tap(start.x,start.y);
    else await page.mouse.move(start.x,start.y);
    await changedDistance(page,before);
    await waitForProfile(page);
    const initialBearing = await compass.textContent();
    const initialHeading = await eyePanel.getAttribute('data-heading');
    const checkRenderedScene = !mobile && !profileLayout;
    const initialColors = checkRenderedScene ? await readMapColors(page) : null;
    if (initialColors) assert.ok(new Set(initialColors).size > 3, 'The observer map should contain rendered terrain.');
    const target = await freeGround(page, mobile ? -55 : -145, -15);
    const moved = (await page.locator(distance).innerText()).trim();
    if (mobile) {
      await page.waitForFunction(p => {
        const h = document.querySelector('.live-aim');
        return h && h.contains(document.elementFromPoint(p.x,p.y));
      }, start);
      await touchDrag(page,start,target);
    } else {
      await page.mouse.move(target.x,target.y);
    }
    await changedDistance(page,moved);
    await waitForProfile(page);
    await page.waitForFunction(before => document.querySelector('.eye-compass').textContent !== before,initialBearing);
    const heading = await eyePanel.getAttribute('data-heading');
    assert.notEqual(heading,initialHeading);
    assert.ok(heading !== null && Number.isFinite(Number(heading)));
    if (!mobile) await waitForObserverMap(page);
    if (initialColors) assert.notDeepEqual(await readMapColors(page),initialColors,
      'Looking in a different direction should change the rendered map.');
    assert.equal(await page.locator('.tf-probe-pin').count(),0);

    step = 'summit and range';
    await menuAction('Visible peaks');
    await page.getByRole('combobox',{name:'Filter peaks by visibility'}).selectOption('hidden');
    await activate(page.getByRole('button',{name:/Chiqueiros da Queimada/}).first());
    await page.locator('#profile-name').filter({hasText:'Chiqueiros da Queimada'}).waitFor();
    await page.locator('.profile-answer').filter({hasText:/^Blocked nearby\b/}).waitFor();
    assert.equal(await button('Resume exploring').getAttribute('aria-pressed'),'true');
    await menuAction('Settings');
    assert.ok(await page.locator('#settings #location').isVisible());
    assert.ok(await page.locator('#settings #observer-stats').isVisible());
    const radius = page.getByLabel('Analysis radius',{exact:true});
    await radius.selectOption('1000');
    await page.locator('.profile-answer').filter({hasText:'Outside radius'}).waitFor({state:'attached'});
    await page.locator('.eye-panel[data-radius-m="1000"]').waitFor({state:'attached'});
    await radius.selectOption('10000');
    await page.waitForFunction(() => document.querySelector('.profile-answer')?.textContent.startsWith('Blocked nearby'));
    await page.locator('.eye-panel[data-radius-m="10000"]').waitFor({state:'attached'});
    await activate(button('Settings'));
    await waitForProfile(page);
    if (checkRenderedScene) {
      await waitForObserverMap(page);
      const pose = await eyePanel.evaluate(panel => ({...panel.dataset}));
      assert.ok(Math.abs(Number(pose.cameraLat) - Number(pose.observerLat)) < .000001);
      assert.ok(Math.abs(Number(pose.cameraLon) - Number(pose.observerLon)) < .000001);
      assert.ok(Math.abs(Number(pose.cameraAltitude) - Number(pose.groundElevation) - 1.7) < .1);
    }
    await menuAction('360° horizon');
    await page.getByRole('slider',{name:'Horizon bearing'}).waitFor();
    await activate(button('Close horizon'));
    if (await more.getAttribute('aria-expanded') === 'true') await activate(more);
    await waitForProfile(page);

    step = 'save place';
    await activate(button('Profile details'));
    const obstructionDetails = await page.locator('#profile-extra').innerText();
    assert.match(obstructionDetails, /line of sight at 3(?:\.\d+)?\s*m\b/i, 'Details retain the modeled distance at Chiqueiros');
    assert.match(obstructionDetails, /elevation cell here is about \d+(?:\.\d+)?\s*m across/i,
      'Details give the local terrain resolution beside the modeled crossing');
    await activate(button('Save this place'));
    await page.locator('.tf-probe-pin').first().waitFor();
    assert.equal(await page.locator('.tf-probe-pin').count(),1);
    assert.ok(await page.getByRole('heading',{name:'Pico do Arieiro',exact:true}).isVisible());

    await activate(button('Close point details'));
    await activate(button('Profile details'));
    if (!mobile && !profileLayout) {
      step = 'search and move observer to Gornergrat';
      const search = page.getByRole('combobox',{name:'Search for a mountain or enter coordinates'});
      await search.fill('Gornergrat');
      await activate(page.getByRole('option',{name:/Gornergrat/}).first());
      assert.ok(await page.getByRole('heading',{name:'Pico do Arieiro',exact:true}).isVisible());
      await activate(button('Place observer here'));
      await page.getByRole('heading',{name:'Gornergrat',exact:true}).waitFor();
      await waitForProfile(page);
      await waitForObserverMap(page);
      assert.ok(Math.abs(Number(await eyePanel.getAttribute('data-observer-lat')) - 45.9833365) < .001);
      assert.ok(Math.abs(Number(await eyePanel.getAttribute('data-observer-lon')) - 7.7849888) < .001);
      await menuAction('Settings');
      await page.locator('#settings #location').filter({hasText:/Switzerland/}).waitFor();
      await activate(more);
      await waitForProfile(page);
      if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,'desktop-alps.png')});
    } else if (mobile && !profileLayout) {
      step = 'drag the observer and remove it';
      const drop = await freeGround(page,55,-30);
      const handle = await page.locator(observer).boundingBox();
      const start = {x:handle.x+handle.width/2,y:handle.y+handle.height/2};
      assert.ok(await page.locator(observer).evaluate((el,p)=>el.contains(document.elementFromPoint(p.x,p.y)),start));
      await touchDrag(page,start,drop);
      await page.waitForFunction(() => document.querySelector('#place').textContent !== 'Pico do Arieiro');
      await waitForProfile(page);
      await menuAction('Remove observer');
      await page.locator('#terrain-profile').waitFor({state:'hidden'});
      assert.ok(await button('Place observer').isVisible());
      await activate(button('Place observer'));
      await page.getByRole('status').filter({hasText:'Tap the terrain to place the observer'}).waitFor();
      await activate(button('Cancel placement'));
    }
    assert.deepEqual(errors,[]);
    console.log(name + ' passed at ' + address.href);
  } catch (cause) {
    if (screenshotDir) await page.screenshot({path:path.join(screenshotDir,name+'-failure.png')}).catch(()=>{});
    throw new Error(name+' failed during “'+step+'”'+(errors.length?' ('+errors.join(', ')+')':''),{cause});
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  // Each desktop or expanded mobile view owns two MapLibre WebGL contexts.
  for (const profileLayout of [false,true]) {
    const checks = await Promise.allSettled([checkView(browser,false,profileLayout),checkView(browser,true,profileLayout)]);
    const failures = checks.filter(check=>check.status==='rejected').map(check=>check.reason);
    if (failures.length) throw new AggregateError(failures,'Visibility Explorer smoke failed');
  }
} finally {
  await browser.close();
}
