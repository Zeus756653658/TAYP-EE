-- ====================================================================
-- TAYP EE Web POS — Supabase Cloud Database DDL
-- Run this in your Supabase Project -> SQL Editor to initialize Cloud DB
-- ====================================================================

-- 1. Products & Services
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    type TEXT DEFAULT 'service',
    price NUMERIC NOT NULL,
    cost_price NUMERIC DEFAULT 0,
    duration_mins INT DEFAULT 30,
    barcode TEXT,
    commission_percent NUMERIC DEFAULT 20.0,
    tax_percent NUMERIC DEFAULT 18.0
);
ALTER TABLE products DISABLE ROW LEVEL SECURITY;

-- 2. Customers CRM & Loyalty
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    email TEXT,
    address TEXT,
    loyalty_points INT DEFAULT 0,
    wallet_balance NUMERIC DEFAULT 0,
    khata_balance NUMERIC DEFAULT 0,
    total_visits INT DEFAULT 0,
    total_spend NUMERIC DEFAULT 0,
    membership_tier TEXT DEFAULT 'Regular',
    notes TEXT
);
ALTER TABLE customers DISABLE ROW LEVEL SECURITY;

-- 3. Sales & Bills
CREATE TABLE IF NOT EXISTS bills (
    invoice_number TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_at_display TEXT,
    customer JSONB,
    items JSONB NOT NULL,
    subtotal NUMERIC NOT NULL,
    discount_type TEXT DEFAULT 'flat',
    discount_value NUMERIC DEFAULT 0,
    discount_amount NUMERIC DEFAULT 0,
    tax_enabled BOOLEAN DEFAULT TRUE,
    tax_percent NUMERIC DEFAULT 18.0,
    tax_amount NUMERIC DEFAULT 0,
    grand_total NUMERIC NOT NULL,
    rounded_total NUMERIC NOT NULL,
    payment_mode TEXT NOT NULL,
    split_details JSONB,
    notes TEXT,
    cashier TEXT DEFAULT 'Admin',
    status TEXT DEFAULT 'Paid'
);
ALTER TABLE bills DISABLE ROW LEVEL SECURITY;

-- 4. Inventory Stock
CREATE TABLE IF NOT EXISTS stock (
    product_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    current_stock INT DEFAULT 0,
    min_alert_level INT DEFAULT 5,
    cost_price NUMERIC DEFAULT 0,
    selling_price NUMERIC NOT NULL,
    supplier TEXT
);
ALTER TABLE stock DISABLE ROW LEVEL SECURITY;

-- 5. Staff Directory
CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    base_commission NUMERIC DEFAULT 20.0,
    active BOOLEAN DEFAULT TRUE
);
ALTER TABLE staff DISABLE ROW LEVEL SECURITY;

-- 6. Daily Expenses
CREATE TABLE IF NOT EXISTS daily_expenses (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    payment_mode TEXT DEFAULT 'Cash',
    description TEXT NOT NULL,
    recorded_by TEXT DEFAULT 'Admin'
);
ALTER TABLE daily_expenses DISABLE ROW LEVEL SECURITY;

-- 7. Appointments & Bookings
CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    service_name TEXT NOT NULL,
    staff_name TEXT NOT NULL,
    appointment_date TEXT NOT NULL,
    appointment_time TEXT NOT NULL,
    status TEXT DEFAULT 'Confirmed',
    notes TEXT
);
ALTER TABLE appointments DISABLE ROW LEVEL SECURITY;

-- 8. Key-Value Settings (Shop, Tax, UPI, Printer)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    data JSONB NOT NULL
);
ALTER TABLE settings DISABLE ROW LEVEL SECURITY;

-- 9. Activity & Security Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    user_name TEXT DEFAULT 'Admin',
    action TEXT NOT NULL,
    details TEXT
);
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;
