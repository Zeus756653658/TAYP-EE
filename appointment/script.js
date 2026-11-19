/**
 * TAYP EE — Standalone Appointment Booking Portal Controller
 * Pure Vanilla JS with Fluid Animation, Real-time Validation & Confetti
 */

const BookingPortal = {
  catalog: {
    shop_name: 'TAYP EE',
    currency_symbol: '₹',
    services: [],
    staff: []
  },
  selectedService: null,
  selectedStaff: 'Any Available Stylist',
  selectedCategory: 'All',
  selectedTimeSlot: '02:30 PM',

  async init() {
    this.initDatePicker();
    await this.loadCatalog();
    if (window.lucide) window.lucide.createIcons();
  },

  initDatePicker() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('booking-date');
    if (dateInput) {
      dateInput.min = today;
      dateInput.value = today;
      this.updateDateTimeLabel();
      dateInput.addEventListener('change', () => this.updateDateTimeLabel());
    }

    const timeInput = document.getElementById('booking-time-input');
    if (timeInput) {
      timeInput.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val) {
          this.selectedTimeSlot = this.formatTime24to12(val);
          this.highlightTimeChips(null);
          this.updateDateTimeLabel();
        }
      });
    }
  },

  async loadCatalog() {
    try {
      const res = await fetch('/api/appointments/booking-catalog');
      const data = await res.json();
      if (data && data.services) {
        this.catalog = data;
        this.renderCategories();
        this.renderServices();
        this.renderStaff();

        // Default select first service
        if (data.services.length > 0) {
          this.selectService(data.services[0]);
        }
      }
    } catch (e) {
      console.warn("Failed to load booking catalog:", e);
      this.showMessage("Unable to load services catalog. Please check connection.", "error");
    }
  },

  renderCategories() {
    const container = document.getElementById('service-category-pills');
    if (!container) return;

    const categories = ['All'];
    this.catalog.services.forEach(s => {
      const cat = s.category || 'General';
      if (!categories.includes(cat)) categories.push(cat);
    });

    container.innerHTML = categories.map(cat => `
      <button type="button" onclick="BookingPortal.filterCategory('${cat}')" class="px-2.5 py-1 rounded-full font-bold whitespace-nowrap transition-all ${cat === this.selectedCategory ? 'bg-[#0176D3] text-white shadow-sm' : 'bg-white text-[#706E6B] border border-[#DDDBDA] hover:bg-[#F3F3F3]'}">
        ${cat}
      </button>
    `).join('');
  },

  filterCategory(cat) {
    this.selectedCategory = cat;
    this.renderCategories();
    this.renderServices();
  },

  renderServices() {
    const grid = document.getElementById('services-grid');
    if (!grid) return;

    const filtered = this.catalog.services.filter(s => {
      if (this.selectedCategory === 'All') return true;
      return (s.category || 'General') === this.selectedCategory;
    });

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="p-4 text-center text-xs text-[#706E6B] col-span-full">No services found in this category.</div>';
      return;
    }

    const sym = this.catalog.currency_symbol || '₹';
    grid.innerHTML = filtered.map(s => {
      const isSel = this.selectedService && this.selectedService.id === s.id;
      return `
        <div onclick="BookingPortal.selectService(${JSON.stringify(s).replace(/"/g, '&quot;')})" class="selectable-card ${isSel ? 'selected' : ''}">
          <div class="flex items-start justify-between gap-1">
            <h4 class="font-bold text-xs text-[#181818] leading-snug">${s.name}</h4>
            <span class="font-mono text-xs font-black text-[#2E844A] shrink-0">${sym}${Number(s.price).toFixed(0)}</span>
          </div>
          <div class="flex items-center gap-2 mt-1 text-[10px] text-[#706E6B]">
            <span class="flex items-center gap-0.5"><i data-lucide="clock" class="w-3 h-3 text-[#0176D3]"></i> ${s.duration_mins || 30} mins</span>
            <span>•</span>
            <span class="uppercase font-semibold">${s.category || 'General'}</span>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  },

  selectService(service) {
    this.selectedService = service;
    const label = document.getElementById('service-selected-label');
    const sym = this.catalog.currency_symbol || '₹';
    if (label) {
      label.textContent = `${service.name} (${sym}${service.price})`;
    }
    this.renderServices();
  },

  renderStaff() {
    const grid = document.getElementById('stylist-grid');
    if (!grid) return;

    const list = [{ id: 'ANY', name: 'Any Available Stylist', role: 'Fastest Service' }, ...this.catalog.staff];

    grid.innerHTML = list.map(st => {
      const isSel = this.selectedStaff === st.name;
      const initials = st.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `
        <div onclick="BookingPortal.selectStaff('${st.name}')" class="selectable-card text-center p-2.5 ${isSel ? 'selected' : ''}">
          <div class="w-8 h-8 rounded-full ${isSel ? 'bg-[#0176D3]' : 'bg-[#E5E5E5]'} ${isSel ? 'text-white' : 'text-[#181818]'} mx-auto mb-1 flex items-center justify-center font-bold text-xs shadow-sm transition-colors">
            ${initials}
          </div>
          <div class="font-bold text-[11px] text-[#181818] truncate">${st.name}</div>
          <div class="text-[9px] text-[#706E6B] truncate">${st.role || 'Stylist'}</div>
        </div>
      `;
    }).join('');
  },

  selectStaff(staffName) {
    this.selectedStaff = staffName;
    const label = document.getElementById('stylist-selected-label');
    if (label) {
      label.textContent = staffName;
    }
    this.renderStaff();
  },

  selectTimeSlot(slot) {
    this.selectedTimeSlot = slot;
    this.highlightTimeChips(slot);
    this.updateDateTimeLabel();
  },

  highlightTimeChips(selectedSlot) {
    const chips = document.querySelectorAll('.time-slot-chip');
    chips.forEach(chip => {
      if (chip.textContent.trim() === selectedSlot) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
    });
  },

  updateDateTimeLabel() {
    const dateInput = document.getElementById('booking-date');
    const label = document.getElementById('datetime-selected-label');
    if (label && dateInput) {
      label.textContent = `${dateInput.value || 'Today'} @ ${this.selectedTimeSlot}`;
    }
  },

  formatTime24to12(time24) {
    const [h, m] = time24.split(':');
    let hours = parseInt(h, 10);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours < 10 ? '0' + hours : hours}:${m} ${suffix}`;
  },

  showMessage(text, type = "error") {
    const box = document.getElementById('portal-msg-box');
    if (!box) return;
    if (!text) {
      box.className = "hidden";
      box.textContent = "";
      return;
    }
    if (type === "success") {
      box.className = "p-3 rounded-lg text-xs font-semibold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5] flex items-center gap-2";
    } else {
      box.className = "p-3 rounded-lg text-xs font-semibold bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4] flex items-center gap-2";
    }
    box.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : 'alert-triangle'}" class="w-4 h-4 shrink-0"></i><span>${text}</span>`;
    if (window.lucide) window.lucide.createIcons();
  },

  async submitBooking() {
    const name = (document.getElementById('booking-client-name')?.value || '').trim();
    const phone = (document.getElementById('booking-client-phone')?.value || '').trim();
    const date = document.getElementById('booking-date')?.value;
    const time = this.selectedTimeSlot;
    const notes = (document.getElementById('booking-notes')?.value || '').trim();

    if (!this.selectedService) {
      this.showMessage("Please select a salon service or treatment.");
      return;
    }

    if (!name) {
      this.showMessage("Please provide your full client name.");
      document.getElementById('booking-client-name')?.focus();
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      this.showMessage("Please provide a valid 10-digit mobile number.");
      document.getElementById('booking-client-phone')?.focus();
      return;
    }

    if (!date) {
      this.showMessage("Please select your appointment date.");
      return;
    }

    const btn = document.getElementById('btn-submit-booking');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Confirming &amp; Syncing with Store Cloud...</span>`;
      if (window.lucide) window.lucide.createIcons();
    }

    try {
      const res = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: name,
          customer_phone: cleanPhone,
          service_name: this.selectedService.name,
          staff_name: this.selectedStaff || 'Any Available Stylist',
          appointment_date: date,
          appointment_time: time,
          notes: notes
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Failed to confirm booking");
      }

      // Show Confirmation Pane
      this.showConfirmation(data.appointment);
    } catch (e) {
      this.showMessage(e.message, "error");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Confirm Appointment Booking</span>`;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  },

  showConfirmation(apt) {
    this.showMessage("");
    document.getElementById('pane-booking')?.classList.add('hidden');
    document.getElementById('pane-confirmed')?.classList.remove('hidden');

    // Update Stepper
    document.getElementById('step-indicator-1')?.classList.remove('active');
    document.getElementById('step-indicator-1')?.classList.add('completed');
    document.getElementById('step-line-1')?.classList.add('active');
    document.getElementById('step-indicator-2')?.classList.add('active');

    // Populate Ticket
    document.getElementById('ticket-id').textContent = apt.id;
    document.getElementById('ticket-client').textContent = apt.customer_name;
    document.getElementById('ticket-phone').textContent = apt.customer_phone;
    document.getElementById('ticket-service').textContent = apt.service_name;
    document.getElementById('ticket-stylist').textContent = apt.staff_name;
    document.getElementById('ticket-date').textContent = apt.appointment_date;
    document.getElementById('ticket-time').textContent = apt.appointment_time;

    if (window.lucide) window.lucide.createIcons();

    // Trigger Confetti
    this.triggerConfetti();
  },

  triggerConfetti() {
    const container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = '';

    const colors = ['#0176D3', '#2E844A', '#FE9339', '#8E44AD', '#EA001E', '#F9E154'];
    const count = 45;

    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.animationDuration = `${2.2 + Math.random() * 1.5}s`;
      piece.style.transform = `scale(${0.6 + Math.random() * 0.8})`;
      container.appendChild(piece);
    }

    setTimeout(() => {
      container.innerHTML = '';
    }, 4500);
  },

  resetForNewBooking() {
    document.getElementById('pane-confirmed')?.classList.add('hidden');
    document.getElementById('pane-booking')?.classList.remove('hidden');

    document.getElementById('step-indicator-1')?.classList.add('active');
    document.getElementById('step-indicator-1')?.classList.remove('completed');
    document.getElementById('step-line-1')?.classList.remove('active');
    document.getElementById('step-indicator-2')?.classList.remove('active');

    document.getElementById('booking-client-name').value = '';
    document.getElementById('booking-client-phone').value = '';
    document.getElementById('booking-notes').value = '';

    const btn = document.getElementById('btn-submit-booking');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4"></i><span>Confirm Appointment Booking</span>`;
    }

    if (window.lucide) window.lucide.createIcons();
    document.getElementById('booking-client-name')?.focus();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  BookingPortal.init();
});
