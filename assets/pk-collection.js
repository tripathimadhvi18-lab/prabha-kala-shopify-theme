// Prabha Kala collection page behaviour (sections/pk-main-collection.liquid).
// The filter form is a normal GET form using Shopify's filter.* / sort_by parameters, so the
// page works without this script. This script:
//   - refreshes filters, counts and results in place via the Section Rendering API
//     (same URL + section_id), keeping the address bar and back/forward in sync;
//   - opens the filters as a side panel below 1024px.

const DESKTOP = window.matchMedia('(min-width: 1024px)');

class PkCollection extends HTMLElement {
  connectedCallback() {
    this.sectionId = this.dataset.sectionId;
    this.panel = this.querySelector('[data-pk-filters]');
    this.backdrop = this.querySelector('.pk-filters__backdrop');
    this.form = this.querySelector('[data-pk-facets-form]');
    this.controller = null;

    this.addEventListener('change', this.#onChange);
    this.addEventListener('submit', this.#onSubmit);
    this.addEventListener('click', this.#onClick);
    this.addEventListener('keydown', this.#onKeyDown);
    this.onPopState = () => this.#refresh(window.location.href, {push: false});
    window.addEventListener('popstate', this.onPopState);
    this.onBreakpoint = () => DESKTOP.matches && this.#closePanel({restoreFocus: false});
    DESKTOP.addEventListener('change', this.onBreakpoint);
  }

  disconnectedCallback() {
    window.removeEventListener('popstate', this.onPopState);
    DESKTOP.removeEventListener('change', this.onBreakpoint);
    document.documentElement.classList.remove('pk-scroll-lock');
  }

  // ---------- filtering ----------

  #formUrl() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(this.form)) {
      if (String(value).trim() !== '') params.append(key, value);
    }
    const url = new URL(this.form.action, window.location.origin);
    url.search = params.toString();
    return url.toString();
  }

  #onChange = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target.form !== this.form) return;
    if (target.type === 'number' && !target.checkValidity()) {
      target.reportValidity();
      return;
    }
    this.#refresh(this.#formUrl());
  };

  #onSubmit = (event) => {
    if (event.target !== this.form) return;
    event.preventDefault();
    this.#refresh(this.#formUrl());
  };

  async #refresh(href, {push = true} = {}) {
    const url = new URL(href, window.location.origin);
    const fetchUrl = new URL(url);
    fetchUrl.searchParams.set('section_id', this.sectionId);

    this.controller?.abort();
    this.controller = new AbortController();
    this.setAttribute('aria-busy', 'true');

    const focusedId = document.activeElement?.id;
    const openGroups = new Map(
      [...this.querySelectorAll('[data-pk-filter]')].map((el) => [el.dataset.pkFilter, el.open])
    );

    try {
      const response = await fetch(fetchUrl, {signal: this.controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
      const next = doc.querySelector('pk-collection');
      if (!next) throw new Error('Section markup missing');

      for (const selector of ['[data-pk-filter-groups]', '[data-pk-results]', '.pk-filters__foot']) {
        const current = this.querySelector(selector);
        const incoming = next.querySelector(selector);
        if (current && incoming) current.replaceWith(incoming);
      }

      // Keep each filter group open or closed as the shopper left it.
      this.querySelectorAll('[data-pk-filter]').forEach((el) => {
        if (openGroups.has(el.dataset.pkFilter)) el.open = openGroups.get(el.dataset.pkFilter);
      });
      if (this.panel?.classList.contains('is-open')) {
        this.querySelector('[data-pk-filters-open]')?.setAttribute('aria-expanded', 'true');
      }
      if (focusedId) document.getElementById(focusedId)?.focus({preventScroll: true});

      if (push) window.history.pushState({}, '', url.pathname + url.search);
      window.dispatchEvent(new Event('pk-wishlist')); // repaint saved hearts on the new cards
    } catch (error) {
      if (error.name === 'AbortError') return;
      window.location.assign(url.toString()); // fall back to a normal page load
    } finally {
      this.removeAttribute('aria-busy');
    }
  }

  // ---------- links, panel ----------

  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const link = target.closest('a[data-pk-link]');
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
      event.preventDefault();
      const isPage = link.closest('.pk-pagination');
      this.#refresh(link.href).then(() => {
        if (isPage) this.querySelector('[data-pk-results]')?.scrollIntoView({block: 'start'});
      });
      return;
    }

    if (target.closest('[data-pk-filters-open]')) {
      this.#openPanel();
    } else if (target.closest('[data-pk-filters-close]')) {
      this.#closePanel();
    }
  };

  #openPanel() {
    if (!this.panel || DESKTOP.matches) return;
    this.panel.classList.add('is-open');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    if (this.backdrop) this.backdrop.hidden = false;
    this.querySelector('[data-pk-filters-open]')?.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('pk-scroll-lock');
    this.panel.focus({preventScroll: true});
  }

  #closePanel({restoreFocus = true} = {}) {
    if (!this.panel?.classList.contains('is-open')) return;
    this.panel.classList.remove('is-open');
    this.panel.removeAttribute('role');
    this.panel.removeAttribute('aria-modal');
    if (this.backdrop) this.backdrop.hidden = true;
    const toggle = this.querySelector('[data-pk-filters-open]');
    toggle?.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('pk-scroll-lock');
    if (restoreFocus) toggle?.focus({preventScroll: true});
  }

  #onKeyDown = (event) => {
    if (!this.panel?.classList.contains('is-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.#closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep keyboard focus inside the open panel.
    const focusable = [...this.panel.querySelectorAll('a[href], button, input:not([disabled]), select, summary')].filter(
      (el) => el.offsetParent !== null
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

if (!customElements.get('pk-collection')) customElements.define('pk-collection', PkCollection);
