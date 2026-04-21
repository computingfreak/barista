const defaults = {
  age: 33,
  retirementAge: 50,
  lifeExpectancy: 90,
  monthlyIncome1: 200000,
  monthlyIncome2: 0,
  incomeGrowth: 6,
  netWorth: 0,
  domesticEquity: 33000000,
  intlEquity: 330000,
  epfCurrent: 1700000,
  epfAnnual: 240000,
  ppfCurrent: 1300000,
  ppfAnnual: 150000,
  npsCurrent: 0,
  npsAnnual: 50000,
  debtCorpus: 1000000,
  cashCorpus: 500000,
  monthlyExpenses: 100000,
  monthlyInvest: 100000,
  annualInsurance: 200000,
  domesticTrips: 2,
  domesticTripCost: 60000,
  intlTrips: 2,
  intlTripCost: 300000,
  cityMode: 'tier1',
  semiRetireTravel: 300000,
  domesticReturn: 11,
  intlReturnUsd: 8,
  debtReturn: 7,
  cashReturn: 4,
  inflationGeneral: 6,
  inflationHealth: 9,
  inflationEducation: 10,
  inflationLifestyle: 7,
  inrDepreciation: 3,
  foreignAllocation: 15,
  withdrawalRate: 3.8,
  guardrail: 10,
  coastAge: 42,
  baristaIncome: 50000,
  cashYears: 3,
  taxDragPre: 1,
  taxDragPost: 1.5,
  simMode: 'base',
  marriageYear: 2028,
  marriageCost: 1500000,
  houseYear: 2031,
  houseCost: 7000000,
  kidsYear: 2034,
  kidsAnnualCost: 600000,
  breakStart: 2030,
  breakMonths: 6,
  migrationMode: 'none',
};

const ids = Object.keys(defaults);
let projectionChart, sorChart, allocationChart;

function inr(v) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
}

function loadValues(source = defaults) {
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = source[id] ?? defaults[id];
  });
}

function valuesFromForm() {
  const v = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    v[id] = el.type === 'number' ? Number(el.value || 0) : el.value;
  });
  return v;
}

function applyCityMode(v) {
  const adj = { ...v };
  if (v.cityMode === 'tier1') adj.monthlyExpenses *= 1.15;
  if (v.cityMode === 'tier2') adj.monthlyExpenses *= 0.85;
  if (v.cityMode === 'geo') {
    adj.monthlyExpenses *= 1.05;
    adj.semiRetireTravel *= 1.4;
  }
  return adj;
}

function scenarioTweaks(v) {
  const m = { ...v };
  if (v.simMode === 'optimistic') {
    m.domesticReturn += 1.5;
    m.intlReturnUsd += 1;
    m.inflationGeneral -= 1;
  } else if (v.simMode === 'pessimistic') {
    m.domesticReturn -= 2;
    m.intlReturnUsd -= 1.5;
    m.inflationGeneral += 1.5;
    m.inflationHealth += 1;
  } else if (v.simMode === 'crash') {
    m.domesticReturn -= 1;
    m.inflationGeneral += 0.5;
  }
  return m;
}

function lifeEventExpense(v, year, inflationFactor) {
  let expense = 0;
  if (year === v.marriageYear) expense += v.marriageCost * inflationFactor;
  if (year === v.houseYear) expense += v.houseCost * inflationFactor;
  if (year >= v.kidsYear && year < v.kidsYear + 15) {
    expense += v.kidsAnnualCost * Math.pow(1 + v.inflationEducation / 100, year - v.kidsYear);
  }
  return expense;
}

