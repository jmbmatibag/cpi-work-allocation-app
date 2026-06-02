import { z } from 'zod';

export const AddNameSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const RenameSchema = z.object({
  name: z.string().min(1).max(100),
});

export const AddSubCategorySchema = z.object({
  name: z.string().min(1).max(100),
  parentMainCategoryId: z.number().int(),
  clients: z.array(z.string()).optional().default([]),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const SetSubCategoryClientsSchema = z.object({
  clients: z.array(z.string()),
});

export const AddWorkTypeSchema = z.object({
  name: z.string().min(1).max(100),
  parents: z.array(z.string()).min(1),
});

export const SetWorkTypeParentsSchema = z.object({
  parents: z.array(z.string()).min(1),
});

export const InferenceRuleSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  subCategory: z.string().nullable().optional(),
  workType: z.string().min(1),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const BulkInferenceRulesSchema = z.object({
  rules: z.array(InferenceRuleSchema),
});

export const BulkUpdateWorkTypeParentsSchema = z.object({
  updates: z.array(
    z.object({
      id: z.number().int(),
      parents: z.array(z.string()).min(1),
    }),
  ).min(1),
});

export type AddNameInput = z.infer<typeof AddNameSchema>;
export type RenameInput = z.infer<typeof RenameSchema>;
export type AddSubCategoryInput = z.infer<typeof AddSubCategorySchema>;
export type SetSubCategoryClientsInput = z.infer<
  typeof SetSubCategoryClientsSchema
>;
export type AddWorkTypeInput = z.infer<typeof AddWorkTypeSchema>;
export type SetWorkTypeParentsInput = z.infer<typeof SetWorkTypeParentsSchema>;
export type InferenceRuleInput = z.infer<typeof InferenceRuleSchema>;
export type BulkInferenceRulesInput = z.infer<typeof BulkInferenceRulesSchema>;
export type BulkUpdateWorkTypeParentsInput = z.infer<typeof BulkUpdateWorkTypeParentsSchema>;
