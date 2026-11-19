import {CRITTERS} from './critters';
import {icons} from './icons';

export function mountGameLayout(root: HTMLElement, difficulties: Record<string, {label: string}>) {
 root.innerHTML=`<div id="map" aria-label="Scent map" aria-describedby="pick-spot-hint"></div><div class="vignette"></div>
<div id="pick-spot-hint" class="pick-spot-hint"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><div><strong>Pick a starting point</strong><span>Tap the map or drag your character</span></div></div>
<header class="topbar"><a class="brand" href="https://tileflow.dev" target="_blank" rel="noopener" aria-label="Built with Tileflow"><span>Built with</span><img src="${import.meta.env.BASE_URL}tileflow-wordmark.svg" alt="Tileflow"></a><div class="top-actions"><button id="locate-me" class="round-button" disabled aria-label="Use my location" title="Use my location">${icons.target}</button><button id="pick-location" class="round-button" aria-label="Choose a new starting point" title="Choose a new starting point" hidden>⚑</button><button id="sound" class="round-button" aria-label="Mute sound" title="Sound">♫</button><button id="pause" class="round-button" aria-label="Pause" title="Pause" hidden>Ⅱ</button><button id="about" class="round-button" aria-label="How to play" title="How to play">?</button></div></header>
<section class="intro"><div class="intro-challenge"><span>30 Day Map Challenge</span><span>Day 19 · Senses: Smell</span></div><h1 aria-label="SNIFF!"><span class="intro-wordmark"><span data-wordmark="S">S</span><span data-wordmark="N">N</span><span data-wordmark="IF">IF</span><span data-wordmark="F">F</span></span><span class="intro-bang" data-wordmark="!">!</span></h1>
<div id="critter-label" class="setup-label">Play as</div>
<div class="critter-picker" role="group" aria-labelledby="critter-label">${Object.entries(CRITTERS).map(([kind,critter])=>`<button type="button" data-critter="${kind}" aria-pressed="${kind==='dog'}"><img class="critter-portrait" src="${import.meta.env.BASE_URL}critters/${kind}.webp" alt="" width="51" height="46" draggable="false"><small>${critter.label}</small></button>`).join('')}</div>
<div class="setup-label difficulty-label" id="difficulty-label">Difficulty</div>
<div class="difficulty-picker" role="group" aria-labelledby="difficulty-label">${Object.entries(difficulties).map(([key,{label}])=>'<button type="button" data-difficulty="'+key+'" aria-pressed="'+(key==='normal')+'">'+label+'</button>').join('')}</div>
<button id="start" class="play-button" disabled><span>Loading…</span></button>
<div class="intro-extras"><button id="free-play" disabled>Free roam</button></div></section>
<div id="start-status" role="status"></div>
<div class="round-stats" hidden><div id="health" class="health" aria-label="3 hearts"><span id="heart-0"></span><span id="heart-1"></span><span id="heart-2"></span></div><div class="timer" role="timer" aria-label="Time for the next bite"><span class="timer-icon">${icons.watch}</span><strong id="time">1:00</strong><button id="pause-inline" aria-label="Pause round">Ⅱ</button></div></div>
<aside class="order-board" hidden>
 <div class="order-title"><h2><span class="bites-mobile-title">Next bites</span><span class="bites-desktop-title">Your tasting</span></h2><span id="tasting-count"></span><div class="star-count"><span id="star-model"></span><strong id="stars">0</strong></div></div>
 <div id="ingredients"></div>
 <button type="button" id="next-bite" class="next-bite" title="Sniff for a trail" hidden>
  <span class="next-bite-copy">
   <small id="next-bite-status">Next bite</small>
   <strong id="next-bite-venue"></strong>
  </span>
  <span id="next-bite-direction"><span id="next-bite-arrow" aria-hidden="true">➜</span><strong id="next-bite-distance"></strong></span>
 </button>
 <div class="score-line"><strong id="score">0</strong><span>points</span><span id="combo"></span></div>
</aside>
<div class="explore-badge" hidden><span>🐾</span><strong id="found-total">0</strong><button id="start-here">▶ Play</button></div>
<div class="game-controls" hidden><button id="jump" class="jump-button" aria-label="Jump, Space">${icons.jump}<strong>Jump</strong><kbd>SPACE</kbd></button><button id="sniff" class="sniff-button" aria-label="Hold to sniff, E or Enter">${icons.paw}<span>Sniff!</span><kbd>E / ↵</kbd></button><button id="sprint" class="round-button sprint-button" aria-label="Hold to sprint, Shift">${icons.sprint}<small aria-hidden="true">Sprint</small><kbd>SHIFT</kbd></button><button id="sit" class="round-button sit-button" aria-label="Sit and recover, Control" aria-pressed="false" title="Sit · Ctrl">${icons.rest}<kbd>CTRL</kbd></button><button id="camera" class="round-button" aria-label="Follow the dog" title="Follow the dog">${icons.target}</button></div>
<figure class="minimap" hidden><figcaption><span class="sr-only">Live minimap</span><span class="minimap-north" aria-label="North up"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 13 13 8 10 3 13Z" fill="currentColor"/></svg>N</span></figcaption><canvas id="minimap" role="img" aria-label="Live map of your route and heading"></canvas></figure>
<div id="joystick" class="joystick" aria-label="Drag to steer" hidden><span class="joystick-knob" aria-hidden="true">✥</span></div>
<button id="scent-guide" class="scent-guide" aria-label="Find a food scent" hidden><span id="guide-arrow">➜</span><strong id="guide-distance"></strong><span id="guide-kind"></span><span id="guide-aroma" hidden></span><span id="guide-venue" hidden><strong id="venue-name"></strong><small id="venue-type"></small></span></button>
<div id="venue-labels">${Array.from({length:3},()=>'<div class="venue-label" hidden></div>').join('')}</div>
<div id="arrival-card" class="arrival-card" hidden><span id="arrival-city"></span><strong id="arrival-street"></strong></div>
<div id="countdown" class="countdown" hidden><strong id="countdown-number">3</strong><span id="countdown-caption">WASD to run · Space to jump · E / Enter to sniff</span></div>
<div id="game-toast" class="game-toast" role="status" aria-live="polite"></div><div id="damage-flash"></div><div id="order-celebration" class="order-celebration" hidden></div>
<section id="pause-card" class="pause-card" hidden><span>Ⅱ</span><h2>Paws for a moment.</h2><button id="resume" class="play-button">Resume <b>▶</b></button><button id="quit" class="text-button">End round</button><button id="pick-paused" class="text-button">Change starting point</button></section>
<div class="film-ui" hidden><span>SNIFF! <small>by tileflow</small></span><button id="stop-film" class="round-button" aria-label="End film">×</button><div class="film-track"><span id="film-progress"></span></div></div>
<dialog id="about-dialog"><button id="close-about" class="round-button" aria-label="Close help">×</button><h2>Follow your nose.</h2><div class="help-grid"><span>🥐 ☕ 🥘</span><p>Follow your nose to taste the foods on your card. Eat what you are craving. Every bite refills the clock. Later cravings give you less time.</p><span>💩 🚗</span><p>Jump over holes and low fences. Dodge cars, bikes, scooters and smelly trash. Sprinklers and pedestrians slow you down.</p><span>♡</span><p>Sit safely to regain one heart every 3 seconds.</p></div><p class="help-keys"><b>WASD / arrows</b> run · <b>Space</b> jump<br><b>E / Enter</b> sniff · <b>Shift</b> sprint · <b>Ctrl</b> rest<br>Tap a spot to run there · Drag to look around</p><small>Real mapped businesses. Fictional collectibles and hazards. Paella is a game reward, not a menu claim. © OpenStreetMap · Tileflow.</small></dialog>
<div id="load-error" role="alert" hidden><strong>The map could not load.</strong><button id="retry" class="play-button">Try again ↻</button></div>
`;
}
