import {TASTES} from './game.mjs';
import './recipe-finish.css';

function element<K extends keyof HTMLElementTagNameMap>(name: K, className?: string, words?: string) {
 const node = document.createElement(name);
 if (className) node.className = className;
 if (words !== undefined) node.textContent = words;
 return node;
}

function taste(kind: string) {
 return TASTES[kind as keyof typeof TASTES];
}

export function createRecipeFinish() {
 const award = document.getElementById('order-celebration')!;
 const panels = Array.from(document.querySelectorAll('.order-board, .scent-guide'));
 const announcement = element('div', 'sr-only');
 award.classList.add('recipe-award');
 announcement.setAttribute('role', 'status');
 award.after(announcement);

 function clearHud() {
  if (award.hidden) return;
  const bounds = award.getBoundingClientRect();
  let bottom = 0;
  for (const panel of panels) {
   const rect = panel.getBoundingClientRect();
   if (rect.height && rect.left < bounds.right && rect.right > bounds.left) {
    bottom = Math.max(bottom, rect.bottom);
   }
  }
  award.style.setProperty('--recipe-hud-bottom', `${Math.ceil(bottom)}px`);
 }

 const resize = new ResizeObserver(clearHud);

 return {
  celebrate(kinds: readonly string[]) {
   const ticket = element('div', 'recipe-ticket');
   const foodRow = element('div', 'recipe-ticket-food');
   for (const [index, kind] of kinds.entries()) {
    const icon = element('div', 'recipe-ticket-bite');
    icon.id = 'recipe-bite-' + index;
    icon.setAttribute('aria-label', taste(kind)?.label ?? kind);
    icon.style.setProperty('--bite-color', taste(kind)?.color ?? '#ffecb4');
    foodRow.append(icon);
   }
   const label = element('div', 'recipe-ticket-label', 'Craving satisfied!');
   const bonus = element('div', 'recipe-ticket-bonus', '+300 points');
   ticket.append(label, foodRow, bonus);
   award.replaceChildren(ticket);
   award.hidden = false;
   clearHud();
   resize.observe(document.body);
   panels.forEach(panel => resize.observe(panel));
   announcement.textContent = label.textContent;
   return foodRow.getBoundingClientRect();
  },

  hideAward() {
   resize.disconnect();
   award.hidden = true;
   announcement.textContent = '';
  },
 };
}
