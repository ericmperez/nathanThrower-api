/**
 * Unit tests for 15-month pawn loan calculation functions
 */
import {
  calculate15MonthPayoff,
  calculatePartialPaymentOptions,
  applyPayment,
  calculateFirstMonthFee,
  calculateDaysCovered,
  calculateLoanDay,
  determinePeriod,
  daysBetween,
  addDays,
  formatCents,
  dollarsToCents,
  TERM_DAYS,
  DAYS_PER_MONTH,
  TERM_MONTHS,
  PawnLoanData,
} from '../../lib/money';

// Helper to create a test loan
function createTestLoan(overrides: Partial<PawnLoanData> = {}): PawnLoanData {
  const startDate = new Date('2025-01-01');
  return {
    id: 'test-loan-1',
    principal: 10000, // $100 in cents
    principalRemaining: 10000,
    monthlyInterestRate: 0.20, // 20%
    storageFee: 500, // $5 in cents
    startDate,
    termEndDate: addDays(startDate, TERM_DAYS),
    nextPaymentDueDate: addDays(startDate, DAYS_PER_MONTH),
    currentCycleStart: startDate,
    firstMonthFeeOwed: 0,
    firstMonthFeePaid: false,
    ...overrides,
  };
}

describe('Pawn Loan Constants', () => {
  it('should have correct term constants', () => {
    expect(TERM_MONTHS).toBe(15);
    expect(DAYS_PER_MONTH).toBe(30);
    expect(TERM_DAYS).toBe(450); // 15 * 30
  });
});

describe('Utility Functions', () => {
  describe('daysBetween', () => {
    it('should calculate days between two dates', () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-01-15');
      expect(daysBetween(start, end)).toBe(14);
    });

    it('should return 0 for same day', () => {
      const date = new Date('2025-01-01');
      expect(daysBetween(date, date)).toBe(0);
    });
  });

  describe('addDays', () => {
    it('should add days to a date', () => {
      const start = new Date('2025-01-01');
      const result = addDays(start, 30);
      expect(result.toISOString().slice(0, 10)).toBe('2025-01-31');
    });
  });

  describe('calculateLoanDay', () => {
    it('should return 1 on the start date', () => {
      const startDate = new Date('2025-01-01');
      expect(calculateLoanDay(startDate, startDate)).toBe(1);
    });

    it('should return 15 on day 15', () => {
      const startDate = new Date('2025-01-01');
      const day15 = new Date('2025-01-15');
      expect(calculateLoanDay(startDate, day15)).toBe(15);
    });
  });

  describe('determinePeriod', () => {
    it('should return first_month for days 1-30', () => {
      expect(determinePeriod(1)).toBe('first_month');
      expect(determinePeriod(15)).toBe('first_month');
      expect(determinePeriod(30)).toBe('first_month');
    });

    it('should return interest_only for days 31-450', () => {
      expect(determinePeriod(31)).toBe('interest_only');
      expect(determinePeriod(200)).toBe('interest_only');
      expect(determinePeriod(450)).toBe('interest_only');
    });

    it('should return principal_only for days 451+', () => {
      expect(determinePeriod(451)).toBe('principal_only');
      expect(determinePeriod(500)).toBe('principal_only');
      expect(determinePeriod(1000)).toBe('principal_only');
    });
  });

  describe('formatCents', () => {
    it('should format cents to dollars', () => {
      expect(formatCents(2500)).toBe('$25.00');
      expect(formatCents(100)).toBe('$1.00');
      expect(formatCents(50)).toBe('$0.50');
    });
  });

  describe('dollarsToCents', () => {
    it('should convert dollars to cents', () => {
      expect(dollarsToCents(25.00)).toBe(2500);
      expect(dollarsToCents(1.50)).toBe(150);
    });
  });
});

describe('calculateFirstMonthFee', () => {
  it('should calculate storage + full month interest', () => {
    // $100 principal, 20% rate, $5 storage
    // Interest = $100 * 0.20 = $20
    // Total = $5 + $20 = $25
    const fee = calculateFirstMonthFee(10000, 0.20, 500);
    expect(fee).toBe(2500); // $25 in cents
  });

  it('should handle zero storage fee', () => {
    const fee = calculateFirstMonthFee(10000, 0.20, 0);
    expect(fee).toBe(2000); // Just interest: $20
  });
});

