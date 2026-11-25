// Keep the native menu stable while someone is choosing a bus from the live fleet.
export function createBusPicker(select, describe, choose) {
  const order = new Intl.Collator('en', {numeric: true});
  const groups = new Map(), options = new Map();
  const supportsOpen = CSS.supports('selector(:open)');
  let fleet = [], selected = '';
  function sync(force = false) {
    if (!force && (supportsOpen ? select.matches(':open') : select === document.activeElement)) return;
    const active = new Set(), changed = new Set();
    let groupOrderChanged = false;
    for (const bus of fleet) {
      active.add(bus.id);
      const {line, destination} = describe(bus);
      const vehicle = bus.id.split('/').at(-1);
      let group = groups.get(line);
      if (!group) {
        group = document.createElement('optgroup');
        group.label = 'Line ' + line;
        groups.set(line, group);
        groupOrderChanged = true;
      }
      let option = options.get(bus.id);
      if (!option) {
        option = new Option('', bus.id);
        options.set(bus.id, option);
      }
      const title = line + ' · Bus ' + vehicle + ' → ' + destination;
      if (option.text !== title || option.parentElement !== group) {
        option.text = title;
        option.dataset.destination = destination;
        group.append(option);
        changed.add(group);
      }
      if (option.disabled) option.disabled = false;
    }
    for (const [id, option] of options) {
      if (active.has(id)) continue;
      if (id === selected) {
        if (!option.disabled) option.text += ' · Signal lost';
        option.disabled = true;
      } else {
        option.remove();
        options.delete(id);
      }
    }
    for (const [line, group] of groups) {
      if (!group.childElementCount) {
        group.remove();
        groups.delete(line);
      } else if (changed.has(group)) {
        group.append(...Array.from(group.children).sort((a, b) =>
          order.compare(a.dataset.destination, b.dataset.destination) || order.compare(a.text, b.text) ||
          order.compare(a.value, b.value)));
      }
    }
    if (groupOrderChanged) {
      select.append(...[...groups].sort(([a], [b]) => order.compare(a, b)).map(([, group]) => group));
    }
    if (select.value !== selected) select.value = options.has(selected) ? selected : '';
  }
  select.addEventListener('pointerdown', () => sync(true));
  select.addEventListener('change', () => { choose(select.value); sync(true); });
  select.addEventListener('blur', () => sync(true));
  return {
    update(buses) { fleet = buses; sync(); },
    select(id) {
      selected = id || '';
      if (select.value !== selected) select.value = options.has(selected) ? selected : '';
    },
  };
}
