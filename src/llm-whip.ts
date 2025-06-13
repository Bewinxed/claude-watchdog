import * as fs from 'fs';
import * as path from 'path';
import type { Config } from './types';
import { config as rootConfig } from '../llm-whip.config';
import { showHelp } from './cli-help';
import { FileWatcher } from './file-watcher';
import { InitCommand } from './init-command';
import { AuditCommand } from './audit-command';


async function findConfigFile(): Promise<string | undefined> {
  const possibleConfigs = [
    'llm-whip.config.json',
    'llm-whip.config.js',
    'llm-whip.config.ts'
  ];

  for (const configFile of possibleConfigs) {
    try {
      await fs.promises.access(path.join(process.cwd(), configFile));
      return configFile;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function loadConfig(configPath: string): Promise<Config | null> {
  try {
    if (configPath.endsWith('.json')) {
      // For JSON files, use fs.readFile
      const content = await fs.promises.readFile(path.resolve(configPath), 'utf-8');
      const configData = JSON.parse(content);
      return configData;
    } else if (configPath.endsWith('.js')) {
      // For JS files, use dynamic import
      const configModule = await import(path.resolve(configPath));
      return configModule.config || configModule.default;
    } else {
      console.warn(`Unsupported config file type: ${configPath}. Please use JSON (.json) or JavaScript (.js) files.`);
      return null;
    }
  } catch (error) {
    console.warn(`Failed to load config ${configPath}:`, error);
    return null;
  }
}

// CLI entry point - always run when this file is executed
const args = process.argv.slice(2);

async function main() {
    if (args[0] === 'init') {
      // Initialize configuration
      const targetDir = args[1] || process.cwd();
      await InitCommand.run(targetDir);
      return;
    }

    if (args[0] === 'audit') {
      // Audit directories for existing patterns
      const auditArgs = args.slice(1);
      const configPath = auditArgs.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      const format = auditArgs.find(arg => arg.startsWith('--format='))?.split('=')[1] as 'table' | 'json' | 'csv' || 'table';
      const directories = auditArgs.filter(arg => !arg.startsWith('--'));
      
      if (directories.length === 0) {
        directories.push(process.cwd()); // Default to current directory
      }
      
      await AuditCommand.run(directories, configPath, format);
      return;
    }
    
    // Check for different modes
    if (args[0] === 'watch') {
      // File watch only mode
      const watchArgs = args.slice(1);
      const configPath = watchArgs.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      const grepFlag = watchArgs.find(arg => arg.startsWith('--grep='));
      const grepPatterns = grepFlag ? grepFlag.split('=')[1]?.split(',') || [] : [];
      const keyboardEnabled = watchArgs.includes('--interrupt');
      const directories = watchArgs.filter(arg => !arg.startsWith('--'));
      
      if (directories.length === 0) {
        console.error('Usage: llm-whip watch [directories...] [--config=path] [--grep=pattern1,pattern2]');
        console.error('Example: llm-whip watch ./src ./lib --config=config.ts --grep="TODO,FIXME"');
        process.exit(1);
      }
      
      let config: Config = rootConfig;
      
      if (configPath) {
        try {
          // Try TypeScript config first
          const customConfig = await loadConfig(configPath);
          if (customConfig) {
            config = { ...config, ...customConfig };
          } else {
            console.error('Config file must be a TypeScript (.ts) or JavaScript (.js) file');
            process.exit(1);
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('Failed to load config:', errorMessage);
          process.exit(1);
        }
      }
      
      // Add keyboard interrupt capability if requested
      if (keyboardEnabled) {
        // Check and request permissions first
        const { PermissionManager } = await import('./permission-manager');
        const hasPermission = await PermissionManager.checkAndRequestKeyboardPermissions();
        
        if (hasPermission) {
          config.reactions = {
            ...config.reactions,
            interrupt: { delay: 500 }
          };
        } else {
          console.error('❌ Keyboard interrupts require accessibility permissions. Disabling interrupt feature.');
          console.log('💡 Grant permissions in: System Preferences > Security & Privacy > Privacy > Accessibility');
          // Continue without interrupts
        }
      }
      
      const watcher = new FileWatcher({ config, directories, grepPatterns });
      watcher.start();
      
      // Handle exit
      process.on('SIGINT', () => {
        console.log('\nStopping file watcher...');
        watcher.stop();
        process.exit(0);
      });
    } else {
      // Default: Watch mode
      if (args.includes('--help') || args.includes('-h')) {
        showHelp();
        process.exit(0);
      }
      
      // Get directories (default to current directory if none provided)
      const directories = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'));
      if (directories.length === 0) {
        directories.push(process.cwd()); // Default to current directory
      }
      
      const configPath = args.find(arg => arg.startsWith('--config='))?.split('=')[1] || await findConfigFile();
      const grepFlag = args.find(arg => arg.startsWith('--grep='));
      const grepPatterns = grepFlag ? grepFlag.split('=')[1]?.split(',') || [] : [];
      const keyboardEnabled = args.includes('--interrupt');
      
      let config: Config = rootConfig;
      
      if (configPath) {
        try {
          const customConfig = await loadConfig(configPath);
          if (customConfig) {
            config = { ...config, ...customConfig };
          }
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          console.error('Failed to load config:', errorMessage);
          process.exit(1);
        }
      }
      
      // Add keyboard interrupt capability if requested
      if (keyboardEnabled) {
        // Check and request permissions first
        const { PermissionManager } = await import('./permission-manager');
        const hasPermission = await PermissionManager.checkAndRequestKeyboardPermissions();
        
        if (hasPermission) {
          config.reactions = {
            ...config.reactions,
            interrupt: { delay: 500 }
          };
        } else {
          console.error('❌ Keyboard interrupts require accessibility permissions. Disabling interrupt feature.');
          console.log('💡 Grant permissions in: System Preferences > Security & Privacy > Privacy > Accessibility');
          // Continue without interrupts
        }
      }
      
      const watcher = new FileWatcher({ config, directories, grepPatterns });
      watcher.start();
      
      // Handle exit
      process.on('SIGINT', () => {
        console.log('\nStopping file watcher...');
        watcher.stop();
        process.exit(0);
      });
    }
  }

main().catch(console.error);