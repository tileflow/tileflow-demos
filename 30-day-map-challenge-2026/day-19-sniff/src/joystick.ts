/** Circular dead zone and independent pointer capture for multitouch. */
export function createJoystick(element: HTMLElement, canMove: () => boolean, onStart: () => void) {
  const knob = element.querySelector<HTMLElement>('.joystick-knob')!;
  let pointer: number | undefined;
  let origin = [0, 0];
  let input = [0, 0];
  const radius = 36;
  const deadZone = .14;

  function update(event: PointerEvent) {
    const x = (event.clientX - origin[0]) / radius;
    const y = (event.clientY - origin[1]) / radius;
    const length = Math.hypot(x, y);
    const strength = Math.max(0, (Math.min(length, 1) - deadZone) / (1 - deadZone));
    input = strength ? [x * strength / length, y * strength / length] : [0, 0];
    const clamp = Math.max(1, length);
    knob.style.transform = 'translate(' + x * radius / clamp + 'px,' + y * radius / clamp + 'px)';
  }

  function reset() {
    const previous = pointer;
    pointer = undefined;
    input = [0, 0];
    knob.style.transform = '';
    element.classList.remove('engaged');
    if (previous !== undefined && element.hasPointerCapture(previous)) {
      element.releasePointerCapture(previous);
    }
  }

  element.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !canMove() ||
        (pointer !== undefined && pointer !== event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    pointer = event.pointerId;
    origin = [event.clientX, event.clientY];
    input = [0, 0];
    knob.style.transform = '';
    element.classList.add('engaged');
    onStart();
  });
  element.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if (!canMove() || (event.pointerType === 'mouse' && (event.buttons & 1) === 0)) {
      reset();
      return;
    }
    update(event);
  });

  function finish(event: PointerEvent) {
    if (event.pointerId === pointer) reset();
  }

  // A release can target the document instead of the stick after a capture change.
  window.addEventListener('pointerup', finish, {capture: true});
  window.addEventListener('pointercancel', finish, {capture: true});
  element.addEventListener('lostpointercapture', finish);

  return {reset, get input() { return input; }, get active() { return pointer !== undefined; }};
}

/** A second touch can jump before either finger is released. */
export function bindJumpButton(button: HTMLButtonElement, jump: () => void) {
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    jump();
  });
  button.addEventListener('click', event => {
    if (event.detail === 0) jump();
  });
}
