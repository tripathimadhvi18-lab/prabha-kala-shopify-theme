// Prabha Kala cart page behaviour (sections/pk-main-cart.liquid).
// The page is Shopify's native cart form and works without this script. This script updates
// quantities, removals and discount codes in place through Shopify's own Ajax cart endpoints
// (/cart/change.js, /cart/update.js) and re-renders the section from Shopify's response
// (Section Rendering API). It dispatches Shopify's standard CartLinesUpdateEvent /
// CartDiscountUpdateEvent — the same events the cart drawer, header bag count and product
// cards already use — so there is a single cart-update mechanism across the theme.
import { CartLinesUpdateEvent, CartDiscountUpdateEvent, CartErrorEvent } from '@shopify/events';

// Horizon declares `Theme` as a top-level const (not on window).
function routes() {
  // eslint-disable-next-line no-undef
  const r = typeof Theme !== 'undefined' && Theme.routes ? Theme.routes : {};
  return {change: r.cart_change_url || '/cart/change.js', update: r.cart_update_url || '/cart/update.js'};
}

const post = (url, body, signal) =>
  fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify(body),
    signal,
  }).then((response) => response.json());

class PkCart extends HTMLElement {
  connectedCallback() {
    this.sectionId = this.dataset.sectionId;
    this.status = this.querySelector('[data-pk-cart-status]');
    this.timers = new Map();
    this.addEventListener('click', this.#onClick);
    this.addEventListener('change', this.#onChange);
    this.addEventListener('submit', this.#onSubmit);
  }

  get body() {
    return this.querySelector('[data-pk-cart-body]');
  }

  #lineOf(el) {
    return el.closest('[data-line]');
  }

  // ---------- quantity + remove ----------

  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const step = target.closest('[data-pk-line-step]');
    if (step) {
      const row = this.#lineOf(step);
      const input = row.querySelector('[data-pk-line-input]');
      const max = input.max ? Number(input.max) : Infinity;
      const next = Math.min(Math.max((Number(input.value) || 1) + Number(step.dataset.pkLineStep), 1), max);
      if (next === Number(input.value)) return;
      input.value = String(next);
      this.#queue(row, next);
      return;
    }

    const remove = target.closest('[data-pk-line-remove]');
    if (remove && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.#changeLine(this.#lineOf(remove), 0);
      return;
    }

    const removeCode = target.closest('[data-pk-discount-remove]');
    if (removeCode) {
      const code = removeCode.dataset.pkDiscountRemove;
      this.#applyDiscounts(this.#appliedCodes().filter((c) => c !== code), {removed: code});
    }
  };

  #onChange = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-pk-line-input]')) return;
    const max = input.max ? Number(input.max) : Infinity;
    const value = Math.min(Math.max(Math.floor(Number(input.value)) || 1, 1), max);
    input.value = String(value);
    this.#queue(this.#lineOf(input), value);
  };

