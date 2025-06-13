import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class KeyboardController {
  private static isOSXBuildAvailable = false;

  static async init() {
    try {
      // Check if we can use osascript for keyboard control
      await execAsync('which osascript');
      this.isOSXBuildAvailable = true;
    } catch {
      this.isOSXBuildAvailable = false;
    }
  }

  static async sendKeysToActiveWindow(keys: string): Promise<boolean> {
    try {
      if (process.platform === 'darwin') {
        return await this.sendKeysOSX(keys);
      } else if (process.platform === 'linux') {
        return await this.sendKeysLinux(keys);
      } else if (process.platform === 'win32') {
        return await this.sendKeysWindows(keys);
      }
      return false;
    } catch (error) {
      console.error('Failed to send keys:', error);
      return false;
    }
  }

  private static async sendKeysOSX(keys: string): Promise<boolean> {
    if (!this.isOSXBuildAvailable) return false;

    // Focus LLM window first
    await this.focusLLMWindow();
    
    // Send the keys
    const script = `
      tell application "System Events"
        keystroke "${keys}"
      end tell
    `;
    
    await execAsync(`osascript -e '${script}'`);
    return true;
  }

  private static async sendKeysLinux(keys: string): Promise<boolean> {
    try {
      // Try xdotool first
      await execAsync(`which xdotool`);
      await execAsync(`xdotool type "${keys}"`);
      return true;
    } catch {
      try {
        // Try ydotool as fallback
        await execAsync(`which ydotool`);
        await execAsync(`ydotool type "${keys}"`);
        return true;
      } catch {
        return false;
      }
    }
  }

  private static async sendKeysWindows(keys: string): Promise<boolean> {
    // Windows PowerShell SendKeys
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait("${keys}")
    `;
    
    await execAsync(`powershell -Command "${script}"`);
    return true;
  }

  static async focusLLMWindow(): Promise<boolean> {
    try {
      if (process.platform === 'darwin') {
        // Try to focus LLM tools or Terminal running LLM
        const focusScript = `
          tell application "System Events"
            set llmApps to (every process whose name contains "claude" or name contains "Claude" or name contains "Terminal" or name contains "iTerm" or name contains "Code" or name contains "cursor")
            if length of llmApps > 0 then
              set frontmost of item 1 of llmApps to true
              return true
            end if
          end tell
        `;
        
        await execAsync(`osascript -e '${focusScript}'`);
        return true;
      }
      // Add Linux/Windows focus logic if needed
      return true;
    } catch (error) {
      console.error('Failed to focus LLM window:', error);
      return false;
    }
  }

  static async sendInterruptSequence(message: string, location: string, patternType?: string, lineContent?: string): Promise<boolean> {
    try {
      // Send Escape first to ensure we're not in any mode
      await this.sendKeysToActiveWindow('\u001B'); // ESC
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Send Ctrl+C to interrupt
      await this.sendKeysToActiveWindow('\u0003'); // Ctrl+C  
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Create detailed warning message
      const timestamp = new Date().toLocaleTimeString();
      const fullMessage = `
🚨 ANTI-CHEAT PATTERN DETECTED [${timestamp}]

Pattern: ${patternType || 'Unknown'}
File: ${location}
${lineContent ? `Code: ${lineContent.trim()}` : ''}

${message}

Please implement the code properly instead of using shortcuts or placeholders.
LLM Whip detected this pattern and interrupted to ensure code quality.

`;
      
      await this.sendKeysToActiveWindow(fullMessage);
      
      return true;
    } catch (error) {
      console.error('Failed to send interrupt sequence:', error);
      return false;
    }
  }

  static async sendNotification(title: string, message: string): Promise<boolean> {
    try {
      if (process.platform === 'darwin') {
        const script = `display notification "${message}" with title "${title}" sound name "Basso"`;
        await execAsync(`osascript -e '${script}'`);
        return true;
      } else if (process.platform === 'linux') {
        await execAsync(`notify-send "${title}" "${message}"`);
        return true;
      } else if (process.platform === 'win32') {
        // Windows toast notification
        const script = `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.MessageBox]::Show("${message}", "${title}")
        `;
        await execAsync(`powershell -Command "${script}"`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to send notification:', error);
      return false;
    }
  }
}