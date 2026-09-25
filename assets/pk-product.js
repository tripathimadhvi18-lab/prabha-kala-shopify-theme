// Prabha Kala product page behaviour (sections/pk-main-product.liquid).
// The buy form is Shopify's native product form, so it works without this script.
// This script adds: variant switching (price, stock, button, URL, image), quantity steppers,
// Add to bag through the same cart flow as the product card (opens Horizon's cart drawer),
// the swipe gallery with thumbnails, the larger-image viewer and the sticky mobile bar.
// <pk-recommendations> lazily loads Shopify's native product recommendations (replacing the
// catalogue fallback rendered with the page when Shopify returns any).

const inr = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0, minimumFractionDigits: 0});
const formatMoney = (paise) => inr.format(Math.round(paise / 100));

class PkProduct extends HTMLElement {
  connectedCallback() {
    this.variants = JSON.parse(this.querySelector('[data-pk-variants]')?.textContent || '[]');
    this.form = this.querySelector('[data-pk-form]');
    this.variantInput = this.querySelector('[data-pk-variant-id]');
    this.qtyInput = this.querySelector('.pk-qty__input');
    this.addButton = this.querySelector('[data-pk-add]');
    this.stickyBar = this.querySelector('[data-pk-sticky]');
    this.track = this.querySelector('[data-pk-gallery-track]');
    this.slides = [...this.querySelectorAll('.pk-gallery__slide')];
    this.thumbs = [...this.querySelectorAll('[data-pk-gallery-thumb]')];
    this.lightbox = this.querySelector('[data-pk-lightbox]');
    this.current = this.variants.find((v) => String(v.id) === this.variantInput?.value) || this.variants[0];

    this.addEventListener('change', this.#onChange);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('input', this.#onInput);
    this.form?.addEventListener('submit', this.#onSubmit);
    this.track?.addEventListener('keydown', this.#onTrackKey);

    this.#watchGallery();
    this.#watchSticky();
    this.#markUnavailable();
    this.#syncQty();
  }

  disconnectedCallback() {
    this.galleryObserver?.disconnect();
    this.stickyObserver?.disconnect();
  }

  // ---------- variants ----------

  #selectedOptions() {
    return [...this.querySelectorAll('[data-pk-option]')].map((fieldset) => fieldset.querySelector('input:checked')?.value);
  }

  #onChange = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.closest('[data-pk-option]')) return;
    input.closest('[data-pk-option]').querySelector('[data-pk-option-selected]').textContent = input.value;
    const options = this.#selectedOptions();
    const variant = this.variants.find((v) => v.options.every((value, i) => value === options[i]));
    this.#applyVariant(variant);
    this.#markUnavailable();
  };

  #applyVariant(variant) {
    const set = (selector, fn) => this.querySelectorAll(selector).forEach(fn);
    this.current = variant || null;
    this.#hideError();

    if (!variant) {
      set('[data-pk-add-label]', (el) => (el.textContent = 'Unavailable'));
      this.addButton && (this.addButton.disabled = true);
      set('[data-pk-sticky-add]', (el) => {
        el.disabled = true;
        el.textContent = 'Unavailable';
      });
      set('[data-pk-stock]', (el) => (el.textContent = 'This combination is not available'));
      this.#syncQty();
      return;
    }

    if (this.variantInput) this.variantInput.value = variant.id;
    const onSale = variant.compare > variant.price;
    set('[data-pk-price]', (el) => (el.textContent = formatMoney(variant.price)));
    set('[data-pk-sticky-price]', (el) => (el.textContent = formatMoney(variant.price)));
    set('[data-pk-compare]', (el) => (el.hidden = !onSale));
    set('[data-pk-compare-value]', (el) => (el.textContent = onSale ? formatMoney(variant.compare) : ''));
    set('[data-pk-save]', (el) => {
      el.hidden = !onSale;
      el.textContent = onSale ? `Save ${formatMoney(variant.compare - variant.price)}` : '';
    });

    let stockText = '';
    if (!variant.available) stockText = 'Sold out';
    else if (variant.stock !== null && variant.stock > 0 && variant.stock <= 3) stockText = `Only ${variant.stock} left`;
    set('[data-pk-stock]', (el) => (el.textContent = stockText));

    const label = variant.available ? 'Add to bag' : 'Sold out';
    set('[data-pk-add-label]', (el) => (el.textContent = label));
    if (this.addButton) this.addButton.disabled = !variant.available;
    set('[data-pk-sticky-add]', (el) => {
      el.disabled = !variant.available;
      el.textContent = label;
    });
    set('[data-pk-buy-now]', (el) => (el.hidden = !variant.available));

    const url = new URL(window.location.href);
    url.searchParams.set('variant', variant.id);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);

