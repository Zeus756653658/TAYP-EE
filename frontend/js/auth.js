// Global fetch interceptor to guarantee credentials & Authorization Bearer header across all API calls
(function() {
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    options = options || {};
    options.credentials = options.credentials || 'include';

    const token = localStorage.getItem('taypee_auth_token');
    const urlStr = typeof url === 'string' ? url : (url?.url || '');

    if (token && (urlStr.startsWith('/api/') || urlStr.includes('/api/'))) {
      if (!options.headers) {
        options.headers = {};
      }
      if (options.headers instanceof Headers) {
        if (!options.headers.has('Authorization')) {
          options.headers.set('Authorization', `Bearer ${token}`);
        }
      } else if (Array.isArray(options.headers)) {
        const hasAuth = options.headers.some(h => (h[0] || '').toLowerCase() === 'authorization');
        if (!hasAuth) {
          options.headers.push(['Authorization', `Bearer ${token}`]);
        }
      } else if (typeof options.headers === 'object') {
        if (!options.headers['Authorization'] && !options.headers['authorization']) {
          options.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    if (window.AuthGate && typeof AuthGate.recordActivity === 'function') {
      AuthGate.recordActivity();
    }
    return originalFetch(url, options);
  };
})();

// ==================== INPUT MASK FOR OTP (CUSTOM ELEMENT) ====================
// Web component strictly managing 6 visual box slots driven by a single native numeric input
class OTPInput extends HTMLElement {
  #controller;

  connectedCallback() {
    this.#controller = new AbortController();
    this.inputElement = this.querySelector('input');
    if (!this.inputElement) return;

    this.maskElement = document.createElement('div');
    this.maskElement.setAttribute('aria-hidden', 'true');
    this.maskElement.className = 'grid grid-cols-6 gap-2 w-full pointer-events-none select-none';

    this.slotElements = [];
    for (let i = 0; i < this.maxlength; i++) {
      const box = document.createElement('div');
      box.className = 'otp-box h-12 rounded border-2 border-[#DDDBDA] bg-white flex items-center justify-center text-xl font-black font-mono text-[#0176D3] shadow-sm transition-all duration-150 relative';
      this.maskElement.append(box);
      this.slotElements.push(box);
    }
    this.append(this.maskElement);

    this.inputElement.addEventListener('input', () => {
      this.inputElement.value = this.inputElement.value.replace(/\D/g, '').slice(0, this.maxlength);
      this.updateMask();

      if (this.length === this.maxlength) {
        this.dispatchEvent(new CustomEvent('otp-complete', {
          bubbles: true,
          detail: { code: this.inputElement.value }
        }));
      }
    }, { signal: this.#controller.signal });

    this.inputElement.addEventListener('focus', () => this.updateMask(), { signal: this.#controller.signal });
    this.inputElement.addEventListener('blur', () => this.updateMask(), { signal: this.#controller.signal });

    this.inputElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        AuthGate.submitStep3Otp();
      }
    }, { signal: this.#controller.signal });

    this.updateMask();
  }

  disconnectedCallback() {
    this.#controller?.abort();
    this.maskElement?.remove();
  }

  updateMask() {
    const val = this.inputElement?.value || '';
    const isFocused = document.activeElement === this.inputElement;

    this.slotElements.forEach((box, i) => {
      box.innerHTML = '';
      const char = val[i] || '';

      if (char) {
        box.textContent = char;
        box.className = 'otp-box h-12 rounded border-2 border-[#0176D3] bg-[#F8FBFE] flex items-center justify-center text-xl font-black font-mono text-[#0176D3] shadow-sm transition-all duration-150';
      } else {
        if (isFocused && i === val.length) {
          box.className = 'otp-box h-12 rounded border-2 border-[#0176D3] bg-white ring-2 ring-[#0176D3]/20 flex items-center justify-center text-xl font-mono text-[#0176D3] shadow-sm transition-all duration-150';
          const caret = document.createElement('span');
          caret.className = 'inline-block w-0.5 h-6 bg-[#0176D3] animate-caret-blink';
          box.appendChild(caret);
        } else {
          box.className = 'otp-box h-12 rounded border-2 border-[#DDDBDA] bg-white flex items-center justify-center text-xs font-mono text-[#DDDBDA] shadow-sm transition-all duration-150';
          const dot = document.createElement('span');
          dot.className = 'w-1.5 h-1.5 rounded-full bg-[#DDDBDA]';
          box.appendChild(dot);
        }
      }
    });
  }

  get maxlength() {
    return parseInt(this.inputElement?.getAttribute('maxlength') || '6', 10);
  }

  get length() {
    return (this.inputElement?.value || '').length;
  }

  get value() {
    return this.inputElement?.value || '';
  }

  set value(val) {
    if (this.inputElement) {
      this.inputElement.value = String(val || '').replace(/\D/g, '').slice(0, this.maxlength);
      this.updateMask();
    }
  }

  focus() {
    this.inputElement?.focus();
  }

  clear() {
    if (this.inputElement) {
      this.inputElement.value = '';
      this.updateMask();
    }
  }
}

if (!customElements.get('otp-input')) {
  customElements.define('otp-input', OTPInput);
}

// 3-Step TAYP EE Login & Gmail 6-Digit 2FA Controller
// Flow: Step 1 (Verified Gmail Username) -> Step 2 (Password) -> Step 3 (6-Digit Gmail Code) -> Login Complete
const AuthGate = {
  currentUsername: '',
  currentUserInfo: null,
  challengeId: '',
  currentCaptchaId: '',
  resetChallengeId: '',
  isAuthenticated: false,
  appInitialized: false,
  expiryTimer: null,
  resendTimer: null,
  secondsLeft: 0,
  resendCooldown: 0,
  usersList: [],
  editingUserId: null,

  // 15-Minute Inactivity / Idle Session Tracking
  idleTimeoutSeconds: 900, // 15 minutes inactivity before warning
  idleWarningSeconds: 30,  // 30 seconds countdown on popup before auto-logout
  lastActivityTimestamp: Date.now(),
  idleCheckInterval: null,
  idleCountdownInterval: null,
  isIdleWarningShown: false,
  _boundRecordActivity: null,
  _isBootstrapping: false,

  async bootstrap() {
    if (this._isBootstrapping || this.isAuthenticated) return;
    this._isBootstrapping = true;

    this.setupOtpInputs();
    document.addEventListener('otp-complete', (e) => {
      if (this.challengeId && e.detail?.code?.length === 6) {
        this.submitStep3Otp();
      }
    });

    const token = localStorage.getItem('taypee_auth_token');
    if (!token) {
      this._isBootstrapping = false;
      this.showLoginGate();
      return;
    }

    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' });
      const data = await res.json();

      if (data.authenticated && data.user) {
        this.unlockApp(data.user);
      } else {
        localStorage.removeItem('taypee_auth_token');
        document.documentElement.classList.remove('auth-token-present');
        this.showLoginGate();
      }
    } catch (e) {
      console.warn("Auth status check error:", e);
      localStorage.removeItem('taypee_auth_token');
      document.documentElement.classList.remove('auth-token-present');
      this.showLoginGate();
    } finally {
      this._isBootstrapping = false;
    }
  },

  showLoginGate() {
    this.isAuthenticated = false;
    this.challengeId = '';
    this.stopActivityTracking();
    document.documentElement.classList.remove('auth-token-present');

    const gate = document.getElementById('auth-login-gate');
    const shell = document.getElementById('app-shell');
    if (shell) shell.classList.add('hidden');
    if (gate) gate.classList.remove('hidden');

    this.goToStep(1);
    setTimeout(() => document.getElementById('auth-username-input')?.focus(), 80);
    if (window.lucide) window.lucide.createIcons();
  },

  async unlockApp(user) {
    this.isAuthenticated = true;
    this.currentUserInfo = user;
    this.currentUsername = user?.username || '';
    this.clearTimers();
    document.documentElement.classList.add('auth-token-present');

    const gate = document.getElementById('auth-login-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.classList.add('hidden');
    if (shell) {
      shell.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
    }

    // Update header avatar & email badge
    const avatarEl = document.getElementById('header-user-avatar');
    const emailEl = document.getElementById('header-user-email');
    const displayName = user?.name || user?.username || 'Admin';
    if (avatarEl) {
      avatarEl.textContent = displayName.slice(0, 2).toUpperCase();
      avatarEl.title = `${displayName} (${user?.role || 'user'}) — ${user?.username || ''}`;
    }
    if (emailEl) {
      emailEl.textContent = `${displayName} (${user?.role || 'user'})`;
    }

    // Start 5-minute inactivity tracking
    this.initActivityTracking();

    if (!this.appInitialized) {
      this.appInitialized = true;
      await App.init();
    } else {
      await App.refreshAllData();
    }
    if (window.App && typeof App.switchTab === 'function') {
      App.switchTab('pos');
    }
    if (window.lucide) window.lucide.createIcons();
  },

  setMessage(text, type = 'error') {
    const box = document.getElementById('auth-message-box');
    if (!box) return;
    if (!text) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    box.classList.remove('hidden');
    if (type === 'success') {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]";
    } else if (type === 'info') {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#EBF7FE] text-[#014486] border border-[#C5E8FC]";
    } else {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4]";
    }
    box.textContent = text;
  },

  updateStepper(activeStep) {
    [1, 2, 3].forEach(num => {
      const el = document.getElementById(`stepper-${num}`);
      if (!el) return;
      const circle = el.querySelector('span');
      if (num < activeStep) {
        el.className = "flex items-center gap-1.5 font-bold text-[#2E844A]";
        if (circle) {
          circle.className = "w-5 h-5 rounded-full bg-[#2E844A] text-white text-[10px] flex items-center justify-center font-bold";
          circle.textContent = "✓";
        }
      } else if (num === activeStep) {
        el.className = "flex items-center gap-1.5 font-bold text-[#0176D3]";
        if (circle) {
          circle.className = "w-5 h-5 rounded-full bg-[#0176D3] text-white text-[10px] flex items-center justify-center font-bold";
          circle.textContent = String(num);
        }
      } else {
        el.className = "flex items-center gap-1.5 font-semibold text-[#706E6B]";
        if (circle) {
          circle.className = "w-5 h-5 rounded-full bg-[#DDDBDA] text-[#3E3E3C] text-[10px] flex items-center justify-center font-bold";
          circle.textContent = String(num);
        }
      }
    });
  },

  goToStep(stepNum) {
    this.setMessage('');
    document.getElementById('auth-reset-container')?.classList.add('hidden');
    document.getElementById('auth-stepper-header')?.classList.remove('hidden');

    if (stepNum === 1) {
      this.clearTimers();
      this.challengeId = '';
      document.getElementById('auth-step-username')?.classList.remove('hidden');
      document.getElementById('auth-step-password')?.classList.add('hidden');
      document.getElementById('auth-step-otp')?.classList.add('hidden');
      setTimeout(() => document.getElementById('auth-username-input')?.focus(), 50);
    } else if (stepNum === 2) {
      this.clearTimers();
      document.getElementById('auth-step-username')?.classList.add('hidden');
      document.getElementById('auth-step-password')?.classList.remove('hidden');
      document.getElementById('auth-step-otp')?.classList.add('hidden');
      const passInput = document.getElementById('auth-password-input');
      if (passInput) {
        passInput.value = '';
        passInput.type = 'password';
        setTimeout(() => passInput.focus(), 50);
      }
    } else if (stepNum === 3) {
      document.getElementById('auth-step-username')?.classList.add('hidden');
      document.getElementById('auth-step-password')?.classList.add('hidden');
      document.getElementById('auth-step-otp')?.classList.remove('hidden');
      const comp = document.getElementById('auth-otp-component');
      if (comp) {
        comp.clear();
        setTimeout(() => comp.focus(), 60);
      }
    }
    this.updateStepper(stepNum);
    if (window.lucide) window.lucide.createIcons();
  },

  togglePasswordVisibility() {
    const input = document.getElementById('auth-password-input');
    const icon = document.getElementById('auth-pass-eye-icon');
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      input.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) window.lucide.createIcons();
  },

  // ==================== STEP 1: CHECK VERIFIED GMAIL USERNAME ====================
  async submitStep1Username() {
    const input = document.getElementById('auth-username-input');
    const btn = document.getElementById('auth-step1-btn');
    const username = (input?.value || '').trim().toLowerCase();

    if (!username || !username.endsWith('@gmail.com')) {
      this.setMessage('Please enter a valid verified @gmail.com username.', 'error');
      input?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Checking Account...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Username not found.');
      }

      this.currentUsername = data.username;
      const chipName = document.getElementById('auth-user-chip-name');
      const chipRole = document.getElementById('auth-user-chip-role');
      const chipEmail = document.getElementById('auth-user-chip-email');
      const chipAvatar = document.getElementById('auth-user-chip-avatar');

      if (chipName) chipName.textContent = data.name || 'User';
      if (chipRole) chipRole.textContent = data.role || 'cashier';
      if (chipEmail) chipEmail.textContent = data.username;
      if (chipAvatar) chipAvatar.textContent = (data.name || data.username).slice(0, 2).toUpperCase();

      this.goToStep(2);
    } catch (e) {
      this.setMessage(e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>Next: Enter Password</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== STEP 2: VERIFY PASSWORD & SEND 6-DIGIT CODE ====================
  async submitStep2Password() {
    const passInput = document.getElementById('auth-password-input');
    const btn = document.getElementById('auth-step2-btn');
    const password = (passInput?.value || '').trim();

    if (!password) {
      this.setMessage('Please enter your account password.', 'error');
      passInput?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Verifying & Sending Code...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/login-step1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: this.currentUsername, password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid password.');
      }

      this.challengeId = data.challenge_id;
      const targetEl = document.getElementById('auth-target-email');
      if (targetEl) targetEl.textContent = data.email || this.currentUsername;

      this.goToStep(3);
      this.setMessage(data.message || '6-digit verification code sent to your Gmail inbox!', 'success');
      this.startTimers(data.expires_in || 300, 30);
    } catch (e) {
      this.setMessage(e.message, 'error');
      passInput?.focus();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Verify Password & Send 6-Digit Code</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== STEP 3: VERIFY 6-DIGIT CODE & COMPLETE LOGIN ====================
  getEnteredOtp() {
    const comp = document.getElementById('auth-otp-component');
    if (comp && comp.value) {
      return comp.value;
    }
    const singleInput = document.getElementById('auth-otp-input');
    if (singleInput && singleInput.value) {
      return singleInput.value.replace(/\D/g, '').slice(0, 6);
    }
    return '';
  },

  async submitStep3Otp() {
    const code = this.getEnteredOtp();
    const btn = document.getElementById('auth-verify-otp-btn');

    if (code.length !== 6) {
      this.setMessage('Please enter all 6 digits of your verification code.', 'error');
      document.getElementById('auth-otp-component')?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Completing Login...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/login-step2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: this.challengeId, code })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid verification code.');
      }

      if (data.token) {
        localStorage.setItem('taypee_auth_token', data.token);
      }

      if (window.SoundEngine) SoundEngine.success();
      await this.unlockApp(data.user);
    } catch (e) {
      this.setMessage(e.message, 'error');
      document.getElementById('auth-otp-component')?.focus();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="shield-check" class="w-4 h-4"></i> <span>Verify Code & Complete Login</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  async resendOtp() {
    if (!this.challengeId) {
      this.goToStep(1);
      return;
    }
    try {
      const res = await fetch(`/api/auth/resend-code?challenge_id=${encodeURIComponent(this.challengeId)}`, {
        method: 'POST',
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to resend code.');

      this.setMessage(data.message || 'New verification code sent to your Gmail inbox!', 'success');
      this.startTimers(300, 30);
    } catch (e) {
      this.setMessage(e.message, 'error');
    }
  },

  setupOtpInputs() {
    // Component handles its own slots and events
    const comp = document.getElementById('auth-otp-component');
    if (comp && typeof comp.updateMask === 'function') {
      comp.updateMask();
    }
  },

  startTimers(expirySeconds, resendSeconds) {
    this.clearTimers();
    this.secondsLeft = expirySeconds;
    this.resendCooldown = resendSeconds;

    const expEl = document.getElementById('auth-otp-countdown');
    const resendBtn = document.getElementById('auth-resend-btn');

    const updateExp = () => {
      const m = String(Math.floor(this.secondsLeft / 60)).padStart(2, '0');
      const s = String(this.secondsLeft % 60).padStart(2, '0');
      if (expEl) expEl.textContent = `${m}:${s}`;
    };

    const updateResend = () => {
      if (!resendBtn) return;
      if (this.resendCooldown > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = `Resend Code (${this.resendCooldown}s)`;
        resendBtn.className = "text-xs font-semibold text-[#706E6B] cursor-not-allowed";
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = "Resend Code";
        resendBtn.className = "text-xs font-bold text-[#0176D3] hover:underline cursor-pointer";
      }
    };

    updateExp();
    updateResend();

    this.expiryTimer = setInterval(() => {
      this.secondsLeft = Math.max(0, this.secondsLeft - 1);
      updateExp();
      if (this.secondsLeft === 0) {
        clearInterval(this.expiryTimer);
        this.setMessage('Verification code expired. Click Resend Code or Start Over.', 'error');
      }
    }, 1000);

    this.resendTimer = setInterval(() => {
      this.resendCooldown = Math.max(0, this.resendCooldown - 1);
      updateResend();
      if (this.resendCooldown === 0) clearInterval(this.resendTimer);
    }, 1000);
  },

  clearTimers() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    if (this.resendTimer) clearInterval(this.resendTimer);
    this.expiryTimer = null;
    this.resendTimer = null;
  },

  // ==================== INACTIVITY / IDLE SESSION MANAGER (15-MIN WARNING) ====================
  recordActivity() {
    if (this.isAuthenticated && !this.isIdleWarningShown) {
      this.lastActivityTimestamp = Date.now();
    }
  },

  initActivityTracking() {
    this.stopActivityTracking();
    this.lastActivityTimestamp = Date.now();
    this.isIdleWarningShown = false;

    this._boundRecordActivity = () => this.recordActivity();
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(evt => {
      window.addEventListener(evt, this._boundRecordActivity, { passive: true });
    });

    this.idleCheckInterval = setInterval(() => this.checkInactivity(), 1000);
  },

  stopActivityTracking() {
    if (this._boundRecordActivity) {
      const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
      events.forEach(evt => {
        window.removeEventListener(evt, this._boundRecordActivity);
      });
      this._boundRecordActivity = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    if (this.idleCountdownInterval) {
      clearInterval(this.idleCountdownInterval);
      this.idleCountdownInterval = null;
    }
    this.isIdleWarningShown = false;
    const modal = document.getElementById('idle-timeout-modal');
    if (modal) modal.classList.add('hidden');
  },

  checkInactivity() {
    if (!this.isAuthenticated || this.isIdleWarningShown) return;

    const elapsedSeconds = Math.floor((Date.now() - this.lastActivityTimestamp) / 1000);
    if (elapsedSeconds >= this.idleTimeoutSeconds) {
      this.showIdleWarning();
    }
  },

  showIdleWarning() {
    this.isIdleWarningShown = true;
    const modal = document.getElementById('idle-timeout-modal');
    if (modal) modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    if (window.SoundEngine) SoundEngine.beep();

    let countdown = this.idleWarningSeconds;
    const countdownEl = document.getElementById('idle-countdown-seconds');
    if (countdownEl) countdownEl.textContent = String(countdown);

    if (this.idleCountdownInterval) clearInterval(this.idleCountdownInterval);
    this.idleCountdownInterval = setInterval(() => {
      countdown--;
      if (countdownEl) countdownEl.textContent = String(countdown);
      if (countdown <= 0) {
        clearInterval(this.idleCountdownInterval);
        this.idleCountdownInterval = null;
        this.forceIdleLogout();
      }
    }, 1000);
  },

  dismissIdleWarning() {
    this.isIdleWarningShown = false;
    if (this.idleCountdownInterval) {
      clearInterval(this.idleCountdownInterval);
      this.idleCountdownInterval = null;
    }
    const modal = document.getElementById('idle-timeout-modal');
    if (modal) modal.classList.add('hidden');

    this.lastActivityTimestamp = Date.now();
    if (window.SoundEngine) SoundEngine.success();
  },

  async forceIdleLogout() {
    this.dismissIdleWarning();
    await this.performLogout("You were logged out due to inactivity (15 minutes). Please sign in again.");
  },

  async performLogout(message) {
    this.clearTimers();
    this.stopActivityTracking();
    this.isAuthenticated = false;
    this.currentUserInfo = null;

    localStorage.removeItem('taypee_auth_token');
    document.documentElement.classList.remove('auth-token-present');

    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.warn("Logout request failed:", e);
    }

    this.showLoginGate();
    if (message) {
      this.setMessage(message, 'info');
    }
  },

  async logout() {
    if (!confirm(`Sign out from ${this.currentUsername || 'this session'}?`)) return;
    await this.performLogout("You have signed out successfully.");
  },

  // ==================== PASSWORD RESET WITH CAPTCHA & GMAIL OTP ====================
  showResetPasswordView() {
    this.clearTimers();
    this.setMessage('');
    this.setResetMessage('');
    document.getElementById('auth-stepper-header')?.classList.add('hidden');
    document.getElementById('auth-step-username')?.classList.add('hidden');
    document.getElementById('auth-step-password')?.classList.add('hidden');
    document.getElementById('auth-step-otp')?.classList.add('hidden');
    document.getElementById('auth-reset-container')?.classList.remove('hidden');

    // Pre-fill username if already typed in Step 1
    const existingUser = document.getElementById('auth-username-input')?.value || this.currentUsername;
    const resetUserInput = document.getElementById('auth-reset-username');
    if (resetUserInput && existingUser) resetUserInput.value = existingUser;

    this.showResetStep('a');
    this.loadCaptcha();
    if (window.lucide) window.lucide.createIcons();
  },

  cancelResetPassword() {
    document.getElementById('auth-reset-container')?.classList.add('hidden');
    document.getElementById('auth-stepper-header')?.classList.remove('hidden');
    this.goToStep(1);
  },

  showResetStep(step) {
    this.setResetMessage('');
    if (step === 'a') {
      document.getElementById('auth-reset-step-a')?.classList.remove('hidden');
      document.getElementById('auth-reset-step-b')?.classList.add('hidden');
      setTimeout(() => document.getElementById('auth-captcha-input')?.focus(), 60);
    } else {
      document.getElementById('auth-reset-step-a')?.classList.add('hidden');
      document.getElementById('auth-reset-step-b')?.classList.remove('hidden');
      const otpInput = document.getElementById('auth-reset-otp-input');
      if (otpInput) {
        otpInput.value = '';
        setTimeout(() => otpInput.focus(), 60);
      }
    }
    if (window.lucide) window.lucide.createIcons();
  },

  setResetMessage(text, type = 'error') {
    const box = document.getElementById('auth-reset-msg');
    if (!box) return;
    if (!text) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    box.classList.remove('hidden');
    if (type === 'success') {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]";
    } else if (type === 'info') {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#EBF7FE] text-[#014486] border border-[#C5E8FC]";
    } else {
      box.className = "p-2.5 rounded text-xs font-semibold bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4]";
    }
    box.textContent = text;
  },

  async loadCaptcha() {
    const box = document.getElementById('auth-captcha-img-box');
    const input = document.getElementById('auth-captcha-input');
    if (input) input.value = '';
    if (box) box.innerHTML = `<span class="text-xs text-[#706E6B] animate-pulse">Loading Captcha...</span>`;

    try {
      const res = await fetch('/api/auth/captcha', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error("Failed to load captcha");
      this.currentCaptchaId = data.captcha_id;
      if (box) box.innerHTML = data.captcha_svg;
      setTimeout(() => input?.focus(), 50);
    } catch (e) {
      if (box) box.innerHTML = `<button type="button" onclick="AuthGate.loadCaptcha()" class="text-xs text-[#EA001E] underline font-bold">Retry Captcha</button>`;
    }
  },

  toggleResetPassVisibility(inputId, eyeId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(eyeId);
    if (!input) return;
    if (input.type === 'password') {
      input.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      input.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) window.lucide.createIcons();
  },

  async submitResetStepA() {
    const username = (document.getElementById('auth-reset-username')?.value || '').trim().toLowerCase();
    const captcha_code = (document.getElementById('auth-captcha-input')?.value || '').trim();
    const btn = document.getElementById('auth-reset-step-a-btn');

    if (!username || !username.endsWith('@gmail.com')) {
      this.setResetMessage('Please enter a valid registered @gmail.com username.', 'error');
      document.getElementById('auth-reset-username')?.focus();
      return;
    }

    if (!captcha_code || captcha_code.length < 4) {
      this.setResetMessage('Please enter the 5-character Captcha code.', 'error');
      document.getElementById('auth-captcha-input')?.focus();
      return;
    }

    this.setResetMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Verifying Captcha...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/forgot-password/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          username,
          captcha_id: this.currentCaptchaId,
          captcha_code
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to request password reset OTP.');
      }

      this.resetChallengeId = data.reset_challenge_id;
      const targetEl = document.getElementById('auth-reset-target-email');
      if (targetEl) targetEl.textContent = data.email || username;

      this.setResetMessage(data.message || '6-digit OTP code sent to your Gmail inbox!', 'success');
      this.showResetStep('b');
    } catch (e) {
      this.setResetMessage(e.message, 'error');
      this.loadCaptcha();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Verify Captcha & Send OTP</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  async submitResetStepB() {
    const code = (document.getElementById('auth-reset-otp-input')?.value || '').trim();
    const new_password = (document.getElementById('auth-reset-new-password')?.value || '').trim();
    const confirm_password = (document.getElementById('auth-reset-confirm-password')?.value || '').trim();
    const btn = document.getElementById('auth-reset-step-b-btn');

    if (code.length !== 6) {
      this.setResetMessage('Please enter all 6 digits of the OTP code sent to your Gmail.', 'error');
      document.getElementById('auth-reset-otp-input')?.focus();
      return;
    }

    if (new_password.length < 6) {
      this.setResetMessage('New password must be at least 6 characters long.', 'error');
      document.getElementById('auth-reset-new-password')?.focus();
      return;
    }

    if (new_password !== confirm_password) {
      this.setResetMessage('New Password and Confirm Password do not match.', 'error');
      document.getElementById('auth-reset-confirm-password')?.focus();
      return;
    }

    this.setResetMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Resetting Password & Logging In...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/forgot-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          reset_challenge_id: this.resetChallengeId,
          code,
          new_password,
          confirm_password
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Password reset failed.');
      }

      if (window.SoundEngine) SoundEngine.success();
      // Direct system load: Webapp unlocks immediately!
      await this.unlockApp(data.user);
    } catch (e) {
      this.setResetMessage(e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="shield-check" class="w-4 h-4"></i> <span>Reset Password & Open System Directly</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== SETTINGS: GMAIL SMTP + SYSTEM LOGIN USERS ====================
  async loadAuthSettings() {
    try {
      const res = await fetch('/api/auth/config', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        const emailInput = document.getElementById('setting-smtp-email');
        const passInput = document.getElementById('setting-smtp-pass');
        const hoursInput = document.getElementById('setting-session-hours');
        const pill = document.getElementById('settings-gmail-auth-pill');

        if (emailInput) emailInput.value = data.smtp_email || '';
        if (passInput) {
          passInput.value = '';
          passInput.placeholder = data.has_app_password ? '•••••••••••••••• (Loaded from .env)' : '16-char Google App Password';
        }
        if (hoursInput) hoursInput.value = data.session_hours || 24;

        if (pill) {
          if (data.smtp_configured) {
            pill.textContent = 'Gmail SMTP Active';
            pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]';
          } else {
            pill.textContent = 'Setup Mode';
            pill.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF4E8] text-[#8C4B00] border border-[#FE9339]';
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load SMTP config:', e);
    }

    await this.loadSystemUsers();
  },

  async saveSmtpSettings() {
    const smtp_email = document.getElementById('setting-smtp-email')?.value.trim() || '';
    const smtp_app_password = document.getElementById('setting-smtp-pass')?.value.trim() || '';

    try {
      const res = await fetch('/api/auth/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          smtp_email,
          smtp_app_password: smtp_app_password || null,
          test_connection: Boolean(smtp_email)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save Gmail SMTP settings.');

      if (window.SoundEngine) SoundEngine.success();
      alert('✅ ' + (data.test_result?.message || data.message));
      await this.loadAuthSettings();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async loadSystemUsers() {
    try {
      const res = await fetch('/api/auth/users', { credentials: 'same-origin' });
      if (!res.ok) return;
      this.usersList = await res.json();
      const tbody = document.getElementById('settings-users-list');
      if (!tbody) return;

      tbody.innerHTML = this.usersList.map(u => `
        <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB]">
          <td class="py-1.5 px-2">
            <div class="font-bold text-[#181818]">${u.name}</div>
            <div class="text-[10px] font-mono text-[#706E6B]">${u.username}</div>
          </td>
          <td class="py-1.5 px-2">
            <span class="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${u.role === 'admin' ? 'bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC]' : 'bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA]'}">${u.role}</span>
          </td>
          <td class="py-1.5 px-2 text-right">
            <div class="flex items-center justify-end gap-1">
              <button onclick="AuthGate.openEditUserModal('${u.id}')" class="px-1.5 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#0176D3] text-[10px] font-semibold">Edit</button>
              ${u.id !== 'USER-001' ? `<button onclick="AuthGate.deleteSystemUser('${u.id}')" class="px-1.5 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#EA001E] text-[10px] font-semibold">✕</button>` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.warn('Failed to load system users:', e);
    }
  },

  openAddUserModal() {
    this.editingUserId = null;
    document.getElementById('sys-user-modal-title').innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 text-[#0176D3]"></i> Add System Login Account`;
    document.getElementById('sys-user-submit-btn').textContent = 'Create Login Account';
    document.getElementById('sys-user-name').value = '';
    const userInput = document.getElementById('sys-user-username');
    userInput.value = '';
    userInput.disabled = false;
    document.getElementById('sys-user-password').value = '';
    document.getElementById('sys-user-password').placeholder = 'Enter strong password (min 6 chars)';
    document.getElementById('sys-user-role').value = 'cashier';
    document.getElementById('system-user-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  openEditUserModal(userId) {
    const u = this.usersList.find(x => x.id === userId);
    if (!u) return;
    this.editingUserId = userId;
    document.getElementById('sys-user-modal-title').innerHTML = `<i data-lucide="edit-3" class="w-4 h-4 text-[#0176D3]"></i> Edit Login Account (${u.id})`;
    document.getElementById('sys-user-submit-btn').textContent = 'Update Account';
    document.getElementById('sys-user-name').value = u.name || '';
    const userInput = document.getElementById('sys-user-username');
    userInput.value = u.username || '';
    userInput.disabled = true;
    document.getElementById('sys-user-password').value = '';
    document.getElementById('sys-user-password').placeholder = 'Leave blank to keep current password';
    document.getElementById('sys-user-role').value = u.role || 'cashier';
    document.getElementById('system-user-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  async submitUserForm() {
    const name = document.getElementById('sys-user-name').value.trim();
    const username = document.getElementById('sys-user-username').value.trim().toLowerCase();
    const password = document.getElementById('sys-user-password').value.trim();
    const role = document.getElementById('sys-user-role').value;

    const isEdit = Boolean(this.editingUserId);
    if (!name || (!isEdit && (!username || !password))) {
      alert('Please fill Name, Verified Gmail Username, and Password.');
      return;
    }

    try {
      const url = isEdit ? `/api/auth/users/${this.editingUserId}` : '/api/auth/users';
      const method = isEdit ? 'PUT' : 'POST';
      const body = isEdit
        ? { name, role, password: password || null }
        : { name, username, password, role };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to save user.');

      document.getElementById('system-user-modal').classList.add('hidden');
      this.editingUserId = null;
      if (window.SoundEngine) SoundEngine.success();
      await this.loadSystemUsers();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async deleteSystemUser(userId) {
    if (!confirm('Delete this login account permanently?')) return;
    try {
      const res = await fetch(`/api/auth/users/${userId}`, { method: 'DELETE', credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to delete user.');
      await this.loadSystemUsers();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  }
};

// Auto-initialize AuthGate immediately once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => AuthGate.bootstrap());
} else {
  AuthGate.bootstrap();
}
