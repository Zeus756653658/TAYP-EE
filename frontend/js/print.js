// Thermal Receipt Generator & WhatsApp Dispatch
const PrintEngine = {
  renderReceipt(bill, shop, taxSettings, printSettings) {
    const container = document.getElementById('thermal-receipt-container');
    if (!container) return;

    const itemsHtml = (bill.items || []).map(item => `
      <tr>
        <td style="padding: 2px 0; text-align: left;">
          <div><strong>${item.name}</strong></div>
          <div style="font-size: 9px; color: #555;">${item.staff_name ? `Staff: ${item.staff_name}` : ''}</div>
        </td>
        <td style="text-align: center; vertical-align: top;">${item.quantity}</td>
        <td style="text-align: right; vertical-align: top;">₹${item.price.toFixed(2)}</td>
        <td style="text-align: right; vertical-align: top;">₹${item.total.toFixed(2)}</td>
      </tr>
    `).join('');

    const upiQrImg = printSettings?.show_qr_code ? `
      <div style="text-align: center; margin-top: 10px;">
        <img src="/api/billing/upi-qr?amount=${bill.rounded_total}&invoice=${bill.invoice_number}" style="width: 110px; height: 110px; margin: 0 auto; display: block;" />
        <div style="font-size: 9px; margin-top: 2px;">Scan with GPay / PhonePe / Paytm</div>
      </div>
    ` : '';

    container.innerHTML = `
      <div style="text-align: center; border-bottom: 1px dashed #000; padding-bottom: 8px; margin-bottom: 8px;">
        <h2 style="margin: 0; font-size: 16px; font-weight: 800; text-transform: uppercase;">${shop.shop_name || 'TAYP EE'}</h2>
        <div style="font-size: 10px;">${shop.tagline || ''}</div>
        <div style="font-size: 10px;">${shop.address || ''}</div>
        <div style="font-size: 10px;">Tel: ${shop.phone || ''}</div>
        ${taxSettings?.gstin ? `<div style="font-size: 10px;"><strong>GSTIN:</strong> ${taxSettings.gstin}</div>` : ''}
      </div>

      <div style="font-size: 10px; margin-bottom: 8px; border-bottom: 1px dashed #000; padding-bottom: 6px;">
        <div><strong>Invoice:</strong> ${bill.invoice_number}</div>
        <div><strong>Date:</strong> ${bill.created_at_display || new Date().toLocaleString()}</div>
        ${bill.customer?.name ? `<div><strong>Customer:</strong> ${bill.customer.name} (${bill.customer.phone || ''})</div>` : '<div><strong>Customer:</strong> Cash Walk-In</div>'}
        <div><strong>Payment:</strong> ${bill.payment_mode}</div>
        <div><strong>Cashier:</strong> ${bill.cashier || 'Admin'}</div>
      </div>

      <table style="width: 100%; font-size: 10px; border-collapse: collapse; margin-bottom: 8px;">
        <thead>
          <tr style="border-bottom: 1px solid #000;">
            <th style="text-align: left; padding-bottom: 4px;">Item</th>
            <th style="text-align: center; padding-bottom: 4px;">Qty</th>
            <th style="text-align: right; padding-bottom: 4px;">Rate</th>
            <th style="text-align: right; padding-bottom: 4px;">Amt</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div style="border-top: 1px dashed #000; padding-top: 6px; font-size: 11px;">
        <div style="display: flex; justify-content: space-between;">
          <span>Subtotal:</span>
          <span>₹${bill.subtotal.toFixed(2)}</span>
        </div>
        ${bill.discount_amount > 0 ? `
          <div style="display: flex; justify-content: space-between; color: #000;">
            <span>Discount:</span>
            <span>- ₹${bill.discount_amount.toFixed(2)}</span>
          </div>
        ` : ''}
        ${bill.tax_amount > 0 ? `
          <div style="display: flex; justify-content: space-between;">
            <span>Tax (GST):</span>
            <span>+ ₹${bill.tax_amount.toFixed(2)}</span>
          </div>
        ` : ''}
        <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; border-top: 1px solid #000; margin-top: 4px; padding-top: 4px;">
          <span>GRAND TOTAL:</span>
          <span>₹${bill.rounded_total.toFixed(2)}</span>
        </div>
      </div>

      ${upiQrImg}

      <div style="text-align: center; margin-top: 12px; border-top: 1px dashed #000; padding-top: 8px; font-size: 9px;">
        <div>${printSettings?.footer_text || shop.footer_note || 'Thank you for your business!'}</div>
        <div style="margin-top: 2px;">Powered by TAYP EE Web POS</div>
      </div>
    `;
  },

  print(bill, shop, taxSettings, printSettings) {
    this.renderReceipt(bill, shop, taxSettings, printSettings);
    setTimeout(() => {
      window.print();
    }, 150);
  },

  shareWhatsApp(bill, shop) {
    if (!bill.customer || !bill.customer.phone) {
      alert("Customer phone number is required to send WhatsApp invoice.");
      return;
    }
    let phone = bill.customer.phone.replace(/[^0-9]/g, '');
    if (phone.length === 10) {
      phone = '91' + phone;
    }

    const itemsSummary = (bill.items || []).map(i => `• ${i.name} (x${i.quantity}) - ₹${i.total}`).join('\n');
    const msg = `*${shop.shop_name || 'TAYP EE'} - INVOICE*\n` +
      `Invoice No: ${bill.invoice_number}\n` +
      `Date: ${bill.created_at_display || new Date().toLocaleDateString()}\n\n` +
      `*Items:*\n${itemsSummary}\n\n` +
      `Subtotal: ₹${bill.subtotal}\n` +
      (bill.discount_amount > 0 ? `Discount: -₹${bill.discount_amount}\n` : '') +
      (bill.tax_amount > 0 ? `Tax (GST): ₹${bill.tax_amount}\n` : '') +
      `*Total Paid: ₹${bill.rounded_total}* (${bill.payment_mode})\n\n` +
      `Thank you for visiting ${shop.shop_name}! Have a wonderful day!`;

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }
};
