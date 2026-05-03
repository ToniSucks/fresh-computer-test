/* ═══════════════════════════════════════════════════
   Fresh Computer Test — Auth Page Logic
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // If already logged in, skip straight to the main page
  fetch('/api/me').then(r => {
    if (r.ok) window.location.href = '/';
  });

  // ── Tab switching ─────────────────────────────────
  const tabLogin    = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const loginForm   = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  tabLogin.addEventListener('click', () => switchTab('login'));
  tabRegister.addEventListener('click', () => switchTab('register'));

  function switchTab(tab) {
    clearErrors();
    if (tab === 'login') {
      tabLogin.classList.add('auth-tab--active');
      tabRegister.classList.remove('auth-tab--active');
      loginForm.hidden = false;
      registerForm.hidden = true;
    } else {
      tabRegister.classList.add('auth-tab--active');
      tabLogin.classList.remove('auth-tab--active');
      registerForm.hidden = false;
      loginForm.hidden = true;
    }
  }

  // ── Login ─────────────────────────────────────────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
      showError('field-login-user', 'Please fill in all fields.');
      return;
    }

    const btn = document.getElementById('login-btn');
    setLoading(btn, true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError('field-login-pass', data.error || 'Login failed.');
        return;
      }

      // Success — go to main page
      window.location.href = '/';
    } catch (err) {
      showError('field-login-user', 'Connection error. Is the server running?');
    } finally {
      setLoading(btn, false);
    }
  });

  // ── Register ──────────────────────────────────────
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();

    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm  = document.getElementById('reg-confirm').value;

    if (!username || !password || !confirm) {
      showError('field-reg-user', 'Please fill in all fields.');
      return;
    }

    if (password !== confirm) {
      showError('field-reg-confirm', 'Passwords do not match.');
      return;
    }

    const btn = document.getElementById('register-btn');
    setLoading(btn, true);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        showError('field-reg-user', data.error || 'Registration failed.');
        return;
      }

      // Success — go to main page (auto-logged-in)
      window.location.href = '/';
    } catch (err) {
      showError('field-reg-user', 'Connection error. Is the server running?');
    } finally {
      setLoading(btn, false);
    }
  });

  // ── Helpers ───────────────────────────────────────
  function showError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const err = document.createElement('p');
    err.className = 'field__error';
    err.textContent = message;
    field.appendChild(err);
  }

  function clearErrors() {
    document.querySelectorAll('.field__error').forEach(el => el.remove());
  }

  function setLoading(btn, loading) {
    btn.querySelector('.btn__text').hidden = loading;
    btn.querySelector('.btn__loader').hidden = !loading;
    btn.disabled = loading;
  }
})();
