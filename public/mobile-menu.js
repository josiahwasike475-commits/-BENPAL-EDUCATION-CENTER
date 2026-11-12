/* Keep the native checkbox operable with a keyboard; never modify page actions. */
document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  const toggle = document.getElementById('mobile-menu');
  if (toggle && toggle.checked && matchMedia('(max-width: 760px)').matches) {
    toggle.checked = false;
    toggle.focus();
  }
});
document.addEventListener('click', function (event) {
  const panel = event.target.closest('.mobile-panel');
  if (!panel || !matchMedia('(max-width: 760px)').matches) return;
  if (event.target.closest('a, [data-view], #signout')) {
    const toggle = document.getElementById('mobile-menu');
    if (toggle) toggle.checked = false;
  }
});
