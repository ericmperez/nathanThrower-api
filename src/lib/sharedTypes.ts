import { z } from 'zod';

// ==================== Real-Time Chat ====================
export const ChatType = z.enum(['DIRECT', 'GROUP']);
export const ChatMessageStatus = z.enum(['SENT', 'DELIVERED', 'READ']);

export type ChatType = z.infer<typeof ChatType>;
export type ChatMessageStatus = z.infer<typeof ChatMessageStatus>;

// Create direct chat (finds existing or creates new)
export const CreateDirectChatSchema = z.object({
  participantId: z.string().min(1, 'Participant ID is required'),
});

// Create group chat
export const CreateGroupChatSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  participantIds: z.array(z.string()).min(1, 'At least one participant is required'),
});

// Send message
export const SendChatMessageSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  content: z.string().min(1, 'Message content is required').max(5000),
});

// Mark messages as read
export const MarkMessagesReadSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  messageIds: z.array(z.string()).min(1, 'At least one message ID is required'),
});

// Typing indicator
export const TypingIndicatorSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
});

// Update group chat
export const UpdateGroupChatSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  addParticipantIds: z.array(z.string()).optional(),
  removeParticipantIds: z.array(z.string()).optional(),
});

export type CreateDirectChatInput = z.infer<typeof CreateDirectChatSchema>;
export type CreateGroupChatInput = z.infer<typeof CreateGroupChatSchema>;
export type SendChatMessageInput = z.infer<typeof SendChatMessageSchema>;
export type MarkMessagesReadInput = z.infer<typeof MarkMessagesReadSchema>;
export type TypingIndicatorInput = z.infer<typeof TypingIndicatorSchema>;
export type UpdateGroupChatInput = z.infer<typeof UpdateGroupChatSchema>;

// Socket event payloads
export interface SocketMessagePayload {
  chatId: string;
  content: string;
}

export interface SocketReadReceiptPayload {
  chatId: string;
  messageIds: string[];
}

export interface SocketTypingPayload {
  chatId: string;
}

// ==================== Pawn Loan System ====================
export const LoanStatus = z.enum(['ACTIVE', 'REDEEMED', 'FORFEITED', 'EXTENDED']);
export const PaymentMethod = z.enum(['CASH', 'CARD', 'CHECK']);
export const CycleOption = z.enum(['A', 'B']);
export const LoanPeriodEnum = z.enum(['first_month', 'interest_only', 'principal_only']);

export type LoanStatus = z.infer<typeof LoanStatus>;
export type PaymentMethodType = z.infer<typeof PaymentMethod>;
export type CycleOptionType = z.infer<typeof CycleOption>;

// Create Pawn Loan Schema
export const CreatePawnLoanSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  itemDescription: z.string().min(1, 'Item description is required'),
  itemCategory: z.string().min(1, 'Item category is required'),
  serialNumber: z.string().optional(),
  principal: z.number().int().min(1, 'Principal must be at least 1 cent'),
  monthlyInterestRate: z.number().min(0).max(1, 'Interest rate must be between 0 and 1'),
  storageFee: z.number().int().min(0).default(0),
});

// Payment Preview Request Schema
export const PaymentPreviewSchema = z.object({
  amount: z.number().int().min(1, 'Payment amount must be at least 1 cent'),
});

// Partial Payment Schema
export const PartialPaymentSchema = z.object({
  amount: z.number().int().min(1, 'Payment amount must be at least 1 cent'),
  paymentMethod: PaymentMethod,
  cycleOption: CycleOption.optional(),
  notes: z.string().optional(),
});

// Full Redemption Schema
export const RedeemLoanSchema = z.object({
  paymentMethod: PaymentMethod,
  notes: z.string().optional(),
});

export type CreatePawnLoanInput = z.infer<typeof CreatePawnLoanSchema>;
export type PaymentPreviewInput = z.infer<typeof PaymentPreviewSchema>;
export type PartialPaymentInput = z.infer<typeof PartialPaymentSchema>;
export type RedeemLoanInput = z.infer<typeof RedeemLoanSchema>;

// ==================== Money Utilities ====================
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function parseCurrency(dollars: string): number {
  const cleaned = dollars.replace(/[$,]/g, '');
  return Math.round(parseFloat(cleaned) * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

// System Settings Interface
export interface ForfeitureSettings {
  forfeitureEnabled: boolean;
  forfeitureDaysThreshold: number;
}
