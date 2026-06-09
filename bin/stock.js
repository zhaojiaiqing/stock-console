#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const watchlistPath = path.join(rootDir, 'watchlist.json');

const MARKET_PREFIXES = new Set(['sh', 'sz', 'bj', 'hk', 'us']);
const DEFAULT_BURN_SECONDS = 3;
const SH_FUND_PREFIXES = ['50', '51', '52', '56', '58'];

const HELP = `
用法:
  stock <股票代码...>          查询指定股票，例如: stock 600519 AAPL 00700.HK
  stock                       查询自选股；如果没有自选股则进入交互模式
  stock add <股票代码...>      添加自选股
  stock add <中文名称...>      按中文名称搜索并添加自选股
  stock search <中文名称>      按中文名称搜索股票代码
  stock remove <股票代码...>   删除自选股
  stock list                  查看自选股
  stock clear                 清空自选股
  stock --keep <股票代码...>   查询后不自动清屏
  stock --seconds 5 <代码...>  查询后 5 秒自动清屏

代码格式:
  A股: 600519 / sh600519, 000001 / sz000001, 830799 / bj830799
  港股: 00700.HK / hk00700
  美股: AAPL / TSLA / usAAPL
`.trim();

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const args = options.args;
    const [command, ...rest] = args;

    if (command === '-h' || command === '--help' || command === 'help') {
      console.log(HELP);
      return;
    }

    if (command === 'add') {
      await addSymbols(rest);
      return;
    }

    if (command === 'search') {
      await searchSymbols(rest);
      return;
    }

    if (command === 'remove' || command === 'rm') {
      await removeSymbols(rest);
      return;
    }

    if (command === 'list' || command === 'ls') {
      await listSymbols();
      return;
    }

    if (command === 'clear') {
      await saveWatchlist([]);
      console.log('已清空自选股。');
      return;
    }

    const symbols = args.length > 0 ? args : await getDefaultSymbols();
    if (symbols.length === 0) {
      await interactive();
      return;
    }

    await printQuotes(symbols, { burn: options.burn, burnSeconds: options.burnSeconds });
  } catch (error) {
    console.error(`查询失败: ${error.message}`);
    process.exitCode = 1;
  }
}

async function interactive() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('输入股票代码查询，多个代码用空格分隔。输入 q 退出。');
    while (true) {
      const answer = (await rl.question('stock> ')).trim();
      if (!answer) continue;
      if (['q', 'quit', 'exit'].includes(answer.toLowerCase())) break;

      const symbols = answer.split(/\s+/);
      try {
        await printQuotes(symbols, { burn: true, burnSeconds: DEFAULT_BURN_SECONDS });
      } catch (error) {
        console.error(`查询失败: ${error.message}`);
      }
    }
  } finally {
    rl.close();
  }
}

async function getDefaultSymbols() {
  const watchlist = await loadWatchlist();
  return watchlist.map((item) => item.input);
}

async function addSymbols(symbols) {
  if (symbols.length === 0) {
    throw new Error('请提供要添加的股票代码或中文名称。');
  }

  const current = await loadWatchlist();
  const map = new Map(current.map((item) => [item.key, item]));
  const added = [];

  for (const inputSymbol of symbols) {
    const resolved = await resolveSymbolInput(inputSymbol);
    if (resolved.needsConfirmation) {
      const confirmed = await confirmResolvedSymbol(inputSymbol, resolved.matches);
      if (!confirmed) continue;
      map.set(confirmed.key, { key: confirmed.key, input: confirmed.input });
      added.push(formatResolvedSymbol(confirmed));
      continue;
    }

    map.set(resolved.key, { key: resolved.key, input: resolved.input });
    added.push(formatResolvedSymbol(resolved));
  }

  if (added.length === 0) {
    console.log('未添加任何自选股。');
    return;
  }

  await saveWatchlist([...map.values()]);
  console.log(`已添加: ${added.join(', ')}`);
}

async function searchSymbols(terms) {
  const keyword = terms.join(' ').trim();
  if (!keyword) {
    throw new Error('请提供要搜索的中文名称。');
  }

  const results = await fetchSymbolSearch(keyword);
  if (results.length === 0) {
    console.log(`没有找到匹配 "${keyword}" 的股票。`);
    return;
  }

  console.table(results.map((item, index) => ({
    '#': index + 1,
    名称: item.name,
    代码: item.input,
    市场: item.market,
    类型: item.type
  })));
}

async function removeSymbols(symbols) {
  if (symbols.length === 0) {
    throw new Error('请提供要删除的股票代码。');
  }

  const current = await loadWatchlist();
  const removeKeys = new Set(symbols.map((symbol) => normalizeSymbol(symbol).key));
  const next = current.filter((item) => !removeKeys.has(item.key));

  await saveWatchlist(next);
  console.log(`已删除: ${symbols.join(', ')}`);
}

