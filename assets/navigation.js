/* Native details and anchors remain functional without this enhancement. */
(() => {
  const init = () => {
    const panel = document.getElementById('topic-panel');
    const toggle = panel?.querySelector('summary');
    if (!toggle) return;
    const wide = matchMedia('(min-width: 80rem)');
    let desktopOpen = panel.open;
    const syncLabel = () => {
      const label = panel.open ? toggle.dataset.closeLabel : toggle.dataset.openLabel;
      if (label) {
        toggle.setAttribute('aria-label', label);
        toggle.title = label;
      }
    };
    const syncLayout = () => {
      const hadFocus = panel.contains(document.activeElement);
      panel.open = wide.matches && desktopOpen;
      if (!panel.open && hadFocus) toggle.focus();
      syncLabel();
      schedule();
    };
    panel.addEventListener('toggle', syncLabel);
    toggle.addEventListener('click', () => {
      if (wide.matches) desktopOpen = !panel.open;
    });
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !panel.open) return;
      event.preventDefault();
      panel.open = false;
      if (wide.matches) desktopOpen = false;
      syncLabel();
      toggle.focus();
    });
    const links = [...panel.querySelectorAll('a[href^="#"]')];
    const targets = links.map(link => {
      try { return document.getElementById(decodeURIComponent(link.hash.slice(1))); }
      catch { return null; }
    });
    links.forEach((link, index) => {
      link.addEventListener('click', event => {
        const target = targets[index];
        if (!target || event.defaultPrevented || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (!wide.matches) {
          panel.open = false;
          syncLabel();
        }
        // Keep native hash/history/scroll behavior, but move keyboard reading focus.
        const temporary = !target.hasAttribute('tabindex');
        if (temporary) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        if (temporary) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
        schedule();
      });
    });
    let scheduled = false;
    const updateCurrent = () => {
      scheduled = false;
      const threshold = wide.matches ? 32 : toggle.getBoundingClientRect().bottom + 24;
      let current = -1;
      targets.forEach((target, index) => {
        if (!target) return;
        const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        if (target.getBoundingClientRect().top <= Math.max(threshold, margin + 2)) current = index;
      });
      const root = document.scrollingElement;
      // A short final section may never reach the top-of-viewport threshold.
      if (root && root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        current = targets.findLastIndex(target => target !== null);
      }
      links.forEach((link, index) => {
        if (index === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };
    function schedule() {
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(updateCurrent);
      }
    }
    wide.addEventListener('change', syncLayout);
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    addEventListener('hashchange', schedule);
    addEventListener('pageshow', schedule);
    // Images, disclosure content and late fonts can change section positions.
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(document.body);
    syncLayout();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