  // Small debounce so repeated taps on + / − send one request.
  #queue(row, quantity) {
    const line = row.dataset.line;
    clearTimeout(this.timers.get(line));
    this.timers.set(line, setTimeout(() => this.#changeLine(row, quantity), 350));
  }

  async #changeLine(row, quantity) {
    if (!row) return;
    const line = Number(row.dataset.line);
    const title = row.querySelector('.pk-line__title')?.textContent.trim() || 'Item';
    const deferred = CartLinesUpdateEvent.createPromise();
    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: quantity > 0 ? 'update' : 'remove',
        context: 'cart',
        lines: [{id: row.dataset.key, quantity}],
        promise: deferred.promise,
      })
    );
    this.#busy(true);
    try {
      const data = await post(routes().change, {line, quantity, sections: this.sectionId, sections_url: window.location.pathname});
      if (data.status || data.errors) {
        const message = data.description || data.message || 'Sorry, that change could not be made.';
        deferred.reject(new Error(message));
        this.dispatchEvent(new CartErrorEvent({error: message, code: 'INVALID'}));
        this.#lineError(line, message);
        return;
      }
      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(data),
        detail: {sections: data.sections, items: data.items, itemCount: data.item_count, source: 'pk-cart', didError: false},
      });
      this.#render(data.sections?.[this.sectionId]);
      this.#announce(quantity > 0 ? `${title}: quantity updated to ${quantity}.` : `${title} removed from your bag.`);
    } catch (error) {
      deferred.reject(error);
      this.dispatchEvent(new CartErrorEvent({error: 'Network error while updating the bag', code: 'SERVICE_UNAVAILABLE'}));
      this.#lineError(line, 'Could not update your bag. Please check your connection and try again.');
    } finally {
      this.#busy(false);
    }
  }

  #lineError(line, message) {
    const row = this.querySelector(`[data-line="${line}"]`);
    const el = row?.querySelector('[data-pk-line-error]');
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  }

  // ---------- discount codes ----------

  #appliedCodes() {
    return [...this.querySelectorAll('[data-pk-discount-code]')].map((el) => el.dataset.pkDiscountCode);
  }

  #onSubmit = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-pk-discount-form]')) return;
    event.preventDefault();
    const input = this.querySelector('[data-pk-discount-input]');
    const code = input?.value.trim();
    if (!code) return;
    const existing = this.#appliedCodes();
    if (existing.includes(code)) return;
    this.#applyDiscounts([...existing, code], {added: code});
  };

  async #applyDiscounts(codes, {added, removed} = {}) {
    const deferred = CartDiscountUpdateEvent.createPromise();
    this.dispatchEvent(new CartDiscountUpdateEvent({discountCodes: codes.map((code) => ({code})), promise: deferred.promise}));
    this.#busy(true);
    try {
      const data = await post(routes().update, {discount: codes.join(','), sections: this.sectionId, sections_url: window.location.pathname});
      deferred.resolve({cart: CartDiscountUpdateEvent.createCartFromAjaxResponse(data)});
      const rejected = added && data.discount_codes?.find((d) => d.code.toLowerCase() === added.toLowerCase() && d.applicable === false);
      if (rejected) {
        // Leave the cart as Shopify returned it; just explain.
        this.#discountError(`“${added}” can’t be applied to your bag.`);
        return;
      }
      this.#render(data.sections?.[this.sectionId]);
      this.#announce(added ? `Discount code ${added} applied.` : `Discount code ${removed} removed.`);
    } catch (error) {
      deferred.reject(error);
      this.#discountError('Could not update the discount. Please try again.');
    } finally {
      this.#busy(false);
    }
  }

  #discountError(message) {
    const el = this.querySelector('[data-pk-discount-error]');
    if (el) {
      el.textContent = message;
      el.hidden = false;
    }
  }

  // ---------- rendering ----------

  #render(html) {
    if (!html) return window.location.reload();
    const incoming = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-pk-cart-body]');
    if (!incoming) return window.location.reload();
    const focusedId = document.activeElement?.id;
    const focusedStep = document.activeElement?.closest?.('[data-pk-line-step]');
    const stepRef = focusedStep ? [this.#lineOf(focusedStep)?.dataset.key, focusedStep.dataset.pkLineStep] : null;

    this.body.replaceWith(incoming);

    // Put keyboard focus back where it was (same control on the same line), or on the heading.
    let target = focusedId ? document.getElementById(focusedId) : null;
    if (stepRef) {
      const row = this.querySelector(`[data-key="${CSS.escape(stepRef[0] || '')}"]`);
      target = row?.querySelector(`[data-pk-line-step="${stepRef[1]}"]`) || target;
    }
    if (target && !target.disabled) {
      target.focus({preventScroll: true});
    } else if (!this.querySelector('[data-line]')) {
      const heading = this.querySelector('.pk-cart__title');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
  }

  #busy(on) {
    this.body?.toggleAttribute('aria-busy', on);
  }

  #announce(message) {
    if (!this.status) return;
    this.status.textContent = '';
    requestAnimationFrame(() => (this.status.textContent = message));
  }
}

if (!customElements.get('pk-cart')) customElements.define('pk-cart', PkCart);
