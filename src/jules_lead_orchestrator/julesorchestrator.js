import { getConfig, upsertSession } from '../state/store.js'
import { createSession } from '../state/jules-api.js'
import { handleOrchestratorToolCall } from './JulesTools.js'

// ------------------------------------------------------------------
// 1. SYSTEM IDENTITY & PROMPT
// ------------------------------------------------------------------
const ORCHESTRATOR_SYSTEM_PROMPT = `### SYSTEM IDENTITY
{
  "agent_id": "JULES-HYBRID-ORCHESTRATOR",
  "persona": "Lead Orchestrator"
}

### DIRECTIVES
1. Breakdown complex tasks into substantial modules.
2. Call \`generate_ink_terminal_diagram\` for planning.
3. Use \`dispatch_sub_agent\` for each module.
4. Manage agents via tools (\`kill_sub_agent\`, \`set_agent_dependency\`, \`merge_branches\`).
5. Output tool calls as JSON. Wait for \`[TOOL_RESULT: ...]\` confirmations before proceeding.
6. React to \`[AGENT_UPDATE: ...]\` messages to manage dependencies and auto-retry if needed.

### OUTPUT FORMAT — STRICT
You MUST output tool calls as a JSON array. Each element MUST follow this exact shape:
[
  {
    "type": "function",
    "function": {
      "name": "<tool_name>",
      "arguments": { ...args as a JSON object... }
    }
  }
]
RULES:
- The outer key is "function", NOT "parameters", NOT "args".
- The inner key is "arguments", NOT "parameters", NOT "args".
- Always output an ARRAY [ ] even for a single tool call.
- Do NOT add prose before or after the JSON array when calling tools.
- Do NOT wrap the JSON in markdown code fences.
- Wait for a [TOOL_RESULT: ...] line before outputting the next batch of tool calls.`;

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

// ── FIX #5: Derive a clean short title from user input ─────────────
// Previously the title was set to `ORCHESTRATOR— ${raw.substring(0, 40)}`
// which just truncates mid-word. This extracts the first meaningful
// phrase (up to 40 chars, breaking on a word boundary).
function deriveOrchestratorTitle(userInput) {
  const raw = userInput.trim()
  if (raw.length <= 40) return `ORCHESTRATOR— ${raw}`

  // Try to break on a word boundary before 40 chars
  const truncated = raw.substring(0, 40)
  const lastSpace = truncated.lastIndexOf(' ')
  const shortDesc = lastSpace > 10 ? truncated.substring(0, lastSpace) : truncated
  return `ORCHESTRATOR— ${shortDesc}`
}

export async function dispatchLeadOrchestrator(userInput, taskValue = 1, title = null) {
  const config = getConfig();

  if (!config.source) {
    throw new Error('No source set. Run: jorch config set-source sources/github-owner-repo');
  }

  // ── FIX #5: Build the clean title before creating the session ─────
  // The title is derived locally so it's never overwritten by Jules'
  // raw-prompt title. The ORCHESTRATOR— prefix is also what protects
  // it from being overwritten in the sync loop.
  const cleanTitle = title || deriveOrchestratorTitle(userInput)

  // Build the full prompt — note we no longer ask Jules to "name this
  // session" since the TUI sets the name itself. That instruction caused
  // Jules to output the name as its first message rather than diving
  // straight into tool calls.
  const fullPrompt = [
    ORCHESTRATOR_SYSTEM_PROMPT,
    '',
    '[ORCHESTRATOR TOOLSET]',
    'Here are your available tools. You must output tool calls as JSON matching these schemas:',
    JSON.stringify(ORCHESTRATOR_TOOLS, null, 2),
    '',
    '[USER INPUT]',
    `Task Value: ${taskValue}`,
    `Prompt: ${userInput}`,
  ].join('\n')

  // Create Jules session configured as the Hybrid Orchestrator
  const julesSession = await createSession({
    prompt: fullPrompt,
    source: config.source,
    startingBranch: config.branch || undefined,
    requirePlanApproval: false,
    tools: ORCHESTRATOR_TOOLS
  });

  const sessionId = julesSession.name?.split('/').pop() || julesSession.id;

  // Track the orchestrator session in the state store.
  // We set title here with the ORCHESTRATOR— prefix so the sync loop
  // will always preserve it (see cleanRemoteTitle in useSessionManager).
  const sessionData = {
    id: sessionId,
    title: cleanTitle,
    type: 'orchestrator',
    state: julesSession.state || 'QUEUED',
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    repo: config.source,
  };

  upsertSession(sessionData);

  return { queued: false, sessionId };
}