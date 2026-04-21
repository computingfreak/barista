const defaults = {
  age: 33,
  retirementAge: 50,
  lifeExpectancy: 90,
  monthlyIncome1: 200000,
  monthlyIncome2: 0,
  incomeGrowth: 0,
  netWorth: 0,
  domesticEquity: 33000000,
  intlEquity: 330000,
  epfCurrent: 1800000,
  epfMonthly: 33000,
  ppfCurrent: 1300000,
  ppfAnnual: 150000,
  npsCurrent: 0,
  npsAnnual: 0,
  debtCorpus: 0,
  emergencyFund: 600000,
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
  fireType: 'coast',
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
let projectionChart, cashflowChart;

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

function fireConfig(v) {
  const map = {
    lean: { multiple: 22 },
    coast: { multiple: 25, coast: true },
    regular: { multiple: 25 },
    barista: { multiple: 27 },
    fat: { multiple: 33 },
  };
  return map[v.fireType] ?? map.coast;
}

function lifeEventExpense(v, year, inflationFactor) {
  let expense = 0;
  if (v.marriageYear > 0 && v.marriageCost > 0 && year === v.marriageYear) expense += v.marriageCost * inflationFactor;
  if (v.houseYear > 0 && v.houseCost > 0 && year === v.houseYear) expense += v.houseCost * inflationFactor;
  if (v.kidsYear > 0 && v.kidsAnnualCost > 0 && year >= v.kidsYear && year < v.kidsYear + 15) {
    expense += v.kidsAnnualCost * Math.pow(1 + v.inflationEducation / 100, year - v.kidsYear);
  }
  return expense;
}

function careerBreakFactorForYear(v, year) {
  if (!v.breakStart || v.breakStart <= 0 || v.breakMonths <= 0) return 1;
  const yearOffset = year - v.breakStart;
  if (yearOffset < 0) return 1;
  const remainingAtYearStart = v.breakMonths - (yearOffset * 12);
  if (remainingAtYearStart <= 0) return 1;
  const breakMonthsThisYear = Math.min(12, remainingAtYearStart);
  return Math.max(0, (12 - breakMonthsThisYear) / 12);
}

function fireTargetForYear(v, fireRules, annualExpenseForYear, age) {
  const baseTarget = annualExpenseForYear * fireRules.multiple;
  if (!fireRules.coast) return baseTarget;
  const yearsToRetirement = Math.max(0, v.retirementAge - age);
  const realReturn = Math.max(0.01, ((v.domesticReturn - v.inflationGeneral) / 100));
  return baseTarget / Math.pow(1 + realReturn, yearsToRetirement);
}

function withdrawFromBuckets(state, amount, age, foreignAllocation) {
  let remaining = Math.max(0, amount);
  const fromCash = Math.min(state.cash, remaining); state.cash -= fromCash; remaining -= fromCash;
  const fromDebt = Math.min(state.debt, remaining); state.debt -= fromDebt; remaining -= fromDebt;
  const fromEPF = age >= 58 ? Math.min(state.epf, remaining) : 0; state.epf -= fromEPF; remaining -= fromEPF;
  const fromPPF = Math.min(state.ppf, remaining); state.ppf -= fromPPF; remaining -= fromPPF;
  const fromNPS = age >= 60 ? Math.min(state.nps, remaining) : 0; state.nps -= fromNPS; remaining -= fromNPS;
  const fromEq = Math.min(state.dom + state.intl, remaining);
  const domPart = Math.min(state.dom, fromEq * (1 - foreignAllocation / 100));
  state.dom -= domPart;
  state.intl -= (fromEq - domPart);
  remaining -= fromEq;
  return remaining;
}

function simulate(v, customReturns) {
  const years = [];
  const ages = [];
  const corpus = [];
  const expenses = [];
  const events = [];
  const contributions = [];
  const withdrawals = [];
  const startYear = new Date().getUTCFullYear();
  const projectionYears = Math.max(0, v.lifeExpectancy - v.age);
  const endYear = startYear + projectionYears;
  const fireRules = fireConfig(v);

  let dom = v.domesticEquity;
  let intl = v.intlEquity;
  let epf = v.epfCurrent;
  let ppf = v.ppfCurrent;
  let nps = v.npsCurrent;
  let debt = v.debtCorpus;
  let cash = v.emergencyFund;
  let net = v.netWorth;

  let annualIncome = (v.monthlyIncome1 + v.monthlyIncome2) * 12;
  const baseExpense = v.monthlyExpenses * 12 + v.annualInsurance + (v.domesticTrips * v.domesticTripCost) + (v.intlTrips * v.intlTripCost);
  let annualExpense = baseExpense;

  let fireYear = null;
  let failYear = null;

  for (let year = startYear; year <= endYear; year++) {
    const age = v.age + (year - startYear);
    const retired = age >= v.retirementAge;
    const careerBreakFactor = careerBreakFactorForYear(v, year);

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
      annualIncome *= (1 + v.incomeGrowth / 100);
      const effectiveIncome = annualIncome * careerBreakFactor;
      const plannedInvest = v.monthlyInvest * 12;
      const maxAffordableInvest = Math.max(0, effectiveIncome - annualExpense);
      const annualInvest = Math.min(plannedInvest, maxAffordableInvest);
      const isCoastMode = v.fireType === 'coast';
      const coastStop = isCoastMode && age >= v.coastAge;
      const investUsed = coastStop ? 0 : annualInvest;

      dom += investUsed * 0.7;
      debt += investUsed * 0.2;
      cash += investUsed * 0.1;
      epf += v.epfMonthly * 12 * careerBreakFactor;
      ppf += v.ppfAnnual;
      nps += v.npsAnnual;
      contributions.push(investUsed + v.epfMonthly * 12 * careerBreakFactor + v.ppfAnnual + v.npsAnnual);

      if (v.monthlyIncome2 > 0 && age < v.retirementAge - 5) {
        dom += v.monthlyIncome2 * 12 * 0.2 * careerBreakFactor;
      }
    } else {
      contributions.push(0);
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
      const baristaIncome = v.fireType === 'barista'
        ? v.baristaIncome * 12 * (age <= v.retirementAge + 10 ? 1 : 0.4)
        : 0;
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
    const fireNumber = fireTargetForYear(v, fireRules, annualExpenseForYear, age);
    if (total >= fireNumber && fireYear === null) fireYear = year;

    years.push(year);
    ages.push(age);
    corpus.push(total);
    expenses.push(annualExpenseForYear);
    events.push(inflatedEventExpense);
    withdrawals.push(withdrawalNeed);
  }

  const finalCorpus = corpus[corpus.length - 1] || 0;
  const success = failYear === null;
  const fireNumberNow = fireTargetForYear(v, fireRules, baseExpense, v.age);
  const yearsToFI = fireYear ? Math.max(0, fireYear - startYear) : projectionYears;

  const milestones = [0.25, 0.5, 0.75, 1].map((m) => {
    const idx = corpus.findIndex((c) => c >= fireNumberNow * m);
    return { pct: m, year: idx >= 0 ? years[idx] : null };
  });

  return { years, ages, corpus, expenses, events, contributions, withdrawals, success, fireYear, failYear, yearsToFI, fireNumberNow, finalCorpus, milestones };
}

function yearsBySavingsRate(v) {
  const annualIncome = (v.monthlyIncome1 + v.monthlyIncome2) * 12;
  const fireRules = fireConfig(v);
  const rows = [];
  for (let sr = 10; sr <= 70; sr += 10) {
    const invest = annualIncome * sr / 100;
    const annualExp = Math.max(1, annualIncome - invest);
    const fireNum = annualExp * fireRules.multiple;
    const current = v.domesticEquity + v.intlEquity + v.epfCurrent + v.ppfCurrent + v.npsCurrent + v.debtCorpus + v.emergencyFund + v.netWorth;
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
  if (typeof Chart === 'undefined') return;
  const ctx = document.getElementById('projectionChart');
  if (!ctx) return;
  if (projectionChart) projectionChart.destroy();
  const fireTargetSeries = result.ages.map((_, i) => result.expenses[i] * fireConfig(v).multiple);
  const eventPoints = result.events
    .map((ev, i) => (ev > 0 ? { x: result.ages[i], y: result.corpus[i] } : null))
    .filter(Boolean);
  projectionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: result.ages,
      datasets: [
        { label: 'Corpus vs age', data: result.corpus, borderColor: '#6bdcff' },
        { label: 'FIRE target', data: fireTargetSeries, borderColor: '#ffcc66', borderDash: [6, 4] },
        { label: 'Life event markers', data: eventPoints, showLine: false, parsing: false, pointStyle: 'triangle', pointRadius: 6, borderColor: '#ff8f8f', backgroundColor: '#ff8f8f' },
      ],
    },
  });

  const cfCtx = document.getElementById('cashflowChart');
  if (!cfCtx) return;
  if (cashflowChart) cashflowChart.destroy();
  cashflowChart = new Chart(cfCtx, {
    type: 'bar',
    data: {
      labels: result.ages,
      datasets: [
        { label: 'Annual contributions', data: result.contributions, backgroundColor: '#8affb8' },
        { label: 'Annual expenses', data: result.expenses, backgroundColor: '#7887ff' },
        { label: 'Retirement withdrawals', data: result.withdrawals, backgroundColor: '#ff8f8f' },
      ],
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
    ['The Richest Engineer', 'https://www.abhishekumar.in/'],
    ['I Will Teach You To Be Rich', 'https://www.iwillteachyoutoberich.com/'],
    ['The Almanack of Naval Ravikant', 'https://www.navalmanack.com/'],
    ['Against The Gods: The Story of Risk', 'https://www.penguinrandomhouse.com/books/324918/against-the-gods-by-peter-l-bernstein/'],
    ['The Dhandho Investor', 'https://dhandho.com/'],
    ['A Random Walk Down Wall Street', 'https://wwnorton.com/books/9781324035435'],
    ['The Intelligent Investor', 'https://www.harpercollins.com/products/the-intelligent-investor-benjamin-graham?variant=32207562715170'],
    ['When Money Dies', 'https://www.penguinrandomhouse.com/books/246448/when-money-dies-by-adam-fergusson/'],
    ['The Great Depression: A Diary', 'https://www.penguinrandomhouse.com/books/572928/the-great-depression-by-benjamin-roth/'],
    ['The Black Swan', 'https://www.penguinrandomhouse.com/books/176227/the-black-swan-by-nassim-nicholas-taleb/'],
    ['Antifragile', 'https://www.penguinrandomhouse.com/books/176226/antifragile-by-nassim-nicholas-taleb/'],
    ['Just Keep Buying', 'https://www.nickmagiulli.com/justkeepbuying/'],
    ['Die With Zero', 'https://www.hachettebookgroup.com/titles/bill-perkins/die-with-zero/9780358567097/'],
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

function renderResult(base, savingsMap, v) {
  const fiYearDisplay = base.fireYear || `Not reached by age ${v.lifeExpectancy}`;
  const kpis = [
    ['FIRE number (today)', inr(base.fireNumberNow)],
    ['FI year', fiYearDisplay],
    ['Years to FI', base.yearsToFI],
    ['Corpus at life expectancy', inr(base.finalCorpus)],
    ['Plan health', base.success ? 'On track' : `Shortfall risk from ${base.failYear}`],
    ['Selected FIRE type', v.fireType],
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
    <p>Life-event markers are shown as red triangles on the corpus chart.</p>
  `;

  drawCharts(base, v);
}

function runAll() {
  const raw = valuesFromForm();
  const v = scenarioTweaks(applyCityMode(raw));
  const base = simulate(v);
  const savingsMap = yearsBySavingsRate(v);
  renderResult(base, savingsMap, v);
}

function setup() {
  const fromStorage = localStorage.getItem('indiaFirePlan');
  if (fromStorage) loadValues(JSON.parse(fromStorage));
  else loadValues(defaults);

  renderResources();
  runAll();

  document.getElementById('runBtn').addEventListener('click', () => {
    const v = valuesFromForm();
    localStorage.setItem('indiaFirePlan', JSON.stringify(v));
    runAll();
  });
  document.getElementById('loadDefaultsBtn').addEventListener('click', () => {
    loadValues(defaults);
    runAll();
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    localStorage.removeItem('indiaFirePlan');
    loadValues(defaults);
    runAll();
  });
}

setup();