async function listSymbols() {
  const watchlist = await loadWatchlist();
  if (watchlist.length === 0) {
    console.log('暂无自选股。');
    return;
  }

  console.table(watchlist.map((item, index) => ({
    '#': index + 1,
    code: item.input,
    marketCode: item.key
  })));
}

async function loadWatchlist() {
  try {
    const content = await fs.readFile(watchlistPath, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveWatchlist(watchlist) {
  await fs.writeFile(watchlistPath, `${JSON.stringify(watchlist, null, 2)}\n`, 'utf8');
}

async function printQuotes(inputSymbols, { burn = true, burnSeconds = DEFAULT_BURN_SECONDS } = {}) {
  const symbols = inputSymbols.map(normalizeSymbol);
  const quotes = await fetchQuotes(symbols);

  if (quotes.length === 0) {
    console.log('没有查到有效行情。');
    if (burn) await clearAfterDelay(burnSeconds);
    return;
  }

  console.table(quotes.map((quote) => ({
    名称: quote.name,
    代码: quote.symbol,
    最新价: quote.price,
    涨跌额: quote.change,
    涨跌幅: quote.changePercent,
    今开: quote.open,
    最高: quote.high,
    最低: quote.low,
    成交量: quote.volume,
    更新时间: quote.time
  })));

  if (burn) await clearAfterDelay(burnSeconds);
}

function parseArgs(rawArgs) {
  const options = {
    args: [],
    burn: true,
    burnSeconds: DEFAULT_BURN_SECONDS
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--keep' || arg === '--no-burn') {
      options.burn = false;
      continue;
    }
    if (arg === '--seconds' || arg === '-s') {
      const value = rawArgs[i + 1];
      if (!value) throw new Error('请为 --seconds 提供秒数。');
      options.burnSeconds = parseBurnSeconds(value);
      i += 1;
      continue;
    }
    options.args.push(arg);
  }

  return options;
}

function parseBurnSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 60) {
    throw new Error('--seconds 只支持 0.5 到 60 之间的数字。');
  }
  return seconds;
}

async function clearAfterDelay(seconds) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  console.clear();
}

async function fetchQuotes(symbols) {
  const query = symbols.map((symbol) => symbol.tencentCode).join(',');
  const url = `https://qt.gtimg.cn/q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'stock-console/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`行情接口返回 HTTP ${response.status}`);
  }

  const body = decodeTencentText(await response.arrayBuffer());
  return body
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseTencentLine)
    .filter(Boolean);
}

async function resolveSymbolInput(inputSymbol) {
  try {
    const parsed = normalizeSymbol(inputSymbol);
    return { ...parsed, input: inputSymbol };
  } catch (error) {
    if (!isLikelyChineseName(inputSymbol)) throw error;
  }

  const matches = await fetchSymbolSearch(inputSymbol);
  if (matches.length === 0) {
    throw new Error(`没有找到名称匹配的股票: ${inputSymbol}`);
  }

  return { needsConfirmation: true, matches };
}

async function confirmResolvedSymbol(keyword, matches) {
  console.log(`"${keyword}" 搜索结果:`);
  console.table(matches.map((item, index) => ({
    '#': index + 1,
    名称: item.name,
    代码: item.input,
    市场: item.market,
    类型: item.type
  })));

  const defaultIndex = findDefaultSearchIndex(keyword, matches);
  const hint = defaultIndex === -1 ? '输入序号确认添加，或输入 q 跳过: ' : `回车添加 #${defaultIndex + 1}，输入序号选择其它结果，或输入 q 跳过: `;
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const answer = (await rl.question(hint)).trim();
      if (!answer && defaultIndex !== -1) return matches[defaultIndex];
      if (['q', 'quit', 'exit', 'n', 'no'].includes(answer.toLowerCase())) return null;

      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= matches.length) {
        return matches[index - 1];
      }

      console.log(`请输入 1 到 ${matches.length} 的序号，或输入 q 跳过。`);
    }
  } finally {
    rl.close();
  }
}

function findDefaultSearchIndex(keyword, matches) {
  const exactIndex = matches.findIndex((item) => item.name === keyword);
  if (exactIndex !== -1) return exactIndex;
  return matches.length === 1 ? 0 : -1;
}

