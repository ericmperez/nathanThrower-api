import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth';
import {
  CreatePawnLoanSchema,
  PaymentPreviewSchema,
  PartialPaymentSchema,
  RedeemLoanSchema,
  ForfeitureSettings,
} from '../lib/sharedTypes';
import {
  calculate15MonthPayoff,
  calculatePartialPaymentOptions,
  applyPayment,
  calculateFirstMonthFee,
  addDays,
  daysBetween,
  calculateLoanDay,
  determinePeriod,
  TERM_DAYS,
  DAYS_PER_MONTH,
  PawnLoanData,
} from '../lib/money';

const router = Router();
const prisma = new PrismaClient();

// Default forfeiture settings
const DEFAULT_FORFEITURE_SETTINGS: ForfeitureSettings = {
  forfeitureEnabled: false,
  forfeitureDaysThreshold: 60,
};

/**
 * Get forfeiture settings from SystemSetting table
 */
async function getForfeitureSettings(): Promise<ForfeitureSettings> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'forfeiture_settings' },
    });

    if (setting) {
      return JSON.parse(setting.value) as ForfeitureSettings;
    }
  } catch (error) {
    console.error('Error fetching forfeiture settings:', error);
  }
  return DEFAULT_FORFEITURE_SETTINGS;
}

/**
 * Convert Prisma PawnLoan to PawnLoanData for calculations
 */
function toPawnLoanData(loan: any): PawnLoanData {
  return {
    id: loan.id,
    principal: loan.principal,
    principalRemaining: loan.principalRemaining,
    monthlyInterestRate: loan.monthlyInterestRate,
    storageFee: loan.storageFee,
    startDate: new Date(loan.startDate),
    termEndDate: loan.termEndDate ? new Date(loan.termEndDate) : null,
    nextPaymentDueDate: new Date(loan.nextPaymentDueDate),
    currentCycleStart: loan.currentCycleStart ? new Date(loan.currentCycleStart) : null,
    firstMonthFeeOwed: loan.firstMonthFeeOwed,
    firstMonthFeePaid: loan.firstMonthFeePaid,
  };
}

// ==========================================
// STATIC ROUTES (must come before /:id routes)
// ==========================================

/**
 * GET /api/pawns/settings/forfeiture - Get forfeiture settings
 */
router.get('/settings/forfeiture', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await getForfeitureSettings();
    res.json(settings);
  } catch (error) {
    console.error('Get forfeiture settings error:', error);
    res.status(500).json({ error: 'Failed to get forfeiture settings' });
  }
});

/**
 * PUT /api/pawns/settings/forfeiture - Update forfeiture settings (admin only)
 */
router.put('/settings/forfeiture', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { forfeitureEnabled, forfeitureDaysThreshold } = req.body;

    if (typeof forfeitureEnabled !== 'boolean') {
      return res.status(400).json({ error: 'forfeitureEnabled must be a boolean' });
    }

    if (forfeitureDaysThreshold !== undefined && (typeof forfeitureDaysThreshold !== 'number' || forfeitureDaysThreshold < 1)) {
      return res.status(400).json({ error: 'forfeitureDaysThreshold must be a positive number' });
    }

    const settings: ForfeitureSettings = {
      forfeitureEnabled,
      forfeitureDaysThreshold: forfeitureDaysThreshold || DEFAULT_FORFEITURE_SETTINGS.forfeitureDaysThreshold,
    };

    await prisma.systemSetting.upsert({
      where: { key: 'forfeiture_settings' },
      update: { value: JSON.stringify(settings) },
      create: { key: 'forfeiture_settings', value: JSON.stringify(settings) },
    });

    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    console.error('Update forfeiture settings error:', error);
    res.status(500).json({ error: 'Failed to update forfeiture settings' });
  }
});

/**
 * GET /api/pawns/at-risk - Get loans at risk of forfeiture
 */
router.get('/at-risk', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await getForfeitureSettings();
    const now = new Date();

    const atRiskLoans = await prisma.pawnLoan.findMany({
      where: {
        status: 'ACTIVE',
        nextPaymentDueDate: { lt: now },
      },
      orderBy: { nextPaymentDueDate: 'asc' },
    });

    const loansWithRisk = atRiskLoans.map(loan => {
      const loanData = toPawnLoanData(loan);
      const daysOverdue = daysBetween(loan.nextPaymentDueDate, now);
      const daysUntilForfeiture = settings.forfeitureEnabled
        ? Math.max(0, settings.forfeitureDaysThreshold - daysOverdue)
        : null;
      const payoffState = calculate15MonthPayoff(
        loanData, now,
        settings.forfeitureEnabled ? settings.forfeitureDaysThreshold : null
      );

      return {
        loan,
        daysOverdue,
        daysUntilForfeiture,
        payoffState,
        urgency: daysUntilForfeiture !== null && daysUntilForfeiture <= 7 ? 'critical' :
                 daysUntilForfeiture !== null && daysUntilForfeiture <= 14 ? 'high' :
                 daysOverdue > 30 ? 'medium' : 'low',
      };
    });

    res.json({
      items: loansWithRisk,
      total: loansWithRisk.length,
      forfeitureEnabled: settings.forfeitureEnabled,
      forfeitureThreshold: settings.forfeitureDaysThreshold,
    });
  } catch (error) {
    console.error('Get at-risk loans error:', error);
    res.status(500).json({ error: 'Failed to get at-risk loans' });
  }
});

