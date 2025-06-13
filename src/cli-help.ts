import * as p from '@clack/prompts';
import { outro, intro, note } from '@clack/prompts';
import color from 'picocolors';

export function showHelp(): void {
  console.log();
  intro(color.bgCyan(color.black(' LLM Whip ')));
  
  note(
    `Anti-cheat monitoring for LLM coding sessions

${color.bold('Usage:')}
  ${color.cyan('llm-whip')} ${color.dim('[options]')}                     Launch Claude with background monitoring ${color.dim('(DEFAULT)')}
  ${color.cyan('llm-whip init')} ${color.dim('[dir]')}                    Create TypeScript configuration file
  ${color.cyan('llm-whip audit')} ${color.dim('[dirs...] [options]')}     Scan directories and report existing patterns
  ${color.cyan('llm-whip watch')} ${color.cyan('<dirs...>')} ${color.dim('[options]')}     Watch directories only ${color.dim('(no LLM)')}

${color.bold('Options:')}
  ${color.cyan('--config=<path>')}                        Custom configuration file ${color.dim('(.ts, .js)')}
  ${color.cyan('--format=<type>')}                        Audit output format: ${color.dim('table, json, csv (default: table)')}
  ${color.cyan('--grep=<patterns>')}                      Only watch files containing these patterns ${color.dim('(comma-separated)')}
  ${color.cyan('--help, -h')}                             Show this help

${color.bold('Examples:')}
  ${color.dim('# Create llm-whip.config.ts')}
  ${color.green('llm-whip init')}
  
  ${color.dim('# Scan current directory for patterns')}
  ${color.green('llm-whip audit')}
  
  ${color.dim('# Audit src directory, output as JSON')}
  ${color.green('llm-whip audit ./src --format=json')}
  
  ${color.dim('# Launch Claude with background monitoring')}
  ${color.green('llm-whip')}
  
  ${color.dim('# With custom TypeScript config')}
  ${color.green('llm-whip --config=strict.ts')}
  
  ${color.dim('# File monitoring only')}
  ${color.green('llm-whip watch ./src ./lib')}
  
  ${color.dim('# Watch only files containing TODO or FIXME')}
  ${color.green('llm-whip watch ./src --grep="TODO,FIXME"')}`,
    'ℹ️ Info'
  );
  
  outro(color.dim('The default mode runs Claude normally while monitoring files for anti-cheat patterns!'));
}