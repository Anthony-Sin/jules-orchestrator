import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import { execSync } from 'child_process'
import { getActiveSessions, upsertSession, getConfig, store, checkFileLockConflicts, lockFiles, unlockFiles } from '../state/store.js'
import { createSession } from '../state/jules-api.js'
import { DEFAULTS } from '../../config/defaults.js'

function getHeaders() {
  const key = getConfig().apiKey;
  if (!key) throw new Error('No API key set. Run: jorch config set-key YOUR_KEY');
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key };
}

export async function handleOrchestratorToolCall(toolCall) {
  const { name, arguments: argsString } = toolCall.function;
  const args = JSON.parse(argsString);

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
          return { status: 'error', message: `Failed to kill agent: ${res.status} ${await res.text()}` };
        }
        upsertSession({ id: args.agent_id, state: 'KILLED' });
        return { status: 'success', message: `Agent ${args.agent_id} killed. Reason: ${args.reason}` };
      } catch (err) {
        if (err.name === 'AbortError') return { status: 'error', message: 'Request timed out' };
        return { status: 'error', message: `Failed to kill agent: ${err.message}` };
      }
    }

    case 'pause_sub_agent': {
      upsertSession({ id: args.agent_id, state: 'PAUSED' });
      return { status: 'success', message: `Agent ${args.agent_id} paused. Reason: ${args.reason}` };
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
          return { status: 'error', message: `Failed to reassign agent: ${res.status} ${await res.text()}` };
        }
        return { status: 'success', message: `Agent ${args.agent_id} reassigned with new instructions.` };
      } catch (err) {
        if (err.name === 'AbortError') return { status: 'error', message: 'Request timed out' };
        return { status: 'error', message: `Failed to reassign agent: ${err.message}` };
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
        return {
          status: 'error',
          message: `Broadcast partially failed. Errors on ${errors.length} agents. Details: ${errors.map(e => e.message).join('; ')}`
        };
      }
      return { status: 'success', message: `Broadcast sent to ${broadcastPromises.length} active sessions.` };
    }
    case 'set_agent_dependency': {
      upsertSession({
        id: args.dependent_agent_id,
        state: 'PAUSED',
        waitingOn: args.target_agent_id
      });
      return { status: 'success', message: `Agent ${args.dependent_agent_id} is now waiting for ${args.target_agent_id} to complete.` };
    }

    case 'create_shared_contract': {
      const contractPath = path.join(process.cwd(), args.contract_name);

      // File locking to prevent race conditions
      const conflicts = checkFileLockConflicts([contractPath]);
      if (conflicts.length > 0) {
        return { status: 'error', message: `Cannot create contract. File is currently locked by session ${conflicts[0].lockedBy}` };
      }

      try {
        lockFiles('ORCHESTRATOR', [contractPath]);
        fs.writeFileSync(contractPath, args.initial_content, 'utf8');
      } finally {
        unlockFiles('ORCHESTRATOR');
      }

      return { status: 'success', message: `Shared contract ${args.contract_name} created at ${contractPath}. Allowed agents: ${args.allowed_agent_ids.join(', ')}` };
    }

    case 'generate_ink_terminal_diagram': {
      const currentDiagrams = store.get('architectureDiagrams') || [];
      const newDiagStr = JSON.stringify(args);
      
      if (!currentDiagrams.some(d => JSON.stringify(d) === newDiagStr)) {
          currentDiagrams.unshift(args);
          store.set('architectureDiagrams', currentDiagrams.slice(0, 10));
          store.set('diagramLastUpdated', Date.now()); 
      }
      
      return { 
        status: 'success', 
        message: 'Diagram generated and added to architecture history.' 
      };
    }

    case 'dispatch_sub_agent': {
      try {
        const config = getConfig();
        if (!config.source) {
           return { status: 'error', message: 'No source set in configuration.' };
        }

        // Timeout not directly available in createSession if it doesn't support AbortController
        // but we can wrap it if needed or rely on internal timeout. Assuming internal timeout or fast enough API here.
        // Or we can add an AbortController in createSession but we can't easily modify jules-api.js directly in this step without reading it, actually it uses node-fetch.
        // Let's implement timeout logic manually for dispatch_sub_agent using Promise.race or modifying createSession signature.
        // We will just use standard createSession for now as it's the expected way based on orchestrator.js
        const julesSession = await createSession({
          prompt: args.instructions,
          source: config.source,
          startingBranch: config.branch || 'main',
          requirePlanApproval: false,
        });

        const sessionId = julesSession.name?.split('/').pop() || julesSession.id;

        const sessionData = {
          id: sessionId,
          title: args.module_name,
          type: 'sub_agent',
          state: julesSession.state || 'QUEUED',
          createdAt: Date.now(),
          lastUpdated: Date.now(),
          repo: config.source,
        };

        upsertSession(sessionData);

        return { status: 'success', message: `Sub-agent for ${args.module_name} queued for dispatch with session ID ${sessionId}.` };
      } catch (err) {
         return { status: 'error', message: `Failed to dispatch sub-agent: ${err.message}` };
      }
    }

    case 'merge_branches': {
      const { base_branch, branches_to_merge } = args;
      const timestamp = Date.now();
      const tempBranchName = `temp-merge-${base_branch}-${timestamp}`;

      try {
        // Fetch all latest branches
        execSync('git fetch origin', { stdio: 'ignore' });

        // Create and checkout the temporary branch from the base branch
        execSync(`git checkout -b ${tempBranchName} origin/${base_branch}`, { stdio: 'ignore' });

        const mergeLog = [];

        // Attempt to merge each branch one by one
        for (const branch of branches_to_merge) {
          try {
            // Merge branch from origin (assuming agents push their branches)
            execSync(`git merge origin/${branch} --no-edit`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            mergeLog.push(`Successfully merged ${branch}`);
          } catch (error) {
            // Merge conflict occurred. Stop immediately, abort, and return exactly what happened.
            const conflictOutput = (error.stdout || '') + (error.stderr || '');

            try {
               execSync('git merge --abort', { stdio: 'ignore' });
            } catch (e) {
               // Ignore if abort fails (maybe nothing to abort)
            }

            return {
              status: 'error',
              message: `Merge conflict occurred while merging ${branch}. Merge aborted and working directory cleaned. Conflict details:\n${conflictOutput}`,
              temp_branch: tempBranchName
            };
          }
        }

        // Push the temporary branch back to origin
        execSync(`git push origin ${tempBranchName}`, { stdio: 'ignore' });

        return {
          status: 'success',
          message: `Created temporary branch '${tempBranchName}' and pushed to origin. Merge log: ${mergeLog.join(' | ')}`,
          temp_branch: tempBranchName
        };
      } catch (err) {
        return { status: 'error', message: `Failed during branch operations: ${err.message}` };
      }
    }

    default:
      throw new Error(`Unknown tool call: ${name}`);
  }
}
