CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 5 AND 40),
  measurements TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(measurements)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  customer_name TEXT,
  expense_name TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  date TEXT NOT NULL CHECK (date GLOB '????-??-??'),
  description TEXT NOT NULL DEFAULT '',
  category TEXT CHECK (category IS NULL OR category IN ('Fabrics', 'Accessories', 'Transport', 'Equipment', 'Utilities', 'Rent', 'Other')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (type = 'income' AND customer_name IS NOT NULL AND expense_name IS NULL AND category IS NULL)
    OR
    (type = 'expense' AND expense_name IS NOT NULL AND category IS NOT NULL AND customer_name IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type);
