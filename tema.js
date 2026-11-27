// Aplica o tema antes de desenhar a página: escolha salva ou, sem escolha, o tema do sistema.
(function () {
  var t = null;
  try { t = localStorage.getItem('painel-tema'); } catch (e) {}
  if (t !== 'claro' && t !== 'escuro') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  document.documentElement.setAttribute('data-tema', t);
})();
