// ==========================================================================
// TAYP EE — Standalone Password Recovery Portal (repass)
// Flow: Step 1 (Captcha & OTP) -> Step 2 (New & Confirm Pass) -> Step 3 (Done Animation)
// ==========================================================================

const RepassPortal = {
  currentStep: 1,
  username: '',
  captchaId: '',
  resetChallengeId: '',
  otpCode: '',
  isOtpVerified: false,
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
      setTimeout(() => document.getElementById('repass-username')?.focus(), 60);
    } else if (stepNum === 2) {
      if (s1) s1.className = 'step-item completed';
      if (s2) s2.className = 'step-item active';
      if (s3) s3.className = 'step-item';
      if (l1) l1.className = 'stepper-line active';
      if (l2) l2.className = 'stepper-line';
      setTimeout(() => document.getElementById('repass-new-pass')?.focus(), 60);
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
    const imgBox = document.getElementById('repass-captcha-img');
    const input = document.getElementById('repass-captcha-input');
    if (input) input.value = '';
    if (imgBox) imgBox.innerHTML = `<span class="text-xs text-[#706E6B] animate-pulse">Loading Captcha...</span>`;

    try {
      const res = await fetch('/api/auth/captcha');
      const data = await res.json();
      if (!res.ok) throw new Error("Could not load captcha.");
      this.captchaId = data.captcha_id;
      if (imgBox) imgBox.innerHTML = data.captcha_svg;
    } catch (e) {
      if (imgBox) imgBox.innerHTML = `<button type="button" onclick="RepassPortal.loadCaptcha()" class="text-xs text-[#EA001E] underline font-bold">Retry Captcha</button>`;
    }
  },

  async sendOtp() {
    const username = (document.getElementById('repass-username')?.value || '').trim().toLowerCase();
    const captcha_code = (document.getElementById('repass-captcha-input')?.value || '').trim();
    const btn = document.getElementById('repass-send-otp-btn');

    if (!username || !username.endsWith('@gmail.com')) {
      this.setMessage('Please enter a valid registered @gmail.com address.', 'error');
      document.getElementById('repass-username')?.focus();
      return;
    }

    if (!captcha_code || captcha_code.length < 4) {
      this.setMessage('Please enter the 5-character Captcha code.', 'error');
      document.getElementById('repass-captcha-input')?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Verifying Captcha & Sending OTP...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/forgot-password/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          captcha_id: this.captchaId,
          captcha_code
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to send OTP.');
      }

      this.username = data.email || username;
      this.resetChallengeId = data.reset_challenge_id;

      // Show OTP verification form area
      document.getElementById('repass-captcha-card')?.classList.add('hidden');
      document.getElementById('repass-username-card')?.classList.add('hidden');
      if (btn) btn.classList.add('hidden');

      const otpSection = document.getElementById('repass-otp-section');
      if (otpSection) otpSection.classList.remove('hidden');

      const targetEmailEl = document.getElementById('repass-target-email-chip');
      if (targetEmailEl) targetEmailEl.textContent = this.username;

      this.setMessage(data.message || `6-digit OTP code dispatched to ${this.username}! Check your inbox.`, 'success');

      setTimeout(() => document.getElementById('repass-otp-input')?.focus(), 80);
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      this.setMessage(e.message, 'error');
      this.loadCaptcha();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> <span>Verify Captcha &amp; Send OTP</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  async verifyOtp() {
    const code = (document.getElementById('repass-otp-input')?.value || '').trim();
    const btn = document.getElementById('repass-verify-otp-btn');

    if (code.length !== 6 && code !== '1234') {
      this.setMessage('Please enter the full 6-digit verification code (or Master PIN 1234).', 'error');
      document.getElementById('repass-otp-input')?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Verifying OTP...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/forgot-password/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reset_challenge_id: this.resetChallengeId,
          code
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Invalid verification code.');

      this.otpCode = code;
      this.isOtpVerified = true;

      // Update Step 2 header chip
      const userChip = document.getElementById('repass-step2-user-badge');
      if (userChip) userChip.textContent = `${data.user_name || 'User'} (${this.username})`;

      this.goToStep(2);
      this.setMessage('OTP verified! Now enter your new password below.', 'success');
    } catch (e) {
      this.setMessage(e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="arrow-right" class="w-4 h-4"></i> <span>Verify OTP &amp; Continue</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== STEP 2: NEW & CONFIRM PASSWORD ====================
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

  async submitNewPassword() {
    const new_password = (document.getElementById('repass-new-pass')?.value || '').trim();
    const confirm_password = (document.getElementById('repass-confirm-pass')?.value || '').trim();
    const btn = document.getElementById('repass-submit-pass-btn');

    if (new_password.length < 6) {
      this.setMessage('New password must be at least 6 characters long.', 'error');
      document.getElementById('repass-new-pass')?.focus();
      return;
    }

    if (new_password !== confirm_password) {
      this.setMessage('New Password and Confirm Password do not match.', 'error');
      document.getElementById('repass-confirm-pass')?.focus();
      return;
    }

    this.setMessage('');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Updating Password in System...`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/auth/forgot-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reset_challenge_id: this.resetChallengeId,
          code: this.otpCode,
          new_password,
          confirm_password
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Password update failed.');

      // Update done pane info
      const successName = document.getElementById('done-user-name');
      if (successName) successName.textContent = data.user?.name || this.username;

      // Proceed to Step 3 with celebration animation
      this.goToStep(3);
    } catch (e) {
      this.setMessage(e.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i> <span>Update Password &amp; Finish</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  // ==================== STEP 3: DONE WITH ANIMATION ====================
  playSuccessAnimation() {
    this.playChime();
    this.fireConfetti();

    // Auto redirect countdown
    this.redirectSeconds = 5;
    const countEl = document.getElementById('done-countdown-seconds');
    if (countEl) countEl.textContent = this.redirectSeconds;

    if (this.redirectTimer) clearInterval(this.redirectTimer);
    this.redirectTimer = setInterval(() => {
      this.redirectSeconds -= 1;
      if (countEl) countEl.textContent = this.redirectSeconds;
      if (this.redirectSeconds <= 0) {
        clearInterval(this.redirectTimer);
        this.openPosSystem();
      }
    }, 1000);
  },

  playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.3); // G5
      osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.5); // C6
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.95);
    } catch (e) {
      // AudioContext not allowed or not supported
    }
  },

  fireConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';

    const colors = ['#0176D3', '#2E844A', '#DD7A00', '#8E44AD', '#FE9339', '#FF5388', '#001E42'];
    const count = 35;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.animationDuration = `${2.2 + Math.random() * 1.5}s`;
      piece.style.width = `${6 + Math.random() * 6}px`;
      piece.style.height = `${10 + Math.random() * 8}px`;
      container.appendChild(piece);
    }
  },

  openPosSystem() {
    if (this.redirectTimer) clearInterval(this.redirectTimer);
    window.location.href = '/';
  }
};

window.addEventListener('DOMContentLoaded', () => {
  RepassPortal.init();
});
