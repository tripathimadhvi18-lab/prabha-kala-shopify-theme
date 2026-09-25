// Prabha Kala hero carousel — vanilla port of the production P2h-A HeroCarousel.
// Only the current slide is in the live DOM; other slides are <template data-pk-slide>.
// Autoplay is driven by the progress bar's own animation, so indicator and timer
// cannot drift apart. Pauses on hover, keyboard focus, touch, hidden tab and the
// pause button; prefers-reduced-motion starts paused with no zoom.

const AUTOPLAY_MS = 6500;
const SWIPE_MIN_PX = 48;

class PkHero extends HTMLElement {
  connectedCallback() {
    this.templates = [...this.querySelectorAll('template[data-pk-slide]')];
    this.count = this.templates.length;
    if (this.count < 2) return;

    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.index = 0;
    this.userPaused = this.reduceMotion;
    this.hovered = false;
    this.focused = false;
    this.touching = false;
    this.tabHidden = document.hidden;
    this.exiting = null;

    this.media = this.querySelector('[data-pk-hero-media]');
    this.text = this.querySelector('[data-pk-hero-text]');
    this.counter = this.querySelector('[data-pk-hero-counter]');
    this.bar = this.querySelector('[data-pk-hero-bar]');
    this.live = this.querySelector('[data-pk-hero-live]');
    this.pauseButton = this.querySelector('[data-pk-hero-pause]');
    this.section = this.querySelector('section');

    this.querySelector('[data-pk-hero-prev]')?.addEventListener('click', () => this.go(-1));
    this.querySelector('[data-pk-hero-next]')?.addEventListener('click', () => this.go(1));
    this.pauseButton?.addEventListener('click', () => {
      this.userPaused = !this.userPaused;
      this.#paintPauseButton();
      this.#applyHold();
    });

    this.addEventListener('keydown', this.#onKeyDown);
    this.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.#setHold('hovered', true));
    this.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.#setHold('hovered', false));
    this.addEventListener('focusin', (e) => this.#setHold('focused', e.target instanceof Element && e.target.matches(':focus-visible')));
    this.addEventListener('focusout', (e) => !this.contains(e.relatedTarget) && this.#setHold('focused', false));
    this.addEventListener('touchstart', this.#onTouchStart, { passive: true });
    this.addEventListener('touchend', this.#onTouchEnd, { passive: true });
    this.addEventListener('touchcancel', () => this.#setHold('touching', false), { passive: true });
    this.onVisibility = () => this.#setHold('tabHidden', document.hidden);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.#paintPauseButton();
    this.#startProgress();
    this.#applyHold();
  }

  disconnectedCallback() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.animation?.cancel();
  }

  get held() {
    return this.userPaused || this.hovered || this.focused || this.touching || this.tabHidden;
  }

  go(delta) {
    const slide = this.text.querySelector('[data-pk-hero-slide]');
    const refocus = Boolean(slide && slide.contains(document.activeElement));
    this.index = (this.index + delta + this.count) % this.count;
    this.#show(this.index, refocus);
  }

  #show(index, refocus) {
    const fragment = this.templates[index].content;
    const pad = (n) => String(n).padStart(2, '0');

    // Text: swap immediately, fade and rise in.
    const nextSlide = fragment.querySelector('[data-pk-hero-slide]').cloneNode(true);
    this.text.replaceChildren(nextSlide);
    nextSlide.animate(
      this.reduceMotion
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: this.reduceMotion ? 200 : 600, delay: this.reduceMotion ? 0 : 100, easing: 'ease-out', fill: 'backwards' }
    );

    // Image: fade the current picture out, then bring the latest target in.
    this.targetIndex = index;
    if (!this.exiting) {
      const current = this.media.querySelector('[data-pk-hero-picture]');
      const duration = this.reduceMotion ? 200 : 800;
      if (current) {
        this.exiting = current.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in-out', fill: 'forwards' });
        this.exiting.finished.then(() => this.#enterPicture(), () => this.#enterPicture());
      } else {
        this.#enterPicture();
      }
    }

    if (this.counter) this.counter.textContent = `${pad(index + 1)} / ${pad(this.count)}`;
    if (this.live) this.live.textContent = `Slide ${index + 1} of ${this.count}: ${this.templates[index].dataset.title || ''}`;
    this.#startProgress();

    if (refocus) {
      (this.text.querySelector('[data-testid="hero-cta-link"]') || this.querySelector('[data-pk-hero-next]'))?.focus();
    }
  }

  #enterPicture() {
    this.exiting = null;
    const picture = this.templates[this.targetIndex].content.querySelector('[data-pk-hero-picture]').cloneNode(true);
    const img = picture.querySelector('img');
    if (img) img.loading = 'eager';
    this.media.replaceChildren(picture);
    picture.animate(
      this.reduceMotion ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: 'scale(1.06)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: this.reduceMotion ? 200 : 800, easing: 'ease-in-out' }
    );
  }

  #startProgress() {
    this.animation?.cancel();
    if (!this.bar?.animate) return;
    this.animation = this.bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: AUTOPLAY_MS,
      easing: 'linear',
      fill: 'forwards',
    });
    this.animation.onfinish = () => this.go(1);
    if (this.held) this.animation.pause();
  }

  #setHold(key, value) {
    if (this[key] === value) return;
    this[key] = value;
    this.#applyHold();
  }

  #applyHold() {
    if (this.animation) {
      if (this.held) this.animation.pause();
      else this.animation.play();
    }
    // Announce slide changes only while the carousel is not rotating on its own.
    this.live?.setAttribute('aria-live', this.held ? 'polite' : 'off');
  }

  #paintPauseButton() {
    if (!this.pauseButton) return;
    this.pauseButton.setAttribute('aria-label', this.userPaused ? 'Play slideshow' : 'Pause slideshow');
    this.pauseButton.querySelector('.pk-hero__icon-pause')?.toggleAttribute('hidden', this.userPaused);
    this.pauseButton.querySelector('.pk-hero__icon-play')?.toggleAttribute('hidden', !this.userPaused);
  }

  #onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.go(1);
    }
  };

  #onTouchStart = (event) => {
    const t = event.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY };
    this.#setHold('touching', true);
  };

  #onTouchEnd = (event) => {
    this.#setHold('touching', false);
    const start = this.touchStart;
    this.touchStart = null;
    const t = event.changedTouches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(dx < 0 ? 1 : -1);
  };
}

if (!customElements.get('pk-hero')) customElements.define('pk-hero', PkHero);
