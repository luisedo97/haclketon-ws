import { z } from 'zod';

export const DeviceStatusSchema = z.enum([
  'DISCONNECTED',
  'CONNECTING',
  'QR_READY',
  'CONNECTED',
  'ERROR',
]);

export const TaskStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'CANCELLED',
]);

export const CreateDeviceSchema = z.object({
  label: z.string().min(1).max(100),
});

export const CreateContactSchema = z.object({
  phoneE164: z.string().min(8).max(20),
  displayName: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
  deviceId: z.string().cuid().optional(),
});

export const CreateTaskSchema = z.object({
  contactId: z.string().cuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  status: TaskStatusSchema.optional(),
  dueAt: z.string().datetime().optional(),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  status: TaskStatusSchema.optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export const AnalysisTaskItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  priority: z
    .enum(['low', 'medium', 'high'])
    .catch('medium'),
  dueHint: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => value ?? null),
});

export const AnalyzeConversationRequestSchema = z.object({
  conversationId: z.string().min(1),
  fromMessageId: z.string().min(1),
  toMessageId: z.string().min(1),
});

export const AiAnalysisOutputSchema = z.object({
  hasTasks: z.boolean(),
  summary: z.string().default(''),
  tasks: z.array(AnalysisTaskItemSchema).default([]),
});

export const PROPOSAL_CATEGORIES = [
  'logística',
  'finanzas',
  'voluntariado',
  'comunicación',
  'administración',
  'otro',
] as const;

export const CategoriaSchema = z
  .enum(PROPOSAL_CATEGORIES)
  .catch('otro');

export const ProposalStatusSchema = z.enum([
  'PENDIENTE',
  'APROBADA',
  'DESCARTADA',
  'RETENIDA',
]);

export const ProposalLlmOutputSchema = z.object({
  es_tarea: z.boolean(),
  confianza: z
    .number()
    .min(0)
    .max(1)
    .catch(0),
  titulo: z.string().default(''),
  descripcion: z.string().default(''),
  responsable_probable: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  fecha_limite: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  categoria: CategoriaSchema,
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceSchema>;
export type CreateContactInput = z.infer<typeof CreateContactSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type AnalyzeConversationRequestInput = z.infer<
  typeof AnalyzeConversationRequestSchema
>;
export type AiAnalysisOutput = z.infer<typeof AiAnalysisOutputSchema>;
export type ProposalLlmOutput = z.infer<typeof ProposalLlmOutputSchema>;
export type ProposalCategoria = (typeof PROPOSAL_CATEGORIES)[number];
export type ProposalStatusValue = z.infer<typeof ProposalStatusSchema>;
