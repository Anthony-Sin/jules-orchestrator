import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

// Create mocked versions of store functions
const mockedSetConfig = mock.fn()
const mockedGetConfig = mock.fn(() => ({}))

// Need to mock the imports inside the module we are testing
mock.module('../state/store.js', {
  namedExports: {
    setConfig: mockedSetConfig,
    getConfig: mockedGetConfig,
  },
})

// Now we can import the module to test, after mocking its dependencies
const { setupConfigCommands } = await import('./config.js')

test('setupConfigCommands registers all commands and executes actions correctly', async (t) => {
  // A simple fake commander instance
  const fakeProgram = {
    _commands: [],
    command(name) {
      const cmd = {
        name,
        _description: '',
        _action: null,
        _commands: [],
        description(desc) {
          this._description = desc
          return this
        },
        action(fn) {
          this._action = fn
          return this
        },
        command(subName) {
          const subCmd = {
            name: subName,
            _description: '',
            _action: null,
            description(desc) {
              this._description = desc
              return this
            },
            action(fn) {
              this._action = fn
              return this
            }
          }
          this._commands.push(subCmd)
          return subCmd
        }
      }
      this._commands.push(cmd)
      return cmd
    }
  }

  // 1. Setup the commands
  setupConfigCommands(fakeProgram)

  // Basic validation that 'config' command was registered
  assert.equal(fakeProgram._commands.length, 1)
  const configCmd = fakeProgram._commands[0]
  assert.equal(configCmd.name, 'config')

  // Helper to find a registered subcommand by name prefix
  const getSubCommand = (prefix) => {
    return configCmd._commands.find(c => c.name.startsWith(prefix))
  }

  await t.test('set-key action calls setConfig correctly', () => {
    mockedSetConfig.mock.resetCalls()
    const setKeyCmd = getSubCommand('set-key')
    assert.ok(setKeyCmd, 'set-key command should exist')

    // Simulate executing the action
    setKeyCmd._action('my-secret-key')

    assert.equal(mockedSetConfig.mock.callCount(), 1)
    assert.deepEqual(mockedSetConfig.mock.calls[0].arguments, ['apiKey', 'my-secret-key'])
  })

  await t.test('set-source action calls setConfig correctly', () => {
    mockedSetConfig.mock.resetCalls()
    const setSourceCmd = getSubCommand('set-source')
    assert.ok(setSourceCmd, 'set-source command should exist')

    setSourceCmd._action('github-test-repo')

    assert.equal(mockedSetConfig.mock.callCount(), 1)
    assert.deepEqual(mockedSetConfig.mock.calls[0].arguments, ['source', 'github-test-repo'])
  })

  await t.test('set-branch action calls setConfig correctly', () => {
    mockedSetConfig.mock.resetCalls()
    const setBranchCmd = getSubCommand('set-branch')
    assert.ok(setBranchCmd, 'set-branch command should exist')

    setBranchCmd._action('develop')

    assert.equal(mockedSetConfig.mock.callCount(), 1)
    assert.deepEqual(mockedSetConfig.mock.calls[0].arguments, ['branch', 'develop'])
  })

  await t.test('set-auto-pr action calls setConfig correctly with true', () => {
    mockedSetConfig.mock.resetCalls()
    const setAutoPrCmd = getSubCommand('set-auto-pr')
    assert.ok(setAutoPrCmd, 'set-auto-pr command should exist')

    setAutoPrCmd._action('true')

    assert.equal(mockedSetConfig.mock.callCount(), 1)
    assert.deepEqual(mockedSetConfig.mock.calls[0].arguments, ['autoPr', true])
  })

  await t.test('set-auto-pr action calls setConfig correctly with false', () => {
    mockedSetConfig.mock.resetCalls()
    const setAutoPrCmd = getSubCommand('set-auto-pr')

    setAutoPrCmd._action('false')

    assert.equal(mockedSetConfig.mock.callCount(), 1)
    assert.deepEqual(mockedSetConfig.mock.calls[0].arguments, ['autoPr', false])
  })

  await t.test('show action calls getConfig', () => {
    mockedGetConfig.mock.resetCalls()
    const showCmd = getSubCommand('show')
    assert.ok(showCmd, 'show command should exist')

    // Set up a mock return value for getConfig just to ensure it doesn't crash
    mockedGetConfig.mock.mockImplementationOnce(() => ({
      apiKey: 'test-key',
      source: 'test-source',
      branch: 'test-branch',
      autoPr: true
    }))

    // We don't strictly test console.log output based on user input,
    // but we can ensure it runs and calls getConfig
    showCmd._action()

    assert.equal(mockedGetConfig.mock.callCount(), 1)
  })

  await t.test('show action calls getConfig with empty config', () => {
    mockedGetConfig.mock.resetCalls()
    const showCmd = getSubCommand('show')

    mockedGetConfig.mock.mockImplementationOnce(() => ({}))
    showCmd._action()

    assert.equal(mockedGetConfig.mock.callCount(), 1)
  })
})
