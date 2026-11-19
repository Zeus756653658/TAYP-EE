// Main Application State & View Controller
const App = {
  version: '0.1.0 BETA',
  build: '2026.11.20-b1',
  currentTab: 'pos',
  productsList: [],
  customersList: [],
  staffList: [],
  staffPerfList: [],
  stockList: [],
  expensesList: [],
  appointmentsList: [],
  dashboardBillsList: [],
  settings: {},
  customerTierFilter: 'All',
  expenseCategoryFilter: 'All',
  appointmentStatusFilter: 'All',
  inventorySubTab: 'stock',
  posTypeFilter: 'all',
  posSortBy: 'default',
  dashAnalyticsPeriod: 'today',
  editingCustomerId: null,
  editingProductId: null,
  editingStockProductId: null,
  editingStaffId: null,
  editingExpenseId: null,
  editingAppointmentId: null,
  globalSearchTimer: null,

  async init() {
    // Initialize sound engine on first user click
    window.addEventListener('click', () => SoundEngine.init(), { once: true });

    // Load initial settings and data safely without throwing unhandled rejections
    try { await this.loadSettings(); } catch (e) { console.warn("Init loadSettings:", e); }
    try { await this.checkCloudStatus(); } catch (e) { console.warn("Init checkCloudStatus:", e); }
    try { await this.loadStaff(); } catch (e) { console.warn("Init loadStaff:", e); }
    try { await this.loadProducts(); } catch (e) { console.warn("Init loadProducts:", e); }
    try { await this.loadCustomers(); } catch (e) { console.warn("Init loadCustomers:", e); }
    try { await this.loadDashboardStats(); } catch (e) { console.warn("Init loadDashboardStats:", e); }

    // Initialize sub-engines
    try { POS.init(); } catch (e) { console.warn("Init POS:", e); }
    try { MaintenanceEngine.init(); } catch (e) { console.warn("Init Maintenance:", e); }

    // Global ESC listener to close App Launcher & Global Search dropdown
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const launcher = document.getElementById('app-launcher-modal');
        if (launcher && !launcher.classList.contains('hidden')) {
          App.closeAppLauncher();
        }
        App.hideGlobalSearchDropdown();
      }
    });

    // Click outside Global Search closes dropdown
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('global-search-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        App.hideGlobalSearchDropdown();
      }
    });

    // Default tab
    this.switchTab('pos');

    if (window.lucide) window.lucide.createIcons();
  },

  async refreshAllData() {
    SoundEngine.beep();
    await Promise.all([
      this.loadSettings(),
      this.checkCloudStatus(),
      this.loadStaff(),
      this.loadProducts(),
      this.loadCustomers(),
      this.loadInventory(),
      this.loadDashboardStats()
    ]);
    if (this.currentTab === 'staff') await this.loadStaffPerformance();
    if (this.currentTab === 'expenses') await this.loadExpenses();
    if (this.currentTab === 'appointments') await this.loadAppointments();
  },

  // ==================== GLOBAL SEARCH ENGINE ====================
  handleGlobalSearch(rawQuery) {
    const query = (rawQuery || '').trim();
    const clearBtn = document.getElementById('global-search-clear');
    const dropdown = document.getElementById('global-search-dropdown');

    if (clearBtn) {
      if (query) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    }

    if (!query) {
      this.hideGlobalSearchDropdown();
      return;
    }

    clearTimeout(this.globalSearchTimer);
    this.globalSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/system/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        this.renderGlobalSearchDropdown(data, query);
      } catch (e) {
        console.warn("Global search failed:", e);
      }
    }, 150);
  },

  hideGlobalSearchDropdown() {
    const dropdown = document.getElementById('global-search-dropdown');
    if (dropdown) dropdown.classList.add('hidden');
  },

  clearGlobalSearch() {
    const input = document.getElementById('global-search-input');
    const clearBtn = document.getElementById('global-search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    this.hideGlobalSearchDropdown();
  },

  renderGlobalSearchDropdown(data, query) {
    const dropdown = document.getElementById('global-search-dropdown');
    if (!dropdown) return;

    const totalMatches =
      (data.products?.length || 0) +
      (data.customers?.length || 0) +
      (data.bills?.length || 0) +
      (data.stock?.length || 0) +
      (data.staff?.length || 0) +
      (data.appointments?.length || 0);

    if (totalMatches === 0) {
      dropdown.innerHTML = `
        <div class="p-6 text-center text-xs text-[#706E6B]">
          <i data-lucide="search-x" class="w-6 h-6 mx-auto mb-1.5 text-[#C9C7C5]"></i>
          No results found for "<strong class="text-[#181818]">${query}</strong>"
        </div>
      `;
      dropdown.classList.remove('hidden');
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    let html = '';

    // 1. Products & Services
    if (data.products && data.products.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Products & Services (${data.products.length})</div>`;
      html += data.products.map(p => `
        <div class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs">
          <div onclick="App.globalPickProduct('${p.id}')" class="flex-1 cursor-pointer">
            <div class="font-bold text-[#181818]">${p.name}</div>
            <div class="text-[10px] text-[#706E6B]">${p.category} • ${p.type} • <span class="font-mono font-bold text-[#0176D3]">₹${Number(p.price).toFixed(2)}</span></div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="App.globalPickProduct('${p.id}')" class="px-2 py-0.5 rounded bg-[#0176D3] text-white text-[10px] font-bold">+ POS</button>
            <button onclick="App.hideGlobalSearchDropdown(); App.openEditProductModal('${p.id}')" class="px-2 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#181818] text-[10px] font-semibold">Edit</button>
          </div>
        </div>
      `).join('');
    }

    // 2. Customers
    if (data.customers && data.customers.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Customers (${data.customers.length})</div>`;
      html += data.customers.map(c => `
        <div class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs">
          <div onclick="App.hideGlobalSearchDropdown(); App.selectCustomerForPOS('${c.id}')" class="flex-1 cursor-pointer">
            <div class="font-bold text-[#181818]">${c.name} <span class="font-mono text-[11px] text-[#706E6B]">(${c.phone})</span></div>
            <div class="text-[10px] text-[#706E6B]">Tier: ${c.membership_tier || 'Regular'} • Pts: ${c.loyalty_points || 0} • Wallet: ₹${Number(c.wallet_balance || 0).toFixed(0)}</div>
          </div>
          <div class="flex items-center gap-1">
            <button onclick="App.hideGlobalSearchDropdown(); App.selectCustomerForPOS('${c.id}')" class="px-2 py-0.5 rounded bg-[#0176D3] text-white text-[10px] font-bold">Bill</button>
            <button onclick="App.hideGlobalSearchDropdown(); App.openEditCustomerModal('${c.id}')" class="px-2 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#181818] text-[10px] font-semibold">Edit</button>
          </div>
        </div>
      `).join('');
    }

    // 3. Invoices / Bills
    if (data.bills && data.bills.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Invoices & Bills (${data.bills.length})</div>`;
      html += data.bills.map(b => `
        <div onclick="App.hideGlobalSearchDropdown(); App.reprintBill('${b.invoice_number}')" class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs cursor-pointer">
          <div>
            <div class="font-mono font-bold text-[#0176D3]">${b.invoice_number} <span class="font-sans text-[#181818]">• ${b.customer?.name || 'Walk-in'}</span></div>
            <div class="text-[10px] text-[#706E6B]">${b.created_at_display || ''} • ${b.payment_mode}</div>
          </div>
          <div class="text-right">
            <div class="font-mono font-bold text-[#2E844A]">₹${Number(b.rounded_total || 0).toFixed(2)}</div>
            <div class="text-[10px] text-[#0176D3] font-semibold">Reprint</div>
          </div>
        </div>
      `).join('');
    }

    // 4. Stock Inventory
    if (data.stock && data.stock.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Stock Inventory (${data.stock.length})</div>`;
      html += data.stock.map(s => `
        <div class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs">
          <div>
            <div class="font-bold text-[#181818]">${s.name} <span class="font-mono text-[10px] text-[#706E6B]">(${s.product_id})</span></div>
            <div class="text-[10px] text-[#706E6B]">Qty: <strong>${s.current_stock}</strong> • Price: ₹${Number(s.selling_price || 0).toFixed(2)} • ${s.supplier || '-'}</div>
          </div>
          <button onclick="App.hideGlobalSearchDropdown(); App.switchTab('inventory'); App.openEditStockModal('${s.product_id}')" class="px-2 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#0176D3] text-[10px] font-bold">Edit Stock</button>
        </div>
      `).join('');
    }

    // 5. Staff
    if (data.staff && data.staff.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Staff Directory (${data.staff.length})</div>`;
      html += data.staff.map(s => `
        <div class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs">
          <div>
            <div class="font-bold text-[#181818]">${s.name}</div>
            <div class="text-[10px] text-[#706E6B]">${s.role} • ${s.phone || 'No phone'} • Comm: ${s.base_commission || 20}%</div>
          </div>
          <button onclick="App.hideGlobalSearchDropdown(); App.switchTab('staff'); App.openEditStaffModal('${s.id}')" class="px-2 py-0.5 rounded bg-white border border-[#DDDBDA] text-[#0176D3] text-[10px] font-bold">Edit Staff</button>
        </div>
      `).join('');
    }

    // 6. Appointments
    if (data.appointments && data.appointments.length > 0) {
      html += `<div class="px-3 py-1.5 bg-[#F8F9FA] border-b border-[#E5E5E5] text-[10px] font-bold uppercase text-[#706E6B]">Appointments (${data.appointments.length})</div>`;
      html += data.appointments.map(a => `
        <div onclick="App.hideGlobalSearchDropdown(); App.switchTab('appointments')" class="px-3 py-2 border-b border-[#F3F3F3] hover:bg-[#EBF7FE] flex items-center justify-between gap-2 text-xs cursor-pointer">
          <div>
            <div class="font-bold text-[#181818]">${a.customer_name} • ${a.service_name}</div>
            <div class="text-[10px] text-[#706E6B]">${a.appointment_date} at ${a.appointment_time} • Stylist: ${a.staff_name}</div>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-[#EBF7FE] text-[#0176D3]">${a.status}</span>
        </div>
      `).join('');
    }

    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  globalPickProduct(prodId) {
    const prod = this.productsList.find(p => p.id === prodId);
    if (prod) {
      this.hideGlobalSearchDropdown();
      this.clearGlobalSearch();
      this.switchTab('pos');
      POS.addToCart(prod);
      SoundEngine.beep();
    }
  },

  switchTab(tabId) {
    this.currentTab = tabId;
    const tabs = ['pos', 'dashboard', 'customers', 'inventory', 'staff', 'expenses', 'appointments', 'maintenance', 'settings'];

    tabs.forEach(t => {
      const view = document.getElementById(`view-${t}`);
      const btn = document.getElementById(`nav-btn-${t}`);

      if (view) {
        if (t === tabId) {
          view.classList.remove('hidden');
        } else {
          view.classList.add('hidden');
        }
      }

      if (btn) {
        if (t === tabId) {
          btn.className = "flex items-center gap-2 px-4 py-3 text-xs font-bold text-[#0176D3] border-b-2 border-[#0176D3] bg-[#F3F3F3] transition-all whitespace-nowrap cursor-pointer";
        } else {
          btn.className = "flex items-center gap-2 px-4 py-3 text-xs font-semibold text-[#3E3E3C] hover:text-[#0176D3] hover:bg-[#F9F9FA] border-b-2 border-transparent transition-all whitespace-nowrap cursor-pointer";
        }
      }
    });

    // Update Mobile Bottom Nav active states (Android & iOS)
    const mobTabs = ['pos', 'appointments', 'dashboard', 'customers', 'staff'];
    mobTabs.forEach(mt => {
      const mobBtn = document.getElementById(`mob-tab-${mt}`);
      if (mobBtn) {
        if (mt === tabId) {
          mobBtn.className = "flex flex-col items-center justify-center py-1 px-2.5 text-[#0176D3] font-bold text-[10px] transition-colors active:scale-90";
        } else {
          mobBtn.className = "flex flex-col items-center justify-center py-1 px-2.5 text-[#706E6B] font-semibold text-[10px] transition-colors active:scale-90";
        }
      }
    });

    // Refresh specific view data on tab open
    if (tabId === 'pos') {
      this.renderPOSCategories();
      this.renderPOSProductsGrid();
      if (window.POS && typeof POS.renderCart === 'function') POS.renderCart();
    }
    if (tabId === 'dashboard') this.loadDashboardStats();
    if (tabId === 'customers') this.loadCustomers();
    if (tabId === 'inventory') this.loadInventory();
    if (tabId === 'staff') this.loadStaffPerformance();
    if (tabId === 'expenses') this.loadExpenses();
    if (tabId === 'appointments') this.loadAppointments();
    if (tabId === 'maintenance') this.loadBackups();
    if (tabId === 'settings') {
      this.populateSettingsForm();
    }

    if (window.lucide) window.lucide.createIcons();
  },

  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      this.settings = await res.json();

      // Update store name in header
      const nameEl = document.getElementById('header-store-name');
      if (nameEl && this.settings.shop?.shop_name) {
        nameEl.textContent = this.settings.shop.shop_name;
      }

      if (this.settings.tax) {
        POS.taxEnabled = this.settings.tax.enabled ?? true;
        POS.taxPercent = (this.settings.tax.cgst_percent || 9.0) + (this.settings.tax.sgst_percent || 9.0);
      }

      this.populateSettingsForm();
    } catch (e) {
      console.warn("Failed to load settings:", e);
    }
  },

  async loadDashboardStats() {
    try {
      const res = await fetch('/api/system/dashboard-stats');
      if (res.ok) {
        const stats = await res.json();
        const todaySales = typeof stats.today_sales === 'number' ? stats.today_sales : 0;
        const todayProfit = typeof stats.today_profit === 'number' ? stats.today_profit : 0;
        const monthSales = typeof stats.month_sales === 'number' ? stats.month_sales : 0;

        const s1 = document.getElementById('dash-today-sales');
        const s2 = document.getElementById('dash-today-profit');
        const s3 = document.getElementById('dash-today-bills');
        const s4 = document.getElementById('dash-low-stock');
        const s5 = document.getElementById('dash-appointments');
        const s6 = document.getElementById('dash-month-sales');

        if (s1) s1.textContent = `₹${todaySales.toFixed(2)}`;
        if (s2) s2.textContent = `₹${todayProfit.toFixed(2)}`;
        if (s3) s3.textContent = stats.today_bills_count ?? 0;
        if (s4) s4.textContent = stats.low_stock_count ?? 0;
        if (s5) s5.textContent = stats.today_appointments_count ?? 0;
        if (s6) s6.textContent = `₹${monthSales.toFixed(2)}`;
      }

      // Load bills for telemetry & recent bills table
      const billsRes = await fetch('/api/billing/bills?limit=200');
      if (billsRes.ok) {
        const allBills = await billsRes.json();
        this.dashboardBillsList = Array.isArray(allBills) ? allBills : [];
      } else {
        this.dashboardBillsList = [];
      }
      this.filterDashboardBills();

      // Render Payment Channel Split & Top Staff strictly for active period (default: today)
      await this.renderDashboardAnalytics();
    } catch (e) {
      console.warn("Error loading dashboard stats:", e);
    }
  },

  setDashboardAnalyticsPeriod(period) {
    this.dashAnalyticsPeriod = period;
    document.querySelectorAll('.dash-period-btn').forEach(btn => {
      if (btn.classList.contains(`dash-period-${period}`)) {
        btn.className = `dash-period-btn dash-period-${period} px-2 py-0.5 rounded font-bold bg-[#0176D3] text-white transition-all`;
      } else {
        const pName = btn.classList.contains('dash-period-today') ? 'today' : btn.classList.contains('dash-period-month') ? 'month' : 'all';
        btn.className = `dash-period-btn dash-period-${pName} px-2 py-0.5 rounded font-semibold text-[#3E3E3C] hover:text-[#0176D3] transition-all`;
      }
    });
    this.renderDashboardAnalytics();
  },

  async renderDashboardAnalytics() {
    const period = this.dashAnalyticsPeriod || 'today';
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayPrefix = `${yyyy}-${mm}-${dd}`;
    const monthPrefix = `${yyyy}-${mm}`;

    // Filter bills strictly for selected period
    const filteredBills = (this.dashboardBillsList || []).filter(b => {
      const created = String(b.created_at || '');
      if (period === 'today') return created.startsWith(todayPrefix);
      if (period === 'month') return created.startsWith(monthPrefix);
      return true;
    });

    // 1. Payment Mode Breakdown
    const payContainer = document.getElementById('dash-payment-breakdown-container');
    if (payContainer) {
      const modes = { 'Cash': 0, 'UPI': 0, 'Card': 0, 'Wallet': 0, 'Khata': 0 };
      let totalRev = 0;
      filteredBills.forEach(b => {
        const m = b.payment_mode || 'Cash';
        const amt = Number(b.rounded_total || 0);
        if (modes[m] !== undefined) modes[m] += amt;
        else modes[m] = amt;
        totalRev += amt;
      });

      const colors = {
        'Cash': 'bg-[#2E844A]',
        'UPI': 'bg-[#0176D3]',
        'Card': 'bg-[#8E44AD]',
        'Wallet': 'bg-[#DD7A00]',
        'Khata': 'bg-[#EA001E]'
      };

      if (totalRev === 0 && period === 'today') {
        payContainer.innerHTML = `
          <div class="py-6 text-center text-xs text-[#706E6B] space-y-2">
            <i data-lucide="wallet" class="w-7 h-7 mx-auto text-[#C9C7C5] stroke-1"></i>
            <div class="font-semibold text-[#181818]">No collections recorded today yet (₹0.00)</div>
            <div class="text-[11px]">New bills generated today will appear here live.</div>
          </div>
        `;
      } else {
        payContainer.innerHTML = Object.entries(modes).map(([mode, amt]) => {
          const pct = totalRev > 0 ? ((amt / totalRev) * 100).toFixed(0) : 0;
          return `
            <div>
              <div class="flex justify-between text-xs mb-1">
                <span class="font-semibold text-[#181818] flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full ${colors[mode] || 'bg-[#0176D3]'}"></span>
                  ${mode}
                </span>
                <span class="font-mono font-bold text-[#181818]">₹${amt.toFixed(2)} (${pct}%)</span>
              </div>
              <div class="w-full bg-[#EAEAEA] h-2 rounded-full overflow-hidden">
                <div class="h-full rounded-full ${colors[mode] || 'bg-[#0176D3]'}" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 2. Top Performing Stylists & Staff strictly for selected period
    const staffContainer = document.getElementById('dash-top-staff-container');
    if (staffContainer) {
      try {
        const perfRes = await fetch(`/api/staff/performance?period=${period}`);
        const data = await perfRes.json();
        const staffPerf = Array.isArray(data) ? data : [];
        const activeLeaders = staffPerf
          .filter(s => (s.total_services || 0) > 0 || (s.total_revenue || 0) > 0)
          .sort((a, b) => b.total_revenue - a.total_revenue);

        if (activeLeaders.length === 0) {
          const periodLabel = period === 'today' ? 'today' : period === 'month' ? 'this month' : 'yet';
          staffContainer.innerHTML = `
            <div class="py-6 text-center text-xs text-[#706E6B] space-y-2">
              <i data-lucide="award" class="w-7 h-7 mx-auto text-[#C9C7C5] stroke-1"></i>
              <div class="font-semibold text-[#181818]">No services billed ${periodLabel} yet.</div>
              <div class="text-[11px]">Create a POS bill to see live stylist rankings${period === 'today' ? ', or switch to Month / All.' : '.'}</div>
              ${period === 'today' ? `<button onclick="App.setDashboardAnalyticsPeriod('month')" class="mt-1 px-2.5 py-1 rounded bg-[#EBF7FE] hover:bg-[#0176D3] text-[#0176D3] hover:text-white border border-[#C5E8FC] text-[11px] font-bold transition-all">View This Month's Leaders</button>` : ''}
            </div>
          `;
        } else {
          const maxRev = Math.max(...activeLeaders.map(s => s.total_revenue || 1));
          const rankStyles = [
            'bg-[#DD7A00] text-white',
            'bg-[#706E6B] text-white',
            'bg-[#A46628] text-white',
            'bg-[#0176D3] text-white'
          ];

          staffContainer.innerHTML = activeLeaders.slice(0, 5).map((s, idx) => {
            const barPct = Math.max(8, Math.round((s.total_revenue / maxRev) * 100));
            return `
              <div class="p-2.5 rounded bg-[#F8F9FA] border border-[#DDDBDA] space-y-1.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <span class="w-6 h-6 rounded-full ${rankStyles[idx] || rankStyles[3]} font-bold text-xs flex items-center justify-center shadow-sm">
                      #${idx + 1}
                    </span>
                    <div>
                      <div class="font-bold text-xs text-[#181818]">${s.name}</div>
                      <div class="text-[10px] text-[#706E6B]">${s.role} • <strong>${s.total_services}</strong> ${s.total_services === 1 ? 'service' : 'services'}</div>
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="font-bold font-mono text-xs text-[#2E844A]">₹${Number(s.total_revenue || 0).toFixed(0)}</div>
                    <div class="text-[10px] font-mono text-[#DD7A00]">Comm: ₹${Number(s.total_commission || 0).toFixed(0)}</div>
                  </div>
                </div>
                <div class="w-full bg-[#E5E5E5] h-1.5 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-[#0176D3]" style="width: ${barPct}%"></div>
                </div>
              </div>
            `;
          }).join('');
        }
      } catch (e) {
        console.warn("Failed to load top staff analytics:", e);
      }
    }

    if (window.lucide) window.lucide.createIcons();
  },

  filterDashboardBills() {
    const billsTable = document.getElementById('dash-recent-bills-table');
    if (!billsTable) return;

    const q = (document.getElementById('dash-bills-search')?.value || '').toLowerCase().trim();
    const list = (this.dashboardBillsList || []).filter(b => {
      if (!q) return true;
      return (
        String(b.invoice_number || '').toLowerCase().includes(q) ||
        String(b.customer?.name || '').toLowerCase().includes(q) ||
        String(b.customer?.phone || '').toLowerCase().includes(q) ||
        String(b.payment_mode || '').toLowerCase().includes(q)
      );
    }).slice(0, 20);

    if (list.length === 0) {
      billsTable.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-[#706E6B]">No matching invoices found.</td></tr>`;
    } else {
      billsTable.innerHTML = list.map(b => `
        <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB] text-xs text-[#181818]">
          <td class="py-2.5 px-4 font-mono font-bold text-[#0176D3]">${b.invoice_number}</td>
          <td class="py-2.5 px-4 text-[#706E6B]">${b.created_at_display || b.created_at?.slice(0, 16)}</td>
          <td class="py-2.5 px-4 font-semibold text-[#181818]">${b.customer?.name || 'Walk-in'}</td>
          <td class="py-2.5 px-4">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold ${b.payment_mode === 'Cash' ? 'bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]' : 'bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC]'}">
              ${b.payment_mode}
            </span>
          </td>
          <td class="py-2.5 px-4 font-mono font-bold text-[#181818]">₹${Number(b.rounded_total || 0).toFixed(2)}</td>
          <td class="py-2.5 px-4 text-right">
            <button onclick="App.reprintBill('${b.invoice_number}')" class="text-[#0176D3] hover:text-[#014486] p-1" title="Reprint Thermal Receipt">
              <i data-lucide="printer" class="w-4 h-4"></i>
            </button>
          </td>
        </tr>
      `).join('');
    }
    if (window.lucide) window.lucide.createIcons();
  },

  async loadProducts() {
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      this.productsList = Array.isArray(data) ? data : [];
      this.renderPOSCategories();
      this.renderPOSProductsGrid();
    } catch (e) {
      console.warn("Failed to load products:", e);
      this.productsList = [];
      this.renderPOSCategories();
      this.renderPOSProductsGrid();
    }
  },

  renderPOSCategories() {
    const list = Array.isArray(this.productsList) ? this.productsList : [];
    const categories = ['All', ...new Set(list.map(p => p.category).filter(Boolean))];
    const container = document.getElementById('pos-categories-container');
    if (!container) return;

    container.innerHTML = categories.map(cat => `
      <button onclick="App.filterPOSCategory('${cat}')" class="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${POS.activeCategory === cat ? 'bg-[#0176D3] text-white shadow-sm' : 'bg-white text-[#3E3E3C] hover:bg-[#F3F3F3] hover:text-[#0176D3] border border-[#DDDBDA]'}">
        ${cat}
      </button>
    `).join('');
  },

  filterPOSCategory(category) {
    POS.activeCategory = category;
    this.renderPOSCategories();
    this.renderPOSProductsGrid();
  },

  filterPOSType(type) {
    this.posTypeFilter = type;
    ['all', 'service', 'product'].forEach(t => {
      const btn = document.getElementById(`pos-type-${t}`);
      if (btn) {
        if (t === type) {
          btn.className = "px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#0176D3] text-white transition-all";
        } else {
          btn.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-[#3E3E3C] hover:text-[#0176D3] transition-all";
        }
      }
    });
    this.renderPOSProductsGrid();
  },

  resetPOSFilters() {
    POS.activeCategory = 'All';
    POS.searchQuery = '';
    this.posTypeFilter = 'all';
    this.posSortBy = 'default';
    const searchInput = document.getElementById('pos-search-input');
    const sortSelect = document.getElementById('pos-sort-select');
    if (searchInput) searchInput.value = '';
    if (sortSelect) sortSelect.value = 'default';
    this.filterPOSType('all');
    this.renderPOSCategories();
    this.renderPOSProductsGrid();
  },

  handlePOSSearchKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = (POS.searchQuery || '').toLowerCase().trim();
    if (!q) return;

    // 1. Exact barcode or ID match first
    const exact = this.productsList.find(p =>
      String(p.barcode || '').toLowerCase() === q ||
      String(p.id || '').toLowerCase() === q
    );
    if (exact) {
      POS.addToCart(exact);
      POS.searchQuery = '';
      e.target.value = '';
      this.renderPOSProductsGrid();
      return;
    }

    // 2. Single filtered match quick-add
    const filtered = this._getFilteredPOSProducts();
    if (filtered.length === 1) {
      POS.addToCart(filtered[0]);
      POS.searchQuery = '';
      e.target.value = '';
      this.renderPOSProductsGrid();
    }
  },

  openCustomItemModal() {
    document.getElementById('custom-item-name').value = '';
    document.getElementById('custom-item-price').value = '';
    document.getElementById('custom-item-qty').value = '1';
    document.getElementById('custom-item-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('custom-item-name')?.focus(), 50);
    if (window.lucide) window.lucide.createIcons();
  },

  submitCustomItem() {
    const name = document.getElementById('custom-item-name').value.trim();
    const price = parseFloat(document.getElementById('custom-item-price').value);
    const qty = parseInt(document.getElementById('custom-item-qty').value) || 1;

    if (!name || isNaN(price) || price <= 0) {
      alert("Please enter a valid item name and price.");
      return;
    }

    const customProd = {
      id: `CUSTOM-${Date.now().toString().slice(-5)}`,
      name,
      category: 'Custom',
      type: 'service',
      price,
      commission_percent: 0.0
    };

    for (let i = 0; i < qty; i++) {
      POS.addToCart(customProd);
    }
    document.getElementById('custom-item-modal').classList.add('hidden');
  },

  _getFilteredPOSProducts() {
    const query = (POS.searchQuery || '').toLowerCase().trim();
    const typeFilter = this.posTypeFilter || 'all';
    const sortBy = this.posSortBy || 'default';

    const list = Array.isArray(this.productsList) ? this.productsList : [];
    let filtered = list.filter(p => {
      const matchCat = POS.activeCategory === 'All' || p.category === POS.activeCategory;
      const matchType = typeFilter === 'all' || (p.type || 'service') === typeFilter;
      const matchQuery = !query ||
        String(p.name || '').toLowerCase().includes(query) ||
        String(p.category || '').toLowerCase().includes(query) ||
        String(p.barcode || '').toLowerCase().includes(query) ||
        String(p.id || '').toLowerCase().includes(query) ||
        String(p.price || '').includes(query);
      return matchCat && matchType && matchQuery;
    });

    if (sortBy === 'price-asc') {
      filtered = [...filtered].sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (sortBy === 'price-desc') {
      filtered = [...filtered].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (sortBy === 'name-asc') {
      filtered = [...filtered].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }

    return filtered;
  },

  renderPOSProductsGrid() {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;

    const filtered = this._getFilteredPOSProducts();
    const countBadge = document.getElementById('pos-products-count-badge');
    if (countBadge) countBadge.textContent = `${filtered.length} items`;
    const mobCatBadge = document.getElementById('pos-mob-catalog-badge');
    if (mobCatBadge) mobCatBadge.textContent = filtered.length;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="col-span-full py-12 text-center text-[#706E6B] flex flex-col items-center justify-center gap-2.5">
          <i data-lucide="package-search" class="w-10 h-10 stroke-1 text-[#C9C7C5]"></i>
          <div class="text-xs font-semibold text-[#181818]">No products or services found.</div>
          <div class="text-[11px] text-[#706E6B]">Try clearing filters or add a new item directly to your catalog.</div>
          <div class="flex items-center gap-2 mt-1">
            <button onclick="App.resetPOSFilters()" class="px-3 py-1.5 rounded bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] text-xs font-semibold transition-all">
              Reset Filters
            </button>
            <button onclick="App.openAddProductModal()" class="px-3 py-1.5 rounded bg-[#0176D3] hover:bg-[#014486] text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-all">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add New Product / Service
            </button>
          </div>
        </div>
      `;
    } else {
      // Build cart quantity lookup for live in-cart badges
      const cartQtyMap = {};
      (POS.cart || []).forEach(ci => {
        cartQtyMap[ci.id] = (cartQtyMap[ci.id] || 0) + (ci.quantity || 1);
      });

      grid.innerHTML = filtered.map(p => {
        const inCartQty = cartQtyMap[p.id] || 0;
        const hasStockInfo = p.type === 'product' && p.current_stock !== undefined && p.current_stock !== null;
        const isOut = hasStockInfo && p.current_stock <= 0;
        const stockBadge = hasStockInfo
          ? (isOut
              ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4]">Out of Stock</span>`
              : p.is_low_stock
                ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FFF4E8] text-[#DD7A00] border border-[#FFD599]">Low: ${p.current_stock}</span>`
                : `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]">${p.current_stock} left</span>`)
          : (p.duration_mins ? `<span class="text-[10px] text-[#706E6B] flex items-center gap-0.5"><i data-lucide="clock" class="w-3 h-3 text-[#706E6B]"></i> ${p.duration_mins}m</span>` : '');

        return `
        <div onclick="App.quickAddPOSProduct('${p.id}')" 
             class="relative bg-white border ${inCartQty > 0 ? 'border-[#0176D3] ring-1 ring-[#0176D3]/30 bg-[#F8FCFF]' : 'border-[#DDDBDA]'} hover:border-[#0176D3] hover:shadow-md rounded p-3 cursor-pointer flex flex-col justify-between transition-all group slds-card-hover ${isOut ? 'opacity-70' : ''}">
          ${inCartQty > 0 ? `<span class="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-[#0176D3] text-white text-[10px] font-extrabold font-mono shadow-md">${inCartQty} in cart</span>` : ''}
          <div>
            <div class="flex items-center justify-between gap-1 mb-1.5">
              <span class="text-[10px] font-bold px-2 py-0.5 rounded truncate max-w-[65%] ${p.type === 'product' ? 'bg-[#FFF4E8] text-[#DD7A00] border border-[#FFD599]' : 'bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC]'}">
                ${p.category}
              </span>
              ${stockBadge}
            </div>
            <h4 class="font-bold text-[#181818] text-xs group-hover:text-[#0176D3] transition-colors line-clamp-2">${p.name}</h4>
          </div>

          <div class="flex items-center justify-between mt-3 pt-2 border-t border-[#F3F3F3]">
            <span class="text-sm font-extrabold text-[#0176D3] font-mono">₹${Number(p.price || 0).toFixed(2)}</span>
            <div class="flex items-center gap-1">
              <button onclick="event.stopPropagation(); App.openEditProductModal('${p.id}')" class="opacity-0 group-hover:opacity-100 w-6 h-6 rounded bg-[#F3F3F3] hover:bg-[#DDDBDA] text-[#3E3E3C] flex items-center justify-center transition-all" title="Quick Edit Price / Name">
                <i data-lucide="edit-3" class="w-3 h-3"></i>
              </button>
              <span class="w-6 h-6 rounded ${inCartQty > 0 ? 'bg-[#0176D3] text-white' : 'bg-[#EBF7FE] text-[#0176D3] group-hover:bg-[#0176D3] group-hover:text-white'} flex items-center justify-center transition-all">
                <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              </span>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    if (window.lucide) window.lucide.createIcons();
  },

  quickAddPOSProduct(prodId) {
    const prod = this.productsList.find(p => p.id === prodId);
    if (!prod) return;
    if (prod.type === 'product' && prod.current_stock !== undefined && prod.current_stock <= 0) {
      if (!confirm(`"${prod.name}" is currently Out of Stock (0 left). Still add to bill?`)) return;
    }
    POS.addToCart(prod);
  },

  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      const data = await res.json();
      this.customersList = Array.isArray(data) ? data : [];

      // Update Customer Stats
      const totalAccounts = this.customersList.length;
      let totalPoints = 0;
      let totalWallet = 0;
      let totalKhata = 0;

      this.customersList.forEach(c => {
        totalPoints += c.loyalty_points || 0;
        totalWallet += c.wallet_balance || 0;
        totalKhata += c.khata_balance || 0;
      });

      const totalEl = document.getElementById('cust-stat-total');
      const pointsEl = document.getElementById('cust-stat-points');
      const walletEl = document.getElementById('cust-stat-wallet');
      const khataEl = document.getElementById('cust-stat-khata');

      if (totalEl) totalEl.textContent = totalAccounts;
      if (pointsEl) pointsEl.textContent = `${totalPoints} pts`;
      if (walletEl) walletEl.textContent = `₹${totalWallet.toFixed(2)}`;
      if (khataEl) khataEl.textContent = `₹${totalKhata.toFixed(2)}`;

      this.renderCustomersTable();
    } catch (e) {
      console.warn("Failed to load customers:", e);
      this.customersList = [];
    }
  },

  filterCustomerTier(tier) {
    this.customerTierFilter = tier;
    ['All', 'Regular', 'Silver', 'Gold', 'Platinum'].forEach(t => {
      const btn = document.getElementById(`cust-tier-filter-${t}`);
      if (btn) {
        if ((t === 'Platinum' && tier === 'Platinum VIP') || t === tier) {
          btn.className = "px-2.5 py-1 rounded text-xs font-bold bg-[#0176D3] text-white transition-all";
        } else {
          btn.className = "px-2.5 py-1 rounded text-xs font-semibold bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] transition-all";
        }
      }
    });
    this.renderCustomersTable();
  },

  filterCustomers() {
    this.renderCustomersTable();
  },

  renderCustomersTable() {
    const table = document.getElementById('customers-table-body');
    if (!table) return;

    const query = (document.getElementById('customers-search-input')?.value || '').toLowerCase().trim();
    const tier = this.customerTierFilter || 'All';

    const filtered = this.customersList.filter(c => {
      const matchQuery = !query || c.name.toLowerCase().includes(query) || c.phone.includes(query);
      const matchTier = tier === 'All' || c.membership_tier === tier;
      return matchQuery && matchTier;
    });

    if (filtered.length === 0) {
      table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-[#706E6B]">No matching customer accounts found.</td></tr>`;
      return;
    }

    table.innerHTML = filtered.map(c => `
      <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB] text-xs text-[#181818]">
        <td class="py-2.5 px-4 font-bold text-[#181818] flex items-center gap-2">
          <div class="w-6 h-6 rounded-full bg-[#0176D3]/10 text-[#0176D3] font-bold text-[10px] flex items-center justify-center">
            ${c.name.slice(0, 2).toUpperCase()}
          </div>
          <span>${c.name}</span>
        </td>
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${c.phone}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${c.membership_tier === 'Platinum VIP' ? 'bg-[#FFF4E8] text-[#8C4B00] border border-[#FE9339]' : c.membership_tier === 'Gold' ? 'bg-[#FEFBE8] text-[#713F12] border border-[#FDE047]' : 'bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC]'}">
            ${c.membership_tier || 'Regular'}
          </span>
        </td>
        <td class="py-2.5 px-4 font-mono text-[#DD7A00] font-bold">${c.loyalty_points || 0} pts</td>
        <td class="py-2.5 px-4 font-mono text-[#2E844A] font-bold">₹${(c.wallet_balance || 0).toFixed(2)}</td>
        <td class="py-2.5 px-4 font-mono text-[#EA001E] font-bold">₹${(c.khata_balance || 0).toFixed(2)}</td>
        <td class="py-2.5 px-4 text-right flex items-center justify-end gap-1.5 flex-wrap">
          <button onclick="App.openEditCustomerModal('${c.id}')" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#181818] border border-[#DDDBDA] transition-all text-[11px] font-semibold flex items-center gap-1" title="Edit Customer">
            <i data-lucide="edit-3" class="w-3 h-3 text-[#0176D3]"></i> Edit
          </button>
          <button onclick="App.openWalletRechargeModal('${c.id}', '${c.name.replace(/'/g, "\\'")}', ${c.wallet_balance || 0})" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#0176D3] border border-[#DDDBDA] transition-all text-[11px] font-semibold">
            + Recharge
          </button>
          <button onclick="App.openKhataModal('${c.id}', '${c.name.replace(/'/g, "\\'")}', ${c.khata_balance || 0})" class="px-2 py-1 rounded bg-white hover:bg-[#FFF4E8] text-[#DD7A00] border border-[#DDDBDA] transition-all text-[11px] font-semibold">
            Settle Khata
          </button>
          <button onclick="App.selectCustomerForPOS('${c.id}')" class="px-2.5 py-1 rounded bg-[#0176D3] hover:bg-[#014486] text-white transition-all text-[11px] font-bold">
            Bill
          </button>
          <button onclick="App.deleteCustomer('${c.id}')" class="p-1 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA] transition-all" title="Delete Customer">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
  },

  selectCustomerForPOS(custId) {
    const cust = this.customersList.find(c => c.id === custId);
    if (cust) {
      POS.selectCustomer(cust);
      this.switchTab('pos');
      SoundEngine.beep();
    }
  },

  async loadStaff() {
    try {
      const res = await fetch('/api/staff');
      const data = await res.json();
      this.staffList = Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn("Failed to load staff:", e);
      this.staffList = [];
    }
  },

  async loadStaffPerformance() {
    try {
      const res = await fetch('/api/staff/performance');
      const data = await res.json();
      const perf = Array.isArray(data) ? data : [];
      this.staffPerfList = perf;

      // Update Staff Metric Banner
      const totalStaff = perf.length;
      let totalSrv = 0;
      let totalSales = 0;
      let totalComm = 0;

      perf.forEach(s => {
        totalSrv += s.total_services || 0;
        totalSales += s.total_revenue || 0;
        totalComm += s.total_commission || 0;
      });

      const totalEl = document.getElementById('staff-stat-total');
      const srvEl = document.getElementById('staff-stat-services');
      const salesEl = document.getElementById('staff-stat-sales');
      const commEl = document.getElementById('staff-stat-comm');

      if (totalEl) totalEl.textContent = totalStaff;
      if (srvEl) srvEl.textContent = totalSrv;
      if (salesEl) salesEl.textContent = `₹${totalSales.toFixed(0)}`;
      if (commEl) commEl.textContent = `₹${totalComm.toFixed(0)}`;

      this.renderStaffCards();
    } catch (e) {
      console.warn("Failed to load staff performance:", e);
      this.staffPerfList = [];
      this.renderStaffCards();
    }
  },

  filterStaff() {
    this.renderStaffCards();
  },

  toggleStaffLoginFields() {
    const chk = document.getElementById('new-staff-enable-login');
    const fields = document.getElementById('staff-login-fields');
    if (!fields) return;
    if (chk && chk.checked) {
      fields.classList.remove('hidden');
    } else {
      fields.classList.add('hidden');
    }
  },

  renderStaffCards() {
    const container = document.getElementById('staff-cards-grid');
    if (!container) return;

    const q = (document.getElementById('staff-search-input')?.value || '').toLowerCase().trim();
    const list = (this.staffPerfList || []).filter(s => {
      if (!q) return true;
      return (
        String(s.id || '').toLowerCase().includes(q) ||
        String(s.user_id || '').toLowerCase().includes(q) ||
        String(s.name || '').toLowerCase().includes(q) ||
        String(s.role || '').toLowerCase().includes(q) ||
        String(s.phone || '').toLowerCase().includes(q) ||
        String(s.email || '').toLowerCase().includes(q)
      );
    });

    if (list.length === 0) {
      container.innerHTML = `<div class="col-span-full bg-white border border-[#DDDBDA] rounded p-8 text-center text-xs text-[#706E6B]">No staff members match your search.</div>`;
      return;
    }

    container.innerHTML = list.map(s => `
      <div class="bg-white border border-[#DDDBDA] rounded p-4 shadow-sm slds-card-hover flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded bg-[#0176D3] text-white font-bold flex items-center justify-center text-sm shadow-sm shrink-0">
                ${s.name.slice(0, 2).toUpperCase()}
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <h4 class="font-bold text-[#181818] text-sm">${s.name}</h4>
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#F3F3F3] text-[#0176D3] border border-[#DDDBDA]">${s.id}</span>
                  <span class="px-1.5 py-0.2 rounded text-[9px] font-bold ${s.active === false ? 'bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4]' : 'bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]'}">${s.active === false ? 'Inactive' : 'Active'}</span>
                  ${s.has_login ? `<span class="px-1.5 py-0.2 rounded text-[9px] uppercase font-bold bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC] flex items-center gap-0.5"><i data-lucide="shield-check" class="w-2.5 h-2.5"></i> ${s.login_role || 'login'}</span>` : ''}
                </div>
                <span class="text-xs text-[#0176D3] font-semibold block">${s.role}</span>
                <div class="text-[11px] text-[#706E6B] font-mono mt-0.5 flex items-center gap-1.5 truncate">
                  <i data-lucide="mail" class="w-3 h-3 text-[#0176D3] shrink-0"></i>
                  <span class="truncate">${s.email || 'No Gmail configured'}</span>
                </div>
                <div class="text-[11px] text-[#706E6B] font-mono mt-0.5">${s.phone || 'No phone'} • Comm: <strong>${s.base_commission ?? 20}%</strong></div>
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button onclick="App.openStaffPasswordResetModal('${s.id}')" class="px-2 py-1 rounded bg-white hover:bg-[#FFF4E8] text-[#DD7A00] border border-[#DDDBDA] text-[11px] font-semibold flex items-center gap-1 transition-all" title="Reset Staff Password">
                <i data-lucide="key-round" class="w-3 h-3"></i> Pass
              </button>
              <button onclick="App.openEditStaffModal('${s.id}')" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#0176D3] border border-[#DDDBDA] text-[11px] font-semibold flex items-center gap-1 transition-all" title="Edit Staff Member">
                <i data-lucide="edit-3" class="w-3 h-3"></i> Edit
              </button>
              <button onclick="App.deleteStaff('${s.id}')" class="p-1 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA] transition-all" title="Delete Staff">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 pt-3 border-t border-[#F3F3F3] text-center">
          <div class="bg-[#F9FAFB] p-2 rounded border border-[#E5E5E5]">
            <div class="text-[10px] text-[#706E6B] uppercase font-bold">Services</div>
            <div class="text-xs font-bold font-mono text-[#181818]">${s.total_services}</div>
          </div>
          <div class="bg-[#F9FAFB] p-2 rounded border border-[#E5E5E5]">
            <div class="text-[10px] text-[#706E6B] uppercase font-bold">Sales</div>
            <div class="text-xs font-bold font-mono text-[#0176D3]">₹${s.total_revenue.toFixed(0)}</div>
          </div>
          <div class="bg-[#F9FAFB] p-2 rounded border border-[#E5E5E5]">
            <div class="text-[10px] text-[#706E6B] uppercase font-bold">Comm.</div>
            <div class="text-xs font-bold font-mono text-[#2E844A]">₹${s.total_commission.toFixed(0)}</div>
          </div>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
  },

  openAddStaffModal() {
    this.editingStaffId = null;
    document.getElementById('staff-modal-title').innerHTML = `<i data-lucide="user-plus" class="w-4 h-4 text-[#0176D3]"></i> Add Staff Team Member`;
    document.getElementById('staff-modal-submit-btn').textContent = 'Save Staff Member';
    document.getElementById('new-staff-name').value = '';
    document.getElementById('new-staff-role').value = '';
    document.getElementById('new-staff-phone').value = '';
    document.getElementById('new-staff-email').value = '';
    document.getElementById('new-staff-comm').value = '20.0';
    document.getElementById('new-staff-active').checked = true;

    const chkLogin = document.getElementById('new-staff-enable-login');
    if (chkLogin) chkLogin.checked = false;
    document.getElementById('staff-login-fields')?.classList.add('hidden');
    const passInput = document.getElementById('new-staff-login-password');
    if (passInput) passInput.value = '';

    document.getElementById('add-staff-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  openEditStaffModal(staffId) {
    const member = this.staffList.find(s => s.id === staffId) || this.staffPerfList.find(s => s.id === staffId);
    if (!member) return;
    this.editingStaffId = staffId;
    document.getElementById('staff-modal-title').innerHTML = `<i data-lucide="edit-3" class="w-4 h-4 text-[#0176D3]"></i> Edit Staff Member (${staffId})`;
    document.getElementById('staff-modal-submit-btn').textContent = 'Update Staff Member';
    document.getElementById('new-staff-name').value = member.name || '';
    document.getElementById('new-staff-role').value = member.role || '';
    document.getElementById('new-staff-phone').value = member.phone || '';
    document.getElementById('new-staff-email').value = member.email || '';
    document.getElementById('new-staff-comm').value = member.base_commission ?? 20.0;
    document.getElementById('new-staff-active').checked = member.active !== false;

    const chkLogin = document.getElementById('new-staff-enable-login');
    if (chkLogin) chkLogin.checked = Boolean(member.has_login);
    if (member.has_login) {
      document.getElementById('staff-login-fields')?.classList.remove('hidden');
      if (document.getElementById('new-staff-login-role') && member.login_role) {
        document.getElementById('new-staff-login-role').value = member.login_role;
      }
    } else {
      document.getElementById('staff-login-fields')?.classList.add('hidden');
    }

    document.getElementById('add-staff-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  async submitAddStaff() {
    const name = document.getElementById('new-staff-name').value.trim();
    const role = document.getElementById('new-staff-role').value.trim();
    const phone = document.getElementById('new-staff-phone').value.trim();
    const email = document.getElementById('new-staff-email')?.value.trim().toLowerCase() || '';
    const comm = parseFloat(document.getElementById('new-staff-comm').value) || 20.0;
    const active = document.getElementById('new-staff-active')?.checked ?? true;
    const enable_login = document.getElementById('new-staff-enable-login')?.checked ?? false;
    const login_role = document.getElementById('new-staff-login-role')?.value || 'cashier';
    const login_password = document.getElementById('new-staff-login-password')?.value.trim() || null;

    if (!name || !role) {
      alert("Please provide Staff Name and Role");
      return;
    }

    if (enable_login && (!email || !email.endsWith('@gmail.com'))) {
      alert("To enable POS Login, please provide a valid verified @gmail.com address.");
      return;
    }

    const isEdit = Boolean(this.editingStaffId);
    const url = isEdit ? `/api/staff/${this.editingStaffId}` : '/api/staff';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          role,
          phone,
          email,
          base_commission: comm,
          active,
          enable_login,
          login_role,
          login_password
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save staff member");
      }

      document.getElementById('add-staff-modal').classList.add('hidden');
      this.editingStaffId = null;
      SoundEngine.success();
      await this.loadStaff();
      await this.loadStaffPerformance();
    } catch (e) {
      alert(e.message);
    }
  },

  openStaffPasswordResetModal(staffId) {
    const member = this.staffList.find(s => s.id === staffId) || this.staffPerfList.find(s => s.id === staffId);
    if (!member) return;
    if (!member.email || !member.email.endsWith('@gmail.com')) {
      alert(`Staff member ${member.name} does not have a Gmail address configured. Click "Edit" and add a Gmail address first.`);
      return;
    }

    this.currentStaffResetId = staffId;
    const nameEl = document.getElementById('staff-reset-modal-name');
    const emailEl = document.getElementById('staff-reset-modal-email');
    const passInput = document.getElementById('staff-reset-modal-password');

    if (nameEl) nameEl.textContent = member.name;
    if (emailEl) emailEl.textContent = member.email;
    if (passInput) passInput.value = '';

    document.getElementById('staff-reset-password-modal')?.classList.remove('hidden');
    setTimeout(() => passInput?.focus(), 60);
    if (window.lucide) window.lucide.createIcons();
  },

  async submitStaffPasswordReset() {
    if (!this.currentStaffResetId) return;
    const passInput = document.getElementById('staff-reset-modal-password');
    const new_password = (passInput?.value || '').trim();

    if (new_password.length < 6) {
      alert('Password must be at least 6 characters long.');
      passInput?.focus();
      return;
    }

    const btn = document.getElementById('staff-reset-modal-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Updating Password...';
    }

    try {
      const res = await fetch(`/api/staff/${this.currentStaffResetId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed to reset staff password.');

      SoundEngine.success();
      alert('✅ ' + data.message);
      document.getElementById('staff-reset-password-modal')?.classList.add('hidden');
      this.currentStaffResetId = null;
      await this.loadStaffPerformance();
    } catch (e) {
      alert('❌ ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Update Staff Password';
      }
    }
  },

  async deleteStaff(staffId) {
    if (!confirm("Are you sure you want to delete this staff member?")) return;
    try {
      const res = await fetch(`/api/staff/${staffId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete staff member");
      SoundEngine.beep();
      await this.loadStaff();
      await this.loadStaffPerformance();
    } catch (e) {
      alert(e.message);
    }
  },

  async loadInventory() {
    try {
      const res = await fetch('/api/inventory/stock');
      const data = await res.json();
      this.stockList = Array.isArray(data) ? data : [];

      // Update Catalog Metric Banner
      const totalSKUs = this.stockList.length;
      let totalVal = 0;
      let lowCount = 0;

      this.stockList.forEach(s => {
        totalVal += (s.current_stock || 0) * (s.selling_price || 0);
        if (s.is_low_stock) lowCount++;
      });

      const prodList = Array.isArray(this.productsList) ? this.productsList : [];
      const totalItems = prodList.length;
      const serviceCount = prodList.filter(p => p.type === 'service').length;

      const totalEl = document.getElementById('inv-stat-total');
      const valEl = document.getElementById('inv-stat-value');
      const lowEl = document.getElementById('inv-stat-low');
      const srvEl = document.getElementById('inv-stat-services');

      if (totalEl) totalEl.textContent = totalItems || totalSKUs;
      if (valEl) valEl.textContent = `₹${totalVal.toFixed(2)}`;
      if (lowEl) lowEl.textContent = lowCount;
      if (srvEl) srvEl.textContent = serviceCount;

      // Populate Category Filter dropdown (preserve current selection)
      const catSelect = document.getElementById('inventory-cat-filter');
      if (catSelect) {
        const currentVal = catSelect.value || 'All';
        const cats = ['All', ...new Set(prodList.map(p => p.category).filter(Boolean))];
        catSelect.innerHTML = cats.map(c => `<option value="${c}">${c === 'All' ? 'All Categories' : c}</option>`).join('');
        if (cats.includes(currentVal)) catSelect.value = currentVal;
      }

      this.renderInventoryTable();
      this.renderCatalogTable();
    } catch (e) {
      console.warn("Failed to load inventory:", e);
      this.stockList = [];
    }
  },

  switchInventorySubTab(tab) {
    this.inventorySubTab = tab;
    const btnStock = document.getElementById('inv-subtab-stock');
    const btnCatalog = document.getElementById('inv-subtab-catalog');
    const stockCard = document.getElementById('inventory-stock-card');
    const catalogCard = document.getElementById('inventory-catalog-card');
    const lowStockLabel = document.getElementById('inventory-low-stock-label');

    if (tab === 'stock') {
      if (btnStock) btnStock.className = "px-3 py-1.5 rounded text-xs font-bold bg-[#0176D3] text-white transition-all whitespace-nowrap";
      if (btnCatalog) btnCatalog.className = "px-3 py-1.5 rounded text-xs font-semibold bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] transition-all whitespace-nowrap";
      if (stockCard) stockCard.classList.remove('hidden');
      if (catalogCard) catalogCard.classList.add('hidden');
      if (lowStockLabel) lowStockLabel.classList.remove('hidden');
    } else {
      if (btnCatalog) btnCatalog.className = "px-3 py-1.5 rounded text-xs font-bold bg-[#0176D3] text-white transition-all whitespace-nowrap";
      if (btnStock) btnStock.className = "px-3 py-1.5 rounded text-xs font-semibold bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] transition-all whitespace-nowrap";
      if (catalogCard) catalogCard.classList.remove('hidden');
      if (stockCard) stockCard.classList.add('hidden');
      if (lowStockLabel) lowStockLabel.classList.add('hidden');
    }
    this.filterInventory();
  },

  filterInventory() {
    this.renderInventoryTable();
    this.renderCatalogTable();
  },

  renderInventoryTable() {
    const table = document.getElementById('inventory-table-body');
    if (!table) return;

    const query = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('inventory-cat-filter')?.value || 'All';
    const lowOnly = document.getElementById('inventory-low-stock-toggle')?.checked || false;

    const filtered = this.stockList.filter(s => {
      const matchQuery = !query ||
        s.name.toLowerCase().includes(query) ||
        (s.product_id && s.product_id.toLowerCase().includes(query)) ||
        (s.supplier && s.supplier.toLowerCase().includes(query));
      const prodObj = this.productsList.find(p => p.id === s.product_id);
      const matchCat = cat === 'All' || (prodObj && prodObj.category === cat);
      const matchLow = !lowOnly || s.is_low_stock;
      return matchQuery && matchCat && matchLow;
    });

    if (filtered.length === 0) {
      table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-[#706E6B]">No physical stock items matching criteria.</td></tr>`;
      return;
    }

    table.innerHTML = filtered.map(s => `
      <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB] text-xs text-[#181818]">
        <td class="py-2.5 px-4 font-bold text-[#181818]">${s.name}</td>
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${s.product_id}</td>
        <td class="py-2.5 px-4 font-mono">
          <span class="px-2 py-0.5 rounded text-[11px] font-bold ${s.is_low_stock ? 'bg-[#FDF3F2] text-[#EA001E] border border-[#F9C6C4]' : 'bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]'}">
            ${s.current_stock} in stock
          </span>
        </td>
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${s.min_alert_level}</td>
        <td class="py-2.5 px-4 font-mono">
          <span class="text-[#706E6B]">₹${Number(s.cost_price || 0).toFixed(0)}</span> / <strong class="text-[#181818]">₹${Number(s.selling_price || 0).toFixed(2)}</strong>
        </td>
        <td class="py-2.5 px-4 text-[#706E6B]">${s.supplier || '-'}</td>
        <td class="py-2.5 px-4 text-right flex items-center justify-end gap-1.5">
          <button onclick="App.openEditStockModal('${s.product_id}')" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#181818] border border-[#DDDBDA] transition-all text-[11px] font-semibold flex items-center gap-1" title="Edit Stock Details">
            <i data-lucide="edit-3" class="w-3 h-3 text-[#0176D3]"></i> Edit
          </button>
          <button onclick="App.openAdjustStockModal('${s.product_id}', '${s.name.replace(/'/g, "\\'")}', ${s.current_stock})" class="px-2 py-1 rounded bg-[#EBF7FE] hover:bg-[#0176D3] text-[#0176D3] hover:text-white border border-[#C5E8FC] transition-all text-[11px] font-semibold">
            ± Qty
          </button>
          <button onclick="App.deleteStockItem('${s.product_id}')" class="p-1 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA] transition-all" title="Delete Stock Entry">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
  },

  renderCatalogTable() {
    const table = document.getElementById('catalog-table-body');
    if (!table) return;

    const query = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();
    const cat = document.getElementById('inventory-cat-filter')?.value || 'All';

    const filtered = this.productsList.filter(p => {
      const matchQuery = !query ||
        p.name.toLowerCase().includes(query) ||
        (p.id && p.id.toLowerCase().includes(query)) ||
        (p.barcode && p.barcode.toLowerCase().includes(query)) ||
        (p.category && p.category.toLowerCase().includes(query));
      const matchCat = cat === 'All' || p.category === cat;
      return matchQuery && matchCat;
    });

    if (filtered.length === 0) {
      table.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-[#706E6B]">No products or services matching criteria.</td></tr>`;
      return;
    }

    table.innerHTML = filtered.map(p => `
      <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB] text-xs text-[#181818]">
        <td class="py-2.5 px-4 font-bold text-[#181818]">${p.name}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.type === 'product' ? 'bg-[#FFF4E8] text-[#DD7A00] border border-[#FFD599]' : 'bg-[#EBF7FE] text-[#0176D3] border border-[#C5E8FC]'}">
            ${p.category} • ${p.type === 'product' ? 'Product' : 'Service'}
          </span>
        </td>
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${p.barcode || p.id}</td>
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${p.duration_mins ? `${p.duration_mins}m` : '-'}</td>
        <td class="py-2.5 px-4 font-mono">
          <span class="text-[#706E6B]">₹${Number(p.cost_price || 0).toFixed(0)}</span> / <strong class="text-[#0176D3]">₹${Number(p.price || 0).toFixed(2)}</strong>
        </td>
        <td class="py-2.5 px-4 font-mono text-[#2E844A] font-semibold">${p.commission_percent ?? 20}%</td>
        <td class="py-2.5 px-4 text-right flex items-center justify-end gap-1.5">
          <button onclick="App.openEditProductModal('${p.id}')" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#181818] border border-[#DDDBDA] transition-all text-[11px] font-semibold flex items-center gap-1" title="Edit Product/Service">
            <i data-lucide="edit-3" class="w-3 h-3 text-[#0176D3]"></i> Edit
          </button>
          <button onclick="App.globalPickProduct('${p.id}')" class="px-2 py-1 rounded bg-[#0176D3] hover:bg-[#014486] text-white transition-all text-[11px] font-bold">
            + POS
          </button>
          <button onclick="App.deleteProduct('${p.id}')" class="p-1 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA] transition-all" title="Delete Item">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
  },

  openEditStockModal(productId) {
    const item = this.stockList.find(s => s.product_id === productId);
    if (!item) return;
    this.editingStockProductId = productId;
    document.getElementById('edit-stock-name').value = item.name || '';
    document.getElementById('edit-stock-qty').value = item.current_stock ?? 0;
    document.getElementById('edit-stock-alert').value = item.min_alert_level ?? 5;
    document.getElementById('edit-stock-cost').value = item.cost_price ?? 0;
    document.getElementById('edit-stock-price').value = item.selling_price ?? 0;
    document.getElementById('edit-stock-supplier').value = item.supplier || '';
    document.getElementById('edit-stock-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  async submitEditStock() {
    const name = document.getElementById('edit-stock-name').value.trim();
    const current_stock = parseInt(document.getElementById('edit-stock-qty').value);
    const min_alert_level = parseInt(document.getElementById('edit-stock-alert').value) || 5;
    const cost_price = parseFloat(document.getElementById('edit-stock-cost').value) || 0.0;
    const selling_price = parseFloat(document.getElementById('edit-stock-price').value);
    const supplier = document.getElementById('edit-stock-supplier').value.trim();

    if (!name || isNaN(current_stock) || isNaN(selling_price) || selling_price < 0) {
      alert("Please fill valid Product Name, Stock Qty, and Selling Price.");
      return;
    }

    try {
      const res = await fetch(`/api/inventory/stock/${this.editingStockProductId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, current_stock, min_alert_level, cost_price, selling_price, supplier })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to update stock item");
      }
      document.getElementById('edit-stock-modal').classList.add('hidden');
      this.editingStockProductId = null;
      SoundEngine.success();
      await this.loadProducts();
      await this.loadInventory();
      await this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteStockItem(productId) {
    if (!confirm("Delete this item from physical stock inventory?")) return;
    try {
      const res = await fetch(`/api/inventory/stock/${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete stock item");
      SoundEngine.beep();
      await this.loadInventory();
      await this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  openAddProductModal() {
    this.editingProductId = null;
    document.getElementById('product-modal-title').innerHTML = `<i data-lucide="plus-circle" class="w-4 h-4 text-[#0176D3]"></i> Add Product / Service to Price Book`;
    document.getElementById('product-modal-submit-btn').textContent = 'Save to Price Book & Catalog';
    document.getElementById('new-prod-name').value = '';
    document.getElementById('new-prod-category').value = '';
    document.getElementById('new-prod-type').value = 'service';
    document.getElementById('new-prod-price').value = '';
    document.getElementById('new-prod-cost').value = '';
    document.getElementById('new-prod-barcode').value = '';
    document.getElementById('new-prod-duration').value = '30';
    document.getElementById('new-prod-comm').value = '20.0';
    document.getElementById('new-prod-tax').value = '18.0';
    document.getElementById('add-product-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  openEditProductModal(productId) {
    const prod = this.productsList.find(p => p.id === productId);
    if (!prod) return;
    this.editingProductId = productId;
    document.getElementById('product-modal-title').innerHTML = `<i data-lucide="edit-3" class="w-4 h-4 text-[#0176D3]"></i> Edit Product / Service (${productId})`;
    document.getElementById('product-modal-submit-btn').textContent = 'Update Catalog Item';
    document.getElementById('new-prod-name').value = prod.name || '';
    document.getElementById('new-prod-category').value = prod.category || '';
    document.getElementById('new-prod-type').value = prod.type || 'service';
    document.getElementById('new-prod-price').value = prod.price ?? 0;
    document.getElementById('new-prod-cost').value = prod.cost_price ?? 0;
    document.getElementById('new-prod-barcode').value = prod.barcode || '';
    document.getElementById('new-prod-duration').value = prod.duration_mins ?? 30;
    document.getElementById('new-prod-comm').value = prod.commission_percent ?? 20.0;
    document.getElementById('new-prod-tax').value = prod.tax_percent ?? 18.0;
    document.getElementById('add-product-modal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  async submitAddProduct() {
    const name = document.getElementById('new-prod-name').value.trim();
    const category = document.getElementById('new-prod-category').value.trim();
    const type = document.getElementById('new-prod-type').value;
    const price = parseFloat(document.getElementById('new-prod-price').value);
    const cost = parseFloat(document.getElementById('new-prod-cost').value) || 0.0;
    const barcode = document.getElementById('new-prod-barcode').value.trim();
    const duration = parseInt(document.getElementById('new-prod-duration').value) || 30;
    const comm = parseFloat(document.getElementById('new-prod-comm')?.value) || 20.0;
    const tax = parseFloat(document.getElementById('new-prod-tax')?.value) || 18.0;

    if (!name || !category || isNaN(price) || price <= 0) {
      alert("Please provide valid Name, Category and Selling Price.");
      return;
    }

    const isEdit = Boolean(this.editingProductId);
    const url = isEdit ? `/api/products/${this.editingProductId}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category,
          type,
          price,
          cost_price: cost,
          barcode,
          duration_mins: duration,
          commission_percent: comm,
          tax_percent: tax
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save product");
      }

      document.getElementById('add-product-modal').classList.add('hidden');
      this.editingProductId = null;
      SoundEngine.success();
      await this.loadProducts();
      await this.loadInventory();
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteProduct(productId) {
    if (!confirm("Delete this product/service permanently from catalog?")) return;
    try {
      const res = await fetch(`/api/products/${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete item");
      SoundEngine.beep();
      await this.loadProducts();
      await this.loadInventory();
    } catch (e) {
      alert(e.message);
    }
  },

  async loadExpenses() {
    try {
      const res = await fetch('/api/expenses');
      const data = await res.json();
      this.expensesList = Array.isArray(data) ? data : [];

      // Compute Expense Metrics
      const todayStr = new Date().toISOString().split('T')[0];
      let todayExp = 0;
      let cashExp = 0;
      let onlineExp = 0;
      let monthExp = 0;

      this.expensesList.forEach(e => {
        const amt = e.amount || 0;
        monthExp += amt;
        if (e.date === todayStr) {
          todayExp += amt;
          if (e.payment_mode === 'Cash') cashExp += amt;
          else onlineExp += amt;
        }
      });

      const todayEl = document.getElementById('exp-stat-today');
      const cashEl = document.getElementById('exp-stat-cash');
      const onlineEl = document.getElementById('exp-stat-online');
      const monthEl = document.getElementById('exp-stat-month');

      if (todayEl) todayEl.textContent = `₹${todayExp.toFixed(2)}`;
      if (cashEl) cashEl.textContent = `₹${cashExp.toFixed(2)}`;
      if (onlineEl) onlineEl.textContent = `₹${onlineExp.toFixed(2)}`;
      if (monthEl) monthEl.textContent = `₹${monthExp.toFixed(2)}`;

      this.renderExpensesTable();
    } catch (e) {
      console.warn("Failed to load expenses:", e);
      this.expensesList = [];
    }
  },

  filterExpenseCategory(cat) {
    this.expenseCategoryFilter = cat;
    ['All', 'Supplies', 'Pantry', 'Maintenance', 'Utility', 'Misc'].forEach(c => {
      const btn = document.getElementById(`exp-cat-${c}`);
      if (btn) {
        const match = (c === 'Pantry' && cat === 'Pantry & Refreshment') || (c === 'Utility' && cat === 'Utility Bills') || (c === 'Misc' && cat === 'Miscellaneous') || c === cat;
        if (match) {
          btn.className = "px-2.5 py-1 rounded text-xs font-bold bg-[#0176D3] text-white transition-all";
        } else {
          btn.className = "px-2.5 py-1 rounded text-xs font-semibold bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] transition-all";
        }
      }
    });
    this.renderExpensesTable();
  },

  renderExpensesTable() {
    const table = document.getElementById('expenses-table-body');
    if (!table) return;

    const cat = this.expenseCategoryFilter || 'All';
    const q = (document.getElementById('expenses-search-input')?.value || '').toLowerCase().trim();
    const filtered = this.expensesList.filter(e => {
      const matchCat = cat === 'All' || e.category === cat;
      const matchQ = !q ||
        String(e.description || '').toLowerCase().includes(q) ||
        String(e.category || '').toLowerCase().includes(q) ||
        String(e.date || '').toLowerCase().includes(q) ||
        String(e.payment_mode || '').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (filtered.length === 0) {
      table.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-[#706E6B]">No expense records found.</td></tr>`;
      return;
    }

    table.innerHTML = filtered.map(e => `
      <tr class="border-b border-[#E5E5E5] hover:bg-[#F9FAFB] text-xs text-[#181818]">
        <td class="py-2.5 px-4 font-mono text-[#706E6B]">${e.date}</td>
        <td class="py-2.5 px-4 font-semibold text-[#181818]">${e.category}</td>
        <td class="py-2.5 px-4 text-[#3E3E3C]">${e.description}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-[#F3F3F3] border border-[#DDDBDA] text-[#3E3E3C]">${e.payment_mode}</span>
        </td>
        <td class="py-2.5 px-4 font-mono font-bold text-[#EA001E]">₹${Number(e.amount || 0).toFixed(2)}</td>
        <td class="py-2.5 px-4 text-right flex items-center justify-end gap-1.5">
          <button onclick="App.openEditExpenseModal('${e.id}')" class="px-2 py-1 rounded bg-white hover:bg-[#F3F3F3] text-[#181818] border border-[#DDDBDA] text-[11px] font-semibold flex items-center gap-1" title="Edit Expense">
            <i data-lucide="edit-3" class="w-3 h-3 text-[#0176D3]"></i> Edit
          </button>
          <button onclick="App.deleteExpense('${e.id}')" class="p-1 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA]" title="Delete Expense">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      </tr>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
  },

  async openEODReportModal() {
    try {
      const res = await fetch('/api/expenses/eod-closing');
      const data = await res.json();

      document.getElementById('eod-date').textContent = data.date;
      document.getElementById('eod-total-bills').textContent = data.total_bills;
      document.getElementById('eod-revenue').textContent = `₹${data.total_revenue.toFixed(2)}`;
      document.getElementById('eod-expenses').textContent = `₹${data.total_expenses.toFixed(2)}`;
      document.getElementById('eod-net-profit').textContent = `₹${data.net_profit.toFixed(2)}`;

      document.getElementById('eod-cash-collected').textContent = `₹${data.breakdown.cash_collected.toFixed(2)}`;
      document.getElementById('eod-cash-expenses').textContent = `- ₹${data.breakdown.cash_expenses.toFixed(2)}`;
      document.getElementById('eod-cash-in-hand').textContent = `₹${data.breakdown.net_cash_in_drawer.toFixed(2)}`;

      document.getElementById('eod-upi-collected').textContent = `₹${data.breakdown.upi_collected.toFixed(2)}`;
      document.getElementById('eod-card-collected').textContent = `₹${data.breakdown.card_collected.toFixed(2)}`;

      document.getElementById('eod-modal').classList.remove('hidden');
    } catch (e) {
      alert("Failed to calculate EOD closing: " + e.message);
    }
  },

  async loadAppointments() {
    try {
      const res = await fetch('/api/appointments');
      const data = await res.json();
      this.appointmentsList = Array.isArray(data) ? data : [];

      // Compute Appointment Metrics
      const total = this.appointmentsList.length;
      let confirmed = 0;
      let completed = 0;
      let pending = 0;

      this.appointmentsList.forEach(a => {
        if (a.status === 'Confirmed') confirmed++;
        else if (a.status === 'Completed') completed++;
        else pending++;
      });

      const totalEl = document.getElementById('apt-stat-total');
      const confEl = document.getElementById('apt-stat-confirmed');
      const compEl = document.getElementById('apt-stat-completed');
      const pendEl = document.getElementById('apt-stat-pending');

      if (totalEl) totalEl.textContent = total;
      if (confEl) confEl.textContent = confirmed;
      if (compEl) compEl.textContent = completed;
      if (pendEl) pendEl.textContent = pending;

      this.renderAppointmentsList();
    } catch (e) {
      console.warn("Failed to load appointments:", e);
      this.appointmentsList = [];
    }
  },

  filterAppointmentStatus(status) {
    this.appointmentStatusFilter = status;
    ['All', 'Confirmed', 'Completed'].forEach(s => {
      const btn = document.getElementById(`apt-status-${s}`);
      if (btn) {
        if (s === status) {
          btn.className = "px-2.5 py-1 rounded text-xs font-bold bg-[#0176D3] text-white transition-all";
        } else {
          btn.className = "px-2.5 py-1 rounded text-xs font-semibold bg-white hover:bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] transition-all";
        }
      }
    });
    this.renderAppointmentsList();
  },

  renderAppointmentsList() {
    const container = document.getElementById('appointments-list-container');
    if (!container) return;

    const status = this.appointmentStatusFilter || 'All';
    const q = (document.getElementById('appointments-search-input')?.value || '').toLowerCase().trim();
    const filtered = this.appointmentsList.filter(a => {
      const matchStatus = status === 'All' || a.status === status;
      const matchQ = !q ||
        String(a.customer_name || '').toLowerCase().includes(q) ||
        String(a.customer_phone || '').toLowerCase().includes(q) ||
        String(a.service_name || '').toLowerCase().includes(q) ||
        String(a.staff_name || '').toLowerCase().includes(q);
      return matchStatus && matchQ;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="bg-white border border-[#DDDBDA] rounded p-8 text-center text-[#706E6B]">No client appointments found for selected filter.</div>`;
      return;
    }

    container.innerHTML = filtered.map(a => `
      <div class="bg-white border border-[#DDDBDA] rounded p-4 flex flex-col md:flex-row items-start md:items-center justify-between shadow-sm slds-card-hover gap-3">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded bg-[#EBF7FE] text-[#0176D3] flex flex-col items-center justify-center font-mono border border-[#C5E8FC] shadow-sm">
            <span class="text-xs font-extrabold">${a.appointment_time}</span>
            <span class="text-[9px] text-[#706E6B] font-sans">${a.appointment_date || 'Today'}</span>
          </div>
          <div>
            <h4 class="font-bold text-[#181818] text-sm">${a.customer_name} <span class="font-mono text-xs text-[#706E6B]">(${a.customer_phone})</span></h4>
            <div class="text-xs text-[#0176D3] font-semibold mt-0.5">${a.service_name} • Stylist: <strong>${a.staff_name}</strong></div>
            <div class="text-xs text-[#706E6B] mt-0.5">${a.notes || ''}</div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 flex-wrap w-full md:w-auto justify-end">
          <span class="px-2.5 py-0.5 rounded text-xs font-bold ${a.status === 'Confirmed' ? 'bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]' : a.status === 'Completed' ? 'bg-[#F3F3F3] text-[#706E6B] border border-[#DDDBDA]' : 'bg-[#FFF4E8] text-[#DD7A00] border border-[#FFD599]'}">
            ${a.status}
          </span>
          <button onclick="App.openEditAppointmentModal('${a.id}')" class="px-2 py-1.5 rounded bg-white hover:bg-[#F3F3F3] text-[#181818] border border-[#DDDBDA] text-xs font-semibold flex items-center gap-1" title="Edit Appointment">
            <i data-lucide="edit-3" class="w-3 h-3 text-[#0176D3]"></i> Edit
          </button>
          <button onclick="App.billAppointmentInPOS('${a.id}')" class="px-3 py-1.5 rounded bg-[#0176D3] hover:bg-[#014486] text-white text-xs font-bold shadow-sm flex items-center gap-1 transition-all" title="Load into POS Billing Cart">
            <i data-lucide="zap" class="w-3.5 h-3.5"></i> Bill in POS
          </button>
          ${a.status === 'Completed' ? `
            <span class="px-2.5 py-1.5 rounded bg-[#EBF5EE] text-[#2E844A] text-xs font-bold border border-[#A3D9B5] flex items-center gap-1">
              <i data-lucide="check" class="w-3.5 h-3.5"></i> Done
            </span>
            <button onclick="App.changeAppointmentStatus('${a.id}', 'Confirmed')" class="px-2 py-1.5 rounded bg-white hover:bg-[#F3F3F3] text-[#706E6B] border border-[#DDDBDA] text-xs font-semibold transition-colors" title="Reopen Appointment">
              Reopen
            </button>
          ` : `
            <button onclick="App.changeAppointmentStatus('${a.id}', 'Completed')" class="px-3 py-1.5 rounded bg-[#2E844A] hover:bg-[#226438] text-white text-xs font-bold shadow-sm flex items-center gap-1 transition-all cursor-pointer" title="Mark Done / Completed">
              <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Done
            </button>
          `}
          <button onclick="App.deleteAppointment('${a.id}')" class="p-1.5 rounded bg-white hover:bg-[#FDF3F2] text-[#706E6B] hover:text-[#EA001E] border border-[#DDDBDA] transition-colors" title="Delete Appointment">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    `).join('');

    if (window.lucide) window.lucide.createIcons();
  },

  billAppointmentInPOS(aptId) {
    const apt = this.appointmentsList.find(a => a.id === aptId);
    if (!apt) return;

    // Find or create product
    let prod = this.productsList.find(p => p.name.toLowerCase() === apt.service_name.toLowerCase());
    if (!prod) {
      prod = {
        id: 'SVC-APT',
        name: apt.service_name,
        category: 'Service',
        type: 'service',
        price: 350.0,
        duration_mins: 30
      };
    }

    const matchedStaff = this.staffList.find(s => s.name === apt.staff_name);
    POS.cart.push({
      id: prod.id,
      name: prod.name,
      category: prod.category || 'Service',
      type: prod.type || 'service',
      price: prod.price,
      quantity: 1,
      staff_id: matchedStaff?.id || '',
      staff_name: apt.staff_name || 'Staff',
      staff_commission: matchedStaff ? (prod.price * (matchedStaff.base_commission || 20.0)) / 100.0 : 0.0,
      discount_amount: 0.0,
      total: prod.price
    });

    let cust = this.customersList.find(c => c.phone === apt.customer_phone);
    if (!cust) {
      cust = {
        name: apt.customer_name,
        phone: apt.customer_phone,
        membership_tier: 'Regular',
        loyalty_points: 0,
        wallet_balance: 0.0,
        khata_balance: 0.0
      };
    }

    POS.selectCustomer(cust);
    POS.renderCart();
    this.switchTab('pos');
    SoundEngine.success();
  },

  async loadBackups() {
    try {
      const res = await fetch('/api/system/backups');
      const data = await res.json();
      const backups = Array.isArray(data) ? data : [];
      const list = document.getElementById('backups-list-table');
      if (!list) return;

      if (backups.length === 0) {
        list.innerHTML = `<tr><td colspan="3" class="text-center py-6 text-[#706E6B]">No backup archives created yet.</td></tr>`;
      } else {
        list.innerHTML = backups.map(b => `
          <tr class="border-b border-[#E5E5E5] text-xs text-[#181818]">
            <td class="py-2 px-4 font-mono font-semibold text-[#0176D3]">${b.filename}</td>
            <td class="py-2 px-4 font-mono text-[#706E6B]">${b.size_kb} KB</td>
            <td class="py-2 px-4 text-[#706E6B]">${b.created_at}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.warn("Failed to load backups:", e);
    }
  },

  async reprintBill(invoiceNumber) {
    try {
      const res = await fetch(`/api/billing/bills/${invoiceNumber}`);
      const bill = await res.json();
      PrintEngine.print(
        bill,
        this.settings?.shop || {},
        this.settings?.tax || {},
        this.settings?.print || {}
      );
    } catch (e) {
      alert("Failed to reprint bill: " + e.message);
    }
  },

  // Modal actions — Customer Add & Edit
  openAddCustomerModal() {
    this.editingCustomerId = null;
    document.getElementById('customer-modal-title').textContent = 'New Customer Account';
    document.getElementById('customer-modal-submit-btn').textContent = 'Save Account';
    document.getElementById('new-cust-name').value = '';
    document.getElementById('new-cust-phone').value = '';
    document.getElementById('new-cust-tier').value = 'Regular';
    if (document.getElementById('new-cust-email')) document.getElementById('new-cust-email').value = '';
    if (document.getElementById('new-cust-points')) document.getElementById('new-cust-points').value = '0';
    if (document.getElementById('new-cust-notes')) document.getElementById('new-cust-notes').value = '';
    document.getElementById('add-customer-modal').classList.remove('hidden');
  },

  openEditCustomerModal(custId) {
    const cust = this.customersList.find(c => c.id === custId);
    if (!cust) return;
    this.editingCustomerId = custId;
    document.getElementById('customer-modal-title').textContent = `Edit Customer Account (${custId})`;
    document.getElementById('customer-modal-submit-btn').textContent = 'Update Account';
    document.getElementById('new-cust-name').value = cust.name || '';
    document.getElementById('new-cust-phone').value = cust.phone || '';
    document.getElementById('new-cust-tier').value = cust.membership_tier || 'Regular';
    if (document.getElementById('new-cust-email')) document.getElementById('new-cust-email').value = cust.email || '';
    if (document.getElementById('new-cust-points')) document.getElementById('new-cust-points').value = cust.loyalty_points ?? 0;
    if (document.getElementById('new-cust-notes')) document.getElementById('new-cust-notes').value = cust.notes || cust.address || '';
    document.getElementById('add-customer-modal').classList.remove('hidden');
  },

  async submitAddCustomer() {
    const name = document.getElementById('new-cust-name').value.trim();
    const phone = document.getElementById('new-cust-phone').value.trim();
    const tier = document.getElementById('new-cust-tier').value;
    const email = document.getElementById('new-cust-email')?.value.trim() || '';
    const points = parseInt(document.getElementById('new-cust-points')?.value) || 0;
    const notes = document.getElementById('new-cust-notes')?.value.trim() || '';

    if (!name || !phone) {
      alert("Please fill customer name and phone number");
      return;
    }

    const isEdit = Boolean(this.editingCustomerId);
    const existing = isEdit ? this.customersList.find(c => c.id === this.editingCustomerId) : null;
    const url = isEdit ? `/api/customers/${this.editingCustomerId}` : '/api/customers';
    const method = isEdit ? 'PUT' : 'POST';

    const payload = {
      name,
      phone,
      email,
      membership_tier: tier,
      loyalty_points: points,
      wallet_balance: existing ? (existing.wallet_balance || 0.0) : 0.0,
      khata_balance: existing ? (existing.khata_balance || 0.0) : 0.0,
      notes
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to save customer");
      }

      const result = await res.json();
      document.getElementById('add-customer-modal').classList.add('hidden');
      this.editingCustomerId = null;
      SoundEngine.success();
      await this.loadCustomers();

      if (!isEdit && this.currentTab === 'pos') {
        POS.selectCustomer(result.customer);
      }
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteCustomer(custId) {
    if (!confirm("Delete this customer account permanently?")) return;
    try {
      const res = await fetch(`/api/customers/${custId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete customer");
      SoundEngine.beep();
      await this.loadCustomers();
    } catch (e) {
      alert(e.message);
    }
  },

  activeRechargeCustId: null,
  openWalletRechargeModal(id, name, balance) {
    this.activeRechargeCustId = id;
    document.getElementById('recharge-cust-name').textContent = `${name} (Current: ₹${balance})`;
    document.getElementById('recharge-amount').value = '';
    document.getElementById('wallet-recharge-modal').classList.remove('hidden');
  },

  async submitWalletRecharge() {
    const amt = parseFloat(document.getElementById('recharge-amount').value);
    if (!amt || amt <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    try {
      const res = await fetch(`/api/customers/${this.activeRechargeCustId}/recharge-wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, payment_mode: "Cash" })
      });
      const data = await res.json();
      document.getElementById('wallet-recharge-modal').classList.add('hidden');
      SoundEngine.success();
      this.loadCustomers();
    } catch (e) {
      alert(e.message);
    }
  },

  activeKhataCustId: null,
  openKhataModal(id, name, pending) {
    this.activeKhataCustId = id;
    document.getElementById('khata-cust-name').textContent = name;
    document.getElementById('khata-pending-amt').textContent = `₹${pending}`;
    document.getElementById('khata-pay-amount').value = '';
    document.getElementById('khata-modal').classList.remove('hidden');
  },

  async submitKhata() {
    const amt = parseFloat(document.getElementById('khata-pay-amount').value);
    if (!amt || amt <= 0) {
      alert("Please enter a valid amount");
      return;
    }

    try {
      const res = await fetch(`/api/customers/${this.activeKhataCustId}/settle-khata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, payment_mode: "Cash" })
      });
      document.getElementById('khata-modal').classList.add('hidden');
      SoundEngine.success();
      this.loadCustomers();
    } catch (e) {
      alert(e.message);
    }
  },

  activeStockProdId: null,
  openAdjustStockModal(prodId, name, current) {
    this.activeStockProdId = prodId;
    document.getElementById('adjust-stock-name').textContent = name;
    document.getElementById('adjust-stock-current').textContent = current;
    document.getElementById('adjust-stock-qty').value = '';
    document.getElementById('adjust-stock-modal').classList.remove('hidden');
  },

  async submitAdjustStock() {
    const delta = parseInt(document.getElementById('adjust-stock-qty').value);
    if (isNaN(delta) || delta === 0) {
      alert("Please enter a quantity like +5 or -2");
      return;
    }

    try {
      await fetch('/api/inventory/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: this.activeStockProdId, quantity_change: delta })
      });
      document.getElementById('adjust-stock-modal').classList.add('hidden');
      SoundEngine.beep();
      this.loadInventory();
      this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  openAddExpenseModal() {
    this.editingExpenseId = null;
    document.getElementById('expense-modal-title').textContent = 'Record Daily Expense';
    document.getElementById('expense-modal-submit-btn').textContent = 'Save Expense';
    if (document.getElementById('new-exp-date')) document.getElementById('new-exp-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('new-exp-category').value = 'Supplies';
    document.getElementById('new-exp-amount').value = '';
    document.getElementById('new-exp-desc').value = '';
    document.getElementById('new-exp-mode').value = 'Cash';
    document.getElementById('add-expense-modal').classList.remove('hidden');
  },

  openEditExpenseModal(expenseId) {
    const exp = this.expensesList.find(e => e.id === expenseId);
    if (!exp) return;
    this.editingExpenseId = expenseId;
    document.getElementById('expense-modal-title').textContent = `Edit Expense (${expenseId})`;
    document.getElementById('expense-modal-submit-btn').textContent = 'Update Expense';
    if (document.getElementById('new-exp-date')) document.getElementById('new-exp-date').value = exp.date || new Date().toISOString().split('T')[0];
    document.getElementById('new-exp-category').value = exp.category || 'Supplies';
    document.getElementById('new-exp-amount').value = exp.amount ?? 0;
    document.getElementById('new-exp-desc').value = exp.description || '';
    document.getElementById('new-exp-mode').value = exp.payment_mode || 'Cash';
    document.getElementById('add-expense-modal').classList.remove('hidden');
  },

  async submitAddExpense() {
    const date = document.getElementById('new-exp-date')?.value || new Date().toISOString().split('T')[0];
    const cat = document.getElementById('new-exp-category').value;
    const amt = parseFloat(document.getElementById('new-exp-amount').value);
    const desc = document.getElementById('new-exp-desc').value.trim();
    const mode = document.getElementById('new-exp-mode').value;

    if (!amt || !desc) {
      alert("Please enter amount and description");
      return;
    }

    const isEdit = Boolean(this.editingExpenseId);
    const url = isEdit ? `/api/expenses/${this.editingExpenseId}` : '/api/expenses';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, category: cat, amount: amt, description: desc, payment_mode: mode })
      });
      if (!res.ok) throw new Error("Failed to save expense");
      document.getElementById('add-expense-modal').classList.add('hidden');
      this.editingExpenseId = null;
      SoundEngine.beep();
      this.loadExpenses();
      this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteExpense(id) {
    if (!confirm("Delete this expense entry?")) return;
    try {
      await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
      this.loadExpenses();
      this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  _populateAppointmentStaffSelect(selectedName) {
    const sel = document.getElementById('apt-staff-name');
    if (!sel) return;
    const staff = this.staffList || [];
    if (staff.length === 0) {
      sel.innerHTML = '<option value="General">General</option>';
      return;
    }
    sel.innerHTML = staff.map(s => `
      <option value="${s.name}" ${s.name === selectedName ? 'selected' : ''}>${s.name} (${s.id})</option>
    `).join('');
    if (selectedName) sel.value = selectedName;
  },

  openAddAppointmentModal() {
    this.editingAppointmentId = null;
    document.getElementById('appointment-modal-title').textContent = 'Book Client Appointment';
    document.getElementById('appointment-modal-submit-btn').textContent = 'Confirm Booking';
    document.getElementById('apt-cust-name').value = '';
    document.getElementById('apt-cust-phone').value = '';
    document.getElementById('apt-service-name').value = '';
    this._populateAppointmentStaffSelect(this.staffList[0]?.name || 'Master Stylist');
    if (document.getElementById('apt-status')) document.getElementById('apt-status').value = 'Confirmed';
    document.getElementById('apt-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('apt-time').value = '15:00';
    if (document.getElementById('apt-notes')) document.getElementById('apt-notes').value = '';
    document.getElementById('add-appointment-modal').classList.remove('hidden');
  },

  openEditAppointmentModal(aptId) {
    const apt = this.appointmentsList.find(a => a.id === aptId);
    if (!apt) return;
    this.editingAppointmentId = aptId;
    document.getElementById('appointment-modal-title').textContent = `Edit Appointment (${aptId})`;
    document.getElementById('appointment-modal-submit-btn').textContent = 'Update Appointment';
    document.getElementById('apt-cust-name').value = apt.customer_name || '';
    document.getElementById('apt-cust-phone').value = apt.customer_phone || '';
    document.getElementById('apt-service-name').value = apt.service_name || '';
    this._populateAppointmentStaffSelect(apt.staff_name || '');
    if (document.getElementById('apt-status')) document.getElementById('apt-status').value = apt.status || 'Confirmed';
    document.getElementById('apt-date').value = apt.appointment_date || new Date().toISOString().split('T')[0];
    document.getElementById('apt-time').value = apt.appointment_time || '15:00';
    if (document.getElementById('apt-notes')) document.getElementById('apt-notes').value = apt.notes || '';
    document.getElementById('add-appointment-modal').classList.remove('hidden');
  },

  async submitAddAppointment() {
    const name = document.getElementById('apt-cust-name').value.trim();
    const phone = document.getElementById('apt-cust-phone').value.trim();
    const service = document.getElementById('apt-service-name').value.trim();
    const staffName = document.getElementById('apt-staff-name')?.value || this.staffList[0]?.name || "Master Stylist";
    const status = document.getElementById('apt-status')?.value || "Confirmed";
    const date = document.getElementById('apt-date').value;
    const time = document.getElementById('apt-time').value;
    const notes = document.getElementById('apt-notes')?.value.trim() || '';

    if (!name || !service || !date || !time) {
      alert("Please fill all required appointment fields");
      return;
    }

    const isEdit = Boolean(this.editingAppointmentId);
    const url = isEdit ? `/api/appointments/${this.editingAppointmentId}` : '/api/appointments';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: name,
          customer_phone: phone,
          service_name: service,
          staff_name: staffName,
          appointment_date: date,
          appointment_time: time,
          status,
          notes
        })
      });
      if (!res.ok) throw new Error("Failed to save appointment");
      document.getElementById('add-appointment-modal').classList.add('hidden');
      this.editingAppointmentId = null;
      SoundEngine.beep();
      this.loadAppointments();
      this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  async deleteAppointment(id) {
    if (!confirm("Delete this appointment booking?")) return;
    try {
      await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
      SoundEngine.beep();
      this.loadAppointments();
      this.loadDashboardStats();
    } catch (e) {
      alert(e.message);
    }
  },

  async changeAppointmentStatus(id, status) {
    try {
      // Immediate optimistic update in memory so the button changes state with 0 lag
      const apt = this.appointmentsList.find(a => a.id === id);
      if (apt) {
        apt.status = status;
        this.renderAppointmentsList();
      }

      const res = await fetch(`/api/appointments/${id}/status?status=${encodeURIComponent(status)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to update appointment status");
      }

      if (window.SoundEngine) SoundEngine.success();
      await this.loadAppointments();
      this.loadDashboardStats();
    } catch (e) {
      alert("Appointment Status Error: " + e.message);
      await this.loadAppointments();
    }
  },

  openDiscountModal() {
    document.getElementById('cart-discount-input').value = POS.discountValue || '';
    this.setDiscountType(POS.discountType || 'flat');
    document.getElementById('discount-modal').classList.remove('hidden');
  },

  setDiscountType(type) {
    POS.discountType = type;
    const btnFlat = document.getElementById('disc-btn-flat');
    const btnPct = document.getElementById('disc-btn-pct');
    if (type === 'flat') {
      btnFlat.className = "flex-1 py-1.5 rounded bg-[#0176D3] text-white font-bold text-xs transition-all";
      btnPct.className = "flex-1 py-1.5 rounded bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] font-semibold text-xs transition-all";
    } else {
      btnPct.className = "flex-1 py-1.5 rounded bg-[#0176D3] text-white font-bold text-xs transition-all";
      btnFlat.className = "flex-1 py-1.5 rounded bg-[#F3F3F3] text-[#3E3E3C] border border-[#DDDBDA] font-semibold text-xs transition-all";
    }
  },

  submitDiscount() {
    const val = parseFloat(document.getElementById('cart-discount-input').value) || 0.0;
    POS.discountValue = val;
    document.getElementById('discount-modal').classList.add('hidden');
    POS.renderCart();
  },

  populateSettingsForm() {
    if (!this.settings) return;

    // 1. Shop Profile Settings (shop_settings.json)
    const shop = this.settings.shop || {};
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : '';
    };
    const setChecked = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(val);
    };

    setVal('setting-shop-name', shop.shop_name || 'TAYP EE — Premium POS');
    setVal('setting-shop-tagline', shop.tagline || 'Modern Salon, Spa & Retail Solution');
    setVal('setting-shop-address', shop.address || 'Shop #12, Commercial Market, Main Boulevard');
    setVal('setting-shop-phone', shop.phone || '+91 98765 43210');
    setVal('setting-shop-email', shop.email || 'contact@taypee.com');
    setVal('setting-shop-website', shop.website || 'www.taypee.com');
    setVal('setting-shop-prefix', shop.invoice_prefix || 'INV');
    setVal('setting-shop-currency', shop.currency_symbol || '₹');
    setVal('setting-shop-footer', shop.footer_note || 'Thank you for visiting TAYP EE! Visit us again soon.');

    // 2. GST & Tax Calculation Settings (tax_settings.json)
    const tax = this.settings.tax || {};
    setChecked('setting-tax-enabled', tax.enabled ?? true);
    setVal('setting-tax-name', tax.tax_name || 'GST');
    setVal('setting-tax-gstin', tax.gstin || '07AAAAA0000A1Z5');
    setChecked('setting-tax-composition', tax.is_composition || false);
    setVal('setting-tax-cgst', tax.cgst_percent ?? 9.0);
    setVal('setting-tax-sgst', tax.sgst_percent ?? 9.0);
    setVal('setting-tax-igst', tax.igst_percent ?? 18.0);
    setChecked('setting-tax-inclusive', tax.inclusive_pricing || false);

    // 3. Dynamic UPI QR Settings (upi_settings.json)
    const upi = this.settings.upi || {};
    setChecked('setting-upi-enabled', upi.enabled ?? true);
    setVal('setting-upi-merchant-name', upi.merchant_name || 'TAYP EE');
    setVal('setting-upi-id', upi.upi_id || 'taypee@upi');
    setVal('setting-upi-code', upi.merchant_code || '5411');

    // 4. Thermal Receipt & Printer Setup (print_settings.json)
    const prn = this.settings.print || {};
    setVal('setting-print-paper', prn.paper_size || '80mm');
    setVal('setting-print-copies', prn.print_copies || 1);
    setChecked('setting-print-autoprint', prn.auto_print || false);
    setChecked('setting-print-showqr', prn.show_qr_code ?? true);
    setChecked('setting-print-showlogo', prn.show_logo ?? true);
    setChecked('setting-print-showtax', prn.show_tax_breakup ?? true);
    setChecked('setting-print-showstaff', prn.show_staff_name ?? true);
    setVal('setting-print-footer', prn.footer_text || 'Goods once sold cannot be returned. Please keep receipt safe.');
  },

  async saveShopSettings() {
    const shopData = {
      shop_name: document.getElementById('setting-shop-name')?.value.trim() || 'TAYP EE',
      tagline: document.getElementById('setting-shop-tagline')?.value.trim() || '',
      address: document.getElementById('setting-shop-address')?.value.trim() || '',
      phone: document.getElementById('setting-shop-phone')?.value.trim() || '',
      email: document.getElementById('setting-shop-email')?.value.trim() || '',
      website: document.getElementById('setting-shop-website')?.value.trim() || '',
      invoice_prefix: document.getElementById('setting-shop-prefix')?.value.trim() || 'INV',
      currency_symbol: document.getElementById('setting-shop-currency')?.value.trim() || '₹',
      currency_code: 'INR',
      next_invoice_number: this.settings?.shop?.next_invoice_number || 1011,
      footer_note: document.getElementById('setting-shop-footer')?.value.trim() || ''
    };

    try {
      const res = await fetch('/api/settings/shop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopData)
      });
      if (!res.ok) throw new Error('Failed to save shop settings');
      SoundEngine.beep();
      alert('✅ Store Profile & Branding Saved Successfully!');
      await this.loadSettings();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async saveTaxSettings() {
    const taxData = {
      enabled: document.getElementById('setting-tax-enabled')?.checked ?? true,
      tax_name: document.getElementById('setting-tax-name')?.value.trim() || 'GST',
      gstin: document.getElementById('setting-tax-gstin')?.value.trim() || '',
      is_composition: document.getElementById('setting-tax-composition')?.checked || false,
      cgst_percent: parseFloat(document.getElementById('setting-tax-cgst')?.value) || 0,
      sgst_percent: parseFloat(document.getElementById('setting-tax-sgst')?.value) || 0,
      igst_percent: parseFloat(document.getElementById('setting-tax-igst')?.value) || 0,
      inclusive_pricing: document.getElementById('setting-tax-inclusive')?.checked || false
    };

    try {
      const res = await fetch('/api/settings/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taxData)
      });
      if (!res.ok) throw new Error('Failed to save tax rules');
      SoundEngine.beep();
      alert('✅ GST & Taxation Rules Saved Successfully!');
      await this.loadSettings();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async saveUpiSettings() {
    const upiData = {
      enabled: document.getElementById('setting-upi-enabled')?.checked ?? true,
      merchant_name: document.getElementById('setting-upi-merchant-name')?.value.trim() || 'TAYP EE',
      upi_id: document.getElementById('setting-upi-id')?.value.trim() || '',
      merchant_code: document.getElementById('setting-upi-code')?.value.trim() || '5411'
    };

    try {
      const res = await fetch('/api/settings/upi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upiData)
      });
      if (!res.ok) throw new Error('Failed to save UPI settings');
      SoundEngine.beep();
      alert('✅ Dynamic UPI QR & Payment Account Saved Successfully!');
      await this.loadSettings();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async savePrinterSettings() {
    const printData = {
      paper_size: document.getElementById('setting-print-paper')?.value || '80mm',
      print_copies: parseInt(document.getElementById('setting-print-copies')?.value, 10) || 1,
      auto_print: document.getElementById('setting-print-autoprint')?.checked || false,
      show_qr_code: document.getElementById('setting-print-showqr')?.checked ?? true,
      show_logo: document.getElementById('setting-print-showlogo')?.checked ?? true,
      show_tax_breakup: document.getElementById('setting-print-showtax')?.checked ?? true,
      show_staff_name: document.getElementById('setting-print-showstaff')?.checked ?? true,
      footer_text: document.getElementById('setting-print-footer')?.value.trim() || ''
    };

    try {
      const res = await fetch('/api/settings/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(printData)
      });
      if (!res.ok) throw new Error('Failed to save printer settings');
      SoundEngine.beep();
      alert('✅ Thermal Receipt & Printing Preferences Saved Successfully!');
      await this.loadSettings();
    } catch (e) {
      alert('❌ ' + e.message);
    }
  },

  async checkSystemUpdates() {
    try {
      const res = await fetch('/api/system/version', {
        headers: AuthGate.getAuthHeaders()
      });
      if (res.ok) {
        const info = await res.json();
        alert(`TAYP EE Cloud Suite\n\nVersion: ${info.version}\nStage: ${info.stage}\nBuild: ${info.build}\nRelease Channel: ${info.channel}\n\nStatus: System is running the latest build!`);
      } else {
        alert(`TAYP EE Cloud Suite\n\nVersion: ${this.version}\nStatus: System is operational and running latest build.`);
      }
    } catch (e) {
      alert(`TAYP EE Cloud Suite\n\nVersion: ${this.version}\nStatus: Active.`);
    }
  },

  async checkCloudStatus() {
    try {
      const res = await fetch('/api/system/cloud-status');
      const data = await res.json();
      const badge = document.getElementById('cloud-status-badge');
      const pill = document.getElementById('settings-cloud-pill');
      const urlInput = document.getElementById('setting-supabase-url');
      const keyInput = document.getElementById('setting-supabase-key');
      const syncBtn = document.getElementById('btn-sync-cloud');

      if (urlInput && data.supabase_url) urlInput.value = data.supabase_url;
      if (keyInput) {
        keyInput.value = '';
        keyInput.placeholder = data.has_key ? '•••••••••••••••• (Loaded from .env)' : 'sb_secret_...';
      }

      if (data.is_connected && data.tables_created) {
        if (badge) {
          badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-[#2E844A] mr-1.5 animate-pulse"></span> Cloud: Online`;
          badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#032D60] text-[#A8C7FA] border border-[#2E844A]/60 flex items-center cursor-pointer";
        }
        if (pill) {
          pill.textContent = "Connected & Active";
          pill.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]";
        }
        if (syncBtn) syncBtn.classList.remove('hidden');
      } else if (data.is_connected && !data.tables_created) {
        if (badge) {
          badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-[#FE9339] mr-1.5 animate-ping"></span> Cloud: Run SQL`;
          badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#032D60] text-[#FE9339] border border-[#FE9339]/60 flex items-center cursor-pointer";
        }
        if (pill) {
          pill.textContent = "Tables Pending (Run SQL)";
          pill.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFF4E8] text-[#8C4B00] border border-[#FE9339]";
        }
        if (syncBtn) syncBtn.classList.add('hidden');
      } else {
        if (badge) {
          badge.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-[#FE9339] mr-1.5"></span> Cloud: Ready (Setup)`;
          badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#032D60] text-[#A8C7FA] border border-slate-700 flex items-center cursor-pointer hover:border-[#0176D3]";
        }
        if (pill) {
          pill.textContent = "Standby (Local Buffer)";
          pill.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F3F3F3] text-[#706E6B] border border-[#DDDBDA]";
        }
        if (syncBtn) syncBtn.classList.add('hidden');
      }
    } catch (e) {
      console.warn("Cloud check error:", e);
    }
  },

  async saveCloudConfig() {
    const url = document.getElementById('setting-supabase-url')?.value.trim();
    const key = document.getElementById('setting-supabase-key')?.value.trim();

    if (!url || !key) {
      alert("Please enter both Supabase Project URL and API Key.");
      return;
    }

    try {
      const res = await fetch('/api/system/cloud-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabase_url: url, supabase_key: key })
      });
      const data = await res.json();
      if (data.is_connected) {
        SoundEngine.success();
        alert(data.message || "✅ Cloud Database Connected to Supabase Successfully!");
      } else {
        alert("⚠️ Cloud Connection Test: " + (data.error || "Could not reach Supabase. Please verify URL and Key."));
      }
      this.checkCloudStatus();
    } catch (e) {
      alert("Failed to save cloud config: " + e.message);
    }
  },

  async syncToCloud() {
    try {
      const res = await fetch('/api/system/sync-to-cloud', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        SoundEngine.success();
        alert("✅ Local store data uploaded to Supabase Cloud tables successfully!");
        this.loadProducts();
        this.loadCustomers();
      } else {
        alert("Sync error: " + (data.message || "Failed to sync"));
      }
    } catch (e) {
      alert("Failed to sync: " + e.message);
    }
  },

  // ==================== APP LAUNCHER ====================
  toggleAppLauncher() {
    const modal = document.getElementById('app-launcher-modal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
      this.openAppLauncher();
    } else {
      this.closeAppLauncher();
    }
  },

  openAppLauncher() {
    const modal = document.getElementById('app-launcher-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const searchInput = document.getElementById('app-launcher-search');
    if (searchInput) {
      searchInput.value = '';
      this.filterAppLauncher('');
      setTimeout(() => searchInput.focus(), 50);
    }
    SoundEngine.beep();
    if (window.lucide) window.lucide.createIcons();
  },

  closeAppLauncher() {
    const modal = document.getElementById('app-launcher-modal');
    if (modal) modal.classList.add('hidden');
  },

  launchApp(tabId) {
    this.closeAppLauncher();
    this.switchTab(tabId);
    SoundEngine.beep();
  },

  filterAppLauncher(query) {
    const q = (query || '').toLowerCase().trim();
    const appItems = document.querySelectorAll('.app-launcher-item');
    const actionItems = document.querySelectorAll('.app-launcher-action');

    appItems.forEach(item => {
      const title = (item.getAttribute('data-title') || '').toLowerCase();
      const text = item.textContent.toLowerCase();
      if (!q || title.includes(q) || text.includes(q)) {
        item.classList.remove('hidden');
      } else {
        item.classList.add('hidden');
      }
    });

    actionItems.forEach(item => {
      const title = (item.getAttribute('data-title') || '').toLowerCase();
      const text = item.textContent.toLowerCase();
      if (!q || title.includes(q) || text.includes(q)) {
        item.classList.remove('hidden');
      } else {
        item.classList.add('hidden');
      }
    });
  }
};

// Start Application immediately once DOM is ready (does not stall waiting for external fonts/CDNs)
function startTaypApp() {
  if (window.AuthGate) {
    AuthGate.bootstrap();
  } else {
    App.init();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startTaypApp);
} else {
  startTaypApp();
}
