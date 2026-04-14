-- 009: índices de performance para queries do dashboard
-- O runner já ignora ER_DUP_KEYNAME, então CREATE INDEX simples é suficiente

-- Índice composto em (user_id, date) para acelerar filtros mensais no dashboard
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date);

-- Índice composto em (user_id, type) para acelerar somas por tipo
CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);

-- Índice composto para acelerar queries de despesas fixas mensais
CREATE INDEX idx_monthly_fixed_user_year_month ON monthly_fixed_expenses(user_id, year, month);

-- Índice de status para acelerar filtros de atrasado/pendente/pago
CREATE INDEX idx_monthly_fixed_status ON monthly_fixed_expenses(user_id, status);
