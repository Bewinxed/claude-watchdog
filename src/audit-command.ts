import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type { Config, Pattern } from './types';
import { config as rootConfig } from '../llm-whip.config';
import * as p from '@clack/prompts';
import color from 'picocolors';

interface AuditResult {
  file: string;
  line: number;
  pattern: string;
  severity: 'high' | 'medium' | 'low';
  match: string;
  message: string;
  fullLine: string;
}

export class AuditCommand {
  private static readonly DEFAULT_EXTENSIONS = [
    '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cpp', '.c',
    '.go', '.rs', '.rb', '.php', '.vue', '.svelte', '.swift'
  ];

  private static readonly DEFAULT_IGNORE = [
    'node_modules', 'dist', 'build', '.git', 'coverage', '.next',
    '.bun', 'target', '__pycache__', '.pytest_cache'
  ];

  static async run(directories: string[], configPath?: string, format: 'table' | 'json' | 'csv' = 'table'): Promise<void> {
    console.log();
    p.intro(color.bgMagenta(color.black(' LLM Whip Audit ')));

    // Load config
    const config = await this.loadConfig(configPath);
    
    // Scan all directories
    const spinner = p.spinner();
    spinner.start('Scanning directories for anti-cheat patterns');
    
    const results: AuditResult[] = [];
    for (const dir of directories) {
      spinner.message(`Scanning ${color.cyan(dir)}`);
      const dirResults = await this.scanDirectory(dir, config);
      results.push(...dirResults);
    }
    
    spinner.stop(`Found ${color.yellow(results.length.toString())} potential issues`);
    
    if (results.length === 0) {
      p.outro(color.green('✅ No anti-cheat patterns detected! Your code is clean.'));
      return;
    }

    switch (format) {
      case 'json':
        this.outputJSON(results);
        break;
      case 'csv':
        this.outputCSV(results);
        break;
      default:
        this.outputTable(results);
    }

    // Summary
    const summary = this.generateSummary(results);
    console.log('\n📈 Summary:');
    for (const [severity, count] of Object.entries(summary)) {
      const emoji = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢';
      console.log(`${emoji} ${severity.toUpperCase()}: ${count} issues`);
    }
  }

  private static async loadConfig(configPath?: string): Promise<Config> {
    const defaultConfig: Config = {
      ...rootConfig,
      reactions: { sound: false, interrupt: false, alert: false },
      debounce: false,
      fileTracking: false
    };

    if (!configPath) return defaultConfig;

    try {
      if (configPath.endsWith('.ts') || configPath.endsWith('.js')) {
        const configModule = await import(join(process.cwd(), configPath));
        const customConfig = configModule.config || configModule.default;
        return { ...defaultConfig, ...customConfig };
      } else {
        console.error('Config file must be a TypeScript (.ts) or JavaScript (.js) file');
        return defaultConfig;
      }
    } catch (error) {
      console.warn(`⚠️  Failed to load config ${configPath}, using defaults`);
      return defaultConfig;
    }
  }

  private static async scanDirectory(dir: string, config: Config): Promise<AuditResult[]> {
    const results: AuditResult[] = [];

    try {
      const items = await readdir(dir);
      
      for (const item of items) {
        const fullPath = join(dir, item);
        
        // Skip ignored directories
        if (this.DEFAULT_IGNORE.some(pattern => item.includes(pattern))) {
          continue;
        }

        const stats = await stat(fullPath);
        
        if (stats.isDirectory()) {
          // Recurse into subdirectories
          const subResults = await this.scanDirectory(fullPath, config);
          results.push(...subResults);
        } else if (stats.isFile() && this.shouldScanFile(fullPath)) {
          // Scan file
          const fileResults = await this.scanFile(fullPath, config);
          results.push(...fileResults);
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not scan directory ${dir}:`, error);
    }

    return results;
  }

  private static shouldScanFile(filePath: string): boolean {
    const ext = extname(filePath);
    return this.DEFAULT_EXTENSIONS.includes(ext);
  }

  private static async scanFile(filePath: string, config: Config): Promise<AuditResult[]> {
    const results: AuditResult[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const relativePath = relative(process.cwd(), filePath);

      for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        
        for (const pattern of config.patterns) {
          const regex = new RegExp(pattern.pattern, 'gmi');
          let match: RegExpExecArray | null;
          
          while ((match = regex.exec(line || '')) !== null) {
            results.push({
              file: relativePath,
              line: lineNum + 1,
              pattern: pattern.name,
              severity: pattern.severity || 'medium',
              match: match[0],
              message: pattern.message || `${pattern.name} detected`,
              fullLine: line?.trim() || ''
            });
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not scan file ${filePath}:`, error);
    }

    return results;
  }

  private static outputTable(results: AuditResult[]): void {
    console.log('📋 Audit Results (Table Format):\n');
    
    // Group by severity for better readability
    const grouped = this.groupBySeverity(results);
    
    for (const [severity, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;
      
      const emoji = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢';
      console.log(`${emoji} ${severity.toUpperCase()} SEVERITY (${items.length} issues):`);
      console.log('─'.repeat(80));
      
      for (const result of items) {
        console.log(`📁 ${result.file}:${result.line}`);
        console.log(`🔍 Pattern: ${result.pattern}`);
        console.log(`💬 Message: ${result.message}`);
        console.log(`📝 Code: ${result.fullLine}`);
        console.log(`🎯 Match: "${result.match}"`);
        console.log('─'.repeat(40));
      }
      console.log();
    }
  }

  private static outputJSON(results: AuditResult[]): void {
    console.log('📋 Audit Results (JSON Format):\n');
    console.log('```json');
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      totalIssues: results.length,
      summary: this.generateSummary(results),
      issues: results
    }, null, 2));
    console.log('```');
  }

  private static outputCSV(results: AuditResult[]): void {
    console.log('📋 Audit Results (CSV Format):\n');
    console.log('```csv');
    console.log('File,Line,Pattern,Severity,Match,Message,FullLine');
    
    for (const result of results) {
      const csvLine = [
        result.file,
        result.line.toString(),
        result.pattern,
        result.severity,
        `"${result.match.replace(/"/g, '""')}"`,
        `"${result.message.replace(/"/g, '""')}"`,
        `"${result.fullLine.replace(/"/g, '""')}"`
      ].join(',');
      console.log(csvLine);
    }
    console.log('```');
  }

  private static groupBySeverity(results: AuditResult[]): Record<string, AuditResult[]> {
    return results.reduce((groups, result) => {
      if (!groups[result.severity]) {
        groups[result.severity] = [];
      }
      groups[result.severity]!.push(result);
      return groups;
    }, {} as Record<string, AuditResult[]>);
  }

  private static generateSummary(results: AuditResult[]): Record<string, number> {
    return results.reduce((summary, result) => {
      summary[result.severity] = (summary[result.severity] || 0) + 1;
      return summary;
    }, {} as Record<string, number>);
  }
}