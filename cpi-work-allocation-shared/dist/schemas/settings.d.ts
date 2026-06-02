import { z } from 'zod';
export declare const AddNameSchema: z.ZodObject<{
    name: z.ZodString;
    sortOrder: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const RenameSchema: z.ZodObject<{
    name: z.ZodString;
}, z.core.$strip>;
export declare const AddSubCategorySchema: z.ZodObject<{
    name: z.ZodString;
    parentMainCategoryId: z.ZodNumber;
    clients: z.ZodDefault<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    sortOrder: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const SetSubCategoryClientsSchema: z.ZodObject<{
    clients: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const AddWorkTypeSchema: z.ZodObject<{
    name: z.ZodString;
    parents: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const SetWorkTypeParentsSchema: z.ZodObject<{
    parents: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const InferenceRuleSchema: z.ZodObject<{
    keywords: z.ZodArray<z.ZodString>;
    category: z.ZodString;
    subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    workType: z.ZodString;
    sortOrder: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, z.core.$strip>;
export declare const BulkInferenceRulesSchema: z.ZodObject<{
    rules: z.ZodArray<z.ZodObject<{
        keywords: z.ZodArray<z.ZodString>;
        category: z.ZodString;
        subCategory: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        workType: z.ZodString;
        sortOrder: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const BulkUpdateWorkTypeParentsSchema: z.ZodObject<{
    updates: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        parents: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type AddNameInput = z.infer<typeof AddNameSchema>;
export type RenameInput = z.infer<typeof RenameSchema>;
export type AddSubCategoryInput = z.infer<typeof AddSubCategorySchema>;
export type SetSubCategoryClientsInput = z.infer<typeof SetSubCategoryClientsSchema>;
export type AddWorkTypeInput = z.infer<typeof AddWorkTypeSchema>;
export type SetWorkTypeParentsInput = z.infer<typeof SetWorkTypeParentsSchema>;
export type InferenceRuleInput = z.infer<typeof InferenceRuleSchema>;
export type BulkInferenceRulesInput = z.infer<typeof BulkInferenceRulesSchema>;
export type BulkUpdateWorkTypeParentsInput = z.infer<typeof BulkUpdateWorkTypeParentsSchema>;
//# sourceMappingURL=settings.d.ts.map