function parseCurrencyInput(value) {
  if (value === null || value === undefined) return NaN;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : NaN;
  }

  const raw = String(value).trim();
  if (!raw) return NaN;

  const compact = raw.replace(/\s+/g, '');
  const normalized = compact.includes(',')
    ? compact.replace(/\./g, '').replace(',', '.')
    : compact.replace(/,/g, '');

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return NaN;

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isValidPositiveAmount(value) {
  return Number.isFinite(value) && value > 0;
}

module.exports = {
  parseCurrencyInput,
  isValidPositiveAmount
};
