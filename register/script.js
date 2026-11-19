// ==========================================================================
// TAYP EE — Standalone Staff & User Registration Portal (register)
// Flow: Step 1 (Info, Captcha & OTP) -> Step 2 (Password) -> Step 3 (Saved & Celebration)
// ==========================================================================

const RegisterPortal = {
  currentStep: 1,
  name: '',
  username: '',
  role: 'cashier',
  captchaId: '',
  regChallengeId: '',
  redirectTimer: null,
  redirectSeconds: 5,

  init() {
    this.loadCaptcha();
    this.goToStep(1);
    if (window.lucide) window.lucide.createIcons();
  },

  // ==================== NAVIGATION & STEPPER ====================
  goToStep(stepNum) {
    this.currentStep = stepNum;
    this.setMessage('');

    // Update Panes
    ['step-1-pane', 'step-2-pane', 'step-3-pane'].forEach((id, idx) => {
      const el = document.getElementById(id);
      if (el) {
        if (idx + 1 === stepNum) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });

    // Update Stepper Header
    const s1 = document.getElementById('step-indicator-1');
    const s2 = document.getElementById('step-indicator-2');
    const s3 = document.getElementById('step-indicator-3');
    const l1 = document.getElementById('step-line-1');
    const l2 = document.getElementById('step-line-2');

    if (stepNum === 1) {
      if (s1) s1.className = 'step-item active';
      if (s2) s2.className = 'step-item';
      if (s3) s3.className = 'step-item';
      if (l1) l1.className = 'stepper-line';
      if (l2) l2.className = 'stepper-line';
      setTimeout(() => document.getElementById('reg-name')?.focus(), 60);
    } else if (stepNum === 2) {
      if (s1) s1.className = 'step-item completed';
      if (s2) s2.className = 'step-item active';
      if (s3) s3.className = 'step-item';
      if (l1) l1.className = 'stepper-line active';
      if (l2) l2.className = 'stepper-line';
      setTimeout(() => document.getElementById('reg-password')?.focus(), 60);
    } else if (stepNum === 3) {
      if (s1) s1.className = 'step-item completed';
      if (s2) s2.className = 'step-item completed';
      if (s3) s3.className = 'step-item completed';
      if (l1) l1.className = 'stepper-line active';
      if (l2) l2.className = 'stepper-line active';
      this.playSuccessAnimation();
    }

    if (window.lucide) window.lucide.createIcons();
  },

  setMessage(text, type = 'error') {
    const box = document.getElementById('portal-msg-box');
    if (!box) return;
    if (!text) {
      box.classList.add('hidden');
      box.textContent = '';
      return;
    }
    box.classList.remove('hidden');
    if (type === 'success') {
      box.className = 'p-3 rounded-lg text-xs font-semibold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5] mb-3';
    } else if (type === 'info') {
      box.className = 'p-3 rounded-lg text-xs font-semibold bg-[#EBF7FE] text-[#014486] border border-[#C5E8FC] mb-3';
    } else {
      box.className = 'p-3 rounded-lg text-xs font-semibold bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4] mb-3';
    }
    box.textContent = text;
  },

  // ==================== STEP 1: CAPTCHA & OTP ====================
  async loadCaptcha() {
    const imgBox = document.getElementById('reg-captcha-img');
    const input = document.getElementById('reg-captcha-input');
    if (input) input.value = '';
    if (imgBox) imgBox.innerHTML = `<span class="text-xs text-[#706E6B] animate-pulse">Loading Captcha...</span>`;

    try {
      const res = await fetch('/api/auth/captcha');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not load Captcha.');

      this.captchaId = data.captcha_id;
      if (imgBox) {
        imgBox.innerHTML = data.captcha_svg;
      }
    } catch (e) {
      if (imgBox) {
        imgBox.innerHTML = `<span class="text-[11px] text-[#EA001E]">Error loading captcha</span>`;
      }
      this.setMessage('Could not connect to security captcha service.', 'error');
    }
  },

  async sendOtp() {
    const nameInput = document.getElementById('reg-name');
    const emailInput = document.getElementById('reg-username');
    const roleInput = document.getElementById('reg-role');
    const captchaInput = document.getElementById('reg-captcha-input');
    const btn = document.getElementById('reg-send-otp-btn');

    const name = (nameInput?.value || '').trim();
    const username = (emailInput?.value || '').trim().toLowerCase();
    const role = (roleInput?.value || 'cashier').trim().toLowerCase();
    const captchaCode = (captchaInput?.value || '').trim();

    if (!name || name.length < 2) {
      this.setMessage('Please enter your full name (minimum 2 characters).', 'error');
      nameInput?.focus();
      return;
    }

    if (!username || !username.includes('@') || !username.endsWith('@gmail.com')) {
      this.setMessage('Please enter a valid Gmail address (must end with @gmail.com).', 'error');
      emailInput?.focus();
      return;
    }

    if (!captchaCode) {
      this.setMessage('Please enter the 5-character visual captcha code.', 'error');
      captchaInput?.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Verifying &amp; Sending OTP...</span>`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/register/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          username: username,
          role: role,
          captcha_id: this.captchaId,
          captcha_code: captchaCode
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to dispatch verification code.');
      }

      this.name = name;
      this.username = username;
      this.role = role;
      this.regChallengeId = data.reg_challenge_id;

      // Hide initial fields, show OTP section
      document.getElementById('reg-initial-fields')?.classList.add('hidden');
      const otpSection = document.getElementById('reg-otp-section');
      if (otpSection) otpSection.classList.remove('hidden');

      const targetChip = document.getElementById('reg-target-email-chip');
      if (targetChip) targetChip.textContent = this.username;

      this.setMessage(data.message || `6-digit OTP dispatched to ${this.username}! Check your inbox.`, 'success');

      setTimeout(() => document.getElementById('reg-otp-input')?.focus(), 80);
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      this.setMessage(e.message, 'error');
      this.loadCaptcha();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Verify Captcha &amp; Send Gmail OTP</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  async verifyOtp() {
    const otpInput = document.getElementById('reg-otp-input');
    const btn = document.getElementById('reg-verify-otp-btn');
    const code = (otpInput?.value || '').replace(/\D/g, '').trim();

    if (code.length !== 6) {
      this.setMessage('Please enter all 6 digits of the OTP code sent to your Gmail.', 'error');
      otpInput?.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Verifying OTP...</span>`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/register/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reg_challenge_id: this.regChallengeId,
          code: code
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Incorrect OTP code.');
      }

      // Populate Step 2 verified details
      const nameEl = document.getElementById('reg-step2-name');
      const emailEl = document.getElementById('reg-step2-email');
      const roleBadge = document.getElementById('reg-step2-role-badge');

      if (nameEl) nameEl.textContent = this.name;
      if (emailEl) emailEl.textContent = this.username;
      if (roleBadge) roleBadge.textContent = this.role.toUpperCase();

      this.goToStep(2);
      this.setMessage('Gmail account verified! Now create your secure password.', 'success');
    } catch (e) {
      this.setMessage(e.message, 'error');
      otpInput?.focus();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="arrow-right" class="w-4 h-4"></i> <span>Verify OTP &amp; Proceed to Password</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  togglePassVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
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

  // ==================== STEP 2: COMPLETE REGISTRATION & SAVE ====================
  async submitRegistration() {
    const passInput = document.getElementById('reg-password');
    const confirmInput = document.getElementById('reg-confirm-password');
    const btn = document.getElementById('reg-submit-btn');

    const password = (passInput?.value || '').trim();
    const confirmPassword = (confirmInput?.value || '').trim();

    if (password.length < 6) {
      this.setMessage('Password must be at least 6 characters long.', 'error');
      passInput?.focus();
      return;
    }

    if (password !== confirmPassword) {
      this.setMessage('Password and Confirm Password do not match.', 'error');
      confirmInput?.focus();
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> <span>Saving Account to Server...</span>`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/register/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          reg_challenge_id: this.regChallengeId,
          password: password,
          confirm_password: confirmPassword
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to save registration on server.');
      }

      // Update Step 3 Details
      const doneName = document.getElementById('done-reg-name');
      const doneRole = document.getElementById('done-reg-role');
      if (doneName) doneName.textContent = this.name;
      if (doneRole) doneRole.textContent = this.role.toUpperCase();

      this.goToStep(3);
    } catch (e) {
      this.setMessage(e.message, 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="user-check" class="w-4 h-4"></i> <span>Save Account on Server &amp; Finish</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== STEP 3: DONE ANIMATION & REDIRECT ====================
  playSuccessAnimation() {
    // Blast colorful confetti
    const container = document.getElementById('confetti-container');
    if (container) {
      container.innerHTML = '';
      const colors = ['#0176D3', '#2E844A', '#DD7A00', '#EA001E', '#001E42', '#A8C7FA', '#FFB75D'];
      for (let i = 0; i < 45; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = `${Math.random() * 1.5}s`;
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        container.appendChild(piece);
      }
    }

    // Auto Redirect Countdown
    this.redirectSeconds = 5;
    const cdEl = document.getElementById('done-reg-countdown');
    if (cdEl) cdEl.textContent = this.redirectSeconds;

    if (this.redirectTimer) clearInterval(this.redirectTimer);
    this.redirectTimer = setInterval(() => {
      this.redirectSeconds -= 1;
      if (cdEl) cdEl.textContent = this.redirectSeconds;
      if (this.redirectSeconds <= 0) {
        clearInterval(this.redirectTimer);
        this.openPosSystem();
      }
    }, 1000);
  },

  openPosSystem() {
    if (this.redirectTimer) clearInterval(this.redirectTimer);
    window.location.href = '/';
  }
};

// Auto Initialize
document.addEventListener('DOMContentLoaded', () => {
  RegisterPortal.init();
});
