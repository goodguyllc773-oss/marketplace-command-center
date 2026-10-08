#!/bin/bash
# macOS: double-click (or `open start-dev.command`) to start MCC's dev
# servers in a Terminal window — API on 127.0.0.1:4000, web on 127.0.0.1:5173.
# The Windows equivalent is start-dev.cmd.
cd "$(dirname "$0")" || exit 1
npm run dev
