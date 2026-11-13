// Library form wiring + notice clearing. Loads after parts 1-7, so it can use their globals.
(() => {
  // Clear the shared notice when the person switches tabs (stops messages bleeding across tabs).
  const originalRender = render;
  let lastView = state.view;
  render = function () {
    if (state.view !== lastView) { state.notice = ''; lastView = state.view; }
    originalRender();
  };

  // Library forms (ids come from the library() renderer I gave you).
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'book-form') { e.preventDefault(); saveBook(f); }
    else if (f.id === 'movement-form') { e.preventDefault(); saveMovement(f); }
  });
})();