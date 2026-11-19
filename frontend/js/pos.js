// POS Terminal Logic & Keyboard Navigation
const POS = {
  cart: [],
  selectedCustomer: null,
  activeCategory: 'All',
  searchQuery: '',
  discountType: 'flat', // 'flat' or 'percent'
  discountValue: 0.0,
  taxEnabled: true,
  taxPercent: 18.0,
  currentBillModal: null,

  init() {
    this.setupBarcodeListener();
    this.setupKeyboardShortcuts();
    this.renderCart();
  },

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Do not trigger if typing inside input / textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') {
          e.target.blur();
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        const searchInput = document.getElementById('pos-search-input');
        if (searchInput) searchInput.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        this.openCheckoutModal('Cash');
      } else if (e.key === 'F8') {
        e.preventDefault();
        this.openCheckoutModal('UPI');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.clearCart();
      }
    });
  },

  setupBarcodeListener() {
    let barcodeBuffer = '';
    let lastKeyTime = Date.now();

    window.addEventListener('keydown', (e) => {
      const currentTime = Date.now();
      const targetTag = e.target.tagName.toLowerCase();

      // Scanners typically send characters rapidly (< 50ms per key)
      if (currentTime - lastKeyTime > 100) {
        barcodeBuffer = '';
      }
      lastKeyTime = currentTime;

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 3 && targetTag !== 'input' && targetTag !== 'textarea') {
          this.handleBarcodeScan(barcodeBuffer);
          barcodeBuffer = '';
        }
      } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
      }
    });
  },

  async handleBarcodeScan(barcode) {
    try {
      const res = await fetch(`/api/products/barcode/${encodeURIComponent(barcode)}`);
      if (res.ok) {
        const prod = await res.json();
        this.addToCart(prod);
        SoundEngine.beep();
      }
    } catch (e) {
      console.warn("Barcode lookup error:", e);
    }
  },

  getStaffList() {
    let list = window.App?.staffList;
    if (Array.isArray(list) && list.length > 0) return list;
    try {
      const c = localStorage.getItem('taypee_staff_cache');
      if (c) {
        list = JSON.parse(c);
        if (Array.isArray(list) && list.length > 0) {
          if (window.App) window.App.staffList = list;
          return list;
        }
      }
    } catch (_) {}
    // Trigger background fetch if not yet loaded
    if (window.App && typeof window.App.loadStaff === 'function') {
      window.App.loadStaff();
    }
    return [];
  },

  renderStaffOptions(selectedStaffId, selectedStaffName) {
    const list = this.getStaffList();
    if (!list || list.length === 0) {
      if (selectedStaffName) {
        return `<option value="${selectedStaffId || ''}" selected>${selectedStaffName}</option>`;
      }
      return `<option value="" selected>Loading Staff...</option>`;
    }

    let html = `<option value="">-- Assign Staff --</option>`;
    let hasSelected = false;

    list.forEach(s => {
      const isSel = String(s.id) === String(selectedStaffId) || (!selectedStaffId && s.name === selectedStaffName);
      if (isSel) hasSelected = true;
      const roleInfo = s.role ? ` (${s.role})` : '';
      html += `<option value="${s.id}" ${isSel ? 'selected' : ''}>${s.name}${roleInfo}</option>`;
    });

    if (selectedStaffId && !hasSelected) {
      html += `<option value="${selectedStaffId}" selected>${selectedStaffName || ('Staff ' + selectedStaffId)}</option>`;
    }
    return html;
  },

  addToCart(product) {
    const existingIndex = this.cart.findIndex(i => i.id === product.id);
    let defaultStaff = null;
    const staffList = this.getStaffList();
    const currentUserEmail = (window.AuthGate?.currentUserInfo?.username || '').toLowerCase();
    if (currentUserEmail && staffList.length > 0) {
      defaultStaff = staffList.find(s => (s.email || '').toLowerCase() === currentUserEmail);
    }
    if (!defaultStaff && staffList.length > 0) {
      defaultStaff = staffList.find(s => s.role && s.role.toLowerCase().includes('cashier')) || staffList[0];
    }
    if (!defaultStaff) {
      defaultStaff = { id: '', name: 'General' };
    }

    if (existingIndex > -1) {
      this.cart[existingIndex].quantity += 1;
      this.cart[existingIndex].total = this.cart[existingIndex].quantity * this.cart[existingIndex].price;
    } else {
      const commPct = product.commission_percent || 20.0;
      const staffComm = (product.price * commPct) / 100.0;

      this.cart.push({
        id: product.id,
        name: product.name,
        category: product.category,
        type: product.type || 'service',
        price: product.price,
        quantity: 1,
        staff_id: defaultStaff.id || '',
        staff_name: defaultStaff.name || 'General',
        staff_commission: staffComm,
        discount_amount: 0.0,
        total: product.price
      });
    }

    SoundEngine.beep();
    this.renderCart();
  },

  updateQuantity(index, delta) {
    if (this.cart[index]) {
      this.cart[index].quantity += delta;
      if (this.cart[index].quantity <= 0) {
        this.cart.splice(index, 1);
      } else {
        this.cart[index].total = this.cart[index].quantity * this.cart[index].price;
      }
      this.renderCart();
    }
  },

  removeFromCart(index) {
    if (this.cart[index]) {
      this.cart.splice(index, 1);
      this.renderCart();
    }
  },

  setStaff(index, staffId, staffName) {
    if (this.cart[index]) {
      const list = this.getStaffList();
      const matched = list.find(s => String(s.id) === String(staffId));
      this.cart[index].staff_id = staffId || '';
      this.cart[index].staff_name = matched ? matched.name : (staffName && !staffName.startsWith('--') ? staffName : 'General');
      this.renderCart();
    }
  },

  clearCart() {
    if (this.cart.length > 0) {
      if (confirm("Are you sure you want to clear the active cart?")) {
        this.cart = [];
        this.discountValue = 0.0;
        this.selectedCustomer = null;
        this.renderCart();
        this.renderCustomerBar();
      }
    }
  },

  calculateTotals() {
    const subtotal = this.cart.reduce((acc, item) => acc + item.total, 0.0);
    let discountAmount = 0.0;

    if (this.discountType === 'percent') {
      discountAmount = (subtotal * this.discountValue) / 100.0;
    } else {
      discountAmount = Math.min(subtotal, this.discountValue);
    }

    const taxableAmount = Math.max(0.0, subtotal - discountAmount);
    let taxAmount = 0.0;
    if (this.taxEnabled) {
      taxAmount = (taxableAmount * this.taxPercent) / 100.0;
    }

    const grandTotal = taxableAmount + taxAmount;
    const roundedTotal = Math.round(grandTotal);

    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      taxAmount: parseFloat(taxAmount.toFixed(2)),
      grandTotal: parseFloat(grandTotal.toFixed(2)),
      roundedTotal: parseFloat(roundedTotal.toFixed(2))
    };
  },

  renderCart() {
    const container = document.getElementById('pos-cart-items');
    const emptyState = document.getElementById('pos-cart-empty');
    const totals = this.calculateTotals();

    if (!container) return;

    if (this.cart.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
    } else {
      if (emptyState) emptyState.classList.add('hidden');
      
      container.innerHTML = this.cart.map((item, idx) => `
        <div class="p-2.5 mb-2 rounded bg-white border border-[#DDDBDA] flex flex-col gap-2 hover:border-[#0176D3] shadow-sm transition-all">
          <div class="flex items-start justify-between">
            <div class="flex-1 pr-2">
              <div class="font-bold text-[#181818] text-xs leading-snug">${item.name}</div>
              <div class="text-[11px] text-[#0176D3] font-mono mt-0.5">₹${item.price.toFixed(2)} ${item.type === 'product' ? '• Product' : '• Service'}</div>
            </div>
            <div class="text-right">
              <div class="font-bold text-[#181818] text-xs font-mono">₹${item.total.toFixed(2)}</div>
              <button onclick="POS.removeFromCart(${idx})" class="text-xs text-[#EA001E] hover:text-[#BA0517] mt-0.5 transition-colors" title="Remove item">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between pt-1 border-t border-[#F3F3F3] text-xs">
            <!-- Staff selector -->
            <div class="flex items-center gap-1.5">
              <span class="text-[#706E6B] text-[11px] font-semibold">Staff:</span>
              <select onchange="POS.setStaff(${idx}, this.value, this.options[this.selectedIndex] ? this.options[this.selectedIndex].text : '')" 
                      class="bg-white border border-[#DDDBDA] text-[#181818] text-xs rounded px-1.5 py-0.5 focus:border-[#0176D3] focus:outline-none max-w-[150px] truncate"
                      title="Select attending staff/stylist">
                ${this.renderStaffOptions(item.staff_id, item.staff_name)}
              </select>
            </div>

            <!-- Quantity Counter -->
            <div class="flex items-center gap-1 bg-[#F3F3F3] px-1.5 py-0.5 rounded border border-[#DDDBDA]">
              <button onclick="POS.updateQuantity(${idx}, -1)" class="w-4 h-4 flex items-center justify-center text-[#3E3E3C] hover:text-[#181818] font-bold">-</button>
              <span class="font-mono text-[#181818] font-bold text-xs px-1">${item.quantity}</span>
              <button onclick="POS.updateQuantity(${idx}, 1)" class="w-4 h-4 flex items-center justify-center text-[#3E3E3C] hover:text-[#181818] font-bold">+</button>
            </div>
          </div>
        </div>
      `).join('');

      if (window.lucide) window.lucide.createIcons();
    }

    // Render Totals
    document.getElementById('pos-subtotal').textContent = `₹${totals.subtotal.toFixed(2)}`;
    document.getElementById('pos-discount').textContent = `- ₹${totals.discountAmount.toFixed(2)}`;
    document.getElementById('pos-tax').textContent = `+ ₹${totals.taxAmount.toFixed(2)}`;
    document.getElementById('pos-grand-total').textContent = `₹${totals.roundedTotal.toFixed(2)}`;
    const totalItems = this.cart.reduce((a, b) => a + b.quantity, 0);
    document.getElementById('pos-item-count-badge').textContent = `${totalItems} items`;

    // Mobile Responsive Badges & Floating Cart Bar
    const mobCartBadge = document.getElementById('pos-mob-cart-badge');
    if (mobCartBadge) mobCartBadge.textContent = totalItems;

    const floatingCart = document.getElementById('pos-mobile-floating-cart');
    const floatingItems = document.getElementById('pos-floating-items');
    const floatingTotal = document.getElementById('pos-floating-total');
    if (floatingCart) {
      if (totalItems > 0 && this.currentMobileView === 'catalog') {
        floatingCart.classList.remove('hidden');
        floatingCart.classList.remove('animate-pop-bounce');
        void floatingCart.offsetWidth; // trigger reflow
        floatingCart.classList.add('animate-pop-bounce');
        if (floatingItems) floatingItems.textContent = `${totalItems} ${totalItems === 1 ? 'Item' : 'Items'} in Cart`;
        if (floatingTotal) floatingTotal.textContent = `₹${totals.roundedTotal.toFixed(2)}`;
      } else {
        floatingCart.classList.add('hidden');
      }
    }

    // Live-update In-Cart quantity badges on the POS products grid
    if (window.App && typeof App.renderPOSProductsGrid === 'function') {
      App.renderPOSProductsGrid();
    }
  },

  // MOBILE RESPONSIVE SUBVIEW TOGGLE (CATALOG VS CART)
  currentMobileView: 'catalog',

  switchMobileView(view) {
    this.currentMobileView = view;
    const catPanel = document.getElementById('pos-catalog-panel');
    const cartPanel = document.getElementById('pos-cart-panel');
    const catBtn = document.getElementById('pos-mob-view-catalog-btn');
    const cartBtn = document.getElementById('pos-mob-view-cart-btn');
    const floatingCart = document.getElementById('pos-mobile-floating-cart');

    if (view === 'cart') {
      if (catPanel) {
        catPanel.classList.add('hidden');
        catPanel.classList.remove('flex');
      }
      if (cartPanel) {
        cartPanel.classList.remove('hidden');
        cartPanel.classList.add('flex');
      }
      if (catBtn) {
        catBtn.className = "flex-1 py-1.5 px-3 rounded text-xs font-semibold text-[#3E3E3C] hover:text-[#0176D3] flex items-center justify-center gap-1.5 transition-all";
      }
      if (cartBtn) {
        cartBtn.className = "flex-1 py-1.5 px-3 rounded text-xs font-bold bg-[#0176D3] text-white flex items-center justify-center gap-1.5 transition-all shadow-sm";
      }
      if (floatingCart) floatingCart.classList.add('hidden');
    } else {
      if (catPanel) {
        catPanel.classList.remove('hidden');
        catPanel.classList.add('flex');
      }
      if (cartPanel) {
        cartPanel.classList.add('hidden');
        cartPanel.classList.remove('flex');
      }
      if (catBtn) {
        catBtn.className = "flex-1 py-1.5 px-3 rounded text-xs font-bold bg-[#0176D3] text-white flex items-center justify-center gap-1.5 transition-all shadow-sm";
      }
      if (cartBtn) {
        cartBtn.className = "flex-1 py-1.5 px-3 rounded text-xs font-semibold text-[#3E3E3C] hover:text-[#0176D3] flex items-center justify-center gap-1.5 transition-all";
      }
      const totalItems = this.cart.reduce((a, b) => a + b.quantity, 0);
      if (floatingCart && totalItems > 0) {
        floatingCart.classList.remove('hidden');
      }
    }
    if (window.lucide) window.lucide.createIcons();
  },

  // INLINE CUSTOMER BILLING HANDLING
  handleInlinePhoneInput(val) {
    const phone = val.trim();
    const badge = document.getElementById('pos-cust-status-badge');
    const nameInput = document.getElementById('pos-inline-name');
    const clearBtn = document.getElementById('pos-inline-clear-btn');

    if (!phone) {
      this.clearCustomer();
      return;
    }

    if (clearBtn) clearBtn.classList.remove('hidden');

    // Search in loaded customer directory
    const existing = (window.App?.customersList || []).find(c => c.phone === phone);
    if (existing) {
      this.selectedCustomer = existing;
      if (nameInput) nameInput.value = existing.name;
      if (badge) {
        badge.textContent = `Existing Member (${existing.name})`;
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EBF5EE] text-[#2E844A] border border-[#A3D9B5]";
      }
      this.showCustomerInsights(existing);
      SoundEngine.beep();
    } else {
      // New Customer
      this.selectedCustomer = {
        name: nameInput?.value.trim() || 'New Customer',
        phone: phone,
        is_new: true
      };
      if (badge) {
        badge.textContent = "New Customer (Will be saved on bill)";
        badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#FFF4E8] text-[#DD7A00] border border-[#FFD599]";
      }
      const insights = document.getElementById('pos-customer-insights');
      if (insights) insights.classList.add('hidden');
    }
  },

  handleInlineNameInput(val) {
    const name = val.trim();
    const phone = document.getElementById('pos-inline-phone')?.value.trim();
    if (this.selectedCustomer) {
      this.selectedCustomer.name = name;
    } else if (phone || name) {
      this.selectedCustomer = { name: name || 'Guest', phone: phone || '' };
    }
  },

  async quickSaveInlineCustomer() {
    const phone = document.getElementById('pos-inline-phone')?.value.trim();
    const name = document.getElementById('pos-inline-name')?.value.trim();

    if (!phone || !name) {
      alert("Please enter both Customer Phone and Name");
      return;
    }

    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });
      if (res.ok) {
        const data = await res.json();
        this.selectedCustomer = data.customer;
        SoundEngine.success();
        this.handleInlinePhoneInput(phone);
        if (window.App) window.App.loadCustomers();
      } else {
        // If already exists, just link
        this.handleInlinePhoneInput(phone);
      }
    } catch (e) {
      console.warn("Quick save error:", e);
    }
  },

  showCustomerInsights(cust) {
    const insights = document.getElementById('pos-customer-insights');
    if (!insights) return;
    insights.classList.remove('hidden');
    document.getElementById('pos-insight-points').textContent = cust.loyalty_points || 0;
    document.getElementById('pos-insight-wallet').textContent = `₹${(cust.wallet_balance || 0).toFixed(2)}`;
    document.getElementById('pos-insight-khata').textContent = `₹${(cust.khata_balance || 0).toFixed(2)}`;
    document.getElementById('pos-insight-tier').textContent = cust.membership_tier || 'Regular';
  },

  selectCustomer(customer) {
    this.selectedCustomer = customer;
    const phoneInput = document.getElementById('pos-inline-phone');
    const nameInput = document.getElementById('pos-inline-name');
    if (phoneInput) phoneInput.value = customer.phone || '';
    if (nameInput) nameInput.value = customer.name || '';
    this.handleInlinePhoneInput(customer.phone || '');
  },

  clearCustomer() {
    this.selectedCustomer = null;
    const phone = document.getElementById('pos-inline-phone');
    const name = document.getElementById('pos-inline-name');
    const badge = document.getElementById('pos-cust-status-badge');
    const insights = document.getElementById('pos-customer-insights');
    const clearBtn = document.getElementById('pos-inline-clear-btn');

    if (phone) phone.value = '';
    if (name) name.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    if (insights) insights.classList.add('hidden');
    if (badge) {
      badge.textContent = "Walk-in Guest";
      badge.className = "px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F3F3F3] text-[#706E6B] border border-[#DDDBDA]";
    }
  },

  renderCustomerBar() {
    // Handled directly via inline customer bar
  },

  openCheckoutModal(preferredMode = 'Cash') {
    if (this.cart.length === 0) {
      alert("Cart is empty! Add items or services first.");
      return;
    }

    const totals = this.calculateTotals();
    document.getElementById('checkout-modal-amount').textContent = `₹${totals.roundedTotal.toFixed(2)}`;
    document.getElementById('checkout-modal').classList.remove('hidden');

    this.selectPaymentMode(preferredMode);
  },

  closeCheckoutModal() {
    document.getElementById('checkout-modal').classList.add('hidden');
  },

  selectPaymentMode(mode) {
    this.selectedPaymentMode = mode;
    const modes = ['Cash', 'UPI', 'Card', 'Wallet', 'Khata'];

    modes.forEach(m => {
      const btn = document.getElementById(`pay-mode-btn-${m}`);
      if (btn) {
        if (m === mode) {
          btn.className = "flex-1 py-2.5 px-2 rounded text-xs font-bold bg-[#0176D3] text-white shadow-sm border border-[#0176D3] flex flex-col items-center gap-1 transition-all";
        } else {
          btn.className = "flex-1 py-2.5 px-2 rounded text-xs font-semibold bg-white text-[#3E3E3C] border border-[#DDDBDA] hover:bg-[#F3F3F3] hover:text-[#0176D3] flex flex-col items-center gap-1 transition-all";
        }
      }
    });

    const upiBox = document.getElementById('checkout-upi-box');
    const totals = this.calculateTotals();

    if (mode === 'UPI') {
      if (upiBox) {
        upiBox.classList.remove('hidden');
        const qrImg = document.getElementById('checkout-upi-qr-img');
        if (qrImg) {
          qrImg.src = `/api/billing/upi-qr?amount=${totals.roundedTotal}&invoice=POS-LIVE&t=${Date.now()}`;
        }
      }
    } else {
      if (upiBox) upiBox.classList.add('hidden');
    }
  },

  async finalizeBill() {
    const totals = this.calculateTotals();
    const mode = this.selectedPaymentMode || 'Cash';

    // Auto-detect inline customer inputs if entered
    const inlinePhone = document.getElementById('pos-inline-phone')?.value.trim();
    const inlineName = document.getElementById('pos-inline-name')?.value.trim();
    let customerData = this.selectedCustomer;
    if (!customerData && (inlinePhone || inlineName)) {
      customerData = {
        name: inlineName || 'Walk-in',
        phone: inlinePhone || ''
      };
    } else if (customerData && inlineName && customerData.name !== inlineName) {
      customerData.name = inlineName;
    }

    // Verify wallet balance if wallet mode
    if (mode === 'Wallet') {
      if (!customerData || !customerData.phone) {
        alert("Please enter customer phone with wallet balance to pay via Wallet.");
        return;
      }
      if ((customerData.wallet_balance || 0) < totals.roundedTotal) {
        alert(`Insufficient wallet balance! Customer has ₹${customerData.wallet_balance || 0}, but total is ₹${totals.roundedTotal}.`);
        return;
      }
    }

    const payload = {
      customer: customerData,
      items: this.cart,
      discount_type: this.discountType,
      discount_value: this.discountValue,
      discount_amount: totals.discountAmount,
      tax_enabled: this.taxEnabled,
      tax_percent: this.taxPercent,
      tax_amount: totals.taxAmount,
      subtotal: totals.subtotal,
      grand_total: totals.grandTotal,
      rounded_total: totals.roundedTotal,
      payment_mode: mode,
      cashier: window.AuthGate?.currentUserInfo?.name || window.AuthGate?.currentUsername || 'Admin'
    };

    try {
      const res = await fetch('/api/billing/create-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create invoice");
      }

      const result = await res.json();
      SoundEngine.success();

      this.closeCheckoutModal();
      this.currentBillModal = result.bill;
      this.showBillSuccessModal(result.bill);

      // Reset Cart
      this.cart = [];
      this.discountValue = 0.0;
      this.selectedCustomer = null;
      this.renderCart();
      this.renderCustomerBar();

      // Refresh products & inventory
      if (window.App) {
        window.App.loadProducts();
        window.App.loadDashboardStats();
      }

    } catch (e) {
      alert("Billing Error: " + e.message);
    }
  },

  showBillSuccessModal(bill) {
    document.getElementById('success-modal-invoice-no').textContent = bill.invoice_number;
    document.getElementById('success-modal-amount').textContent = `₹${bill.rounded_total.toFixed(2)}`;
    document.getElementById('success-modal-mode').textContent = bill.payment_mode;
    document.getElementById('bill-success-modal').classList.remove('hidden');
  },

  printCurrentReceipt() {
    if (this.currentBillModal && window.App) {
      PrintEngine.print(
        this.currentBillModal,
        window.App.settings?.shop || {},
        window.App.settings?.tax || {},
        window.App.settings?.print || {}
      );
    }
  },

  shareCurrentWhatsApp() {
    if (this.currentBillModal && window.App) {
      PrintEngine.shareWhatsApp(this.currentBillModal, window.App.settings?.shop || {});
    }
  },

  closeSuccessModal() {
    document.getElementById('bill-success-modal').classList.add('hidden');
  }
};
