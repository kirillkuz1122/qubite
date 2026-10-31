/* global document, localStorage, matchMedia */
/* тема до первой отрисовки, чтобы светлая не мигала тёмной (настройка из @qubite/ui) */
try {
  var s = JSON.parse(localStorage.getItem('qubite.look.v1') || '{}');
  var t =
    s.theme === 'auto'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : s.theme || 'dark';
  document.documentElement.dataset.theme = t;
  if (s.round != null) document.documentElement.style.setProperty('--q-round', s.round / 100);
} catch {
  /* настройка недоступна — остаётся тёмная тема по умолчанию */
}
