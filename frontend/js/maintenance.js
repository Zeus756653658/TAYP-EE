// Daily Dual-Window Maintenance & System Update Engine
// Window 1: Night 12:30 AM - 1:00 AM (00:30 - 01:00)
// Window 2: Afternoon 3:00 PM - 3:15 PM (15:00 - 15:15)
const MaintenanceEngine = {
  statusData: null,
  warningShown: false,
  timerInterval: null,

  init() {
    this.pollStatus();
    setInterval(() => this.pollStatus(), 6000);
    setInterval(() => this.updateClock(), 1000);
  },

  async pollStatus() {
    try {
      const res = await fetch('/api/system/maintenance');
      if (!res.ok) return;
      const data = await res.json();
      if (!data || data.detail) return;
      this.statusData = data;
      this.renderUI(data);
    } catch (e) {
      console.warn("Failed to check maintenance status:", e);
    }
  },

  updateClock() {
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    if (!this.statusData) return;

    if (this.statusData.in_maintenance) {
      if (this.statusData.seconds_remaining_in_maintenance > 0) {
        this.statusData.seconds_remaining_in_maintenance--;
      }
      this.updateMaintenanceClock(this.statusData.seconds_remaining_in_maintenance);
    } else if (this.statusData.seconds_until_maintenance > 0) {
      this.statusData.seconds_until_maintenance--;
      this.updateCountdownBadge(this.statusData.seconds_until_maintenance);
    }
  },

  updateMaintenanceClock(seconds) {
    const digitsEl = document.getElementById('maint-clock-digits');
    const circleEl = document.getElementById('maint-clock-circle');
    const progText = document.getElementById('maint-progress-text');
    const progBar = document.getElementById('maint-progress-bar');
    const startLbl = document.getElementById('maint-clock-start-label');
    const endLbl = document.getElementById('maint-clock-end-label');

    const totalSeconds = this.statusData?.total_window_seconds || 1800;
    const remaining = Math.max(0, seconds || 0);

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    if (digitsEl) digitsEl.textContent = timeStr;

    const elapsed = Math.max(0, totalSeconds - remaining);
    const pct = totalSeconds > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / totalSeconds) * 100))) : 0;

    if (progText) progText.textContent = `${pct}%`;
    if (progBar) progBar.style.width = `${pct}%`;

    // Circumference for r=50 is 2 * PI * 50 = 314.16
    const circumference = 314.16;
    if (circleEl) {
      const remainingRatio = totalSeconds > 0 ? (remaining / totalSeconds) : 0;
      const offset = circumference * (1 - remainingRatio);
      circleEl.style.strokeDashoffset = offset;
    }

    if (startLbl && this.statusData?.window_start_display) {
      startLbl.textContent = `Started ${this.statusData.window_start_display}`;
    }
    if (endLbl && this.statusData?.window_end_display) {
      endLbl.textContent = `Unlocks at ${this.statusData.window_end_display}`;
    }

    // Update top header badge as well
    const badge = document.getElementById('maintenance-countdown-badge');
    if (badge) {
      const winDisplay = this.statusData?.active_window_display || "Maintenance";
      badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping mr-1.5"></span> Maintenance (${timeStr})`;
      badge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center";
    }

    // When maintenance reaches 0, trigger instant poll to unlock
    if (remaining <= 0) {
      this.pollStatus();
    }
  },

  updateCountdownBadge(seconds) {
    const badge = document.getElementById('maintenance-countdown-badge');
    if (!badge) return;

    if (this.statusData?.in_maintenance) {
      return; // Handled by updateMaintenanceClock
    }

    const winDisplay = this.statusData?.active_window_display || "Maintenance";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    let timeStr = "";
    if (hrs > 0) timeStr = `${hrs}h ${mins}m`;
    else if (mins > 0) timeStr = `${mins}m ${secs}s`;
    else timeStr = `${secs}s`;

    badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1.5"></span> ${winDisplay}: <span class="font-mono ml-1 text-emerald-300 font-bold">${timeStr}</span>`;
  },

  renderUI(data) {
    const banner = document.getElementById('maintenance-warning-banner');
    const overlay = document.getElementById('maintenance-fullscreen-overlay');
    const winDisplay = data.active_window_display || "Scheduled Window";

    // 1. Pre-maintenance warning banner
    if (data.warning_active && !data.in_maintenance) {
      if (banner) {
        banner.classList.remove('hidden');
        const minsLeft = Math.ceil(data.seconds_until_maintenance / 60);
        const timeEl = document.getElementById('maintenance-warning-time');
        const winEl = document.getElementById('maintenance-warning-window');
        if (timeEl) timeEl.textContent = `${minsLeft} minutes`;
        if (winEl) winEl.textContent = winDisplay;
      }
      if (!this.warningShown) {
        SoundEngine.alert();
        this.warningShown = true;
      }
    } else {
      if (banner) banner.classList.add('hidden');
      if (!data.warning_active) this.warningShown = false;
    }

    // 2. Full Maintenance Lock Overlay
    if (data.in_maintenance) {
      if (overlay) {
        overlay.classList.remove('hidden');
        const overlayWinEl = document.getElementById('maintenance-overlay-window');
        if (overlayWinEl) {
          overlayWinEl.textContent = `SCHEDULED DAILY WINDOW (${winDisplay})`;
        }
        this.updateMaintenanceClock(data.seconds_remaining_in_maintenance);
      }
    } else {
      if (overlay) overlay.classList.add('hidden');
    }

    // 3. Maintenance Tab (View 8) live indicator
    const nextWinLabel = document.getElementById('maintenance-view-next-window');
    if (nextWinLabel) {
      nextWinLabel.textContent = `Next Window: ${data.next_maintenance} (${data.active_window_display || ''})`;
    }
  },

  async emergencyBypass() {
    const pin = prompt("Enter Emergency Cashier/Admin PIN to unlock counter:");
    if (pin === null || !pin.trim()) return;
    try {
      const res = await fetch('/api/system/verify-bypass-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pin: pin.trim() })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Incorrect PIN. Maintenance window locked.");
      }
      const overlay = document.getElementById('maintenance-fullscreen-overlay');
      if (overlay) overlay.classList.add('hidden');
      alert("Emergency Counter Bypass Active. Please complete urgent billing.");
    } catch (e) {
      alert(e.message);
    }
  }
};
