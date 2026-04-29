// Splits a raw user prompt into atomic tasks using Gemini.
// Each task gets: { id, title, prompt, type, priority, estimatedFiles }

import { GoogleGenerativeAI } from '@google/generative-ai'
import 'dotenv/config'

export async function splitPrompt(rawPrompt) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set')
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })

    const prompt = `
You are the Decomposer Agent for a multi-agent system.
Your job is to parse the user's prompt and split it into atomic, typed, prioritized tasks.
You must return a JSON array of task objects and nothing else. Do not include markdown codeblocks, just raw JSON.

Each task object must have this exact shape:
{
  "id": "string - unique id starting with task-, e.g., task-1234-0",
  "title": "string - short title (up to 60 chars)",
  "prompt": "string - the full text for this specific atomic chunk",
  "type": "string - exactly one of 'frontend', 'backend', or 'conflict'",
  "priority": "number - 1, 2, or 3 (higher is more complex/urgent)",
  "estimatedFiles": "array of strings - specific files, globs, or DOMAIN: keys (e.g. DOMAIN:DATABASE)"
}

Rules:
- split on distinct concerns
- detect type ('conflict' if it involves merge conflicts, otherwise 'frontend' or 'backend')
- priority: longer description = more complex = higher priority (1 to 3)
- estimatedFiles: specific files (if mentioned), globs, or DOMAIN: keys.

User Prompt to decompose:
${rawPrompt}
  `

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    // Try to strip any potential markdown block
    let cleanedText = responseText.trim()
    if (cleanedText.startsWith('\`\`\`json')) {
      cleanedText = cleanedText.slice(7)
    } else if (cleanedText.startsWith('\`\`\`')) {
      cleanedText = cleanedText.slice(3)
    }
    if (cleanedText.endsWith('\`\`\`')) {
      cleanedText = cleanedText.slice(0, -3)
    }
    cleanedText = cleanedText.trim()

    let tasks = JSON.parse(cleanedText)

    if (!Array.isArray(tasks)) {
      tasks = [tasks]
    }

    return tasks.map((task, i) => ({
      id: task.id || `task-${Date.now()}-${i}`,
      title: task.title || 'Untitled task',
      prompt: task.prompt || rawPrompt,
      type: ['frontend', 'backend', 'conflict'].includes(task.type) ? task.type : 'frontend',
      priority: [1, 2, 3].includes(task.priority) ? task.priority : 1,
      estimatedFiles: Array.isArray(task.estimatedFiles) ? task.estimatedFiles : ['unknown'],
      createdAt: Date.now(),
    }))
  } catch (error) {
    // Graceful fallback
    return [{
      id: `task-${Date.now()}-fallback`,
      title: rawPrompt.slice(0, 60) + (rawPrompt.length > 60 ? '…' : ''),
      prompt: rawPrompt,
      type: 'frontend',
      priority: 1,
      estimatedFiles: ['unknown'],
      createdAt: Date.now(),
    }]
  }
}

export function groupByType(tasks) {
  return {
    frontend: tasks.filter(t => t.type === 'frontend'),
    backend: tasks.filter(t => t.type === 'backend'),
    conflict: tasks.filter(t => t.type === 'conflict'),
  }
}
