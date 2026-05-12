import { GoogleGenAI } from '@google/genai'
import { runGit } from './git-tools.js'

let reviewerClient = null
function getReviewerClient() {
  if (!reviewerClient) {
    reviewerClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return reviewerClient
}

export const spawn_local_reviewer = {
  name: 'spawn_local_reviewer',
  description: 'Provide a Go/No-Go recommendation based on git diffs.',
  parameters: {
    type: 'object',
    properties: {
      branch_name: { type: 'string', description: 'The branch to review' },
      base_branch: { type: 'string', description: 'The branch to compare against (usually main)' }
    },
    required: ['branch_name', 'base_branch']
  },
  execute: async (args) => {
    try {
      const diff = await runGit(['diff', `${args.base_branch}..${args.branch_name}`])
      if (!diff) return 'No differences found.'

      const ai = getReviewerClient()
      const systemInstruction = 'You are a strict code reviewer. Evaluate the provided git diff. Provide a brief summary of the changes and conclude with a Go/No-Go recommendation.'

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: [
          { role: 'user', parts: [{ text: `Here is the diff:\n\n${diff}` }] }
        ],
        config: { systemInstruction }
      })

      return response.text
    } catch (e) {
      return `Error in spawn_local_reviewer: ${e.message}`
    }
  }
}
