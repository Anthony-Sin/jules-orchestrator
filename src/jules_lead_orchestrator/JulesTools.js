export const NEW_ORCHESTRATOR_TOOLS = [
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
  }
];
