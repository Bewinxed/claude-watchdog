import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class KeyboardController {
  private static isOSXBuildAvailable = false;

  static async init() {
    try {
      // Check if we can use osascript for keyboard control
      await execAsync("which osascript");
      KeyboardController.isOSXBuildAvailable = true;
    } catch {
      KeyboardController.isOSXBuildAvailable = false;
    }
  }

  static async sendKeysToActiveWindow(keys: string): Promise<boolean> {
    try {
      if (process.platform === "darwin") {
        return await KeyboardController.sendKeysOSX(keys);
      }
      if (process.platform === "linux") {
        return await KeyboardController.sendKeysLinux(keys);
      }
      if (process.platform === "win32") {
        return await KeyboardController.sendKeysWindows(keys);
      }
      return false;
    } catch (error) {
      console.error("Failed to send keys:", error);
      return false;
    }
  }

  private static async sendKeysOSX(keys: string): Promise<boolean> {
    if (!KeyboardController.isOSXBuildAvailable) return false;

    // Escape the text for AppleScript (escape quotes and backslashes)
    const escapedKeys = keys.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // Send the keys to the active window
    const script = `
      tell application "System Events"
        keystroke "${escapedKeys}"
      end tell
    `;

    await execAsync(`osascript -e '${script}'`);
    return true;
  }

  private static async sendKeysLinux(keys: string): Promise<boolean> {
    try {
      // Try xdotool first
      await execAsync("which xdotool");
      await execAsync(`xdotool type "${keys}"`);
      return true;
    } catch {
      try {
        // Try ydotool as fallback
        await execAsync("which ydotool");
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


  static async sendMessageSequence(
    message: string,
    location: string,
    patternType?: string,
    interruptConfig?: boolean | { delay?: number; sequence?: string[] },
  ): Promise<boolean> {
    try {
      if (process.platform === "darwin") {
        const timestamp = new Date().toLocaleTimeString();
        const cleanMessage = message.replace(/[\n\r"'\\]/g, ' ').trim();
        
        // Create a concise warning message to type
        const typedMessage = `🚨 Anti-cheat detected: ${patternType} in ${location} - ${cleanMessage}`;
        
        // Get configuration or use defaults
        const config = typeof interruptConfig === 'object' ? interruptConfig : {};
        const delay = config.delay || 100;
        const sequence = config.sequence || ['\\u001b', '{message}', '\\n']; // ESC + message + Enter
        
        // Send the keyboard sequence
        for (const step of sequence) {
          if (step === '{message}') {
            await KeyboardController.sendKeysToActiveWindow(typedMessage);
          } else if (step === '\\u001b') {
            // Send ESC key using key code
            await KeyboardController.sendEscapeKey();
          } else if (step === '\\n') {
            // Send Enter key using key code
            await KeyboardController.sendEnterKey();
          } else {
            await KeyboardController.sendKeysToActiveWindow(step);
          }
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        
        // Also show notification
        const notificationTitle = "🚨 LLM Whip - Anti-Cheat Detected";
        const notificationMessage = `[${timestamp}] ${patternType}: ${cleanMessage} (${location})`;
        await KeyboardController.sendNotification(notificationTitle, notificationMessage);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("Failed to send message sequence:", error);
      return false;
    }
  }

  static async sendEscapeKey(): Promise<boolean> {
    try {
      if (process.platform === "darwin") {
        const script = `
          tell application "System Events"
            key code 53
          end tell
        `;
        await execAsync(`osascript -e '${script}'`);
        return true;
      }
      // Add Linux/Windows support if needed
      return false;
    } catch (error) {
      console.error("Failed to send ESC key:", error);
      return false;
    }
  }

  static async sendEnterKey(): Promise<boolean> {
    try {
      if (process.platform === "darwin") {
        const script = `
          tell application "System Events"
            key code 36
          end tell
        `;
        await execAsync(`osascript -e '${script}'`);
        return true;
      }
      // Add Linux/Windows support if needed
      return false;
    } catch (error) {
      console.error("Failed to send Enter key:", error);
      return false;
    }
  }

  static async sendNotification(
    title: string,
    message: string,
  ): Promise<boolean> {
    try {
      if (process.platform === "darwin") {
        const script = `display notification "${message}" with title "${title}" sound name "Basso"`;
        await execAsync(`osascript -e '${script}'`);
        return true;
      }
      if (process.platform === "linux") {
        await execAsync(`notify-send "${title}" "${message}"`);
        return true;
      }
      if (process.platform === "win32") {
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
      console.error("Failed to send notification:", error);
      return false;
    }
  }
}
