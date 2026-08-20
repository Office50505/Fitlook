const SUBSCRIPTION_PLAN = {
  id: 'monthly_150_tokens',
  name: 'FitLook Monthly',
  orderType: 'subscription',
  dueTodayAmount: 100,
  amount: 100,
  currency: 'INR',
  tokens: 150,
  billing: 'Monthly',
  cancellation: 'Cancel future monthly billing before the next renewal from your account or by contacting support.',
  mandate: {
    setupAmount: 100,
    recurringAmount: 50000,
    firstDebitDelayHours: 24,
    frequency: 'Monthly'
  }
};

const TOP_UP_PLANS = [
  { id: 'topup_50_tokens', name: '50 Credit Top-up', orderType: 'topup', amount: 20000, dueTodayAmount: 20000, currency: 'INR', tokens: 50, billing: 'One-time' },
  { id: 'topup_75_tokens', name: '75 Credit Top-up', orderType: 'topup', amount: 30000, dueTodayAmount: 30000, currency: 'INR', tokens: 75, billing: 'One-time' },
  { id: 'topup_110_tokens', name: '110 Credit Top-up', orderType: 'topup', amount: 40000, dueTodayAmount: 40000, currency: 'INR', tokens: 110, billing: 'One-time' },
  { id: 'topup_135_tokens', name: '135 Credit Top-up', orderType: 'topup', amount: 50000, dueTodayAmount: 50000, currency: 'INR', tokens: 135, billing: 'One-time' },
  { id: 'topup_400_tokens', name: '400 Credit Top-up', orderType: 'topup', amount: 100000, dueTodayAmount: 100000, currency: 'INR', tokens: 400, billing: 'One-time' }
];

const PAYMENT_PLANS = [SUBSCRIPTION_PLAN, ...TOP_UP_PLANS];

function planById(planId) {
  const id = String(planId || '').trim();
  return PAYMENT_PLANS.find((plan) => plan.id === id) || null;
}

function minorToMajor(amount) {
  return Number(amount || 0) / 100;
}

function formatMinorAmount(amount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: amount % 100 === 0 ? 0 : 2
  }).format(minorToMajor(amount));
}

function firstRecurringPaymentDate(plan, now = new Date()) {
  const delayHours = Number(plan?.mandate?.firstDebitDelayHours || 0);
  return new Date(now.getTime() + delayHours * 60 * 60 * 1000);
}

function creditRateLabel(plan) {
  const amount = Number(plan?.orderType === 'subscription' ? plan?.mandate?.recurringAmount : plan?.amount);
  const tokens = Number(plan?.tokens || 0);
  if (!amount || !tokens) return '';
  return `${formatMinorAmount(Math.round(amount / tokens), plan.currency)} / credit`;
}

export {
  PAYMENT_PLANS,
  SUBSCRIPTION_PLAN,
  TOP_UP_PLANS,
  creditRateLabel,
  firstRecurringPaymentDate,
  formatMinorAmount,
  minorToMajor,
  planById
};