/**
 * POST /api/pawns/process-forfeitures - Process forfeited loans (admin/cron only)
 */
router.post('/process-forfeitures', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await getForfeitureSettings();

    if (!settings.forfeitureEnabled) {
      return res.json({
        success: true,
        message: 'Forfeiture processing is disabled',
        processed: 0,
        forfeitedIds: [],
      });
    }

    const result = await processForfeitedLoans(settings.forfeitureDaysThreshold);

    res.json({
      success: true,
      message: `Processed ${result.count} forfeited loans`,
      processed: result.count,
      forfeitedIds: result.forfeitedIds,
    });
  } catch (error) {
    console.error('Process forfeitures error:', error);
    res.status(500).json({ error: 'Failed to process forfeitures' });
  }
});

// ==========================================
// COLLECTION ROUTES
// ==========================================

/**
 * POST /api/pawns - Create a new pawn loan
 */
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const validation = CreatePawnLoanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const data = validation.data;
    const startDate = new Date();
    const termEndDate = addDays(startDate, TERM_DAYS);
    const nextPaymentDueDate = addDays(startDate, DAYS_PER_MONTH); // First payment due in 30 days

    // Calculate first month fee
    const firstMonthFee = calculateFirstMonthFee(
      data.principal,
      data.monthlyInterestRate,
      data.storageFee
    );

    const loan = await prisma.pawnLoan.create({
      data: {
        customerId: data.customerId,
        itemDescription: data.itemDescription,
        itemCategory: data.itemCategory,
        serialNumber: data.serialNumber,
        principal: data.principal,
        principalRemaining: data.principal,
        monthlyInterestRate: data.monthlyInterestRate,
        storageFee: data.storageFee,
        startDate,
        termEndDate,
        nextPaymentDueDate,
        currentCycleStart: startDate,
        firstMonthFeeOwed: firstMonthFee,
        firstMonthFeePaid: false,
      },
    });

    // Get payoff state for response
    const loanData = toPawnLoanData(loan);
    const forfeitureSettings = await getForfeitureSettings();
    const payoffState = calculate15MonthPayoff(
      loanData,
      new Date(),
      forfeitureSettings.forfeitureEnabled ? forfeitureSettings.forfeitureDaysThreshold : null
    );

    res.status(201).json({
      loan,
      payoffState,
    });
  } catch (error) {
    console.error('Create pawn loan error:', error);
    res.status(500).json({ error: 'Failed to create pawn loan' });
  }
});

// ==========================================
// PARAMETERIZED ROUTES (must come after static routes)
// ==========================================

/**
 * GET /api/pawns/:id - Get loan details with current payoff state
 */
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const loan = await prisma.pawnLoan.findUnique({
      where: { id },
      include: {
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10, // Last 10 payments
        },
      },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    // Calculate current payoff state
    const loanData = toPawnLoanData(loan);
    const forfeitureSettings = await getForfeitureSettings();
    const payoffState = calculate15MonthPayoff(
      loanData,
      new Date(),
      forfeitureSettings.forfeitureEnabled ? forfeitureSettings.forfeitureDaysThreshold : null
    );

    res.json({
      loan,
      payoffState,
      forfeitureSettings: {
        enabled: forfeitureSettings.forfeitureEnabled,
        threshold: forfeitureSettings.forfeitureDaysThreshold,
      },
    });
  } catch (error) {
    console.error('Get pawn loan error:', error);
    res.status(500).json({ error: 'Failed to get pawn loan' });
  }
});