function withdrawFromBuckets(state, amount, age, foreignAllocation) {
  let remaining = Math.max(0, amount);
  const fromCash = Math.min(state.cash, remaining); state.cash -= fromCash; remaining -= fromCash;
  const fromDebt = Math.min(state.debt, remaining * 0.8); state.debt -= fromDebt; remaining -= fromDebt;
  const fromEPF = age >= 58 ? Math.min(state.epf, remaining) : 0; state.epf -= fromEPF; remaining -= fromEPF;
  const fromPPF = Math.min(state.ppf, remaining * 0.4); state.ppf -= fromPPF; remaining -= fromPPF;
  const fromNPS = age >= 60 ? Math.min(state.nps, remaining * 0.5) : 0; state.nps -= fromNPS; remaining -= fromNPS;
  const fromEq = Math.min(state.dom + state.intl, remaining);
  const domPart = Math.min(state.dom, fromEq * (1 - foreignAllocation / 100));
  state.dom -= domPart;
  state.intl -= (fromEq - domPart);
  remaining -= fromEq;
  return remaining;
}

function simulate(v, customReturns) {
  const years = [];
  const corpus = [];
  const expenses = [];
  const events = [];
  const startYear = new Date().getUTCFullYear();
  const endYear = startYear + (v.lifeExpectancy - v.age);

  let dom = v.domesticEquity;
  let intl = v.intlEquity;
  let epf = v.epfCurrent;
  let ppf = v.ppfCurrent;
  let nps = v.npsCurrent;
  let debt = v.debtCorpus;
  let cash = v.cashCorpus;
  let net = v.netWorth;

  let annualIncome = (v.monthlyIncome1 + v.monthlyIncome2) * 12;
  const baseExpense = v.monthlyExpenses * 12 + v.annualInsurance + (v.domesticTrips * v.domesticTripCost) + (v.intlTrips * v.intlTripCost);
  let annualExpense = baseExpense;

  let fireYear = null;
  let failYear = null;

  for (let year = startYear; year <= endYear; year++) {
    const age = v.age + (year - startYear);
    const retired = age >= v.retirementAge;
    const inCareerBreak = year === v.breakStart;
    const careerBreakFactor = inCareerBreak ? Math.max(0, (12 - v.breakMonths) / 12) : 1;

    const eqR = customReturns?.domestic?.[year - startYear] ?? v.domesticReturn / 100;
    const usdR = customReturns?.intl?.[year - startYear] ?? v.intlReturnUsd / 100;
    const debtR = customReturns?.debt?.[year - startYear] ?? v.debtReturn / 100;
    const cashR = customReturns?.cash?.[year - startYear] ?? v.cashReturn / 100;

    const eqAfterTax = eqR - ((retired ? v.taxDragPost : v.taxDragPre) / 100);
    const usdAfterTaxInr = (1 + usdR) * (1 + v.inrDepreciation / 100) - 1 - ((retired ? v.taxDragPost : v.taxDragPre) / 100);

    dom *= (1 + eqAfterTax);
    intl *= (1 + usdAfterTaxInr);
    epf *= (1 + 0.0825);
    ppf *= (1 + 0.071);
    nps *= (1 + Math.max(0.04, eqAfterTax * 0.6 + debtR * 0.4));
    debt *= (1 + Math.max(0, debtR - (retired ? v.taxDragPost : v.taxDragPre) / 100));
    cash *= (1 + Math.max(0, cashR));

    if (!retired) {
      annualIncome *= (1 + v.incomeGrowth / 100) * careerBreakFactor;
      dom += v.monthlyInvest * 12 * 0.7;
      debt += v.monthlyInvest * 12 * 0.2;
      cash += v.monthlyInvest * 12 * 0.1;
      epf += v.epfAnnual;
      ppf += v.ppfAnnual;
      nps += v.npsAnnual;

      if (v.monthlyIncome2 > 0 && age < v.retirementAge - 5) {
        dom += v.monthlyIncome2 * 12 * 0.2;
      }
    }

    annualExpense *= (1 + (v.inflationGeneral + v.inflationLifestyle * 0.3 + v.inflationHealth * 0.2) / 100);
    const inflatedEventExpense = lifeEventExpense(v, year, Math.pow(1 + v.inflationGeneral / 100, year - startYear));
    let migrationFactor = 1;
    if (v.migrationMode === 'temporary' && year >= startYear + 6 && year <= startYear + 10) migrationFactor = 1.25;
    if (v.migrationMode === 'permanent' && year >= v.retirementAge - v.age + startYear) migrationFactor = 1.2;
    const annualExpenseForYear = annualExpense * migrationFactor;

    if (!retired && inflatedEventExpense > 0) {
      const preRetireState = { dom, intl, epf, ppf, nps, debt, cash };
      const eventShortfall = withdrawFromBuckets(preRetireState, inflatedEventExpense, age, v.foreignAllocation);
      ({ dom, intl, epf, ppf, nps, debt, cash } = preRetireState);
      if (eventShortfall > 0 && failYear === null) failYear = year;
    }

    let withdrawalNeed = 0;
    if (retired) {
      const baristaIncome = v.baristaIncome * 12 * (age <= v.retirementAge + 10 ? 1 : 0.4);
      withdrawalNeed = Math.max(0, annualExpenseForYear + v.semiRetireTravel - baristaIncome + inflatedEventExpense);

      const target = (annualExpenseForYear / (v.withdrawalRate / 100));
      const upper = target * (1 + v.guardrail / 100);
      const lower = target * (1 - v.guardrail / 100);
      const totalBefore = dom + intl + epf + ppf + nps + debt + cash + net;
      if (totalBefore < lower) withdrawalNeed *= 0.92;
      if (totalBefore > upper) withdrawalNeed *= 1.06;

      const cashTarget = annualExpenseForYear * v.cashYears;
      if (cash < cashTarget) {
        const fill = Math.min((dom + debt) * 0.08, cashTarget - cash);
        dom -= fill * 0.7;
        debt -= fill * 0.3;
        cash += fill;
      }

      const retiredState = { dom, intl, epf, ppf, nps, debt, cash };
      const remaining = withdrawFromBuckets(retiredState, withdrawalNeed, age, v.foreignAllocation);
      ({ dom, intl, epf, ppf, nps, debt, cash } = retiredState);

      if (remaining > 0 && failYear === null) failYear = year;
    }

    if (v.simMode === 'crash' && (year === startYear + 1 || year === startYear + 2)) {
      dom *= 0.75;
      intl *= 0.78;
    }

    const total = dom + intl + epf + ppf + nps + debt + cash + net;
    const fireNumber = annualExpenseForYear / (v.withdrawalRate / 100);
    if (total >= fireNumber && fireYear === null) fireYear = year;

    years.push(year);
    corpus.push(total);
    expenses.push(annualExpenseForYear);
    events.push(inflatedEventExpense + withdrawalNeed);
  }

  const finalCorpus = corpus[corpus.length - 1] || 0;
  const success = failYear === null;
  const fireNumberNow = (baseExpense) / (v.withdrawalRate / 100);
  const yearsToFI = fireYear ? fireYear - startYear : null;

  const milestones = [0.25, 0.5, 0.75, 1].map((m) => {
    const idx = corpus.findIndex((c) => c >= fireNumberNow * m);
    return { pct: m, year: idx >= 0 ? years[idx] : null };
  });

  return { years, corpus, expenses, events, success, fireYear, failYear, yearsToFI, fireNumberNow, finalCorpus, milestones };
}

