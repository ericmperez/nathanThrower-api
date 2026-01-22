/**
 * Pawn Loan Payment Calculations - 15 Month Term Model
 *
 * Payment Periods:
 * - First Month (Days 1-30): Storage + Full Month Interest (partial allowed, must complete)
 * - Interest Only (Days 31-450): Daily interest accumulates at monthlyRate / 30
 * - Principal Only (Days 451+): NO more interest! All payments go directly to principal
 */

// ==========================================
// CONSTANTS
// ==========================================

export const TERM_MONTHS = 15;
export const DAYS_PER_MONTH = 30;
export const TERM_DAYS = TERM_MONTHS * DAYS_PER_MONTH; // 450 days

// ==========================================
// TYPES
// ==========================================

export type LoanPeriod = 'first_month' | 'interest_only' | 'principal_only';

export interface PawnLoanData {
  id: string;
  principal: number; // cents
  principalRemaining: number; // cents
  monthlyInterestRate: number; // e.g., 0.20 for 20%
  storageFee: number; // cents
  startDate: Date;
  termEndDate: Date | null;
  nextPaymentDueDate: Date;
  currentCycleStart: Date | null;
  firstMonthFeeOwed: number; // cents
  firstMonthFeePaid: boolean;
}

export interface LoanPayoffState {
  period: LoanPeriod;
  loanDay: number; // Which day of the loan (1-based)
  daysIntoCurrentPeriod: number;

  // Daily rate only applies in interest_only period
  dailyInterestRate: number; // cents per day

  // What's owed today
  firstMonthOwed: number; // cents (only if in first_month period and not fully paid)
  interestOwed: number; // cents
  principalOwed: number; // cents (full principal or remaining after principal_only payments)
  totalOwed: number; // cents

  // For display
  nextPaymentDueDate: Date;
  termEndDate: Date;
  isInGracePeriod: boolean;
  daysUntilForfeiture: number | null; // null if forfeiture disabled
}

export interface PartialPaymentOption {
  option: 'A' | 'B';
  description: string;
  daysCovered: number;
  nextDueDate: Date;
  remainingOwed: number; // cents - for Option B
}

export interface PartialPaymentPreview {
  paymentAmount: number; // cents
  daysCovered: number;
  optionA: PartialPaymentOption;
  optionB: PartialPaymentOption;
  canPayFull: boolean;
  fullPaymentAmount: number; // cents
}

