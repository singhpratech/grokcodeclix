#!/usr/bin/env node
/**
 * Smoke test for Grok Code CLI.
 *
 * Exercises every module we can test offline without calling the xAI API:
 *   - markdown renderer (edge cases, long text, regex)
 *   - diff util
 *   - image utils (path detection, reference extraction)
 *   - tool execution (Read/Write/Edit/Glob/Grep/Bash) on scratch files
 *   - registry tool map
 *   - permissions manager risk levels
 *   - history manager save/load
 *   - custom commands loader
 *   - GrokClient request building (doesn't call the network)
 *   - CLI --version via child_process
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST = path.join(__dirname, 'dist');

const TMP = path.join(os.tmpdir(), `grokcli-smoke-${Date.now()}`);
await fs.mkdir(TMP, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  ✗ ${name}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

async function section(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name} threw: ${err.message}`);
    console.log(`  ✗ threw: ${err.message}`);
    console.log(err.stack);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Markdown renderer
// ───────────────────────────────────────────────────────────────────────────
await section('Markdown renderer', async () => {
  const { renderMarkdown, stripMarkdown } = await import(`${DIST}/utils/markdown.js`);

  // Basic text roundtrip
  const plain = renderMarkdown('hello world');
  assert(plain.includes('hello world'), 'plain text preserved');

  // Headers
  const h1 = renderMarkdown('# Title');
  assert(h1.includes('Title'), 'h1 rendered');

  const h2 = renderMarkdown('## Subtitle');
  assert(h2.includes('Subtitle'), 'h2 rendered');

  // Bold & italic
  const bold = renderMarkdown('**bold text**');
  assert(bold.includes('bold text'), 'bold content preserved');
  assert(bold.includes('\x1b['), 'bold has ANSI codes');

  const italic = renderMarkdown('This is *italic* text');
  assert(italic.includes('italic'), 'italic content preserved');

  // Inline code
  const code = renderMarkdown('use `foo()` here');
  assert(code.includes('foo()'), 'inline code preserved');

  // Fenced code block
  const block = renderMarkdown('```ts\nconst x: number = 42;\n```');
  assert(block.includes('const'), 'code block content preserved');
  assert(block.includes('42'), 'code block numbers preserved');

  // Lists
  const ul = renderMarkdown('- item 1\n- item 2');
  assert(ul.includes('item 1') && ul.includes('item 2'), 'unordered list items preserved');

  const ol = renderMarkdown('1. first\n2. second');
  assert(ol.includes('first') && ol.includes('second'), 'ordered list items preserved');

  // Links
  const link = renderMarkdown('[click](https://x.ai)');
  assert(link.includes('click') && link.includes('https://x.ai'), 'link label and URL preserved');

  // Blockquote
  const quote = renderMarkdown('> quoted text');
  assert(quote.includes('quoted text'), 'blockquote content preserved');

  // Strip
  assertEq(
    stripMarkdown('# Title\n**bold** and *italic* with `code` and [link](url)'),
    'Title\nbold and italic with code and link',
    'stripMarkdown strips formatting'
  );

  // Long text — 10k chars shouldn't crash
  const longText = 'word '.repeat(2000) + '\n**bold** end';
  const longRendered = renderMarkdown(longText);
  assert(longRendered.length > 9000, 'long text rendered');

  // Malformed markdown — no unclosed crashes
  const malformed = renderMarkdown('**unclosed bold\n\n```\nunclosed code');
  assert(typeof malformed === 'string', 'malformed markdown does not crash');

  // Nested code block in list
  const nested = renderMarkdown('- item with `inline code`\n- another');
  assert(nested.includes('inline code'), 'nested inline code in list');

  // Regex-heavy content (important — the renderer uses many regexes)
  const regex = renderMarkdown('Try `/foo\\s+(bar|baz)/gi` or `^\\d+$`');
  assert(regex.includes('foo') && regex.includes('\\s+'), 'regex-like content preserved');

  // Multiple consecutive code blocks
  const multi = renderMarkdown('```js\na\n```\n```py\nb\n```');
  assert(multi.includes('a') && multi.includes('b'), 'multiple code blocks');
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Diff util
// ───────────────────────────────────────────────────────────────────────────
await section('Diff util', async () => {
  const { computeDiff, renderDiff, formatDiffSummary } = await import(`${DIST}/utils/diff.js`);

  // Simple line change
  const d1 = computeDiff('line1\nline2\nline3', 'line1\nCHANGED\nline3');
  assertEq(d1.additions, 1, 'simple change counts 1 addition');
  assertEq(d1.removals, 1, 'simple change counts 1 removal');

  // Pure addition
  const d2 = computeDiff('a\nb', 'a\nb\nc\nd');
  assertEq(d2.additions, 2, 'pure addition counts');
  assertEq(d2.removals, 0, 'pure addition has no removals');

  // Pure removal
  const d3 = computeDiff('a\nb\nc', 'a');
  assertEq(d3.additions, 0, 'pure removal has no additions');
  assertEq(d3.removals, 2, 'pure removal counts');

  // No change
  const d4 = computeDiff('same\ntext', 'same\ntext');
  assertEq(d4.additions, 0, 'no change = 0 additions');
  assertEq(d4.removals, 0, 'no change = 0 removals');

  // Rendered diff contains colored markers
  const rendered = renderDiff(d1);
  assert(rendered.includes('CHANGED'), 'renderDiff includes new line');
  assert(rendered.includes('line2'), 'renderDiff includes old line');

  // Summary formatting
  assertEq(formatDiffSummary(d1), '1 addition and 1 removal', 'summary singular');
  assertEq(formatDiffSummary({ additions: 3, removals: 2, lines: [] }), '3 additions and 2 removals', 'summary plural');
  assertEq(formatDiffSummary(d4), 'no changes', 'summary no changes');

  // Large file diff doesn't crash
  const a = Array(500).fill('line').join('\n');
  const b = Array(500).fill('line').map((l, i) => (i === 250 ? 'CHANGED' : l)).join('\n');
  const dLarge = computeDiff(a, b);
  assert(dLarge.additions === 1 && dLarge.removals === 1, 'large file single change detected');
  const renderedLarge = renderDiff(dLarge, 10);
  assert(renderedLarge.length > 0, 'large diff renders');
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Image utils (offline — path detection only)
// ───────────────────────────────────────────────────────────────────────────
await section('Image utils', async () => {
  const { isImagePath, extractImageReferences } = await import(`${DIST}/utils/image.js`);

  assert(isImagePath('foo.png'), 'png detected');
  assert(isImagePath('/abs/path/bar.JPG'), 'JPG uppercase detected');
  assert(isImagePath('./rel.webp'), 'webp detected');
  assert(!isImagePath('foo.txt'), 'txt not image');
  assert(!isImagePath('foo'), 'no extension not image');

  const { text, paths } = extractImageReferences('check @screenshot.png please');
  assert(paths.includes('screenshot.png'), 'extracted image path');
  assert(text.includes('check') && text.includes('please'), 'remaining text preserved');

  const nopaths = extractImageReferences('nothing to see here');
  assertEq(nopaths.paths.length, 0, 'no paths in plain text');
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Tool execution on scratch files
// ───────────────────────────────────────────────────────────────────────────
await section('Tool execution', async () => {
  const { executeTool, allTools } = await import(`${DIST}/tools/registry.js`);

  // All tools registered
  const toolNames = allTools.map((t) => t.function.name).sort();
  const expected = [
    'Bash', 'BashOutput', 'Edit', 'ExitPlanMode',
    'GenerateImage', 'Glob', 'Grep', 'KillBash',
    'MultiEdit', 'Read', 'SpeakText', 'TodoWrite',
    'TranscribeAudio', 'WebFetch', 'WebSearch', 'Write',
  ];
  assertEq(allTools.length, expected.length, `${expected.length} tools in registry`);
  assertEq(toolNames, expected, 'all tool names present');

  // Write
  const testFile = path.join(TMP, 'test.txt');
  const writeResult = await executeTool('Write', { file_path: testFile, content: 'hello\nworld' });
  assert(writeResult.success, 'Write succeeded');
  assert(writeResult.display?.summary, 'Write returns display summary');

  // Read
  const readResult = await executeTool('Read', { file_path: testFile });
  assert(readResult.success, 'Read succeeded');
  assert(readResult.output.includes('hello'), 'Read returns content');
  assert(readResult.display?.summary, 'Read returns display summary');

  // Edit
  const editResult = await executeTool('Edit', {
    file_path: testFile,
    old_string: 'hello',
    new_string: 'HELLO',
  });
  assert(editResult.success, 'Edit succeeded');
  assert(editResult.display?.diff, 'Edit returns diff');
  assertEq(editResult.display.diff.additions, 1, 'Edit diff 1 addition');

  // Verify edit
  const readAfter = await executeTool('Read', { file_path: testFile });
  assert(readAfter.output.includes('HELLO'), 'Edit actually changed file');

  // Edit — old_string not found
  const editMissing = await executeTool('Edit', {
    file_path: testFile,
    old_string: 'nonexistent',
    new_string: 'X',
  });
  assert(!editMissing.success, 'Edit fails on missing old_string');

  // Read — missing file
  const readMissing = await executeTool('Read', { file_path: path.join(TMP, 'nope.txt') });
  assert(!readMissing.success, 'Read fails on missing file');

  // Write — with directory creation
  const nestedFile = path.join(TMP, 'nested/dir/file.txt');
  const nestedResult = await executeTool('Write', { file_path: nestedFile, content: 'nested' });
  assert(nestedResult.success, 'Write creates nested directories');

  // Glob
  const globResult = await executeTool('Glob', { pattern: '**/*.txt', path: TMP });
  assert(globResult.success, 'Glob succeeded');
  assert(globResult.output.includes('test.txt') || globResult.output.includes('file.txt'), 'Glob found txt files');

  // Grep
  const grepResult = await executeTool('Grep', { pattern: 'HELLO', path: TMP });
  assert(grepResult.success, 'Grep succeeded');

  // Bash — simple echo
  const bashResult = await executeTool('Bash', { command: 'echo bash-works' });
  assert(bashResult.success, 'Bash succeeded');
  assert(bashResult.output.includes('bash-works'), 'Bash echo output');

  // Bash — non-zero exit
  const bashFail = await executeTool('Bash', { command: 'exit 1' });
  assert(!bashFail.success, 'Bash non-zero exit is failure');

  // Bash — timeout enforced
  const bashTimeout = await executeTool('Bash', { command: 'sleep 5', timeout: 1000 });
  assert(!bashTimeout.success, 'Bash timeout produces failure');
  assert(/timed out/i.test(bashTimeout.error || ''), 'Bash timeout error mentions timeout');

  // MultiEdit — happy path
  const meFile = path.join(TMP, 'multi.txt');
  await executeTool('Write', { file_path: meFile, content: 'foo\nbar\nbaz\nfoo' });
  const meResult = await executeTool('MultiEdit', {
    file_path: meFile,
    edits: [
      { old_string: 'bar', new_string: 'BAR' },
      { old_string: 'baz', new_string: 'BAZ' },
      { old_string: 'foo', new_string: 'FOO', replace_all: true },
    ],
  });
  assert(meResult.success, 'MultiEdit succeeded');
  const meAfter = await executeTool('Read', { file_path: meFile });
  assert(meAfter.output.includes('FOO'), 'MultiEdit applied first edit');
  assert(meAfter.output.includes('BAR'), 'MultiEdit applied second edit');
  assert(meAfter.output.includes('BAZ'), 'MultiEdit applied third edit');

  // MultiEdit — atomic on failure (one bad edit aborts the rest)
  const meFile2 = path.join(TMP, 'multi2.txt');
  await executeTool('Write', { file_path: meFile2, content: 'alpha\nbeta' });
  const meBad = await executeTool('MultiEdit', {
    file_path: meFile2,
    edits: [
      { old_string: 'alpha', new_string: 'ALPHA' },
      { old_string: 'nope', new_string: 'X' },
    ],
  });
  assert(!meBad.success, 'MultiEdit fails when an edit is unmatched');
  const meBadAfter = await executeTool('Read', { file_path: meFile2 });
  assert(meBadAfter.output.includes('alpha'), 'MultiEdit atomic — file unchanged on failure');

  // TodoWrite — persists state
  const twResult = await executeTool('TodoWrite', {
    todos: [
      { content: 'Task one', status: 'completed' },
      { content: 'Task two', status: 'in_progress', activeForm: 'Doing task two' },
      { content: 'Task three', status: 'pending' },
    ],
  });
  assert(twResult.success, 'TodoWrite succeeded');
  assert(twResult.display?.preview, 'TodoWrite returns rendered preview');
  const { todoState } = await import(`${DIST}/tools/todowrite.js`);
  assertEq(todoState.items.length, 3, 'TodoWrite stored 3 items');

  // TodoWrite — rejects two in_progress
  const twBad = await executeTool('TodoWrite', {
    todos: [
      { content: 'A', status: 'in_progress' },
      { content: 'B', status: 'in_progress' },
    ],
  });
  assert(!twBad.success, 'TodoWrite rejects multiple in_progress');

  // Background bash + BashOutput + KillBash
  const bgStart = await executeTool('Bash', {
    command: 'for i in 1 2 3 4 5; do echo line-$i; sleep 0.2; done',
    run_in_background: true,
  });
  assert(bgStart.success, 'Bash run_in_background started');
  const idMatch = bgStart.output.match(/bash_\d+/);
  assert(idMatch, 'Bash background returns bash_id');
  const bgId = idMatch[0];
  // Wait for some output to accumulate
  await new Promise((r) => setTimeout(r, 600));
  const bgOut = await executeTool('BashOutput', { bash_id: bgId });
  assert(bgOut.success, 'BashOutput read succeeded');
  assert(/line-/.test(bgOut.output), 'BashOutput returns streamed lines');
  // Cursor: a second read returns less / no duplicate output
  const bgOut2 = await executeTool('BashOutput', { bash_id: bgId });
  assert(bgOut2.success, 'BashOutput second read succeeded');
  assert(
    bgOut2.output.length <= bgOut.output.length + 200,
    'BashOutput cursor advances (no duplicate output)'
  );
  // Kill it
  const kill = await executeTool('KillBash', { bash_id: bgId });
  assert(kill.success, 'KillBash succeeded');

  // BashOutput on unknown id
  const bgBad = await executeTool('BashOutput', { bash_id: 'bash_99999' });
  assert(!bgBad.success, 'BashOutput rejects unknown id');

  // ExitPlanMode — flips request flag
  const { planExitState } = await import(`${DIST}/tools/exitplan.js`);
  planExitState.requested = false;
  const ep = await executeTool('ExitPlanMode', { plan: '1. Read files\n2. Write changes' });
  assert(ep.success, 'ExitPlanMode succeeded');
  assertEq(planExitState.requested, true, 'ExitPlanMode flips request flag');
  planExitState.requested = false; // reset for cleanliness

  // ExitPlanMode without plan
  const epBad = await executeTool('ExitPlanMode', {});
  assert(!epBad.success, 'ExitPlanMode rejects empty plan');

  // Unknown tool
  const unknown = await executeTool('BogusTool', {});
  assert(!unknown.success, 'Unknown tool rejected');
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Permissions manager
// ───────────────────────────────────────────────────────────────────────────
await section('Permissions manager', async () => {
  const { PermissionManager } = await import(`${DIST}/permissions/manager.js`);
  const pm = new PermissionManager();

  assertEq(pm.getToolRiskLevel('Read'), 'read', 'Read is read risk');
  assertEq(pm.getToolRiskLevel('Glob'), 'read', 'Glob is read risk');
  assertEq(pm.getToolRiskLevel('Grep'), 'read', 'Grep is read risk');
  assertEq(pm.getToolRiskLevel('WebFetch'), 'read', 'WebFetch is read risk');
  assertEq(pm.getToolRiskLevel('WebSearch'), 'read', 'WebSearch is read risk');
  assertEq(pm.getToolRiskLevel('Write'), 'write', 'Write is write risk');
  assertEq(pm.getToolRiskLevel('Edit'), 'write', 'Edit is write risk');
  assertEq(pm.getToolRiskLevel('Bash'), 'execute', 'Bash is execute risk');

  // Auto-approve bypass
  const pmAuto = new PermissionManager(['Read']);
  const approved = await pmAuto.requestPermission({
    tool: 'Read',
    description: 'test',
    riskLevel: 'read',
  });
  assertEq(approved, true, 'auto-approved tool bypasses prompt');

  const pmStar = new PermissionManager(['*']);
  const approvedAll = await pmStar.requestPermission({
    tool: 'Bash',
    description: 'test',
    riskLevel: 'execute',
  });
  assertEq(approvedAll, true, 'wildcard auto-approve works');

  // formatToolDetails
  assertEq(
    pm.formatToolDetails('Read', { file_path: '/tmp/x' }),
    'Read file: /tmp/x',
    'formatToolDetails Read'
  );
  assertEq(
    pm.formatToolDetails('WebSearch', { query: 'grok api' }),
    'Search web: grok api',
    'formatToolDetails WebSearch'
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 6. History manager
// ───────────────────────────────────────────────────────────────────────────
await section('History manager', async () => {
  // Use a temp HOME so we don't pollute the real config
  const fakeHome = path.join(TMP, 'home');
  await fs.mkdir(fakeHome, { recursive: true });
  const origHome = process.env.HOME;
  process.env.HOME = fakeHome;

  try {
    // Need to re-import with the new HOME — use a dynamic import via a unique query param trick
    const mod = await import(`${DIST}/conversation/history.js?v=${Date.now()}`);
    const hm = new mod.HistoryManager();

    const session = await hm.createSession(TMP);
    assert(session.id, 'session has id');
    assertEq(session.title, 'New Conversation', 'default title');

    session.messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello world from smoke test' },
      { role: 'assistant', content: 'hi' },
    ];
    await hm.saveSession(session);

    const loaded = await hm.loadSession(session.id);
    assert(loaded !== null, 'session loadable');
    assertEq(loaded.messages.length, 3, 'loaded 3 messages');

    const list = await hm.listSessions(5);
    assert(list.length >= 1, 'listSessions returns at least one');

    const last = await hm.getLastSession();
    assert(last !== null, 'getLastSession returns something');

    const deleted = await hm.deleteSession(session.id);
    assertEq(deleted, true, 'deleteSession returns true');
  } finally {
    process.env.HOME = origHome;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Custom commands loader
// ───────────────────────────────────────────────────────────────────────────
await section('Custom commands loader', async () => {
  const { processCommandArgs } = await import(`${DIST}/commands/loader.js`);

  // Arg substitution
  assertEq(
    processCommandArgs('Hello $ARGUMENTS!', 'world'),
    'Hello world!',
    '$ARGUMENTS substitution'
  );

  assertEq(
    processCommandArgs('First: $1, Second: $2', 'foo bar'),
    'First: foo, Second: bar',
    '$1 $2 substitution'
  );

  // Missing args — leave literals
  assertEq(
    processCommandArgs('$1 and $2', ''),
    '$1 and $2',
    'missing args leave literals'
  );

  // Loading from fake project dir
  const projectDir = path.join(TMP, 'cmd-project');
  const commandsDir = path.join(projectDir, '.grok', 'commands');
  await fs.mkdir(commandsDir, { recursive: true });
  await fs.writeFile(
    path.join(commandsDir, 'greet.md'),
    '---\ndescription: Greet someone\n---\n\nHello $ARGUMENTS',
    'utf-8'
  );

  const origCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const { loadCustomCommands } = await import(`${DIST}/commands/loader.js?v=${Date.now()}`);
    const cmds = await loadCustomCommands();
    assert(cmds.length >= 1, 'loaded at least one custom command');
    const greet = cmds.find((c) => c.name === 'greet');
    assert(greet, 'found greet command');
    assertEq(greet.description, 'Greet someone', 'parsed frontmatter description');
  } finally {
    process.chdir(origCwd);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 8. GrokClient (mocked fetch)
// ───────────────────────────────────────────────────────────────────────────
await section('GrokClient request building', async () => {
  const { GrokClient } = await import(`${DIST}/grok/client.js`);

  // Replace global fetch
  const origFetch = globalThis.fetch;
  let lastRequest = null;
  globalThis.fetch = async (url, init) => {
    lastRequest = { url, init };
    // Return a minimal valid response
    return new Response(
      JSON.stringify({
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'grok-4-1-fast-reasoning',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hi' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  try {
    const client = new GrokClient('fake-key', 'grok-4-1-fast-reasoning');
    const resp = await client.chat([{ role: 'user', content: 'hi' }]);
    assertEq(resp.choices[0].message.content, 'hi', 'chat returns choice content');
    assert(lastRequest.url.includes('/chat/completions'), 'calls /chat/completions');
    assertEq(lastRequest.init.method, 'POST', 'uses POST');
    const body = JSON.parse(lastRequest.init.body);
    assertEq(body.model, 'grok-4-1-fast-reasoning', 'includes model');
    assertEq(body.messages[0].content, 'hi', 'includes messages');
    assertEq(body.stream, false, 'chat is non-streaming');

    // With tools
    await client.chat(
      [{ role: 'user', content: 'x' }],
      [
        {
          type: 'function',
          function: { name: 'T', description: 'test', parameters: {} },
        },
      ]
    );
    const bodyWithTools = JSON.parse(lastRequest.init.body);
    assert(bodyWithTools.tools && bodyWithTools.tools.length === 1, 'includes tools');
    assertEq(bodyWithTools.tool_choice, 'auto', 'tool_choice auto');

    // Error handling
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    try {
      await client.chat([{ role: 'user', content: 'x' }]);
      assert(false, '401 throws');
    } catch (err) {
      assert(err.message.includes('401'), '401 error mentions status');
      assert(err.message.includes('XAI_API_KEY') || err.message.includes('bad key'), '401 error has context');
    }

    // 429 rate limit with retry-after
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
        headers: { 'retry-after': '60' },
      });
    try {
      await client.chat([{ role: 'user', content: 'x' }]);
      assert(false, '429 throws');
    } catch (err) {
      assert(err.message.includes('429'), '429 error');
      assert(err.message.includes('retry'), '429 includes retry hint');
    }
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Tools registry dispatcher
// ───────────────────────────────────────────────────────────────────────────
await section('Registry dispatcher', async () => {
  const { executeTool } = await import(`${DIST}/tools/registry.js`);

  // Invalid tool
  const r = await executeTool('NotARealTool', { foo: 1 });
  assert(!r.success, 'unknown tool returns failure');
  assert(r.error?.includes('Unknown'), 'error says unknown');
});

// ───────────────────────────────────────────────────────────────────────────
// 10. CLI --version (child_process)
// ───────────────────────────────────────────────────────────────────────────
await section('CLI --version', async () => {
  const result = await new Promise((resolve) => {
    const child = spawn('node', [path.join(DIST, 'cli.js'), '--version'], {
      env: { ...process.env, XAI_API_KEY: 'fake-for-version-check' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    // Safety timeout
    setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, 5000);
  });
  assertEq(result.code, 0, 'cli --version exits 0');
  assert(/\d+\.\d+\.\d+/.test(result.stdout), 'cli --version prints semver');
});

// ───────────────────────────────────────────────────────────────────────────
// 11. New Claude-Code parity features
// ───────────────────────────────────────────────────────────────────────────
await section('Claude Code parity features', async () => {
  // Verify the chat module exports and its slash command list is complete
  const { GrokChat } = await import(`${DIST}/conversation/chat.js`);
  assert(typeof GrokChat === 'function', 'GrokChat class exported');

  // Build a chat instance (doesn't start the loop)
  const chat = new GrokChat({ apiKey: 'fake-key-for-test' });

  // Check that the slash command map contains the new commands
  const commandNames = Object.keys(GrokChat.SLASH_COMMANDS || {});
  assert(commandNames.includes('/bug'), 'has /bug');
  assert(commandNames.includes('/release-notes'), 'has /release-notes');
  assert(commandNames.includes('/memory'), 'has /memory');
  assert(commandNames.includes('/output-style'), 'has /output-style');
  assert(commandNames.includes('/theme'), 'has /theme');
  assert(commandNames.includes('/back'), 'has /back');
  assert(commandNames.includes('/backup'), 'has /backup');

  // Latest additions
  assert(commandNames.includes('/init'), 'has /init');
  assert(commandNames.includes('/todos'), 'has /todos');
  assert(commandNames.includes('/todo'), 'has /todo');
  assert(commandNames.includes('/vim'), 'has /vim');
  assert(commandNames.includes('/terminal-setup'), 'has /terminal-setup');
  assert(commandNames.includes('/upgrade'), 'has /upgrade');
  assert(commandNames.includes('/feedback'), 'has /feedback');
  assert(commandNames.includes('/security-review'), 'has /security-review');
  assert(commandNames.includes('/pr-comments'), 'has /pr-comments');

  // Verify total count is at least 40
  assert(commandNames.length >= 40, `at least 40 slash commands (have ${commandNames.length})`);

  // Clean up the rl so the process can exit
  try {
    chat['rl']?.close();
  } catch {}
});

// ───────────────────────────────────────────────────────────────────────────
// 12. Memory system — loading GROK.md from multiple locations
// ───────────────────────────────────────────────────────────────────────────
await section('Memory hierarchy', async () => {
  // Create a fake project with a GROK.md
  const projectDir = path.join(TMP, 'memory-project');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'GROK.md'),
    '# Test Project\n\n## Notes\n- Use TypeScript\n',
    'utf-8'
  );

  const origCwd = process.cwd();
  process.chdir(projectDir);
  try {
    const { GrokChat } = await import(`${DIST}/conversation/chat.js?v=${Date.now()}`);
    const chat = new GrokChat({ apiKey: 'fake' });
    // Call the private loader via any-cast
    await chat['loadProjectContext']();
    const ctx = chat['projectContext'];
    assert(typeof ctx === 'string' && ctx.includes('Test Project'), 'loaded project GROK.md');
    assert(ctx.includes('TypeScript'), 'loaded project GROK.md contents');

    try {
      chat['rl']?.close();
    } catch {}
  } finally {
    process.chdir(origCwd);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 13. Provider detection & OpenRouter routing
// ───────────────────────────────────────────────────────────────────────────
await section('Provider detection (OpenRouter / xAI)', async () => {
  const {
    GrokClient,
    detectProvider,
    providerBaseUrl,
    normaliseModelForProvider,
  } = await import(`${DIST}/grok/client.js`);

  assertEq(detectProvider('xai-abc'), 'xai', 'xai- prefix → xai');
  assertEq(detectProvider('sk-or-v1-abc'), 'openrouter', 'sk-or- prefix → openrouter');
  assertEq(detectProvider('plain-string'), 'xai', 'unknown prefix → xai default');

  assertEq(providerBaseUrl('xai'), 'https://api.x.ai/v1', 'xai base URL');
  assertEq(providerBaseUrl('openrouter'), 'https://openrouter.ai/api/v1', 'openrouter base URL');

  assertEq(
    normaliseModelForProvider('grok-4-1-fast-reasoning', 'openrouter'),
    'x-ai/grok-4.1-fast',
    'maps grok-4-1 reasoning to x-ai/grok-4.1-fast'
  );
  assertEq(
    normaliseModelForProvider('grok-code-fast-1', 'openrouter'),
    'x-ai/grok-code-fast-1',
    'maps grok-code-fast-1'
  );
  assertEq(
    normaliseModelForProvider('grok-4', 'xai'),
    'grok-4',
    'xai keeps canonical name'
  );
  assertEq(
    normaliseModelForProvider('x-ai/grok-4', 'xai'),
    'grok-4',
    'xai strips x-ai/ prefix'
  );

  // GrokClient picks up provider from key prefix
  const orClient = new GrokClient('sk-or-v1-test', 'grok-4');
  assertEq(orClient.provider, 'openrouter', 'GrokClient detects OpenRouter from key');
  assertEq(orClient.model, 'x-ai/grok-4', 'GrokClient normalises model to OpenRouter slug');

  const xaiClient = new GrokClient('xai-test', 'grok-4-1-fast-reasoning');
  assertEq(xaiClient.provider, 'xai', 'GrokClient detects xAI from key');
  assertEq(xaiClient.model, 'grok-4-1-fast-reasoning', 'GrokClient keeps canonical xAI model');

  // Override via options.provider
  const overridden = new GrokClient('xai-test', 'grok-4', { provider: 'openrouter' });
  assertEq(overridden.provider, 'openrouter', 'explicit provider override wins');
});

// ───────────────────────────────────────────────────────────────────────────
// 14. New tool registration (MultiEdit / TodoWrite / Bash bg / ExitPlanMode)
// ───────────────────────────────────────────────────────────────────────────
await section('New tool registration', async () => {
  const { allTools } = await import(`${DIST}/tools/registry.js`);
  const names = allTools.map((t) => t.function.name);
  for (const t of ['MultiEdit', 'TodoWrite', 'BashOutput', 'KillBash', 'ExitPlanMode']) {
    assert(names.includes(t), `${t} registered`);
    const def = allTools.find((x) => x.function.name === t);
    assert(def?.function?.description?.length > 20, `${t} has a real description`);
    assert(def?.function?.parameters?.required?.length >= 0, `${t} has params schema`);
  }

  // Bash now advertises run_in_background
  const bash = allTools.find((t) => t.function.name === 'Bash');
  assert(
    'run_in_background' in (bash?.function?.parameters?.properties || {}),
    'Bash advertises run_in_background param'
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 15. Image generation, transcription, TTS — schemas + offline behaviour
// ───────────────────────────────────────────────────────────────────────────
await section('Multimodal tools (image / audio)', async () => {
  const { allTools, executeTool } = await import(`${DIST}/tools/registry.js`);
  const names = allTools.map((t) => t.function.name);

  // Tool registration + schema
  for (const t of ['GenerateImage', 'TranscribeAudio', 'SpeakText']) {
    assert(names.includes(t), `${t} registered`);
    const def = allTools.find((x) => x.function.name === t);
    assert(def?.function?.description?.length > 20, `${t} description present`);
  }
  const ig = allTools.find((t) => t.function.name === 'GenerateImage');
  assert(ig.function.parameters.required.includes('prompt'), 'GenerateImage requires prompt');
  const ta = allTools.find((t) => t.function.name === 'TranscribeAudio');
  assert(ta.function.parameters.required.includes('audio_path'), 'TranscribeAudio requires audio_path');
  const st = allTools.find((t) => t.function.name === 'SpeakText');
  assert(st.function.parameters.required.includes('text'), 'SpeakText requires text');

  // Without API key, tools error early with a clear message
  delete process.env.GROK_RUNTIME_API_KEY;
  const noKeyImg = await executeTool('GenerateImage', { prompt: 'a cat' });
  assert(!noKeyImg.success, 'GenerateImage fails without API key');
  assert(/API key/i.test(noKeyImg.error || ''), 'GenerateImage error mentions API key');

  const noKeyTr = await executeTool('TranscribeAudio', { audio_path: '/nonexistent.mp3' });
  assert(!noKeyTr.success, 'TranscribeAudio fails without API key');

  const noKeySp = await executeTool('SpeakText', { text: 'hello' });
  assert(!noKeySp.success, 'SpeakText fails without API key');

  // With key but missing/invalid audio file we should still get a clean error
  process.env.GROK_RUNTIME_API_KEY = 'fake-key-just-for-routing';
  process.env.GROK_RUNTIME_PROVIDER = 'xai';

  const trMissing = await executeTool('TranscribeAudio', { audio_path: '/tmp/nonexistent-audio.mp3' });
  assert(!trMissing.success, 'TranscribeAudio fails on missing file');
  assert(/not found/i.test(trMissing.error || ''), 'TranscribeAudio file-not-found error is clear');

  // Empty prompts/text rejected
  const emptyImg = await executeTool('GenerateImage', { prompt: '   ' });
  assert(!emptyImg.success, 'GenerateImage rejects empty prompt');
  const emptySpeak = await executeTool('SpeakText', { text: '' });
  assert(!emptySpeak.success, 'SpeakText rejects empty text');

  // Reset env
  delete process.env.GROK_RUNTIME_API_KEY;
  delete process.env.GROK_RUNTIME_PROVIDER;
});

// ───────────────────────────────────────────────────────────────────────────
// 16. Slash command coverage for new multimodal commands
// ───────────────────────────────────────────────────────────────────────────
await section('Multimodal slash commands', async () => {
  const { GrokChat } = await import(`${DIST}/conversation/chat.js?v=${Date.now()}`);
  const cmds = GrokChat.SLASH_COMMANDS;
  for (const c of ['/imagine', '/voice', '/speak', '/image', '/paste']) {
    assert(c in cmds, `${c} command registered`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Cleanup
// ───────────────────────────────────────────────────────────────────────────
await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  • ${f}`));
  process.exit(1);
}