function randomNormal(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function runMonteCarlo(v, runs = 1000) {
  let success = 0;
  const ending = [];
  const years = v.lifeExpectancy - v.age + 1;
  for (let i = 0; i < runs; i++) {
    const customReturns = {
      domestic: Array.from({ length: years }, () => (v.domesticReturn + randomNormal(0, 16)) / 100),
      intl: Array.from({ length: years }, () => (v.intlReturnUsd + randomNormal(0, 18)) / 100),
      debt: Array.from({ length: years }, () => Math.max(-0.02, (v.debtReturn + randomNormal(0, 3)) / 100)),
      cash: Array.from({ length: years }, () => Math.max(0, (v.cashReturn + randomNormal(0, 1.5)) / 100)),
    };
    const result = simulate(v, customReturns);
    if (result.success) success++;
    ending.push(result.finalCorpus);
  }
  ending.sort((a, b) => a - b);
  return {
    successRate: (success / runs) * 100,
    p10: ending[Math.floor(runs * 0.1)],
    p50: ending[Math.floor(runs * 0.5)],
    p90: ending[Math.floor(runs * 0.9)],
  };
}

function historicalBacktest(v) {
  const historical = [
    { d: 0.42, i: 0.35, debt: 0.08 }, { d: -0.52, i: -0.38, debt: 0.07 }, { d: 0.23, i: 0.16, debt: 0.06 },
    { d: 0.51, i: 0.27, debt: 0.07 }, { d: 0.08, i: 0.05, debt: 0.07 }, { d: -0.05, i: -0.09, debt: 0.08 },
    { d: 0.13, i: 0.11, debt: 0.07 }, { d: 0.31, i: 0.19, debt: 0.07 }, { d: 0.04, i: 0.08, debt: 0.07 },
    { d: -0.12, i: -0.2, debt: 0.08 }, { d: 0.76, i: 0.34, debt: 0.08 }, { d: 0.03, i: 0.07, debt: 0.07 },
    { d: 0.29, i: 0.12, debt: 0.07 }, { d: 0.11, i: 0.15, debt: 0.07 }, { d: -0.03, i: -0.06, debt: 0.07 },
  ];
  const years = v.lifeExpectancy - v.age + 1;
  const paths = [];
  for (let offset = 0; offset < historical.length; offset++) {
    const customReturns = {
      domestic: Array.from({ length: years }, (_, y) => historical[(y + offset) % historical.length].d),
      intl: Array.from({ length: years }, (_, y) => historical[(y + offset) % historical.length].i),
      debt: Array.from({ length: years }, (_, y) => historical[(y + offset) % historical.length].debt),
      cash: Array.from({ length: years }, () => v.cashReturn / 100),
    };
    const r = simulate(v, customReturns);
    paths.push(r.finalCorpus);
  }
  paths.sort((a, b) => a - b);
  return {
    worst: paths[0],
    median: paths[Math.floor(paths.length / 2)],
    best: paths[paths.length - 1],
  };
}

function yearsBySavingsRate(v) {
  const annualIncome = (v.monthlyIncome1 + v.monthlyIncome2) * 12;
  const rows = [];
  for (let sr = 10; sr <= 70; sr += 10) {
    const invest = annualIncome * sr / 100;
    const annualExp = Math.max(1, annualIncome - invest);
    const fireNum = annualExp / (v.withdrawalRate / 100);
    const current = v.domesticEquity + v.intlEquity + v.epfCurrent + v.ppfCurrent + v.npsCurrent + v.debtCorpus + v.cashCorpus + v.netWorth;
    const r = (v.domesticReturn - v.inflationGeneral) / 100;
    let years = 0;
    let c = current;
    while (c < fireNum && years < 80) {
      c = c * (1 + r) + invest;
      years++;
    }
    rows.push({ sr, years: years >= 80 ? '80+' : years });
  }
  return rows;
}

function drawCharts(result, v) {
  const ctx = document.getElementById('projectionChart');
  if (projectionChart) projectionChart.destroy();
  projectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: result.years,
      datasets: [
        { label: 'Projected corpus', data: result.corpus, borderColor: '#6bdcff' },
        { label: 'Annual expense', data: result.expenses, borderColor: '#ffcc66' },
        { label: 'Event + withdrawal pressure', data: result.events, borderColor: '#ff8f8f' },
      ],
    },
  });

  const sor = result.corpus.slice(1).map((v2, i) => ((v2 / result.corpus[i]) - 1) * 100);
  const sorCtx = document.getElementById('sorChart');
  if (sorChart) sorChart.destroy();
  sorChart = new Chart(sorCtx, {
    type: 'bar',
    data: { labels: result.years.slice(1), datasets: [{ label: 'Sequence-of-returns (%)', data: sor, backgroundColor: '#8affb8' }] },
  });

  const allocCtx = document.getElementById('allocationChart');
  if (allocationChart) allocationChart.destroy();
  const ageBasedEquity = Math.max(25, Math.min(85, 100 - v.age + (v.retirementAge - v.age > 15 ? 5 : -5)));
  allocationChart = new Chart(allocCtx, {
    type: 'doughnut',
    data: {
      labels: ['Equity', 'Debt', 'Cash'],
      datasets: [{ data: [ageBasedEquity, 100 - ageBasedEquity - 10, 10], backgroundColor: ['#6bdcff', '#7887ff', '#8affb8'] }],
    },
  });
}

