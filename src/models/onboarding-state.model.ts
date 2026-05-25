import { Schema, model, type InferSchemaType } from 'mongoose'

const onboardingStateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    status: { type: String, enum: ['in_progress', 'completed', 'skipped'], default: 'in_progress', index: true },
    currentStep: { type: Number, default: 1, min: 1 },
    completedSteps: { type: [Number], default: [] },
    skippedSteps: { type: [Number], default: [] },
    data: { type: Schema.Types.Mixed, default: {} },
    completedAt: { type: Date, default: null },
    skippedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

export type OnboardingStateDocument = InferSchemaType<typeof onboardingStateSchema>
export const OnboardingStateModel = model('OnboardingState', onboardingStateSchema)