/**
 * GET /api/pawns - List all pawn loans with optional filters
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, customerId, page = '1', limit = '20' } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    const [loans, total] = await Promise.all([
      prisma.pawnLoan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.pawnLoan.count({ where }),
    ]);

    // Add payoff state to each loan
    const forfeitureSettings = await getForfeitureSettings();
    const loansWithState = loans.map(loan => {
      const loanData = toPawnLoanData(loan);
      const payoffState = calculate15MonthPayoff(
        loanData,
        new Date(),
        forfeitureSettings.forfeitureEnabled ? forfeitureSettings.forfeitureDaysThreshold : null
      );
      return { loan, payoffState };
    });

    res.json({
      items: loansWithState,
      total,
      page: pageNum,
      pageSize: limitNum,
    });
  } catch (error) {
    console.error('List pawn loans error:', error);
    res.status(500).json({ error: 'Failed to list pawn loans' });
  }
});

/**
 * POST /api/pawns/:id/payment-preview - Preview partial payment options
 *
 * Returns both Option A and Option B so the UI can present the choice
 */
router.post('/:id/payment-preview', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = PaymentPreviewSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { amount } = validation.data;

    const loan = await prisma.pawnLoan.findUnique({
      where: { id },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Loan is not active' });
    }

    const loanData = toPawnLoanData(loan);
    const currentDate = new Date();
    const payoffState = calculate15MonthPayoff(loanData, currentDate);

    // Only provide options for interest_only period partial payments
    if (payoffState.period === 'interest_only' && amount < payoffState.interestOwed) {
      const preview = calculatePartialPaymentOptions(loanData, amount, currentDate);

      return res.json({
        period: payoffState.period,
        totalOwed: payoffState.totalOwed,
        interestOwed: payoffState.interestOwed,
        principalOwed: payoffState.principalOwed,
        paymentAmount: amount,
        isPartialPayment: true,
        preview,
      });
    }

    // First month or full payment - no option choice needed
    res.json({
      period: payoffState.period,
      totalOwed: payoffState.totalOwed,
      firstMonthOwed: payoffState.firstMonthOwed,
      interestOwed: payoffState.interestOwed,
      principalOwed: payoffState.principalOwed,
      paymentAmount: amount,
      isPartialPayment: amount < payoffState.totalOwed,
      isFullPayment: amount >= payoffState.totalOwed,
      preview: null, // No option choice for first month or full payments
    });
  } catch (error) {
    console.error('Payment preview error:', error);
    res.status(500).json({ error: 'Failed to preview payment' });
  }
});

/**
 * POST /api/pawns/:id/partial-payment - Make a partial payment
 *
 * For interest_only period partial payments, cycleOption (A or B) is required
 */