export interface AppliedPayment {
  appliedToFirstMonth: number; // cents
  appliedToInterest: number; // cents
  appliedToPrincipal: number; // cents
  daysCovered: number;
  newDueDate: Date;
  remainingOwed: number; // cents
  isFullPayment: boolean;
  isRedeemed: boolean; // True if principal fully paid
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Calculate the number of days between two dates
 */
export function daysBetween(startDate: Date, endDate: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Calculate the loan day (1-based) from the start date
 */
export function calculateLoanDay(startDate: Date, currentDate: Date = new Date()): number {
  return daysBetween(startDate, currentDate) + 1;
}

/**
 * Determine which period the loan is in based on the loan day
 */
export function determinePeriod(loanDay: number): LoanPeriod {
  if (loanDay <= DAYS_PER_MONTH) {
    return 'first_month';
  } else if (loanDay <= TERM_DAYS) {
    return 'interest_only';
  } else {
    return 'principal_only';
  }
}

// ==========================================
// CORE CALCULATION FUNCTIONS
// ==========================================

/**
 * Calculate the current payoff state for a 15-month pawn loan
 *
 * @param loan - The pawn loan data
 * @param currentDate - The date to calculate for (defaults to now)
 * @param forfeitureThresholdDays - Days without payment before forfeiture (null = disabled)
 * @returns The current loan payoff state
 */
export function calculate15MonthPayoff(
  loan: PawnLoanData,
  currentDate: Date = new Date(),
  forfeitureThresholdDays: number | null = null
): LoanPayoffState {
  const loanDay = calculateLoanDay(loan.startDate, currentDate);
  const period = determinePeriod(loanDay);

  // Calculate term end date (450 days from start)
  const termEndDate = loan.termEndDate || addDays(loan.startDate, TERM_DAYS);

  // Calculate daily interest rate (for interest_only period)
  const monthlyInterest = Math.round(loan.principal * loan.monthlyInterestRate);
  const dailyInterestRate = Math.round(monthlyInterest / DAYS_PER_MONTH);

  let firstMonthOwed = 0;
  let interestOwed = 0;
  let principalOwed = loan.principalRemaining;
  let daysIntoCurrentPeriod = 0;

  if (period === 'first_month') {
    daysIntoCurrentPeriod = loanDay;

    if (!loan.firstMonthFeePaid) {
      // Full first month owed (or remaining if partial payment made)
      if (loan.firstMonthFeeOwed > 0) {
        firstMonthOwed = loan.firstMonthFeeOwed;
      } else {
        // Calculate full first month: storage + full month interest
        firstMonthOwed = loan.storageFee + monthlyInterest;
      }
    }
  } else if (period === 'interest_only') {
    daysIntoCurrentPeriod = loanDay - DAYS_PER_MONTH;

    // Calculate interest owed since last payment
    const cycleStart = loan.currentCycleStart || addDays(loan.startDate, DAYS_PER_MONTH);
    const daysSinceCycleStart = daysBetween(cycleStart, currentDate);
    interestOwed = daysSinceCycleStart * dailyInterestRate;
  } else {
    // principal_only period - NO MORE INTEREST!
    daysIntoCurrentPeriod = loanDay - TERM_DAYS;
    // Interest is 0, only principal owed
  }

  const totalOwed = firstMonthOwed + interestOwed + principalOwed;

  // Calculate days until forfeiture
  let daysUntilForfeiture: number | null = null;
  let isInGracePeriod = false;

  if (forfeitureThresholdDays !== null) {
    const daysSinceLastPaymentDue = daysBetween(loan.nextPaymentDueDate, currentDate);
    if (daysSinceLastPaymentDue > 0) {
      isInGracePeriod = true;
      daysUntilForfeiture = forfeitureThresholdDays - daysSinceLastPaymentDue;
    }
  }

  return {
    period,
    loanDay,
    daysIntoCurrentPeriod,
    dailyInterestRate,
    firstMonthOwed,
    interestOwed,
    principalOwed,
    totalOwed,
    nextPaymentDueDate: loan.nextPaymentDueDate,
    termEndDate,
    isInGracePeriod,
    daysUntilForfeiture,
  };
}

/**
 * Calculate partial payment options (A and B) for days 31-450
 *
 * Option A: Payment covers X days, those X days become NEW cycle
 * Option B: Keep original due date, only owe remaining next time
 *
 * @param loan - The pawn loan data
 * @param paymentAmount - Amount being paid (in cents)
 * @param currentDate - The date of payment
 * @returns Preview of both payment options
 */
export function calculatePartialPaymentOptions(
  loan: PawnLoanData,
  paymentAmount: number,
  currentDate: Date = new Date()
): PartialPaymentPreview {
  const state = calculate15MonthPayoff(loan, currentDate);

  // Calculate daily rate for this loan
  const monthlyInterest = Math.round(loan.principal * loan.monthlyInterestRate);
  const dailyRate = Math.round(monthlyInterest / DAYS_PER_MONTH);

  // How many days does this payment cover?
  const daysCovered = dailyRate > 0 ? Math.floor(paymentAmount / dailyRate) : 0;

  // Can they pay the full amount owed?
  const canPayFull = paymentAmount >= state.totalOwed;
  const fullPaymentAmount = state.totalOwed;

  // Option A: New cycle starts, next payment due in daysCovered days
  const optionANextDue = addDays(currentDate, daysCovered);
  const optionA: PartialPaymentOption = {
    option: 'A',
    description: `New cycle: Next payment due in ${daysCovered} days`,
    daysCovered,
    nextDueDate: optionANextDue,
    remainingOwed: 0, // Full cycle payment expected at new date
  };

  // Option B: Keep original due date, track remaining owed
  const remainingOwed = state.interestOwed - paymentAmount;
  const optionB: PartialPaymentOption = {
    option: 'B',
    description: `Keep original due date, only owe $${(Math.max(0, remainingOwed) / 100).toFixed(2)} next time`,
    daysCovered,
    nextDueDate: loan.nextPaymentDueDate,
    remainingOwed: Math.max(0, remainingOwed),
  };

  return {
    paymentAmount,
    daysCovered,
    optionA,
    optionB,
    canPayFull,
    fullPaymentAmount,
  };
}

/**
 * Calculate how many days a payment covers
 */
export function calculateDaysCovered(
  loan: PawnLoanData,
  paymentAmount: number
): number {
  const monthlyInterest = Math.round(loan.principal * loan.monthlyInterestRate);
  const dailyRate = Math.round(monthlyInterest / DAYS_PER_MONTH);

  if (dailyRate <= 0) return 0;
  return Math.floor(paymentAmount / dailyRate);
}

/**
 * Apply a payment to a loan and return the result
 *
 * @param loan - The pawn loan data
 * @param paymentAmount - Amount being paid (in cents)
 * @param cycleOption - 'A' or 'B' for partial payments in interest_only period
 * @param currentDate - The date of payment
 * @returns Details of how the payment was applied
 */
export function applyPayment(
  loan: PawnLoanData,
  paymentAmount: number,
  cycleOption: 'A' | 'B' | null,
  currentDate: Date = new Date()
): AppliedPayment {
  const state = calculate15MonthPayoff(loan, currentDate);
  let remainingPayment = paymentAmount;

  let appliedToFirstMonth = 0;
  let appliedToInterest = 0;
  let appliedToPrincipal = 0;
  let newDueDate = loan.nextPaymentDueDate;
  let remainingOwed = 0;
  let isRedeemed = false;

  if (state.period === 'first_month') {
    // First month: apply to first month fee
    if (state.firstMonthOwed > 0) {
      const toApply = Math.min(remainingPayment, state.firstMonthOwed);
      appliedToFirstMonth = toApply;
      remainingPayment -= toApply;

      // If fully paid first month, set next due date to 30 days from start
      if (toApply >= state.firstMonthOwed) {
        newDueDate = addDays(loan.startDate, DAYS_PER_MONTH * 2); // 60 days from start
      } else {
        remainingOwed = state.firstMonthOwed - toApply;
      }
    }

    // Allow remaining payment to go to principal (for full redemption)
    if (remainingPayment > 0) {
      const toApplyToPrincipal = Math.min(remainingPayment, state.principalOwed);
      appliedToPrincipal = toApplyToPrincipal;
      remainingPayment -= toApplyToPrincipal;

      if (appliedToPrincipal >= state.principalOwed) {
        isRedeemed = true;
      }
    }
  } else if (state.period === 'interest_only') {
    // Interest-only period: apply to interest
    const toApplyToInterest = Math.min(remainingPayment, state.interestOwed);
    appliedToInterest = toApplyToInterest;
    remainingPayment -= toApplyToInterest;

    // Calculate days covered
    const dailyRate = state.dailyInterestRate;
    const daysCovered = dailyRate > 0 ? Math.floor(appliedToInterest / dailyRate) : 0;

    // Apply cycle option
    if (cycleOption === 'A') {
      // Option A: New cycle, next payment in daysCovered days
      newDueDate = addDays(currentDate, Math.max(daysCovered, DAYS_PER_MONTH));
    } else if (cycleOption === 'B') {
      // Option B: Keep original due date, track remaining
      remainingOwed = Math.max(0, state.interestOwed - appliedToInterest);
    } else {
      // Full payment - set next due date to 30 days from now
      if (appliedToInterest >= state.interestOwed) {
        newDueDate = addDays(currentDate, DAYS_PER_MONTH);
      }
    }

    // Any remaining after interest goes to principal
    if (remainingPayment > 0) {
      const toApplyToPrincipal = Math.min(remainingPayment, state.principalOwed);
      appliedToPrincipal = toApplyToPrincipal;
      remainingPayment -= toApplyToPrincipal;

      // Check if redeemed
      if (appliedToPrincipal >= state.principalOwed) {
        isRedeemed = true;
      }
    }
  } else {
    // Principal-only period: ALL payment goes to principal
    const toApply = Math.min(remainingPayment, state.principalOwed);
    appliedToPrincipal = toApply;
    remainingPayment -= toApply;

    remainingOwed = state.principalOwed - toApply;

    // Check if redeemed
    if (toApply >= state.principalOwed) {
      isRedeemed = true;
    } else {
      // No specific due date in principal-only period - just track remaining
      newDueDate = currentDate;
    }
  }

  const daysCovered = calculateDaysCovered(loan, appliedToInterest || appliedToFirstMonth);
  const isFullPayment = appliedToFirstMonth + appliedToInterest + appliedToPrincipal >= state.totalOwed;

  return {
    appliedToFirstMonth,
    appliedToInterest,
    appliedToPrincipal,
    daysCovered,
    newDueDate,
    remainingOwed,
    isFullPayment,
    isRedeemed,
  };
}

/**
 * Calculate the first month fee (storage + full month interest)
 */
export function calculateFirstMonthFee(
  principal: number,
  monthlyInterestRate: number,
  storageFee: number
): number {
  const monthlyInterest = Math.round(principal * monthlyInterestRate);
  return storageFee + monthlyInterest;
}

/**
 * Format cents to dollars string
 */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parse dollars string to cents
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Calculate the total payoff amount to redeem a loan today
 */
export function calculateRedemptionAmount(
  loan: PawnLoanData,
  currentDate: Date = new Date()
): number {
  const state = calculate15MonthPayoff(loan, currentDate);
  return state.totalOwed;
}
