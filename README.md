# TAYP EE — Next-Gen Web Point of Sale (POS) & Business Suite

> **TAYP EE** is an ultra-modern, high-performance Web-based Point of Sale (POS), Cloud CRM, Inventory, Staff Commission, and Scheduled Auto-Maintenance Suite designed for Salons, Spas, and Retail Businesses.

---

## 🚀 1-Click Launch (Kaise Chalayein?)

### Method 1: Windows 1-Click (Recommended)
Double click **`run.bat`**  
*(Yeh automatically virtual environment `.venv` activate karega, server start karega aur browser me `http://127.0.0.1:8080` open kar dega).*

### Method 2: PowerShell 1-Click
```powershell
.\run.ps1
```

Browser URL: **`http://127.0.0.1:8080`**  
API Documentation (Swagger UI): **`http://127.0.0.1:8080/docs`**

---

## ☁️ 1. Cloud-First Data Architecture (All Data on Cloud)

Aapke requirement ke mutabiq, **saara business data Cloud-based (Supabase / PostgreSQL Cloud) store hota hai**. Local computer par database store nahi hota — local machine par sirf server se poore data ka **ZIP Snapshot download** karne ka system hai.

### Features:
1. **Supabase Cloud Native**:
   - `backend/schema.sql` file di gayi hai jise aap Supabase SQL Editor me daal kar 1-click me Cloud DB ready kar sakte hain.
   - Settings me jaa kar aap apna **Supabase Project URL** aur **API Key** connect kar sakte hain.
2. **1-Click Local ZIP Download ("Download Data ZIP")**:
   - Header me direct button diya gaya hai: **`Download Data ZIP`**.
   - Is par click karte hi Cloud/Server se tamam tables (`bills`, `customers`, `products`, `stock`, `staff`, `expenses`, `appointments`, `settings`) ek single timestamped `.zip` archive me download ho jati hain.
3. **Daily 5:00 PM Maintenance Auto-Backup**:
   - Roz shaam 5:00 PM par system automatically cloud data ka ZIP backup bana kar `backups/` folder me archive karta hai.

---

## 👤 2. Inline Customer Entry (Billing Screen Par Direct Add)

**Customer add karne ke liye kisi alag page ya CRM tab par jaane ki zaroorat nahi hai**:
- Billing POS Screen par hi top par **Mobile Phone**, **Customer Name**, aur **Add** button diya gaya hai.
- **Auto-Search As You Type**: Jaise hi cashier customer ka 10-digit phone number type karta hai:
  * Agar purana customer hai, to uska naam automatically fill ho jata hai, aur screen par uske **Loyalty Points**, **Wallet Balance**, aur **Khata (Udhaar)** dues samne aa jate hain.
  * Agar naya customer hai, to cashier usi waqt uska Name type karke **Add** daba sakta hai ya direct bill bana sakta hai. Bill finalize hote hi naya customer automatically Cloud CRM me save ho jata hai!
- **1-Click Reset (✕)**: Walk-in customer par switch karne ke liye instant reset button hai.

---

## ⏰ 3. Daily 5:00 PM Scheduled Maintenance & Update System

As per system design, **din ke waqt counter par koi be-waqt update popup ya disturbance nahi hogi**. Har roz shaam **5:00 PM Sharp (17:00:00)** par system ka scheduled maintenance aur update routine execute hota hai:

1. **Pre-Maintenance Notice (4:45 PM - 4:59 PM)**:
   - Header par amber animated notice aayega:  
     `⚠️ Attention: Scheduled Daily 5:00 PM Maintenance begins in 15 minutes. Please wrap up ongoing checkouts.`
2. **Maintenance Lock at 5:00 PM (17:00 - 17:05)**:
   - System automatically full-screen maintenance & update overlay me switch ho jata hai.
   - Cloud data ka automatic **ZIP Backup** banta hai (`backups/cloud_data_backup_YYYYMMDD_HHMMSS.zip`).
   - Transaction ledger integrity check hoti hai aur updates apply ho jati hain.
3. **Emergency Bypass**:
   - Urgent billing ke liye cashier **"Emergency Cashier Bypass"** par click karke PIN `1234` daal kar counter unlock kar sakta hai.

---

## ⚡ Keyboard Shortcuts
- `F2`: Search items / New bill
- `F4`: Quick Pay Cash
- `F8`: Quick Pay Dynamic UPI QR
- `ESC`: Clear Cart