function renderResources() {
  const books = [
    ['Let\'s Talk Money', 'https://www.monikahalan.com/lets-talk-money/'],
    ['The Psychology of Money', 'https://www.goodreads.com/book/show/41881472-the-psychology-of-money'],
    ['The Simple Path to Wealth', 'https://jlcollinsnh.com/stock-series/'],
    ['Your Money or Your Life', 'https://www.penguinrandomhouse.com/books/310554/your-money-or-your-life-by-vicki-robin-and-joe-dominguez/'],
    ['Rich Dad Poor Dad', 'https://www.richdad.com/'],
    ['The Millionaire Next Door', 'https://www.millionairenextdoor.com/'],
    ['Coffee Can Investing', 'https://www.penguin.co.in/book/coffee-can-investing/'],
    ['The Richest Man in Babylon', 'https://www.penguinrandomhouse.com/books/588012/the-richest-man-in-babylon-by-george-s-clason/'],
    ['Die With Zero', 'https://www.diewithzerobook.com/'],
    ['The Little Book of Common Sense Investing', 'https://www.wiley.com/en-us/The+Little+Book+of+Common+Sense+Investing-p-9781119404507'],
    ['Bogleheads Wiki', 'https://www.bogleheads.org/wiki/Main_Page'],
    ['FreeFincal', 'https://freefincal.com/'],
  ];

  const tools = [
    ['FIRECalc', 'https://www.firecalc.com/'],
    ['FIRE Planner', 'https://fire-planner.com/'],
    ['FIRENum', 'https://firenum.com/'],
    ['SparkCalc Retirement', 'https://sparkcalc.com/retirement-calculator'],
    ['BridgeToFI', 'https://bridgetofi.com/'],
    ['RetireEarly App', 'https://www.retireearlyapp.com/'],
    ['MyPlanIQ FIRE Calculator', 'https://www.myplaniq.com/'],
    ['FIRECalcHub', 'https://firecalchub.com/'],
    ['NerdWallet FIRE Calculator', 'https://www.nerdwallet.com/article/investing/fire-financial-independence-retire-early'],
    ['Portfolio Visualizer', 'https://www.portfoliovisualizer.com/'],
    ['cFIREsim', 'https://www.cfiresim.com/'],
    ['Engaging Data FIRE Calculator', 'https://engaging-data.com/fire-calculator/'],
    ['WalletBurst Coast FIRE', 'https://walletburst.com/tools/coast-fire-calc/'],
    ['Investment Moats SIP Calculator', 'https://www.investmentmoats.com/financial-independence/'],
    ['Calculator.net Investment', 'https://www.calculator.net/investment-calculator.html'],
    ['Moneycontrol SIP', 'https://www.moneycontrol.com/personal-finance/tools/sip-calculator.html'],
    ['Value Research Mutual Fund', 'https://www.valueresearchonline.com/'],
    ['INDmoney Goal Planner', 'https://www.indmoney.com/'],
    ['ET Money Retirement', 'https://www.etmoney.com/'],
    ['Kuvera Goal Planner', 'https://kuvera.in/'],
  ];

  document.getElementById('bookLinks').innerHTML = books.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noreferrer">${n}</a></li>`).join('');
  document.getElementById('toolLinks').innerHTML = tools.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noreferrer">${n}</a></li>`).join('');
}

