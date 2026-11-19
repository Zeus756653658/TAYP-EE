// Daily 3:00 PM (15:00) Maintenance & System Update Engine
const MaintenanceEngine = {
  statusData: null,
  warningShown: false,
  timerInterval: null,

  init() {
    this.pollStatus();
    setInterval(() => this.pollStatus(), 8000);
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

    if (this.statusData && this.statusData.seconds_until_maintenance > 0) {
      this.statusData.seconds_until_maintenance--;
      this.updateCountdownBadge(this.statusData.seconds_until_maintenance);
    }
  },

  updateCountdownBadge(seconds) {
    const badge = document.getElementById('maintenance-countdown-badge');
    if (!badge) return;

    if (this.statusData?.in_maintenance) {
      badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping mr-1.5"></span> Maintenance In Progress`;
      badge.className = "px-3 py-1 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center";
      return;
    }

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    let timeStr = "";
    if (hrs > 0) timeStr = `${hrs}h ${mins}m`;
    else if (mins > 0) timeStr = `${mins}m ${secs}s`;
    else timeStr = `${secs}s`;

    const sched = this.statusData?.maintenance_scheduled_time || "15:00";
    let schedDisplay = "3:00 PM";
    try {
      const [h, m] = sched.split(':').map(Number);
      const period = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      schedDisplay = `${h12}:${m.toString().padStart(2, '0')} ${period}`;
    } catch (_) {}

    badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1.5"></span> ${schedDisplay} Maintenance: <span class="font-mono ml-1 text-emerald-300 font-bold">${timeStr}</span>`;
  },

  renderUI(data) {
    const banner = document.getElementById('maintenance-warning-banner');
    const overlay = document.getElementById('maintenance-fullscreen-overlay');

    // 1. Pre-maintenance warning (4:45 PM - 4:59 PM)
    if (data.warning_active && !data.in_maintenance) {
      if (banner) {
        banner.classList.remove('hidden');
        const minsLeft = Math.ceil(data.seconds_until_maintenance / 60);
        document.getElementById('maintenance-warning-time').textContent = `${minsLeft} minutes`;
      }
      if (!this.warningShown) {
        SoundEngine.alert();
        this.warningShown = true;
      }
    } else {
      if (banner) banner.classList.add('hidden');
      if (!data.warning_active) this.warningShown = false;
    }

    // 2. Full Maintenance Lock at 3:00 PM (15:00)
    if (data.in_maintenance) {
      if (overlay) overlay.classList.remove('hidden');
    } else {
      if (overlay) overlay.classList.add('hidden');
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
