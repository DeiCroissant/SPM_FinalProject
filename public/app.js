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
for (const button of document.querySelectorAll('[data-confirm-hide]')) {
  button.closest('form').addEventListener('submit', event => {
    if (!window.confirm('Hide this book from the public catalogue? The record will be kept.')) event.preventDefault();
  });
}
// Trimmed required fields complement native constraints and server validation.
for (const form of document.querySelectorAll('[data-catalogue-form]')) {
  for (const input of form.querySelectorAll('[data-trim-required]')) input.addEventListener('input', () => input.setCustomValidity(input.value.trim() ? '' : 'This field is required.'));
  form.addEventListener('submit', event => {
    for (const input of form.querySelectorAll('[data-trim-required]')) input.setCustomValidity(input.value.trim() ? '' : 'This field is required.');
    if (!form.reportValidity()) event.preventDefault();
  });
}
// Local fallback keeps the catalogue usable when a remote cover URL fails.
for (const image of document.querySelectorAll('[data-cover-fallback]')) {
  const fallback = () => { if (!image.dataset.fallbackApplied) { image.dataset.fallbackApplied='1'; image.src='/book-cover-placeholder.svg'; } };
  image.addEventListener('error', fallback);
  if (image.complete && image.naturalWidth === 0) fallback();
}
