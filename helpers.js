// Helper functions for EJS templates

/**
 * Format currency value to Brazilian Real (BRL)
 * @param {number|string} value - The numeric value to format
 * @returns {string} - Formatted currency string (e.g., "R$ 1.500,00")
 */
function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) {
    return 'R$ 0,00';
  }

  const numValue = parseFloat(value);

  return numValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * Format date to Brazilian format
 * @param {Date|string} date - The date to format
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted date string
 */
function formatDate(date, options = {}) {
  if (!date) return '';

  const defaultOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options
  };

  return new Date(date).toLocaleDateString('pt-BR', defaultOptions);
}

/**
 * Format time to Brazilian format
 * @param {Date|string} date - The date/time to format
 * @param {object} options - Intl.DateTimeFormat options
 * @returns {string} - Formatted time string
 */
function formatTime(date, options = {}) {
  if (!date) return '';

  const defaultOptions = {
    hour: '2-digit',
    minute: '2-digit',
    ...options
  };

  return new Date(date).toLocaleTimeString('pt-BR', defaultOptions);
}

module.exports = {
  formatCurrency,
  formatDate,
  formatTime
};