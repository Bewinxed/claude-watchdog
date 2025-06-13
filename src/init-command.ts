import { writeFile, access, readFile } from 'fs/promises';
import { join } from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { config as defaultConfig } from '../llm-whip.config';

export class InitCommand {
  static async run(targetDir: string = process.cwd()): Promise<void> {
    const configPath = join(targetDir, 'llm-whip.config.json');
    
    console.log();
    p.intro(color.bgBlue(color.white(' LLM Whip Init ')));
    
    try {
      // Check if config already exists
      await access(configPath);
      
      const shouldOverwrite = await p.confirm({
        message: `Configuration file already exists at ${color.cyan(configPath)}. Overwrite?`,
        initialValue: false
      });
      
      if (!shouldOverwrite) {
        p.cancel('Configuration not created.');
        return;
      }
    } catch {
      // File doesn't exist, which is what we want
    }

    try {
      // Generate JSON config from default config
      const configJson = {
        "$schema": "./node_modules/llm-whip/schema.json",
        patterns: defaultConfig.patterns
      };

      const configContent = JSON.stringify(configJson, null, 2);
      
      await writeFile(configPath, configContent);
      
      p.outro(color.green(`✅ Created ${configPath}`));
      
    } catch (error) {
      p.cancel(`Failed to create configuration file: ${error}`);
      process.exit(1);
    }
  }

}