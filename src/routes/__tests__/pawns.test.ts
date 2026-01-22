/**
 * Integration tests for Pawn Loan API endpoints
 */
import request from 'supertest';
import express from 'express';
import { addDays, DAYS_PER_MONTH, TERM_DAYS } from '../../lib/money';

// Create mock objects that will be used in the mock factory
const mockPawnLoan = {
  create: jest.fn(),
  findUnique: jest.fn(),
  findMany: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  count: jest.fn(),
};

const mockLoanPayment = {
  create: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
};

const mockSystemSetting = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
};

const mockTransaction = jest.fn();

// Mock @prisma/client - factory function runs at import time
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    pawnLoan: mockPawnLoan,
    loanPayment: mockLoanPayment,
    systemSetting: mockSystemSetting,
    $transaction: mockTransaction,
  })),
}));

// Mock auth middleware
jest.mock('../../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-123', role: 'admin', email: 'admin@test.com' };
    next();
  },
  AuthRequest: {},
  requireAdmin: (req: any, res: any, next: any) => {
    next();
  },
}));

// Import routes AFTER mocking
import pawnsRoutes from '../pawns';
import { errorHandler } from '../../middleware/errorHandler';

describe('Pawn Loan API Endpoints', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/api/pawns', pawnsRoutes);
    app.use(errorHandler);

    // Default mock for forfeiture settings
    mockSystemSetting.findUnique.mockResolvedValue(null);
  });

  describe('POST /api/pawns - Create Pawn Loan', () => {
    it('should create a new pawn loan with correct initial state', async () => {
      const createData = {
        customerId: 'customer-123',
        itemDescription: 'Gold Ring',
        itemCategory: 'jewelry',
        serialNumber: 'SN12345',
        principal: 10000, // $100
        monthlyInterestRate: 0.20,
        storageFee: 500, // $5
      };

      const mockCreatedLoan = {
        id: 'loan-123',
        ...createData,
        principalRemaining: 10000,
        startDate: new Date(),
        termEndDate: addDays(new Date(), TERM_DAYS),
        nextPaymentDueDate: addDays(new Date(), DAYS_PER_MONTH),
        currentCycleStart: new Date(),
        firstMonthFeeOwed: 2500, // $25 (storage + interest)
        firstMonthFeePaid: false,
        status: 'ACTIVE',
        redeemedAt: null,
        forfeitedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPawnLoan.create.mockResolvedValue(mockCreatedLoan);

      const response = await request(app)
        .post('/api/pawns')
        .send(createData)
        .expect(201);

      expect(response.body).toHaveProperty('loan');
      expect(response.body).toHaveProperty('payoffState');
      expect(response.body.loan.principal).toBe(10000);
      expect(response.body.loan.firstMonthFeeOwed).toBe(2500);
      expect(mockPawnLoan.create).toHaveBeenCalled();
    });

    it('should reject invalid loan data', async () => {
      const invalidData = {
        customerId: '', // Invalid - empty
        principal: -100, // Invalid - negative
      };

      const response = await request(app)
        .post('/api/pawns')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Validation failed');
      expect(mockPawnLoan.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/pawns/:id - Get Loan Details', () => {
    it('should return loan with payoff state', async () => {
      const startDate = new Date('2025-01-01');
      const mockLoan = {
        id: 'loan-123',
        customerId: 'customer-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, DAYS_PER_MONTH),
        currentCycleStart: startDate,
        firstMonthFeeOwed: 2500,
        firstMonthFeePaid: false,
        status: 'ACTIVE',
        payments: [],
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);

      const response = await request(app)
        .get('/api/pawns/loan-123')
        .expect(200);

      expect(response.body).toHaveProperty('loan');
      expect(response.body).toHaveProperty('payoffState');
      expect(response.body.payoffState).toHaveProperty('period');
      expect(response.body.payoffState).toHaveProperty('totalOwed');
    });

    it('should return 404 for non-existent loan', async () => {
      mockPawnLoan.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/pawns/non-existent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Loan not found');
    });
  });

  describe('POST /api/pawns/:id/payment-preview - Preview Payment', () => {
    it('should return Option A and B for partial payment in interest_only period', async () => {
      const startDate = new Date('2025-01-01');
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 60),
        currentCycleStart: addDays(startDate, 30),
        firstMonthFeeOwed: 0,
        firstMonthFeePaid: true,
        status: 'ACTIVE',
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);

      // Mock current date to be day 45
      jest.useFakeTimers().setSystemTime(addDays(startDate, 44));

      const response = await request(app)
        .post('/api/pawns/loan-123/payment-preview')
        .send({ amount: 500 }) // $5 partial payment
        .expect(200);

      jest.useRealTimers();

      expect(response.body).toHaveProperty('period', 'interest_only');
      expect(response.body).toHaveProperty('isPartialPayment', true);
      expect(response.body).toHaveProperty('preview');
      expect(response.body.preview).toHaveProperty('optionA');
      expect(response.body.preview).toHaveProperty('optionB');
    });

    it('should not require option for first month payments', async () => {
      const startDate = new Date();
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 30),
        currentCycleStart: startDate,
        firstMonthFeeOwed: 2500,
        firstMonthFeePaid: false,
        status: 'ACTIVE',
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);

      const response = await request(app)
        .post('/api/pawns/loan-123/payment-preview')
        .send({ amount: 1000 })
        .expect(200);

      expect(response.body).toHaveProperty('period', 'first_month');
      expect(response.body.preview).toBeNull();
    });
  });

  describe('POST /api/pawns/:id/partial-payment - Make Payment', () => {
    it('should require cycleOption for partial payments in interest_only period', async () => {
      const startDate = new Date('2025-01-01');
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 60),
        currentCycleStart: addDays(startDate, 30),
        firstMonthFeeOwed: 0,
        firstMonthFeePaid: true,
        status: 'ACTIVE',
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);

      // Mock current date to be day 45
      jest.useFakeTimers().setSystemTime(addDays(startDate, 44));

      const response = await request(app)
        .post('/api/pawns/loan-123/partial-payment')
        .send({
          amount: 500,
          paymentMethod: 'CASH',
          // Missing cycleOption!
        })
        .expect(400);

      jest.useRealTimers();

      expect(response.body.error).toContain('cycleOption');
    });

    it('should process payment with Option A (new cycle)', async () => {
      const startDate = new Date('2025-01-01');
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 60),
        currentCycleStart: addDays(startDate, 30),
        firstMonthFeeOwed: 0,
        firstMonthFeePaid: true,
        status: 'ACTIVE',
      };

      const mockPayment = {
        id: 'payment-123',
        loanId: 'loan-123',
        amount: 1000,
        paymentMethod: 'CASH',
        daysCovered: 14,
        cycleOption: 'A',
        createdAt: new Date(),
      };

      const updatedLoan = {
        ...mockLoan,
        currentCycleStart: new Date(),
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);
      mockTransaction.mockResolvedValue([mockPayment, updatedLoan]);

      jest.useFakeTimers().setSystemTime(addDays(startDate, 44));

      const response = await request(app)
        .post('/api/pawns/loan-123/partial-payment')
        .send({
          amount: 1000,
          paymentMethod: 'CASH',
          cycleOption: 'A',
        })
        .expect(200);

      jest.useRealTimers();

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('optionChosen', 'A');
      expect(response.body).toHaveProperty('nextPaymentDate');
    });

    it('should process first month partial payment without cycleOption', async () => {
      const startDate = new Date();
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 30),
        currentCycleStart: startDate,
        firstMonthFeeOwed: 2500,
        firstMonthFeePaid: false,
        status: 'ACTIVE',
      };

      const mockPayment = {
        id: 'payment-123',
        loanId: 'loan-123',
        amount: 1500,
        paymentMethod: 'CASH',
        createdAt: new Date(),
      };

      const updatedLoan = {
        ...mockLoan,
        firstMonthFeeOwed: 1000,
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);
      mockTransaction.mockResolvedValue([mockPayment, updatedLoan]);

      const response = await request(app)
        .post('/api/pawns/loan-123/partial-payment')
        .send({
          amount: 1500, // $15 of $25
          paymentMethod: 'CASH',
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.applied.toFirstMonth).toBe(1500);
    });
  });

  describe('POST /api/pawns/:id/redeem - Full Redemption', () => {
    it('should redeem a loan and update status', async () => {
      const startDate = new Date();
      const mockLoan = {
        id: 'loan-123',
        principal: 10000,
        principalRemaining: 10000,
        monthlyInterestRate: 0.20,
        storageFee: 500,
        startDate,
        termEndDate: addDays(startDate, TERM_DAYS),
        nextPaymentDueDate: addDays(startDate, 30),
        currentCycleStart: startDate,
        firstMonthFeeOwed: 2500,
        firstMonthFeePaid: false,
        status: 'ACTIVE',
      };

      const mockPayment = {
        id: 'payment-123',
        loanId: 'loan-123',
        amount: 12500,
        paymentMethod: 'CASH',
        notes: 'Full redemption',
        createdAt: new Date(),
      };

      const redeemedLoan = {
        ...mockLoan,
        status: 'REDEEMED',
        redeemedAt: new Date(),
        principalRemaining: 0,
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);
      mockTransaction.mockResolvedValue([mockPayment, redeemedLoan]);

      const response = await request(app)
        .post('/api/pawns/loan-123/redeem')
        .send({ paymentMethod: 'CASH' })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.loan.status).toBe('REDEEMED');
    });

    it('should reject redemption for non-active loans', async () => {
      const mockLoan = {
        id: 'loan-123',
        status: 'REDEEMED', // Already redeemed
      };

      mockPawnLoan.findUnique.mockResolvedValue(mockLoan);

      const response = await request(app)
        .post('/api/pawns/loan-123/redeem')
        .send({ paymentMethod: 'CASH' })
        .expect(400);

      expect(response.body.error).toBe('Loan is not active');
    });
  });

  describe('GET /api/pawns - List Loans', () => {
    it('should return paginated list with payoff states', async () => {
      const startDate = new Date();
      const mockLoans = [
        {
          id: 'loan-1',
          principal: 10000,
          principalRemaining: 10000,
          monthlyInterestRate: 0.20,
          storageFee: 500,
          startDate,
          termEndDate: addDays(startDate, TERM_DAYS),
          nextPaymentDueDate: addDays(startDate, 30),
          currentCycleStart: startDate,
          firstMonthFeeOwed: 2500,
          firstMonthFeePaid: false,
          status: 'ACTIVE',
        },
      ];

      mockPawnLoan.findMany.mockResolvedValue(mockLoans);
      mockPawnLoan.count.mockResolvedValue(1);

      const response = await request(app)
        .get('/api/pawns')
        .query({ page: 1, limit: 20 })
        .expect(200);

      expect(response.body).toHaveProperty('items');
      expect(response.body).toHaveProperty('total', 1);
      expect(response.body.items[0]).toHaveProperty('loan');
      expect(response.body.items[0]).toHaveProperty('payoffState');
    });

    it('should filter by status', async () => {
      mockPawnLoan.findMany.mockResolvedValue([]);
      mockPawnLoan.count.mockResolvedValue(0);

      await request(app)
        .get('/api/pawns')
        .query({ status: 'ACTIVE' })
        .expect(200);

      expect(mockPawnLoan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE' },
        })
      );
    });
  });

  describe('Forfeiture Settings', () => {
    it('should update forfeiture settings', async () => {
      mockSystemSetting.upsert.mockResolvedValue({
        key: 'forfeiture_settings',
        value: JSON.stringify({ forfeitureEnabled: true, forfeitureDaysThreshold: 90 }),
      });

      const response = await request(app)
        .put('/api/pawns/settings/forfeiture')
        .send({
          forfeitureEnabled: true,
          forfeitureDaysThreshold: 90,
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body.settings.forfeitureEnabled).toBe(true);
      expect(response.body.settings.forfeitureDaysThreshold).toBe(90);
    });

    it('should get forfeiture settings', async () => {
      mockSystemSetting.findUnique.mockResolvedValue({
        key: 'forfeiture_settings',
        value: JSON.stringify({ forfeitureEnabled: true, forfeitureDaysThreshold: 60 }),
      });

      const response = await request(app)
        .get('/api/pawns/settings/forfeiture')
        .expect(200);

      expect(response.body).toHaveProperty('forfeitureEnabled', true);
      expect(response.body).toHaveProperty('forfeitureDaysThreshold', 60);
    });

    it('should return defaults when no settings exist', async () => {
      mockSystemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/pawns/settings/forfeiture')
        .expect(200);

      expect(response.body).toHaveProperty('forfeitureEnabled', false);
      expect(response.body).toHaveProperty('forfeitureDaysThreshold', 60);
    });
  });
});
