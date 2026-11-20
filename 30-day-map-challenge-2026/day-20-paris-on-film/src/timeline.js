// Years come from the archive and run from the first recorded year to the last.
export function bindTimeline(years, select, play, track, changeYear) {
  const yearList = [...years].sort((a, b) => a - b);
  const last = yearList.length - 1;
  const yearDuration = 900;
  let position = 0;
  let frame = null;
  let started = 0;

  track.max = Math.max(0, last);
  play.disabled = last < 1;

  function paint() {
    const percent = last > 0 ? position / last * 100 : 0;
    track.style.setProperty('--elapsed', percent + '%');
    track.value = Math.floor(position);
    track.setAttribute('aria-valuetext', select.selectedOptions[0].textContent);
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    play.setAttribute('aria-label', 'Play years');
    play.title = 'Play years';
    play.dataset.playing = 'false';
  }

  function selectPosition(value) {
    position = Math.max(0, Math.min(last, value));
    const valueYear = yearList[Math.floor(position)];
    if (Number(select.value) !== valueYear) {
      select.value = String(valueYear);
      changeYear(valueYear);
    }
    paint();
  }

  function advance(now) {
    selectPosition((now - started) / yearDuration);
    if (position >= last) stop();
    else frame = requestAnimationFrame(advance);
  }

  function syncSelection() {
    stop();
    position = Math.max(0, yearList.indexOf(Number(select.value)));
    track.hidden = !Number(select.value) || last < 1;
    paint();
  }

  play.onclick = () => {
    if (frame !== null) { stop(); return; }
    track.hidden = false;
    selectPosition(position >= last ? 0 : position);
    started = performance.now() - position * yearDuration;
    play.dataset.playing = 'true';
    play.title = 'Pause years';
    play.setAttribute('aria-label', 'Pause years');
    frame = requestAnimationFrame(advance);
  };
  select.onchange = () => {
    syncSelection();
    changeYear(Number(select.value));
  };
  track.oninput = () => {
    stop();
    selectPosition(Number(track.value));
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  syncSelection();
  return stop;
}
