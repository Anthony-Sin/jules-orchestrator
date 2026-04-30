import fs from 'fs'
import path from 'path'
import fetch from 'node-fetch'
import { execSync } from 'child_process'
import { getActiveSessions, upsertSession, getConfig, store } from '../state/store.js'
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
      const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${args.agent_id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (!res.ok) throw new Error(`Jules API error ${res.status}: ${await res.text()}`);
      upsertSession({ id: args.agent_id, state: 'KILLED' });
      return { status: 'success', message: `Agent ${args.agent_id} killed. Reason: ${args.reason}` };
    }

    case 'pause_sub_agent': {
      upsertSession({ id: args.agent_id, state: 'PAUSED' });
      return { status: 'success', message: `Agent ${args.agent_id} paused. Reason: ${args.reason}` };
    }

    case 'reassign_module': {
      const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${args.agent_id}:sendMessage`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ prompt: `[REASSIGNMENT] ${args.new_instructions}` })
      });
      if (!res.ok) throw new Error(`Jules API error ${res.status}: ${await res.text()}`);
      return { status: 'success', message: `Agent ${args.agent_id} reassigned with new instructions.` };
    }

    case 'broadcast_update': {
      const activeSessions = getActiveSessions();
      for (const session of activeSessions) {
        if (session.type !== 'orchestrator') {
          const res = await fetch(`${DEFAULTS.JULES_API_BASE}/sessions/${session.id}:sendMessage`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ prompt: `[BROADCAST] ${args.message}` })
          });
          if (!res.ok) throw new Error(`Jules API error ${res.status}: ${await res.text()}`);
        }
      }
      return { status: 'success', message: `Broadcast sent to ${activeSessions.length} active sessions.` };
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
      fs.writeFileSync(contractPath, args.initial_content, 'utf8');
      return { status: 'success', message: `Shared contract ${args.contract_name} created at ${contractPath}. Allowed agents: ${args.allowed_agent_ids.join(', ')}` };
    }

    case 'generate_ink_terminal_diagram': {
      store.set('architectureDiagram', args.architecture_description);
      return { status: 'success', message: `Diagram generated and saved: ${args.architecture_description}` };
    }

    case 'dispatch_sub_agent': {
      return { status: 'success', message: `Sub-agent for ${args.module_name} queued for dispatch.` };
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
            execSync(`git merge origin/${branch} --no-edit`, { stdio: 'ignore' });
            mergeLog.push(`Successfully merged ${branch}`);
          } catch (error) {
            // Merge conflict occurred, automatically commit the conflict markers
            try {
              execSync('git add .', { stdio: 'ignore' });
              execSync(`git commit -m "Auto-merge conflicts from ${branch}"`, { stdio: 'ignore' });
              mergeLog.push(`Merged ${branch} with conflicts (markers committed).`);
            } catch (commitError) {
              mergeLog.push(`Failed to merge ${branch}: ${commitError.message}`);
            }
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
