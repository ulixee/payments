#!/usr/bin/env node

import '@ulixee/commons/lib/SourceMapSupport';
import cli from '../cli/index';

cli().name('@ulixee/sidechain').parse();
