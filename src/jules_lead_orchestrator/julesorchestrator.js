import { syncQuota, getConfig, upsertSession } from '../state/store.js'
import { createSession } from '../state/jules-api.js'
import { handleOrchestratorToolCall } from './JulesTools.js'

// ------------------------------------------------------------------
// 1. SYSTEM IDENTITY & PROMPT
// ------------------------------------------------------------------
const ORCHESTRATOR_SYSTEM_PROMPT = `### SYSTEM IDENTITY
{
  "agent_id": "JULES-HYBRID-ORCHESTRATOR",
  "persona": "Strategic Architect / Direct Collaborator",
  "priority": "Speed & Balanced Delegation",
  "vm_policy": "FORBIDDEN (Stay in Sandbox)",
  "decomposition_style": "Macro-Modular (Substantial units only)"
}

### OPERATIONAL DIRECTIVES
1.  **DYNAMIC TRIAGE:** * If the input is a question or a single-file request: **ACT.** Respond directly in the chat.
    * If the input is a project or complex feature: **ORCHESTRATE.**
2.  **TASK VALUE AWARENESS:** * Look for an explicit or implicit 'Task Value' (Parallelism hint) in the user's prompt. 
    * Use this value to determine the number of concurrent agents/branches needed.
3.  **BALANCED GRANULARITY (The 'Goldilocks' Rule):**
    * Do **NOT** create micro-tasks (e.g., "Write this 5-line function"). 
    * Do **NOT** create monolithic tasks (e.g., "Build the whole app").
    * **DO** create "Substantial Modules." Each task should represent a meaningful feature or logical block. 
4.  **ZERO-BOOT PROTOCOL:** Never suggest or initialize a VM. Leverage the pre-warmed sandbox environment and direct file-system operations for all hand-offs.
5.  **MAPPING:** Call 'generate_ink_terminal_diagram' for orchestrated projects. The diagram must reflect the 'Task Value' count and the specific module names.

### THE ACTION PATH
- **Small Prompt:** "Explain this code." -> **Immediate Chat Response.**
- **Big Prompt (Value=3):** "Build a TUI app with State and API." -> **Break into 3 substantial modules + Call Ink Diagram + Dispatch.**

### INITIALIZATION_COMPLETE
[Lead Orchestrator Online. Ready to act or delegate. Send the Task Value and the Prompt.]`;

// ------------------------------------------------------------------
// 2. AVAILABLE TOOLS (JSON SCHEMA)
// ------------------------------------------------------------------
const ORCHESTRATOR_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_ink_terminal_diagram",
      description: "Visualizes the project breakdown. Shows the Orchestrator, the assigned agents, and the specific modules assigned to them.",
      parameters: {
        type: "object",
        properties: {
          architecture_description: {
            type: "string",
            description: "Map: Orchestrator -> [Task Value] Number of Modules -> Target Agents."
          }
        },
        required: ["architecture_description"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "dispatch_sub_agent",
      description: "Creates and dispatches a dedicated sub-agent to work on a substantial module independently.",
      parameters: {
        type: "object",
        properties: {
          module_name: {
            type: "string",
            description: "The name of the substantial module (e.g., 'User Authentication Service')."
          },
          agent_instructions: {
            type: "string",
            description: "Strict, isolated instructions for the sub-agent regarding what to build for this specific module."
          },
          target_files: {
            type: "array",
            items: { type: "string" },
            description: "The specific files or directories this sub-agent is allowed to touch."
          }
        },
        required: ["module_name", "agent_instructions", "target_files"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_agent_dependency",
      description: "Sets a dependency between two sub-agents, ensuring the dependent agent does not start until the target agent reaches the 'COMPLETED' state.",
      parameters: {
        type: "object",
        properties: {
          dependent_agent_id: {
            type: "string",
            description: "The ID of the agent that should wait."
          },
          target_agent_id: {
            type: "string",
            description: "The ID of the agent that must complete first."
          }
        },
        required: ["dependent_agent_id", "target_agent_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_shared_contract",
      description: "Creates a temporary, shared document (like an API schema or type definitions file) that multiple sub-agents can read from and write to, keeping them aligned.",
      parameters: {
        type: "object",
        properties: {
          contract_name: {
            type: "string",
            description: "The name of the shared contract or document."
          },
          initial_content: {
            type: "string",
            description: "The initial content of the shared contract."
          },
          allowed_agent_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of agent IDs allowed to read and write to this contract."
          }
        },
        required: ["contract_name", "initial_content", "allowed_agent_ids"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "broadcast_update",
      description: "Sends a real-time message to all currently running sub-agents.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to broadcast to all sub-agents."
          }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "kill_sub_agent",
      description: "Immediately terminates a sub-agent if the Orchestrator detects it is looping, failing, or no longer needed.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the sub-agent to terminate."
          },
          reason: {
            type: "string",
            description: "The reason for terminating the sub-agent."
          }
        },
        required: ["agent_id", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pause_sub_agent",
      description: "Temporarily freezes a worker agent without killing its session, useful for rate-limiting or waiting for user input.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the sub-agent to pause."
          },
          reason: {
            type: "string",
            description: "The reason for pausing the sub-agent."
          }
        },
        required: ["agent_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reassign_module",
      description: "Updates a currently running sub-agent's prompt/instructions on the fly without having to restart the whole session.",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "The ID of the sub-agent to reassign."
          },
          new_instructions: {
            type: "string",
            description: "The new prompt or instructions for the sub-agent."
          }
        },
        required: ["agent_id", "new_instructions"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "merge_branches",
      description: "Creates a temporary branch from a base branch, merges a list of branches into it, automatically commits any merge conflict markers (to allow a reviewer agent to resolve them later), and pushes the temporary branch to origin.",
      parameters: {
        type: "object",
        properties: {
          base_branch: {
            type: "string",
            description: "The name of the base branch to start from (e.g., 'main')."
          },
          branches_to_merge: {
            type: "array",
            items: { type: "string" },
            description: "List of branch names to merge into the new temporary branch."
          }
        },
        required: ["base_branch", "branches_to_merge"]
      }
    }
  }
];

export { handleOrchestratorToolCall };

// ------------------------------------------------------------------
// 3. CORE DISPATCH LOGIC
// ------------------------------------------------------------------
export async function dispatchLeadOrchestrator(userInput, taskValue = 1, title = "Orchestrator Session") {
  await syncQuota();
  const config = getConfig();

  if (!config.source) {
    throw new Error('No source set. Run: jorch config set-source sources/github-owner-repo');
  }

  // Inject user input and Task Value into the final payload
  const fullPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n[USER INPUT]\nTask Value: ${taskValue}\nPrompt: ${userInput}`;

  // Create Jules session configured as the Hybrid Orchestrator
  const julesSession = await createSession({
    prompt: fullPrompt,
    source: config.source,
    startingBranch: config.branch || 'main',
    requirePlanApproval: false, // Orchestrator handles triage autonomously
    tools: ORCHESTRATOR_TOOLS
  });

  const sessionId = julesSession.name?.split('/').pop() || julesSession.id;

  // Track the orchestrator session in the state store
  const sessionData = {
    id: sessionId,
    title,
    type: 'orchestrator',
    state: julesSession.state || 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    repo: config.source,
  };

  upsertSession(sessionData);

  return { queued: false, sessionId };
}