import { writeFile, access } from 'fs/promises';
import { join } from 'path';
import { generateConfigFile } from './config';

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
      const configContent = generateConfigFile();
      await writeFile(configPath, configContent);
      
      console.log('\n✅ LLM Whip configuration created!');
      console.log('📁 Location:', configPath);
      console.log('\n📝 What was created:');
      console.log('   • TypeScript configuration file with full type safety');
      console.log('   • 9 pre-configured anti-cheat patterns');
      console.log('   • Detailed comments explaining each setting');
      console.log('   • Platform-specific sound commands');
      console.log('   • Customizable reactions and debouncing');
      
      console.log('\n🔧 Next steps:');
      console.log('   1. Review and customize the patterns in:', configPath);
      console.log('   2. Run: bun run llm-whip.ts --config=llm-whip.config.ts');
      console.log('   3. Or just: bun run llm-whip.ts (auto-detects config)');
      
      console.log('\n💡 Pro tips:');
      console.log('   • Add custom patterns for your specific coding style');
      console.log('   • Adjust severity levels and reactions per pattern');
      console.log('   • Use different configs for different projects');
      
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