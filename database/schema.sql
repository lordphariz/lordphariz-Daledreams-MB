CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 5 AND 40),
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(measurements) = 'object'),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(full_name);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers(phone);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  customer_name TEXT,
  expense_name TEXT,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT CHECK (category IS NULL OR category IN ('Fabrics', 'Accessories', 'Transport', 'Equipment', 'Utilities', 'Rent', 'Other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (type = 'income' AND customer_name IS NOT NULL AND expense_name IS NULL AND category IS NULL)
    OR
    (type = 'expense' AND expense_name IS NOT NULL AND category IS NOT NULL AND customer_name IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS transactions_date_idx ON transactions(date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions(type);
