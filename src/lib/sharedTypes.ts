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