async function fetchSymbolSearch(keyword) {
  const normalizedKeyword = String(keyword).trim();
  if (!normalizedKeyword) return [];

  const url = `https://smartbox.gtimg.cn/s3/?t=all&q=${encodeURIComponent(normalizedKeyword)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'stock-console/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`搜索接口返回 HTTP ${response.status}`);
  }

  const body = decodeTencentText(await response.arrayBuffer());
  return parseTencentSearch(body);
}

function parseTencentSearch(body) {
  const match = String(body).match(/^v_hint="(.*)"\s*;?$/);
  if (!match || match[1] === 'N') return [];
  const payload = decodeEscapedTencentString(match[1]);

  return payload
    .split('^')
    .map((item) => item.split('~'))
    .filter((fields) => fields.length >= 5)
    .map(([market, code, name, pinyin, type]) => {
      const normalizedMarket = market.toLowerCase();
      const normalizedCode = normalizedMarket === 'us' ? code.toUpperCase() : code;
      const key = `${normalizedMarket}${normalizedCode}`;
      return {
        market: normalizedMarket,
        code: normalizedCode,
        key,
        tencentCode: key,
        name,
        pinyin,
        type,
        input: formatSearchInput(normalizedMarket, normalizedCode)
      };
    })
    .filter((item) => MARKET_PREFIXES.has(item.market));
}

function decodeEscapedTencentString(value) {
  try {
    return JSON.parse(`"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\\\\u/g, '\\u')}"`);
  } catch {
    return value;
  }
}

function formatSearchInput(market, code) {
  if (market === 'hk') return `${code}.HK`;
  if (market === 'us') return code;
  return code;
}

function formatResolvedSymbol(symbol) {
  return symbol.name ? `${symbol.name}(${symbol.input})` : symbol.input;
}

function isLikelyChineseName(value) {
  return /[\u4e00-\u9fff]/.test(String(value));
}

function decodeTencentText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  try {
    return new TextDecoder('gb18030').decode(bytes);
  } catch {
    return new TextDecoder('gbk').decode(bytes);
  }
}

function parseTencentLine(line) {
  const match = line.match(/^v_([^=]+)="(.*)"$/);
  if (!match) return null;

  const marketCode = match[1];
  const fields = match[2].split('~');
  if (fields.length < 5 || !fields[1]) return null;

  const market = marketCode.slice(0, 2);
  if (market === 'us') return parseUsQuote(marketCode, fields);
  return parseCnHkQuote(marketCode, fields);
}

function parseCnHkQuote(marketCode, fields) {
  const price = parseNumber(fields[3]);
  const previousClose = parseNumber(fields[4]);
  const change = parseNumber(fields[31], price - previousClose);
  const changePercent = parseNumber(fields[32], previousClose ? (change / previousClose) * 100 : NaN);

  return {
    name: fields[1],
    symbol: marketCode,
    price: formatNumber(price),
    change: formatSigned(change),
    changePercent: formatPercent(changePercent),
    open: formatNumber(fields[5]),
    high: formatNumber(fields[33]),
    low: formatNumber(fields[34]),
    volume: fields[6] || '-',
    time: formatTime(fields[30])
  };
}

function parseUsQuote(marketCode, fields) {
  const price = parseNumber(fields[3]);
  const previousClose = parseNumber(fields[4]);
  const change = parseNumber(fields[31], price - previousClose);
  const changePercent = parseNumber(fields[32], previousClose ? (change / previousClose) * 100 : NaN);

  return {
    name: fields[1],
    symbol: marketCode,
    price: formatNumber(price),
    change: formatSigned(change),
    changePercent: formatPercent(changePercent),
    open: formatNumber(fields[5]),
    high: formatNumber(fields[33]),
    low: formatNumber(fields[34]),
    volume: fields[6] || '-',
    time: formatTime(fields[30])
  };
}

function normalizeSymbol(inputSymbol) {
  const raw = String(inputSymbol).trim();
  if (!raw) throw new Error('股票代码不能为空。');

  const value = raw.toLowerCase();
  const prefixed = value.match(/^([a-z]{2})([0-9a-z.]+)$/);
  if (prefixed && MARKET_PREFIXES.has(prefixed[1])) {
    return toSymbol(prefixed[1], prefixed[2].replace(/\.hk$/, '').replace(/\.us$/, ''));
  }

  if (/^\d{5}\.hk$/i.test(raw)) {
    return toSymbol('hk', raw.slice(0, 5));
  }

  if (/^\d{5}$/.test(raw)) {
    return toSymbol('hk', raw);
  }

  if (/^\d{6}$/.test(raw)) {
    const prefix = resolveCnMarket(raw);
    return toSymbol(prefix, raw);
  }

  if (/^[a-z][a-z0-9.-]{0,9}$/i.test(raw)) {
    return toSymbol('us', raw.toUpperCase());
  }

  throw new Error(`无法识别股票代码: ${raw}`);
}

function resolveCnMarket(code) {
  if (code.startsWith('6') || SH_FUND_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return 'sh';
  }
  if (code.startsWith('8') || code.startsWith('4')) {
    return 'bj';
  }
  return 'sz';
}

function toSymbol(market, code) {
  const normalizedCode = market === 'us' ? code.toUpperCase() : code;
  const key = `${market}${normalizedCode}`;
  return {
    market,
    code: normalizedCode,
    key,
    tencentCode: key
  };
}

function parseNumber(value, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value) {
  const number = parseNumber(value);
  return Number.isFinite(number) ? number.toFixed(2) : '-';
}

function formatSigned(value) {
  const number = parseNumber(value);
  if (!Number.isFinite(number)) return '-';
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function formatPercent(value) {
  const number = parseNumber(value);
  if (!Number.isFinite(number)) return '-';
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return value;
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
}

await main();
