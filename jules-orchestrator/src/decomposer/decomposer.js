// Splits a raw user prompt into atomic tasks scored by complexity and type.
// Each task gets: { id, title, prompt, type, priority, estimatedFiles }

const FRONTEND_KEYWORDS = [
  'ui', 'component', 'page', 'layout', 'style', 'css', 'button', 'modal',
  'sidebar', 'navbar', 'form', 'input', 'canvas', 'animation', 'responsive',
  'hook', 'react', 'next', 'frontend', 'display', 'render', 'view', 'design',
]

const BACKEND_KEYWORDS = [
  'api', 'endpoint', 'route', 'server', 'database', 'db', 'schema', 'query',
  'auth', 'middleware', 'service', 'backend', 'model', 'migration', 'cron',
  'webhook', 'job', 'queue', 'cache', 'redis', 'postgres', 'prisma',
]

const CONFLICT_AGENT_KEYWORDS = [
  'merge conflict', 'conflict', 'both changes', 'accept both',
]

function detectType(text) {
  const lower = text.toLowerCase()
  if (CONFLICT_AGENT_KEYWORDS.some(k => lower.includes(k))) return 'conflict'
  const feScore = FRONTEND_KEYWORDS.filter(k => lower.includes(k)).length
  const beScore = BACKEND_KEYWORDS.filter(k => lower.includes(k)).length
  if (feScore === 0 && beScore === 0) return 'frontend' // default to frontend
  return feScore >= beScore ? 'frontend' : 'backend'
}

function scoreComplexity(text) {
  const words = text.split(/\s+/).length
  // rough heuristic: longer description = more complex = higher priority
  if (words > 60) return 3
  if (words > 25) return 2
  return 1
}

function estimateFiles(text) {
  // Predict which files will likely be touched based on keywords

  // 1. Look for specific file names
  const specificFilesMatch = text.match(/[\w\.\-]+\.(?:js|jsx|ts|tsx|json|css|scss|html|md)\b/gi)
  if (specificFilesMatch && specificFilesMatch.length > 0) {
    return [...new Set(specificFilesMatch)]
  }

  const lower = text.toLowerCase()

  // 2. Check for domain-level locks if no specific files found
  if (lower.includes('database') || lower.includes('db') || lower.includes('schema') || lower.includes('model') || lower.includes('migration') || lower.includes('postgres') || lower.includes('prisma')) {
    return ['DOMAIN:DATABASE']
  }

  // 3. Fallback to generic domain locks based on type
  const type = detectType(text)
  if (type === 'frontend') {
    return ['DOMAIN:FRONTEND']
  } else if (type === 'backend') {
    return ['DOMAIN:BACKEND']
  }

  return ['unknown']
}

export function splitPrompt(rawPrompt) {
  // Split on numbered lists, bullet points, or "and" joining distinct concerns
  const lines = rawPrompt
    .split(/\n|(?=\d+\.\s)|(?=[-*•]\s)/)
    .map(l => l.replace(/^[\d\.\-\*•\s]+/, '').trim())
    .filter(l => l.length > 10)

  // If no clear splits, treat the whole thing as one task
  const chunks = lines.length > 1 ? lines : [rawPrompt]

  return chunks.map((chunk, i) => ({
    id: `task-${Date.now()}-${i}`,
    title: chunk.slice(0, 60) + (chunk.length > 60 ? '…' : ''),
    prompt: chunk,
    type: detectType(chunk),
    priority: scoreComplexity(chunk),
    estimatedFiles: estimateFiles(chunk),
    createdAt: Date.now(),
  }))
}

export function groupByType(tasks) {
  return {
    frontend: tasks.filter(t => t.type === 'frontend'),
    backend: tasks.filter(t => t.type === 'backend'),
    conflict: tasks.filter(t => t.type === 'conflict'),
  }
}
