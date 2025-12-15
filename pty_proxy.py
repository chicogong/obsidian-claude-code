#!/usr/bin/env python3
"""
PTY Proxy for Obsidian Terminal Plugin

Architecture Role:
  This script serves as a bridge between the Obsidian plugin (Node.js)
  and the system shell, enabling full terminal functionality.

Data Flow:
  Node.js stdin → Python stdin → PTY master → Shell
  Shell output → PTY master → Python stdout → Node.js stdout

Key Features:
  - Creates pseudo-terminal (PTY) using os.openpty()
  - Disables ECHO to prevent character duplication
  - Supports terminal resize via special __RESIZE__ commands
  - Uses select() for non-blocking bidirectional I/O

Technical Details:
  - TERM=xterm-256color for full terminal capabilities
  - ECHO disabled on slave terminal before fork
  - Shell inherits configured terminal attributes
  - JSON-based resize protocol for window size changes

See ARCHITECTURE.md for detailed design documentation.
"""

import os
import sys
import select
import termios
import struct
import fcntl
import signal
import json

def set_winsize(fd, rows, cols):
    """Set the window size of the PTY."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

def main():
    # Get initial terminal size from arguments
    if len(sys.argv) >= 3:
        cols = int(sys.argv[1])
        rows = int(sys.argv[2])
    else:
        cols = 80
        rows = 24

    # Get shell from environment or use default
    shell = os.environ.get('SHELL', '/bin/bash')

    # Create PTY pair
    master_fd, slave_fd = os.openpty()

    # Set window size on master
    set_winsize(master_fd, rows, cols)

    # Disable ECHO on the slave terminal
    # This prevents the PTY from echoing characters back
    # The shell will still work normally and display output
    attrs = termios.tcgetattr(slave_fd)
    attrs[3] = attrs[3] & ~termios.ECHO  # Disable ECHO
    termios.tcsetattr(slave_fd, termios.TCSANOW, attrs)

    # Fork to create child process
    pid = os.fork()

    if pid == 0:
        # Child process
        os.close(master_fd)

        # Set up slave as stdin/stdout/stderr
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)

        if slave_fd > 2:
            os.close(slave_fd)

        # Start a new session
        os.setsid()

        # Set controlling terminal
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        # Disable echo on stdin AGAIN in the child process
        attrs = termios.tcgetattr(0)
        attrs[3] = attrs[3] & ~termios.ECHO
        termios.tcsetattr(0, termios.TCSANOW, attrs)

        # Set proper TERM for xterm.js compatibility
        os.environ['TERM'] = 'xterm-256color'

        # Execute shell in interactive mode
        os.execvp(shell, [shell, '-i'])
    else:
        # Parent process
        os.close(slave_fd)

        try:
            # Set non-blocking mode for master_fd
            flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
            fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Set non-blocking mode for stdin
            flags = fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL)
            fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, flags | os.O_NONBLOCK)

            # Main loop - bridge between stdin/stdout and PTY
            while True:
                # Use select to wait for data
                readable, _, _ = select.select([sys.stdin, master_fd], [], [], 0.1)

                # Read from stdin (input from Obsidian) and write to PTY
                if sys.stdin in readable:
                    try:
                        data = sys.stdin.buffer.read(4096)
                        if not data:
                            break

                        # Check if this is a resize command (JSON format)
                        if data.startswith(b'__RESIZE__:'):
                            try:
                                resize_data = data[11:].decode('utf-8').strip()
                                size = json.loads(resize_data)
                                set_winsize(master_fd, size['rows'], size['cols'])
                                continue
                            except:
                                pass

                        os.write(master_fd, data)
                    except (OSError, IOError):
                        pass

                # Read from PTY (output from shell) and write to stdout
                if master_fd in readable:
                    try:
                        data = os.read(master_fd, 4096)
                        if not data:
                            break
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                    except (OSError, IOError):
                        break

        except KeyboardInterrupt:
            pass
        finally:
            # Clean up
            os.close(master_fd)
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)

if __name__ == '__main__':
    main()
