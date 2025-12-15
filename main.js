/**
 * Terminal Integrated Plugin for Obsidian
 *
 * Architecture:
 * - xterm.js: Terminal emulator UI
 * - Python PTY Proxy: Bridge between xterm.js and system shell
 * - Data Flow: User Input → xterm.js → Python → Shell → Python → xterm.js → Display
 *
 * See ARCHITECTURE.md for detailed design documentation
 */

const { Plugin, ItemView } = require('obsidian');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const VIEW_TYPE_TERMINAL = 'terminal-view';

/**
 * TerminalView - Main terminal view component
 * Manages xterm.js instance and Python PTY proxy process
 */
class TerminalView extends ItemView {
  constructor(leaf) {
    super(leaf);
    this.terminal = null;
    this.pythonProcess = null;
    this.resizeObserver = null;
  }

  getViewType() {
    return VIEW_TYPE_TERMINAL;
  }

  getDisplayText() {
    return 'Terminal';
  }

  getIcon() {
    return 'terminal';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('terminal-container');

    await this.loadXtermLibrary();
    this.createTerminal(container);
  }

  /**
   * Dynamically load xterm.js library from CDN
   * Loads core xterm.js and fit addon for auto-sizing
   */
  async loadXtermLibrary() {
    return new Promise((resolve, reject) => {
      if (window.Terminal) {
        resolve();
        return;
      }

      // Load xterm.js
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
      script.onload = () => {
        // Load fit addon
        const fitScript = document.createElement('script');
        fitScript.src = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js';
        fitScript.onload = () => resolve();
        fitScript.onerror = () => reject(new Error('Failed to load fit addon'));
        document.head.appendChild(fitScript);
      };
      script.onerror = () => reject(new Error('Failed to load xterm.js'));
      document.head.appendChild(script);
    });
  }

  /**
   * Create and configure xterm.js terminal instance
   * Sets up theme, addons, event handlers, and starts Python PTY proxy
   */
  createTerminal(container) {
    const terminalEl = container.createDiv({ cls: 'xterm-wrapper' });

    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon?.FitAddon;

    this.terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.4,
      letterSpacing: 0,
      disableStdin: false,
      convertEol: false,  // Don't convert EOL - let the PTY handle it
      scrollback: 10000,
      theme: {
        background: '#ffffff',
        foreground: '#1a1a1a',
        cursor: '#007acc',
        cursorAccent: '#ffffff',
        selection: 'rgba(0, 122, 204, 0.2)',
        black: '#000000',
        red: '#cd3131',
        green: '#00bc00',
        yellow: '#e5bf00',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#555555',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      allowTransparency: false
    });

    this.terminal.open(terminalEl);

    // Setup fit addon
    if (FitAddon) {
      this.fitAddon = new FitAddon();
      this.terminal.loadAddon(this.fitAddon);

      setTimeout(() => {
        if (this.fitAddon) {
          this.fitAddon.fit();
        }
      }, 100);

      this.resizeObserver = new ResizeObserver(() => {
        if (this.fitAddon && this.terminal && this.pythonProcess) {
          this.fitAddon.fit();
          const { cols, rows } = this.terminal;
          this.sendResize(cols, rows);
        }
      });
      this.resizeObserver.observe(terminalEl);
    }

    // Focus handling
    terminalEl.addEventListener('click', () => {
      this.terminal.focus();
    });

    this.terminal.focus();

    this.startPythonProxy();

    // Forward user input to Python process
    this.terminal.onData((data) => {
      if (this.pythonProcess && this.pythonProcess.stdin) {
        this.pythonProcess.stdin.write(data);
      }
    });
  }

  /**
   * Start Python PTY proxy process
   * Spawns Python script that creates PTY and bridges to shell
   * Handles stdout/stderr output and process lifecycle
   */
  startPythonProxy() {
    const cwd = this.app.vault.adapter.basePath || os.homedir();
    const { cols, rows } = this.terminal;
    const scriptPath = path.join(
      this.app.vault.adapter.basePath,
      '.obsidian/plugins/terminal-integrated/pty_proxy.py'
    );

    // Spawn Python process
    this.pythonProcess = spawn('python3', [scriptPath, cols.toString(), rows.toString()], {
      cwd,
      env: process.env
    });

    // Handle output from Python proxy
    this.pythonProcess.stdout.on('data', (data) => {
      if (this.terminal) {
        this.terminal.write(data);
      }
    });

    // Handle errors
    this.pythonProcess.stderr.on('data', (data) => {
      console.error('Python PTY error:', data.toString());
      if (this.terminal) {
        this.terminal.write(`\x1b[31m${data.toString()}\x1b[0m`);
      }
    });

    // Handle process exit
    this.pythonProcess.on('exit', (code) => {
      if (this.terminal) {
        this.terminal.writeln('');
        this.terminal.writeln(`\x1b[33mShell exited (${code}). Press any key to restart.\x1b[0m`);
        const disposable = this.terminal.onData(() => {
          disposable.dispose();
          this.terminal.clear();
          this.startPythonProxy();
        });
      }
    });

    // Handle process errors
    this.pythonProcess.on('error', (err) => {
      console.error('Failed to start Python proxy:', err);
      if (this.terminal) {
        this.terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
        this.terminal.writeln('\x1b[33mMake sure Python 3 is installed and in PATH\x1b[0m');
      }
    });
  }

  /**
   * Send terminal resize command to Python proxy
   * Uses special __RESIZE__ command format with JSON payload
   */
  sendResize(cols, rows) {
    if (this.pythonProcess && this.pythonProcess.stdin) {
      try {
        const resizeCmd = `__RESIZE__:${JSON.stringify({ cols, rows })}\n`;
        this.pythonProcess.stdin.write(resizeCmd);
      } catch (e) {
        console.error('Failed to send resize:', e);
      }
    }
  }

  async onClose() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    if (this.pythonProcess) {
      try {
        this.pythonProcess.kill('SIGTERM');
      } catch (e) {
        console.error('Error killing Python process:', e);
      }
    }

    if (this.terminal) {
      this.terminal.dispose();
    }
  }
}

/**
 * TerminalPlugin - Main plugin class
 * Registers terminal view and provides user interface entry points
 */
class TerminalPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_TERMINAL, (leaf) => new TerminalView(leaf));

    this.addRibbonIcon('terminal', 'Open Terminal', () => this.activateView());

    this.addCommand({
      id: 'open-terminal',
      name: 'Open Terminal',
      callback: () => this.activateView()
    });
  }

  async activateView() {
    const { workspace } = this.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);

    let leaf = leaves.length > 0
      ? leaves[0]
      : workspace.getRightLeaf(false);

    if (leaves.length === 0) {
      await leaf.setViewState({ type: VIEW_TYPE_TERMINAL, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }
}

module.exports = TerminalPlugin;
