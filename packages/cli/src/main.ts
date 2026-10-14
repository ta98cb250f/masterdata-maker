// sheetcraft の CLI の入口（FR-CLI-06）
import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
});