router.post('/:id/partial-payment', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = PartialPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { amount, paymentMethod, cycleOption, notes } = validation.data;

    const loan = await prisma.pawnLoan.findUnique({
      where: { id },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Loan is not active' });
    }

    const loanData = toPawnLoanData(loan);
    const currentDate = new Date();
    const payoffState = calculate15MonthPayoff(loanData, currentDate);
    const loanDay = calculateLoanDay(loanData.startDate, currentDate);
    const period = determinePeriod(loanDay);

    // Require cycle option for partial payments in interest_only period
    if (period === 'interest_only' && amount < payoffState.interestOwed && !cycleOption) {
      return res.status(400).json({
        error: 'cycleOption (A or B) is required for partial payments in interest-only period',
      });
    }

    // Apply the payment
    const applied = applyPayment(loanData, amount, cycleOption || null, currentDate);

    // Update the loan
    const updateData: any = {
      nextPaymentDueDate: applied.newDueDate,
    };

    if (period === 'first_month') {
      updateData.firstMonthFeeOwed = applied.remainingOwed;
      if (applied.appliedToFirstMonth >= payoffState.firstMonthOwed) {
        updateData.firstMonthFeePaid = true;
        updateData.currentCycleStart = addDays(loan.startDate, DAYS_PER_MONTH);
      }
    } else if (period === 'interest_only') {
      if (cycleOption === 'A') {
        updateData.currentCycleStart = currentDate;
      }
    }

    // Update principal remaining if any applied to principal
    if (applied.appliedToPrincipal > 0) {
      updateData.principalRemaining = loan.principalRemaining - applied.appliedToPrincipal;
    }

    // Check for redemption
    if (applied.isRedeemed) {
      updateData.status = 'REDEEMED';
      updateData.redeemedAt = currentDate;
    }

    // Create payment record and update loan in transaction
    const [payment, updatedLoan] = await prisma.$transaction([
      prisma.loanPayment.create({
        data: {
          loanId: id,
          amount,
          paymentMethod,
          daysCovered: applied.daysCovered,
          cycleOption: cycleOption || null,
          newDueDate: applied.newDueDate,
          remainingOwed: applied.remainingOwed,
          appliedToFirstMonth: applied.appliedToFirstMonth,
          appliedToInterest: applied.appliedToInterest,
          appliedToPrincipal: applied.appliedToPrincipal,
          loanDayAtPayment: loanDay,
          periodAtPayment: period,
          notes,
        },
      }),
      prisma.pawnLoan.update({
        where: { id },
        data: updateData,
      }),
    ]);

    // Get updated payoff state
    const updatedLoanData = toPawnLoanData(updatedLoan);
    const newPayoffState = calculate15MonthPayoff(updatedLoanData, currentDate);

    res.json({
      success: true,
      payment,
      loan: updatedLoan,
      payoffState: newPayoffState,
      applied: {
        toFirstMonth: applied.appliedToFirstMonth,
        toInterest: applied.appliedToInterest,
        toPrincipal: applied.appliedToPrincipal,
        daysCovered: applied.daysCovered,
        isFullPayment: applied.isFullPayment,
        isRedeemed: applied.isRedeemed,
      },
      nextPaymentDate: applied.newDueDate,
      optionChosen: cycleOption || null,
    });
  } catch (error) {
    console.error('Partial payment error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

/**
 * POST /api/pawns/:id/redeem - Full redemption (pay off entire loan)
 */
router.post('/:id/redeem', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const validation = RedeemLoanSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.error.errors,
      });
    }

    const { paymentMethod, notes } = validation.data;

    const loan = await prisma.pawnLoan.findUnique({
      where: { id },
    });

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Loan is not active' });
    }

    const loanData = toPawnLoanData(loan);
    const currentDate = new Date();
    const payoffState = calculate15MonthPayoff(loanData, currentDate);
    const loanDay = calculateLoanDay(loanData.startDate, currentDate);
    const period = determinePeriod(loanDay);

    // Full redemption amount
    const redemptionAmount = payoffState.totalOwed;

    // Create payment record and update loan in transaction
    const [payment, updatedLoan] = await prisma.$transaction([
      prisma.loanPayment.create({
        data: {
          loanId: id,
          amount: redemptionAmount,
          paymentMethod,
          daysCovered: 0, // N/A for redemption
          cycleOption: null,
          newDueDate: null,
          remainingOwed: 0,
          appliedToFirstMonth: payoffState.firstMonthOwed,
          appliedToInterest: payoffState.interestOwed,
          appliedToPrincipal: payoffState.principalOwed,
          loanDayAtPayment: loanDay,
          periodAtPayment: period,
          notes: notes || 'Full redemption',
        },
      }),
      prisma.pawnLoan.update({
        where: { id },
        data: {
          status: 'REDEEMED',
          redeemedAt: currentDate,
          principalRemaining: 0,
          firstMonthFeePaid: true,
          firstMonthFeeOwed: 0,
        },
      }),
    ]);

    res.json({
      success: true,
      message: 'Loan redeemed successfully',
      payment,
      loan: updatedLoan,
      redemptionAmount,
    });
  } catch (error) {
    console.error('Redemption error:', error);
    res.status(500).json({ error: 'Failed to redeem loan' });
  }
});

/**
 * GET /api/pawns/:id/payments - Get payment history for a loan
 */
router.get('/:id/payments', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);

    const [payments, total] = await Promise.all([
      prisma.loanPayment.findMany({
        where: { loanId: id },
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.loanPayment.count({ where: { loanId: id } }),
    ]);

    res.json({
      items: payments,
      total,
      page: pageNum,
      pageSize: limitNum,
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Process loans that have exceeded the forfeiture threshold
 *
 * This function should be called periodically (via cron job or scheduled task)
 * to process loans that have exceeded the forfeiture threshold.
 *
 * @param forfeitureThresholdDays - Number of days past due before forfeiture
 * @returns Object with forfeited loan IDs and count
 */
export async function processForfeitedLoans(
  forfeitureThresholdDays: number
): Promise<{ forfeitedIds: string[]; count: number }> {
  const now = new Date();
  const thresholdDate = addDays(now, -forfeitureThresholdDays);

  // Find all ACTIVE loans where nextPaymentDueDate is before the threshold
  const loansToForfeit = await prisma.pawnLoan.findMany({
    where: {
      status: 'ACTIVE',
      nextPaymentDueDate: {
        lt: thresholdDate,
      },
    },
    select: {
      id: true,
      customerId: true,
      itemDescription: true,
      nextPaymentDueDate: true,
    },
  });

  if (loansToForfeit.length === 0) {
    return { forfeitedIds: [], count: 0 };
  }

  const forfeitedIds = loansToForfeit.map(loan => loan.id);

  // Batch update all loans to FORFEITED status
  await prisma.pawnLoan.updateMany({
    where: {
      id: { in: forfeitedIds },
    },
    data: {
      status: 'FORFEITED',
      forfeitedAt: now,
    },
  });

  console.log(`[Forfeiture] Processed ${forfeitedIds.length} loans:`, forfeitedIds);

  return {
    forfeitedIds,
    count: forfeitedIds.length,
  };
}

export default router;