describe('calculate15MonthPayoff', () => {
  describe('First Month Period (Days 1-30)', () => {
    it('should calculate first month owed on day 1', () => {
      const loan = createTestLoan();
      const state = calculate15MonthPayoff(loan, loan.startDate);

      expect(state.period).toBe('first_month');
      expect(state.loanDay).toBe(1);
      // Storage $5 + Interest $20 = $25
      expect(state.firstMonthOwed).toBe(2500);
      expect(state.interestOwed).toBe(0);
      expect(state.principalOwed).toBe(10000);
      expect(state.totalOwed).toBe(12500); // $25 first month + $100 principal
    });

    it('should calculate correctly on day 15', () => {
      const loan = createTestLoan();
      const day15 = addDays(loan.startDate, 14);
      const state = calculate15MonthPayoff(loan, day15);

      expect(state.period).toBe('first_month');
      expect(state.loanDay).toBe(15);
      expect(state.daysIntoCurrentPeriod).toBe(15);
    });

    it('should track partial first month payment', () => {
      const loan = createTestLoan({
        firstMonthFeeOwed: 1000, // $10 remaining
        firstMonthFeePaid: false,
      });
      const state = calculate15MonthPayoff(loan, loan.startDate);

      expect(state.firstMonthOwed).toBe(1000); // $10 remaining
    });
  });

  describe('Interest Only Period (Days 31-450)', () => {
    it('should calculate daily interest on day 45', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        firstMonthFeeOwed: 0,
        currentCycleStart: addDays(new Date('2025-01-01'), 30),
      });
      const day45 = addDays(loan.startDate, 44); // Day 45
      const state = calculate15MonthPayoff(loan, day45);

      expect(state.period).toBe('interest_only');
      expect(state.loanDay).toBe(45);
      expect(state.firstMonthOwed).toBe(0);

      // Daily rate: $20 / 30 = $0.67/day (67 cents)
      // Days since cycle start: daysBetween(day30, day44) = 14 days
      // Interest owed: 14 * 67 = 938 cents (~$9.38)
      expect(state.dailyInterestRate).toBe(67); // 67 cents/day
      expect(state.interestOwed).toBe(14 * 67); // 938 cents
    });

    it('should be in interest_only period on day 450', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        currentCycleStart: addDays(new Date('2025-01-01'), 420),
      });
      const day450 = addDays(loan.startDate, 449);
      const state = calculate15MonthPayoff(loan, day450);

      expect(state.period).toBe('interest_only');
      expect(state.loanDay).toBe(450);
    });
  });

  describe('Principal Only Period (Days 451+)', () => {
    it('should have zero interest on day 451', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
      });
      const day451 = addDays(loan.startDate, 450);
      const state = calculate15MonthPayoff(loan, day451);

      expect(state.period).toBe('principal_only');
      expect(state.loanDay).toBe(451);
      expect(state.interestOwed).toBe(0); // NO MORE INTEREST!
      expect(state.principalOwed).toBe(10000); // Just principal
      expect(state.totalOwed).toBe(10000);
    });

    it('should track principal remaining after partial payment', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        principalRemaining: 5000, // $50 remaining
      });
      const day500 = addDays(loan.startDate, 499);
      const state = calculate15MonthPayoff(loan, day500);

      expect(state.period).toBe('principal_only');
      expect(state.principalOwed).toBe(5000);
      expect(state.totalOwed).toBe(5000);
    });
  });

  describe('Forfeiture Tracking', () => {
    it('should calculate days until forfeiture', () => {
      const loan = createTestLoan({
        nextPaymentDueDate: new Date('2025-01-15'),
      });
      const day20 = new Date('2025-01-20'); // 5 days past due
      const state = calculate15MonthPayoff(loan, day20, 60);

      expect(state.isInGracePeriod).toBe(true);
      expect(state.daysUntilForfeiture).toBe(55); // 60 - 5
    });

    it('should return null for forfeiture when disabled', () => {
      const loan = createTestLoan();
      const state = calculate15MonthPayoff(loan, loan.startDate, null);

      expect(state.daysUntilForfeiture).toBeNull();
    });
  });
});

