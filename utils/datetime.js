const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const localeData = require('dayjs/plugin/localeData');
require('dayjs/locale/pt-br');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localeData);

dayjs.locale('pt-br');

const DEFAULT_TZ = 'America/Sao_Paulo';

dayjs.tz.setDefault(DEFAULT_TZ);

function toTzDate(input) {
  if (!input) return dayjs().tz(DEFAULT_TZ);
  return dayjs(input).tz(DEFAULT_TZ);
}

function nowInTz() {
  return dayjs().tz(DEFAULT_TZ);
}

function getMonthKey(input) {
  return toTzDate(input).format('YYYY-MM');
}

function parseMonthKey(monthKey) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthKey || '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function isValidMonthKey(monthKey) {
  return !!parseMonthKey(monthKey);
}

function getMonthStart(monthKey) {
  if (!isValidMonthKey(monthKey)) return '';
  return dayjs.tz(`${monthKey}-01`, 'YYYY-MM-DD', DEFAULT_TZ).startOf('month').format('YYYY-MM-DD');
}

function getMonthEnd(monthKey) {
  if (!isValidMonthKey(monthKey)) return '';
  return dayjs.tz(`${monthKey}-01`, 'YYYY-MM-DD', DEFAULT_TZ).endOf('month').format('YYYY-MM-DD');
}

function getMonthLabel(monthKey) {
  if (!isValidMonthKey(monthKey)) return '';
  return dayjs.tz(`${monthKey}-01`, 'YYYY-MM-DD', DEFAULT_TZ).format('MMMM [de] YYYY');
}

function getMonthShortLabel(monthKey) {
  if (!isValidMonthKey(monthKey)) return '';
  return dayjs.tz(`${monthKey}-01`, 'YYYY-MM-DD', DEFAULT_TZ).format('MMM/YY');
}

function getDateKey(input) {
  return toTzDate(input).format('YYYY-MM-DD');
}

function addMonths(input, amount) {
  return toTzDate(input).add(amount, 'month');
}

function fromParts(year, month, day = 1) {
  return dayjs.tz(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 'YYYY-MM-DD', DEFAULT_TZ);
}

function getDaysInMonth(year, month) {
  return fromParts(year, month, 1).daysInMonth();
}

function buildDate(year, month, day) {
  const safeDay = Math.min(Math.max(Number(day) || 1, 1), getDaysInMonth(year, month));
  return fromParts(year, month, safeDay).format('YYYY-MM-DD');
}

function todayDate() {
  return nowInTz().format('YYYY-MM-DD');
}

module.exports = {
  DEFAULT_TZ,
  toTzDate,
  nowInTz,
  getMonthKey,
  parseMonthKey,
  isValidMonthKey,
  getMonthStart,
  getMonthEnd,
  getMonthLabel,
  getMonthShortLabel,
  getDateKey,
  addMonths,
  fromParts,
  getDaysInMonth,
  buildDate,
  todayDate
};
