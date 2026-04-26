-- Unifica categorias antigas de encargos na categoria correta "Despesas empresa RC2"
-- para evitar duplicidade no ranking de categorias em Relatorios.

-- 1) Reatribui transacoes de "Encargos Empresa(s)" para "Despesas empresa RC2"
UPDATE transactions t
INNER JOIN categories c_old ON c_old.id = t.category_id
INNER JOIN categories c_new
  ON c_new.user_id = c_old.user_id
 AND c_new.type = 'expense'
 AND LOWER(TRIM(c_new.name)) = 'despesas empresa rc2'
SET t.category_id = c_new.id
WHERE c_old.type = 'expense'
  AND LOWER(TRIM(c_old.name)) IN ('encargos empresa', 'encargos empresas')
  AND c_old.id <> c_new.id;

-- 2) Reatribui despesas fixas de "Encargos Empresa(s)" para "Despesas empresa RC2"
UPDATE fixed_expenses fe
INNER JOIN categories c_old ON c_old.id = fe.category_id
INNER JOIN categories c_new
  ON c_new.user_id = c_old.user_id
 AND c_new.type = 'expense'
 AND LOWER(TRIM(c_new.name)) = 'despesas empresa rc2'
SET fe.category_id = c_new.id
WHERE c_old.type = 'expense'
  AND LOWER(TRIM(c_old.name)) IN ('encargos empresa', 'encargos empresas')
  AND c_old.id <> c_new.id;

-- 3) Remove a categoria antiga se ela ficar sem uso apos a migracao
DELETE c_old
FROM categories c_old
INNER JOIN categories c_new
  ON c_new.user_id = c_old.user_id
 AND c_new.type = 'expense'
 AND LOWER(TRIM(c_new.name)) = 'despesas empresa rc2'
LEFT JOIN transactions t
  ON t.user_id = c_old.user_id
 AND t.category_id = c_old.id
LEFT JOIN fixed_expenses fe
  ON fe.user_id = c_old.user_id
 AND fe.category_id = c_old.id
WHERE c_old.type = 'expense'
  AND LOWER(TRIM(c_old.name)) IN ('encargos empresa', 'encargos empresas')
  AND c_old.id <> c_new.id
  AND COALESCE(c_old.is_default, 0) = 0
  AND t.id IS NULL
  AND fe.id IS NULL;