    if (variant.media) {
      const index = this.slides.findIndex((slide) => slide.dataset.mediaId === String(variant.media));
      if (index >= 0) this.#goTo(index);
    }
    this.#syncQty();
  }

  // Strike through option values that have no available variant with the other current choices.
  #markUnavailable() {
    const selected = this.#selectedOptions();
    this.querySelectorAll('[data-pk-option]').forEach((fieldset, position) => {
      fieldset.querySelectorAll('.pk-option__value').forEach((label) => {
        const value = label.querySelector('input').value;
        const available = this.variants.some(
          (v) => v.available && v.options[position] === value && v.options.every((o, i) => i === position || o === selected[i])
        );
        label.classList.toggle('is-unavailable', !available);
      });
    });
  }

  // ---------- quantity ----------

  #maxQty() {
    const stock = this.current?.stock;
    return stock !== null && stock !== undefined && stock > 0 ? stock : Infinity;
  }

  #syncQty() {
    if (!this.qtyInput) return;
    const available = Boolean(this.current?.available);
    const max = this.#maxQty();
    this.qtyInput.disabled = !available;
    if (Number.isFinite(max)) this.qtyInput.max = String(max);
    else this.qtyInput.removeAttribute('max');
    let value = Math.floor(Number(this.qtyInput.value)) || 1;
    value = Math.min(Math.max(value, 1), Number.isFinite(max) ? max : value);
    this.qtyInput.value = String(value);
    const [minus, plus] = this.querySelectorAll('[data-pk-qty-step]');
    if (minus) minus.disabled = !available || value <= 1;
    if (plus) plus.disabled = !available || value >= max;
  }

  #onInput = (event) => {
    if (event.target === this.qtyInput) this.#hideError();
  };

  // ---------- add to bag ----------

  #onSubmit = async (event) => {
    event.preventDefault();
    const buttons = [this.addButton, ...this.querySelectorAll('[data-pk-sticky-add]')].filter(Boolean);
    if (!this.current?.available || buttons.some((b) => b.getAttribute('aria-busy') === 'true')) return;
    this.#syncQty();
    buttons.forEach((b) => b.setAttribute('aria-busy', 'true'));
    try {
      const {pkAddToBag} = await import(this.dataset.cartModule);
      const result = await pkAddToBag({
        source: this,
        variantId: String(this.current.id),
        productId: this.dataset.productId,
        quantity: Number(this.qtyInput?.value || 1),
        sourceName: 'pk-product',
      });
      if (!result.ok) this.#showError(result.message || 'Sorry, this could not be added to your bag. Please try again.');
    } catch {
      this.form.submit(); // fall back to Shopify's normal form post
    } finally {
      buttons.forEach((b) => b.removeAttribute('aria-busy'));
    }
  };

  #showError(message) {
    const el = this.querySelector('[data-pk-error]');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  #hideError() {
    const el = this.querySelector('[data-pk-error]');
    if (el) el.hidden = true;
  }

  // ---------- clicks ----------

  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const step = target.closest('[data-pk-qty-step]');
    if (step && this.qtyInput) {
      this.qtyInput.value = String((Number(this.qtyInput.value) || 1) + Number(step.dataset.pkQtyStep));
      this.#syncQty();
      this.#hideError();
      return;
    }

    const thumb = target.closest('[data-pk-gallery-thumb]');
    if (thumb) return this.#goTo(Number(thumb.dataset.pkGalleryThumb));

    const arrow = target.closest('[data-pk-gallery-step]');
    if (arrow) return this.#goTo(this.activeIndex + Number(arrow.dataset.pkGalleryStep));

    const zoom = target.closest('[data-pk-zoom]');
    if (zoom && this.lightbox) return this.#openLightbox(Number(zoom.dataset.pkZoom));

    if (target.closest('[data-pk-lightbox-close]')) return this.lightbox?.close();
    if (target === this.lightbox) this.lightbox.close(); // click on the backdrop
  };

  // ---------- gallery ----------

  get activeIndex() {
    return this._active || 0;
  }

  #goTo(index) {
    if (!this.track || !this.slides.length) return;
    const clamped = Math.max(0, Math.min(index, this.slides.length - 1));
    this.track.scrollTo({left: this.slides[clamped].offsetLeft - this.track.offsetLeft, behavior: 'smooth'});
    this.#setActive(clamped);
  }

  #setActive(index) {
    this._active = index;
    this.thumbs.forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === index)));
    const counter = this.querySelector('[data-pk-gallery-current]');
    if (counter) counter.textContent = String(index + 1);
    const [prev, next] = [this.querySelector('[data-pk-gallery-step="-1"]'), this.querySelector('[data-pk-gallery-step="1"]')];
    if (prev) prev.disabled = index === 0;
    if (next) next.disabled = index === this.slides.length - 1;
    this.thumbs[index]?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }

  #watchGallery() {
    if (!this.track || this.slides.length < 2) return;
    this.galleryObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) this.#setActive(Number(entry.target.dataset.index));
        });
      },
      {root: this.track, threshold: [0.6]}
    );
    this.slides.forEach((slide) => this.galleryObserver.observe(slide));
    this.#setActive(0);
  }

  #onTrackKey = (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this.#goTo(this.activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  };

  #openLightbox(index) {
    this.lightbox.showModal();
    const item = this.lightbox.querySelector(`[data-pk-lightbox-item="${index}"]`);
    item?.querySelector('img')?.setAttribute('loading', 'eager');
    requestAnimationFrame(() => item?.scrollIntoView({block: 'start'}));
  }

  // ---------- sticky bar ----------

  #watchSticky() {
    if (!this.stickyBar || !this.addButton) return;
    this.stickyObserver = new IntersectionObserver(
      ([entry]) => {
        // Show once the main button has scrolled up out of view (not before it is reached).
        this.stickyBar.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
      },
      {threshold: 0}
    );
    this.stickyObserver.observe(this.addButton);
  }
}

class PkRecommendations extends HTMLElement {
  connectedCallback() {
    if (!this.dataset.url) return;
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        this.observer.disconnect();
        this.#load();
      },
      {rootMargin: '0px 0px 400px 0px'}
    );
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
  }

  async #load() {
    try {
      const response = await fetch(this.dataset.url);
      if (!response.ok) return;
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const incoming = doc.querySelector('pk-recommendations');
      // Keep the catalogue fallback unless Shopify actually returned recommendations.
      if (incoming?.querySelector('[data-pk-recs-source="shopify"]')) {
        this.innerHTML = incoming.innerHTML;
        window.dispatchEvent(new Event('pk-wishlist')); // paint saved hearts on the new cards
      }
    } catch {
      /* recommendations are optional; leave the section empty */
    }
  }
}

if (!customElements.get('pk-product')) customElements.define('pk-product', PkProduct);
if (!customElements.get('pk-recommendations')) customElements.define('pk-recommendations', PkRecommendations);
