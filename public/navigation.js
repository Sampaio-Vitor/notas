// Framework7 owns the page stack and the interactive edge-swipe animation.
// The root page holds the four tabs; secondary pages (dias anteriores,
// repetições) are pushed on top and can be closed with the edge swipe.
// Installed PWAs use the internal stack; browser tabs also integrate browser Back.
export function createNavigation({onRoot, onPage, onChange}) {
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
  // On a computer the edge swipe would follow mouse drags; there the page has a back link.
  const wide = matchMedia('(min-width: 960px)');
  const app = new Framework7({
    el: '#app', name: 'Notas', theme: 'ios', darkMode: true,
    touch: {tapHold: false},
    routes: [
      {path: '/', content: document.querySelector('.page[data-name="root"]').outerHTML, on: {pageInit() { onRoot(); }}},
      {path: '/page/:name/', content: document.querySelector('#sub-template').innerHTML, on: {pageInit(event, page) { onPage(page.route.params.name, page.el); }}},
    ],
  });
  const main = app.views.create('.view-main', {
    url: '/', iosSwipeBack: !wide.matches, iosSwipeBackActiveArea: 30,
    preloadPreviousPage: true, restoreScrollTopOnBack: true,
    browserHistory: !standalone, browserHistoryOnLoad: false,
    browserHistoryStoreHistory: false,
    on: {
      // F7 9.2 swipe-back updates currentPage but leaves currentPageEl stale.
      // Keep its router pointer aligned before another navigation.
      swipebackBeforeChange({previousPageEl}) { app.views.main.router.currentPageEl = previousPageEl; },
      pageAfterIn(page) {
        document.body.dataset.screen = page.name;
        if (page.name === 'root') onRoot();
        onChange?.(page);
      },
    },
  });
  // Dialogs capture gestures themselves and must not slide the page underneath.
  const dialog = document.querySelector('#sheet');
  const swipe = () => { main.params.iosSwipeBack = !dialog.open && !wide.matches; };
  new MutationObserver(swipe).observe(dialog, {attributes: true, attributeFilter: ['open']});
  wide.addEventListener('change', swipe);
  document.body.dataset.screen = 'root';
  return {
    push(name) { main.router.navigate(`/page/${name}/`); },
    back(options) { if (main.router.history.length > 1) main.router.back(options); },
    get current() { return main.el.querySelector('.page-current')?.dataset.name || 'root'; },
  };
}
