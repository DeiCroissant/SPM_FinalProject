for (const button of document.querySelectorAll('[data-toggle-password]')) {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Hide' : 'Show';
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    button.setAttribute('aria-pressed', String(visible));
  });
}
for (const input of document.querySelectorAll('[data-password-limit]')) {
  input.addEventListener('input', () => input.setCustomValidity(new TextEncoder().encode(input.value).length > 72 ? 'Password must be 72 UTF-8 bytes or fewer.' : ''));
}
// Refresh protected state when a browser restores a page from back/forward cache.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
