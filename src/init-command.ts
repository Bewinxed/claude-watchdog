import { writeFile, access } from 'fs/promises';
import { join } from 'path';

export class InitCommand {
  static async run(targetDir: string = process.cwd()): Promise<void> {
    const configPath = join(targetDir, 'llm-whip.config.ts');
    
    try {
      // Check if config already exists
      await access(configPath);
      console.log('⚠️  Configuration file already exists at:', configPath);
      
      const response = await this.promptUser('Overwrite existing config? (y/n): ');
      if (!response.toLowerCase().startsWith('y')) {
        console.log('❌ Configuration not created.');
        return;
      }
    } catch {
      // File doesn't exist, which is what we want
    }

    try {
      const configContent = `import type { Config } from './src/types';

export const config: Config = {
  patterns: [
    { name: "todo", pattern: "TODO" },
    { name: "placeholder", pattern: "placeholder|stub" },
    { name: "not-implemented", pattern: "not implemented|NotImplementedError" },
    { name: "important-thing", pattern: "The important thing is" }
  ]
};`;
      
      await writeFile(configPath, configContent);
      console.log(`✅ Created ${configPath}`);
      
    } catch (error) {
      console.error('❌ Failed to create configuration file:', error);
      process.exit(1);
    }
  }

  private static promptUser(question: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(question);
      process.stdin.once('data', (data) => {
        resolve(data.toString().trim());
      });
    });
  }
}