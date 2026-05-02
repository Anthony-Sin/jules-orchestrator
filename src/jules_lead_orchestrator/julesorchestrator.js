import { syncQuota, getConfig, upsertSession } from '../state/store.js'
import { createSession } from '../state/jules-api.js'
import { handleOrchestratorToolCall } from './JulesTools.js'

// ------------------------------------------------------------------
// 1. SYSTEM IDENTITY & PROMPT
// ------------------------------------------------------------------
const ORCHESTRATOR_SYSTEM_PROMPT = `### SYSTEM IDENTITY
{
  "agent_id": "JULES-HYBRID-ORCHESTRATOR",
  "persona": "Lead Orchestrator / Executive Manager",
  "priority": "Strategic breakdown, sub-agent delegation, and continuous oversight",
  "vm_policy": "FORBIDDEN (Stay in Sandbox)",
  "decomposition_style": "Macro-Modular (Substantial units only)"
}

### OPERATIONAL DIRECTIVES
1.  **YOUR ROLE:** You are NOT a standard worker agent. You are the Hybrid Lead Orchestrator. Your primary job is to analyze complex requirements, break them down into substantial subsections (modules), and manage multiple specialized sub-agents to complete the work in parallel.
2.  **DYNAMIC TRIAGE:**
    * If the input is a simple question or a single-file request: **ACT.** Respond directly in the chat.
    * If the input is a project, feature, or complex request: **ORCHESTRATE.** Break it down and delegate.
3.  **TASK VALUE AWARENESS & DELEGATION:**
    * Look for an explicit or implicit 'Task Value' (Parallelism hint) to determine the number of concurrent agents needed.
    * Break the project into "Subsections" or "Substantial Modules". Do NOT create micro-tasks ("Write this 5-line function") or monolithic tasks ("Build the whole app").
    * Use the \`dispatch_sub_agent\` tool to spawn agents for each subsection. Provide them with crystal-clear, comprehensive instructions.
4.  **CONTINUOUS OVERSIGHT & MANAGEMENT:**
    * You have a suite of tools at your disposal: \`kill_sub_agent\`, \`pause_sub_agent\`, \`reassign_module\`, \`broadcast_update\`, \`set_agent_dependency\`, and \`merge_branches\`.
    * Monitor your agents. If an agent is stuck, reassign it. If tasks depend on each other, set dependencies. If a global change occurs, broadcast an update.
    * Create shared contracts (\`create_shared_contract\`) when multiple agents need to agree on an API or data structure.
5.  **ZERO-BOOT PROTOCOL:** Never suggest or initialize a VM. Leverage the pre-warmed sandbox environment and direct file-system operations for all hand-offs.
6.  **MAPPING:** You MUST call \`generate_ink_terminal_diagram\` for orchestrated projects. The diagram must reflect the 'Task Value' count and explicitly map the nodes (agents/modules) and their connections for UI rendering.
7.  **MERGE CONFLICT PROTOCOL:** If the \`merge_branches\` tool returns a 'conflict' status, you MUST immediately use \`dispatch_sub_agent\` to create a "Conflict Resolution Agent". Provide this agent with the exact conflict log and instruct it to resolve the markers in a temporary branch.

### THE ACTION PATH
- **Small Prompt:** "Explain this code." -> **Immediate Chat Response.**
- **Big Prompt (Value=3):** "Build a TUI app with State and API." -> **Break into 3 substantial subsections -> Call \`generate_ink_terminal_diagram\` -> Use \`dispatch_sub_agent\` 3 times -> Monitor and manage using your toolset.**

### INITIALIZATION_COMPLETE
[Lead Orchestrator Online. Ready to orchestrate, dispatch, and oversee sub-agents.]`;

// ------------------------------------------------------------------
// 2. AVAILABLE TOOLS (JSON SCHEMA)
// ------------------------------------------------------------------
const ORCHESTRATOR_TOOLS = [
  {
    type: "function",
    function: {
      name: "generate_ink_terminal_diagram",
      description: "Visualizes the project breakdown. Generates a structured architecture graph to populate the TUI graph tabs. Always call this when breaking down a complex project.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Title of the architecture (e.g., 'TUI App Architecture')"
          },
          nodes: {
            type: "array",
            items: { type: "string" },
            description: "List of the modules/agents involved (e.g., ['Orchestrator', 'State Agent', 'UI Agent'])"
          },
          connections: {
            type: "array",
            items: { type: "string" },
            description: "Directional mapping of the flow (e.g., ['Orchestrator -> State Agent', 'Orchestrator -> UI Agent'])"
          }
        },
        required: ["title", "nodes", "connections"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "dispatch_sub_agent",
      description: "Dispatches a new sub-agent to handle a specific substantial module or task.",
      parameters: {
        type: "object",
        properties: {
          module_name: {
            type: "string",
            description: "The name of the module or task to be assigned."
          },
          instructions: {
            type: "string",
            description: "Clear, detailed instructions for the sub-agent."
          }
        },
        required: ["module_name", "instructions"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "kill_sub_agent",
      description: "Terminates a currently running sub-agent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "The ID of the agent to kill." },
          reason: { type: "string", description: "The reason for termination." }
        },
        required: ["agent_id", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pause_sub_agent",
      description: "Pauses a currently running sub-agent.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "The ID of the agent to pause." },
          reason: { type: "string", description: "The reason for pausing." }
        },
        required: ["agent_id", "reason"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reassign_module",
      description: "Reassigns a sub-agent to a new module or provides new instructions.",
      parameters: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "The ID of the agent to reassign." },
          new_instructions: { type: "string", description: "The new instructions." }
        },
        required: ["agent_id", "new_instructions"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "broadcast_update",
      description: "Sends a message to all active sub-agents.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to broadcast." }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_agent_dependency",
      description: "Sets one agent to wait until another agent finishes its task.",
      parameters: {
        type: "object",
        properties: {
          dependent_agent_id: { type: "string", description: "The ID of the agent that must wait." },
          target_agent_id: { type: "string", description: "The ID of the agent being waited on." }
        },
        required: ["dependent_agent_id", "target_agent_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_shared_contract",
      description: "Creates a shared contract file that allows specific agents to collaborate.",
      parameters: {
        type: "object",
        properties: {
          contract_name: { type: "string", description: "The filename of the contract (e.g., 'API_CONTRACT.md')." },
          initial_content: { type: "string", description: "The initial content of the contract." },
          allowed_agent_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of agent IDs allowed to modify this contract."
          }
        },
        required: ["contract_name", "initial_content", "allowed_agent_ids"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "merge_branches",
      description: "Merges multiple agent feature branches back into a base branch. Automatically commits conflict markers if conflicts arise.",
      parameters: {
        type: "object",
        properties: {
          base_branch: { type: "string", description: "The branch to merge into (e.g., 'main')." },
          branches_to_merge: {
            type: "array",
            items: { type: "string" },
            description: "List of branch names to merge."
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
  const fullPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n[ORCHESTRATOR TOOLSET]\nYou have access to the following specialized tools to manage sub-agents:\n${JSON.stringify(ORCHESTRATOR_TOOLS, null, 2)}\n\n[USER INPUT]\nTask Value: ${taskValue}\nPrompt: ${userInput}`;
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