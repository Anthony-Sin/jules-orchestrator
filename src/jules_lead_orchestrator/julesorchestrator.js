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
5.  **MAPPING:** Call 'generate_ink_terminal_diagram' for orchestrated projects. The diagram must reflect the 'Task Value' count and explicitly map the nodes (agents/modules) and their connections for UI tab rendering.

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
      description: "Visualizes the project breakdown. Generates a structured architecture graph to populate the TUI graph tabs.",
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
  // ... [Keep the rest of your tools exactly the same (dispatch_sub_agent, etc.)]
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
  const fullPrompt = `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n[USER INPUT]\nTask Value: ${taskValue}\n \n this with your old tools are your tools to help you ${JSON.stringify(ORCHESTRATOR_TOOLS, null, 2)} \nPrompt: ${userInput}`;
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