describe('calculateDaysCovered', () => {
  it('should calculate days covered by payment', () => {
    const loan = createTestLoan();
    // Daily rate: $20/30 = 67 cents
    // $20 payment = 20 / 0.67 = ~29 days
    const days = calculateDaysCovered(loan, 2000);
    expect(days).toBe(29); // Math.floor(2000 / 67)
  });
});

describe('calculatePartialPaymentOptions', () => {
  it('should return both Option A and B for partial payment', () => {
    const loan = createTestLoan({
      firstMonthFeePaid: true,
      currentCycleStart: addDays(new Date('2025-01-01'), 30),
    });
    const day60 = addDays(loan.startDate, 59);

    // 30 days of interest = 30 * 67 = $20.10
    // Pay $10 (1000 cents) -> covers ~15 days
    const preview = calculatePartialPaymentOptions(loan, 1000, day60);

    expect(preview.paymentAmount).toBe(1000);
    expect(preview.daysCovered).toBe(14); // Math.floor(1000 / 67)

    // Option A: new cycle
    expect(preview.optionA.option).toBe('A');
    expect(preview.optionA.daysCovered).toBe(14);

    // Option B: keep original due date
    expect(preview.optionB.option).toBe('B');
  });

  it('should indicate if can pay full amount', () => {
    const loan = createTestLoan({
      firstMonthFeePaid: true,
      currentCycleStart: addDays(new Date('2025-01-01'), 30),
    });
    const day45 = addDays(loan.startDate, 44);

    // Pay more than owed
    const preview = calculatePartialPaymentOptions(loan, 50000, day45);
    expect(preview.canPayFull).toBe(true);
  });
});

describe('applyPayment', () => {
  describe('First Month Payments', () => {
    it('should apply partial first month payment', () => {
      const loan = createTestLoan();
      const result = applyPayment(loan, 1500, null, loan.startDate); // Pay $15 of $25

      expect(result.appliedToFirstMonth).toBe(1500);
      expect(result.appliedToInterest).toBe(0);
      expect(result.appliedToPrincipal).toBe(0);
      expect(result.remainingOwed).toBe(1000); // $10 remaining
      expect(result.isFullPayment).toBe(false);
      expect(result.isRedeemed).toBe(false);
    });

    it('should complete first month with full payment', () => {
      const loan = createTestLoan();
      const result = applyPayment(loan, 2500, null, loan.startDate); // Pay full $25

      expect(result.appliedToFirstMonth).toBe(2500);
      expect(result.isFullPayment).toBe(false); // Still owe principal
    });
  });

  describe('Interest Only Payments', () => {
    it('should apply Option A - new cycle', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        currentCycleStart: addDays(new Date('2025-01-01'), 30),
      });
      const day60 = addDays(loan.startDate, 59);

      const result = applyPayment(loan, 1000, 'A', day60);

      expect(result.appliedToInterest).toBeGreaterThan(0);
      // Option A sets new due date based on days covered
    });

    it('should apply Option B - keep original date', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        currentCycleStart: addDays(new Date('2025-01-01'), 30),
      });
      const day60 = addDays(loan.startDate, 59);

      const result = applyPayment(loan, 1000, 'B', day60);

      expect(result.appliedToInterest).toBeGreaterThan(0);
      expect(result.remainingOwed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Principal Only Payments', () => {
    it('should apply all payment to principal after day 450', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        principalRemaining: 10000,
      });
      const day460 = addDays(loan.startDate, 459);

      const result = applyPayment(loan, 5000, null, day460);

      expect(result.appliedToFirstMonth).toBe(0);
      expect(result.appliedToInterest).toBe(0);
      expect(result.appliedToPrincipal).toBe(5000);
      expect(result.isRedeemed).toBe(false);
    });

    it('should redeem loan when principal fully paid', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        principalRemaining: 5000, // $50 remaining
      });
      const day460 = addDays(loan.startDate, 459);

      const result = applyPayment(loan, 5000, null, day460);

      expect(result.appliedToPrincipal).toBe(5000);
      expect(result.isRedeemed).toBe(true);
    });
  });

  describe('Full Redemption', () => {
    it('should redeem when paying total owed', () => {
      const loan = createTestLoan();
      // Total: $25 first month + $100 principal = $125
      const result = applyPayment(loan, 12500, null, loan.startDate);

      expect(result.isFullPayment).toBe(true);
      expect(result.isRedeemed).toBe(true);
    });
  });
});

