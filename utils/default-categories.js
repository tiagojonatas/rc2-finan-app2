const DEFAULT_CATEGORY_CATALOG = {
  income: [
    { name: 'Salario', color: '#14B8A6' },
    { name: 'Extras', color: '#22C55E' },
    { name: 'Outros', color: '#06B6D4' }
  ],
  expense: [
    { name: 'Educacao', color: '#6366F1' },
    { name: 'Saude', color: '#EF4444' },
    { name: 'Despesas Cartoes', color: '#0EA5E9' },
    { name: 'Energia', color: '#F59E0B' },
    { name: 'Agua', color: '#06B6D4' },
    { name: 'Moradia', color: '#8B5CF6' },
    { name: 'Lazer', color: '#F59E0B' }
  ]
};

const ALLOWED_DEFAULT_CATEGORY_NAMES = {
  income: ['salario', 'salario', 'extras', 'extra', 'outros'],
  expense: [
    'educacao', 'educacao',
    'saude', 'saude',
    'despesas cartoes', 'despesas cartao',
    'energia',
    'agua', 'agua',
    'moradia',
    'lazer'
  ]
};

function getAllowedDefaultNamesByType() {
  return {
    income: [...new Set(ALLOWED_DEFAULT_CATEGORY_NAMES.income.map((name) => String(name || '').trim().toLowerCase()))],
    expense: [...new Set(ALLOWED_DEFAULT_CATEGORY_NAMES.expense.map((name) => String(name || '').trim().toLowerCase()))]
  };
}

function getDefaultCategoryCatalog() {
  return {
    income: [...DEFAULT_CATEGORY_CATALOG.income],
    expense: [...DEFAULT_CATEGORY_CATALOG.expense]
  };
}

module.exports = {
  getAllowedDefaultNamesByType,
  getDefaultCategoryCatalog
};
