#!/usr/bin/env node

import { runCli } from "./command.js";

process.exitCode = runCli(process.argv.slice(2));
