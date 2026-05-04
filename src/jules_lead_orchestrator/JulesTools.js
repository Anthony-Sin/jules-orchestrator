import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import fetch from 'node-fetch'
import { getActiveSessions, upsertSession, getConfig, store, checkFileLockConflicts, lockFiles, unlockFiles } from '../state/store.js'
import { createSession } from '../state/jules-api.js'
import { DEFAULTS } from '../../config/defaults.js'

function getHeaders() {
  const key = getConfig().apiKey;
  if (!key) throw new Error('No API key set. Run: jorch config set-key YOUR_KEY');
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key };
}

export async function handleOrchestratorToolCall(toolCall, orchestratorSessionId) {
  const fn = toolCall.function;
  const { name } = fn;

  // Jules sometimes outputs "parameters" instead of "arguments", and sometimes
  // passes the args as a plain object instead of a JSON string. Handle all cases.
  const rawArgs = fn.arguments ?? fn.parameters ?? fn.args ?? {};
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch (err) {
    return { status: 'error', message: `Failed to parse tool arguments for ${name}: ${err.message}` };
  }

  const confirmToolCall = async (message) => {
    if (orchestratorSessionId) {
      try {
        const { sendMessage } = await import('../state/jules-api.js');
        await sendMessage(orchestratorSessionId, `[TOOL_RESULT: ${name}] ${message}`);
      } catch (err) {
        // Ignore errors sending confirmation back
      }
    }
  };

  switch (name) {
    case 'kill_sub_agent': {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${args.agent_id}`, {
          method: 'DELETE',
          headers: getHeaders(),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const msg = `Failed to kill agent: ${res.status} ${await res.text()}`;
          await confirmToolCall(msg);
          return { status: 'error', message: msg };
        }
        upsertSession({ id: args.agent_id, state: 'KILLED' });
        const msg = `Agent ${args.agent_id} killed. Reason: ${args.reason}`;
        await confirmToolCall(msg);
        return { status: 'success', message: msg };
      } catch (err) {
        let msg = `Failed to kill agent: ${err.message}`;
        if (err.name === 'AbortError') msg = 'Request timed out';
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }
    }

    case 'reassign_module': {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${args.agent_id}:sendMessage`, {
          method: 'POST', 
          headers: getHeaders(),
          body: JSON.stringify({ prompt: `[REASSIGNMENT] ${args.new_instructions}` }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const msg = `Failed to reassign agent: ${res.status} ${await res.text()}`;
          await confirmToolCall(msg);
          return { status: 'error', message: msg };
        }
        const msg = `Agent ${args.agent_id} reassigned with new instructions.`;
        await confirmToolCall(msg);
        return { status: 'success', message: msg };
      } catch (err) {
        let msg = `Failed to reassign agent: ${err.message}`;
        if (err.name === 'AbortError') msg = 'Request timed out';
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }
    }

    case 'broadcast_update': {
      const activeSessions = getActiveSessions();
      const broadcastPromises = activeSessions
        .filter(session => session.type !== 'orchestrator')
        .map(async (session) => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${session.id}:sendMessage`, {
              method: 'POST',
              headers: getHeaders(),
              body: JSON.stringify({ prompt: `[BROADCAST] ${args.message}` }),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) {
              return { status: 'error', session: session.id, message: `${res.status} ${await res.text()}` };
            }
            return { status: 'success', session: session.id };
          } catch (err) {
            if (err.name === 'AbortError') return { status: 'error', session: session.id, message: 'Request timed out' };
            return { status: 'error', session: session.id, message: err.message };
          }
        });

      const results = await Promise.all(broadcastPromises);
      const errors = results.filter(r => r.status === 'error');

      if (errors.length > 0) {
        const msg = `Broadcast partially failed. Errors on ${errors.length} agents. Details: ${errors.map(e => e.message).join('; ')}`;
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }
      const msg = `Broadcast sent to ${broadcastPromises.length} active sessions.`;
      await confirmToolCall(msg);
      return { status: 'success', message: msg };
    }

    case 'set_agent_dependency': {
      upsertSession({
        id: args.dependent_agent_id,
        state: 'PAUSED',
        waitingOn: args.target_agent_id
      });
      const msg = `Agent ${args.dependent_agent_id} is now waiting for ${args.target_agent_id} to complete.`;
      await confirmToolCall(msg);
      return { status: 'success', message: msg };
    }

    case 'create_shared_contract': {
      const contractPath = path.join(process.cwd(), args.contract_name);

      // File locking to prevent race conditions
      const conflicts = checkFileLockConflicts([contractPath]);
      if (conflicts.length > 0) {
        const msg = `Cannot create contract. File is currently locked by session ${conflicts[0].lockedBy}`;
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }

      const operationLockId = `${orchestratorSessionId || 'SYSTEM'}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      try {
        lockFiles(operationLockId, [contractPath]);
        await fsPromises.writeFile(contractPath, args.initial_content, 'utf8');
      } finally {
        unlockFiles(operationLockId);
      }

      const msg = `Shared contract ${args.contract_name} created at ${contractPath}. Allowed agents: ${args.allowed_agent_ids.join(', ')}`;
      await confirmToolCall(msg);
      return { status: 'success', message: msg };
    }

    case 'generate_ink_terminal_diagram': {
      const currentDiagrams = store.get('architectureDiagrams') || [];
      const newDiagStr = JSON.stringify(args);
      
      if (!currentDiagrams.some(d => JSON.stringify(d) === newDiagStr)) {
          currentDiagrams.unshift(args);
          store.set('architectureDiagrams', currentDiagrams.slice(0, 10));
          store.set('diagramLastUpdated', Date.now()); 
      }
      
      const msg = 'Diagram generated and added to architecture history.';
      await confirmToolCall(msg);
      return { status: 'success', message: msg };
    }

    case 'dispatch_sub_agent': {
      try {
        const config = getConfig();
        if (!config.source) {
           const msg = 'No source set in configuration.';
           await confirmToolCall(msg);
           return { status: 'error', message: msg };
        }

        const safeModuleName = (args.module_name || '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const enforcedBranch = orchestratorSessionId
          ? `jorch/${orchestratorSessionId}/${safeModuleName}`
          : `jorch/${Date.now()}/${safeModuleName}`;

        const instructionsWithBranch = `### AGENT IDENTITY
        You are the ${args.module_name} for an orchestrated multi-agent project.
        Your branch: ${enforcedBranch}
        You MUST push all changes to this branch only.

        ### YOUR MISSION
        ${args.instructions}

        ### EXECUTION STANDARDS
        - Write production-quality code, not scaffolding or placeholders.
        - Include error handling, input validation, and inline comments.
        - Structure your files cleanly with logical directory layout.
        - After completing each major component, commit with a descriptive message.
        - When fully done, push to ${enforcedBranch} and confirm completion.

        ### CONSTRAINTS
        - Do NOT touch main or any branch outside your assigned branch.
        - Do NOT wait for other agents — implement your module to be integration-ready.`

        const julesSession = await createSession({
          prompt: instructionsWithBranch,
          source: config.source,
          startingBranch: config.branch || undefined,
          requirePlanApproval: false,
        });

        const sessionId = julesSession.name?.split('/').pop() || julesSession.id;

        // ── FIX #1 (sub-agent side): Use module_name as the title ────────
        // Previously this was already set to args.module_name, which is correct.
        // The problem was the sync loop in useSessionManager was overwriting it
        // with Jules' raw prompt title. That's now fixed in useSessionManager.
        // We also mark parentOrchestratorId here so dashboard-controller can
        // group this session under its orchestrator in the AGENTS hierarchy.
        const sessionData = {
          id: sessionId,
          title: args.module_name,          // Clean human-readable name
          type: 'sub_agent',
          state: julesSession.state || 'QUEUED',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          repo: config.source,
          parentOrchestratorId: orchestratorSessionId,  // Links to parent for hierarchy
        };

        upsertSession(sessionData);

        const msg = `Sub-agent for ${args.module_name} queued for dispatch with session ID ${sessionId}.`;
        await confirmToolCall(msg);
        return { status: 'success', message: msg, session_id: sessionId };
      } catch (err) {
         const msg = `Failed to dispatch sub-agent: ${err.message}`;
         await confirmToolCall(msg);
         return { status: 'error', message: msg };
      }
    }

    case 'merge_branches': {
      let { base_branch, branches_to_merge } = args;

      if (typeof branches_to_merge === 'string') {
        branches_to_merge = [branches_to_merge];
      }

      if (!Array.isArray(branches_to_merge)) {
        const msg = `Validation failed: 'branches_to_merge' must be an array of branch names.`;
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }

      try {
        const config = getConfig();
        if (!config.source) {
          const msg = 'No source set in configuration.';
          await confirmToolCall(msg);
          return { status: 'error', message: msg };
        }

        const requiredPrefix = orchestratorSessionId ? `jorch/${orchestratorSessionId}/` : 'jorch/SYSTEM/';

        // Hard JS validation — prevent merging protected branches
        for (const branch of branches_to_merge) {
          if (typeof branch !== 'string') {
            const msg = `Validation failed: Expected branch name to be a string.`;
            await confirmToolCall(msg);
            return { status: 'error', message: msg };
          }
          if (branch === 'main' || branch === 'master' || branch === 'develop' || branch.startsWith('release/') || !branch.startsWith(requiredPrefix)) {
            const msg = `Validation failed: Branch '${branch}' is not authorized. All branches must start with '${requiredPrefix}' and cannot be protected branches like 'main', 'master', 'develop', or 'release/*'.`;
            await confirmToolCall(msg);
            return { status: 'error', message: msg };
          }
        }

        const matchPatternWildcard = orchestratorSessionId ? `jorch/${orchestratorSessionId}/*` : '*';

        const mergeInstructions = `You are a Merge Agent. Your ONLY job is to merge branches into a temporary branch.
1. Base branch: ${base_branch}
2. Branches to merge: ${branches_to_merge.join(', ')} (these should match ${matchPatternWildcard})
3. Checkout a new temporary branch from ${base_branch}.
4. Merge each specified branch. If there is a conflict, resolve it.
5. Push the resulting temporary branch to origin.
6. Return success with the temporary branch name.`;

        const julesSession = await createSession({
          prompt: mergeInstructions,
          source: config.source,
          startingBranch: config.branch || undefined,
          requirePlanApproval: false,
        });

        const sessionId = julesSession.name?.split('/').pop() || julesSession.id;

        const sessionData = {
          id: sessionId,
          title: 'Merge Agent',
          type: 'sub_agent',
          state: julesSession.state || 'QUEUED',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          repo: config.source,
          parentOrchestratorId: orchestratorSessionId,
        };

        upsertSession(sessionData);

        const msg = `Merge Agent dispatched with session ID ${sessionId} to handle merging.`;
        await confirmToolCall(msg);
        return { status: 'success', message: msg };
      } catch (err) {
        const msg = `Failed to dispatch Merge Agent: ${err.message}`;
        await confirmToolCall(msg);
        return { status: 'error', message: msg };
      }
    }

    default:
      throw new Error(`Unknown tool call: ${name}`);
  }
}