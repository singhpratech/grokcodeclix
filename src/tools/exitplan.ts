import { ToolResult } from './registry.js';

export interface ExitPlanModeParams {
  plan: string;
}

/**
 * State shared with the chat session. The chat reads this after each turn
 * to know whether to drop out of plan mode and prompt the user for approval.
 */
export const planExitState: { requested: boolean; plan: string } = { requested: false, plan: '' };

export async function exitPlanModeTool(params: ExitPlanModeParams): Promise<ToolResult> {
  const plan = (params.plan || '').trim();
  if (!plan) {
    return { success: false, output: '', error: 'plan is required — describe what you intend to do' };
  }

  planExitState.requested = true;
  planExitState.plan = plan;

  return {
    success: true,
    output:
      'Plan recorded. The user will be prompted to approve and exit plan mode. ' +
      'Wait for approval before making any changes.',
    display: { summary: 'Awaiting plan approval', preview: plan },
  };
}