function renderResult(base, monte, hist, savingsMap, v) {
  const kpis = [
    ['FIRE number (today)', inr(base.fireNumberNow)],
    ['FI year', base.fireYear || 'Not reached'],
    ['Years to FI', base.yearsToFI ?? 'N/A'],
    ['Corpus at life expectancy', inr(base.finalCorpus)],
    ['Monte Carlo success', `${monte.successRate.toFixed(1)}%`],
    ['Historical worst case corpus', inr(hist.worst)],
  ];
  document.getElementById('kpis').innerHTML = kpis.map(([k, v2]) => `<div class="kpi"><span>${k}</span><strong>${v2}</strong></div>`).join('');

  document.getElementById('milestones').innerHTML = `<h3>Milestones</h3><ul>${base.milestones.map((m) => `<li>${Math.round(m.pct * 100)}% FIRE: ${m.year ?? 'Not reached'}</li>`).join('')}</ul>`;

  const rows = savingsMap.map((r) => `<tr><td>${r.sr}%</td><td>${r.years}</td></tr>`).join('');
  document.getElementById('scenarioTable').innerHTML = `
    <h3>Savings Rate vs Years-to-FI</h3>
    <table>
      <thead><tr><th>Savings Rate</th><th>Years to FI (approx)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Monte Carlo corpus distribution: P10 ${inr(monte.p10)}, P50 ${inr(monte.p50)}, P90 ${inr(monte.p90)}.</p>
    <p>Historical rolling outcomes: Worst ${inr(hist.worst)}, Median ${inr(hist.median)}, Best ${inr(hist.best)}.</p>
  `;

  drawCharts(base, v);
}