describe('Example Calculations from Plan', () => {
  describe('First Month Example (Day 15, $100 principal, 20% rate, $5 storage)', () => {
    it('should calculate $25 total first month fee', () => {
      const loan = createTestLoan({
        principal: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
      });
      const day15 = addDays(loan.startDate, 14);
      const state = calculate15MonthPayoff(loan, day15);

      // Storage: $5.00
      // Interest: $20.00 (full month, 20% of $100)
      // Total: $25.00
      expect(state.firstMonthOwed).toBe(2500);
    });
  });

  describe('Interest Period Example (Day 45, 14 days into interest period)', () => {
    it('should calculate ~$9.38 owed', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        currentCycleStart: addDays(new Date('2025-01-01'), 30),
      });
      const day45 = addDays(loan.startDate, 44);
      const state = calculate15MonthPayoff(loan, day45);

      // Daily rate: $0.67/day ($20 / 30)
      // Days past: daysBetween(day30, day44) = 14 days
      // Owed: ~$9.38 (14 × $0.67)
      expect(state.dailyInterestRate).toBe(67);
      expect(state.interestOwed).toBe(14 * 67); // 938 cents ≈ $9.38
    });
  });

  describe('Partial Payment Choice ($30 owed, pays $20)', () => {
    it('should calculate 20 days covered at $1/day rate', () => {
      // Using a loan with exactly $1/day rate for simplicity
      // $30/month interest = $1/day
      const loan = createTestLoan({
        principal: 15000, // $150 at 20% = $30/month = $1/day
        monthlyInterestRate: 0.20,
        firstMonthFeePaid: true,
        currentCycleStart: addDays(new Date('2025-01-01'), 30),
      });

      // Daily rate: $30 / 30 = $1 = 100 cents
      const days = calculateDaysCovered(loan, 2000); // $20 payment
      expect(days).toBe(20);
    });
  });

  describe('First Month Partial ($25 owed, pays $15)', () => {
    it('should track $10 remaining', () => {
      const loan = createTestLoan();
      const result = applyPayment(loan, 1500, null, loan.startDate);

      // Payment: $15.00 (accepted)
      // Remaining: $10.00 (still owes to complete first month)
      expect(result.appliedToFirstMonth).toBe(1500);
      expect(result.remainingOwed).toBe(1000);
      expect(result.isFullPayment).toBe(false);
    });
  });

  describe('After 15 Months (Day 460, $100 principal remaining)', () => {
    it('should have zero interest', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        principalRemaining: 10000,
      });
      const day460 = addDays(loan.startDate, 459);
      const state = calculate15MonthPayoff(loan, day460);

      // Interest: $0.00 (NO MORE INTEREST after day 450!)
      // Principal: $100.00
      expect(state.interestOwed).toBe(0);
      expect(state.principalOwed).toBe(10000);
    });

    it('should redeem after two $50 payments', () => {
      const loan = createTestLoan({
        firstMonthFeePaid: true,
        principalRemaining: 10000,
      });
      const day460 = addDays(loan.startDate, 459);

      // First $50 payment
      const result1 = applyPayment(loan, 5000, null, day460);
      expect(result1.appliedToPrincipal).toBe(5000);
      expect(result1.isRedeemed).toBe(false);

      // Update loan with new principal
      const loanAfterFirst = { ...loan, principalRemaining: 5000 };

      // Second $50 payment
      const result2 = applyPayment(loanAfterFirst, 5000, null, day460);
      expect(result2.appliedToPrincipal).toBe(5000);
      expect(result2.isRedeemed).toBe(true);
    });
  });
});
