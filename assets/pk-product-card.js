// Prabha Kala product card behaviour.
// - <pk-add-to-bag>: adds one unit through Shopify's AJAX cart and tells Horizon's cart
//   (drawer contents + bag count) via the standard CartLinesUpdateEvent, then opens the drawer.
//   The same flow is exported as pkAddToBag() for the product page.
// - Wishlist hearts: same localStorage list as the production storefront ("pk_wishlist").
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

const WISHLIST_KEY = 'pk_wishlist';

// Horizon declares `Theme` as a top-level const (not on window), like its own modules use it.
function cartRoutes() {
  // eslint-disable-next-line no-undef
  const routes = typeof Theme !== 'undefined' && Theme.routes ? Theme.routes : {};
  return { add: routes.cart_add_url || '/cart/add.js', cart: routes.cart_url || '/cart' };
}

function readWishlist() {
  try {
    return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeWishlist(handles) {
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(handles));
  } catch {
    /* storage unavailable — the heart still toggles for this page view */
  }
  window.dispatchEvent(new Event('pk-wishlist'));
}

function paintHeart(button, saved) {
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Save to wishlist');
  button.classList.toggle('is-saved', saved);
}

function syncHearts(root = document) {
  const saved = new Set(readWishlist());
  root.querySelectorAll('[data-pk-wishlist]').forEach((button) => paintHeart(button, saved.has(button.dataset.pkWishlist)));
}

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-pk-wishlist]') : null;
  if (!button) return;
  const handle = button.dataset.pkWishlist;
  const list = readWishlist();
  const next = list.includes(handle) ? list.filter((h) => h !== handle) : [...list, handle];
  writeWishlist(next);
  syncHearts();
});
window.addEventListener('pk-wishlist', () => syncHearts());
window.addEventListener('pageshow', () => syncHearts());
syncHearts();

// Adds a variant through Shopify's AJAX cart and updates Horizon's cart drawer and bag count
// via the standard CartLinesUpdateEvent. Shared by the product card and the product page.
// Resolves to {ok, message}; message is Shopify's reason when the add is refused (e.g. stock).
export async function pkAddToBag({source, variantId, productId, quantity = 1, sourceName = 'pk-product-card'}) {
  const sectionIds = [...document.querySelectorAll('cart-items-component')]
    .map((el) => el.dataset.sectionId)
    .filter(Boolean);

  const deferred = CartLinesUpdateEvent.createPromise();
  source.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{merchandiseId: variantId, quantity}],
      promise: deferred.promise,
    })
  );

  try {
    const routes = cartRoutes();
    const response = await fetch(routes.add, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: JSON.stringify({items: [{id: Number(variantId), quantity}], sections: sectionIds.join(',')}),
    });
    const data = await response.json();
    const cart = await fetch(`${routes.cart}.js`, {headers: {Accept: 'application/json'}}).then((r) => r.json());
    const didError = Boolean(data.status);
    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        items: cart.items,
        source: sourceName,
        sourceId: variantId,
        itemCount: quantity,
        productId,
        sections: didError ? undefined : data.sections,
        didError,
      },
    });
    if (didError) {
      source.dispatchEvent(new CartErrorEvent({error: data.message || 'Add to cart failed', code: 'INVALID'}));
      return {ok: false, message: data.description || data.message};
    }
    document.getElementById('cart-drawer')?.open?.();
    return {ok: true};
  } catch (error) {
    deferred.reject(error);
    source.dispatchEvent(new CartErrorEvent({error: 'Network error during add to cart', code: 'SERVICE_UNAVAILABLE'}));
    return {ok: false};
  }
}

class PkAddToBag extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('button');
    this.button?.addEventListener('click', this.#add);
  }

  disconnectedCallback() {
    this.button?.removeEventListener('click', this.#add);
  }

  #add = async () => {
    const button = this.button;
    if (!button || button.disabled || button.getAttribute('aria-busy') === 'true') return;
    button.setAttribute('aria-busy', 'true');
    try {
      await pkAddToBag({source: this, variantId: this.dataset.variantId, productId: this.dataset.productId});
    } finally {
      button.removeAttribute('aria-busy');
    }
  };
}

if (!customElements.get('pk-add-to-bag')) customElements.define('pk-add-to-bag', PkAddToBag);