function runAll() {
  const raw = valuesFromForm();
  const v = scenarioTweaks(applyCityMode(raw));
  const base = simulate(v);
  const monte = runMonteCarlo(v, 1000);
  const hist = historicalBacktest(v);
  const savingsMap = yearsBySavingsRate(v);
  renderResult(base, monte, hist, savingsMap, v);
}

function decodePlanFromURL() {
  const hash = location.hash.replace('#plan=', '');
  if (!hash) return null;
  try {
    const decoded = JSON.parse(atob(hash));
    return decoded;
  } catch {
    return null;
  }
}

function setup() {
  const fromUrl = decodePlanFromURL();
  const fromStorage = localStorage.getItem('indiaFirePlan');
  if (fromUrl) loadValues(fromUrl);
  else if (fromStorage) loadValues(JSON.parse(fromStorage));
  else loadValues(defaults);

  renderResources();
  runAll();

  document.getElementById('runBtn').addEventListener('click', () => {
    const v = valuesFromForm();
    localStorage.setItem('indiaFirePlan', JSON.stringify(v));
    runAll();
  });
  document.getElementById('monteCarloBtn').addEventListener('click', runAll);
  document.getElementById('historicalBtn').addEventListener('click', runAll);
  document.getElementById('loadDefaultsBtn').addEventListener('click', () => {
    loadValues(defaults);
    runAll();
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    localStorage.removeItem('indiaFirePlan');
    loadValues(defaults);
    runAll();
  });
  document.getElementById('sharePlanBtn').addEventListener('click', async () => {
    const v = valuesFromForm();
    const encoded = btoa(JSON.stringify(v));
    const url = `${location.origin}${location.pathname}#plan=${encoded}`;
    await navigator.clipboard.writeText(url);
    alert('Shareable URL copied to clipboard.');
  });
}

setup();
