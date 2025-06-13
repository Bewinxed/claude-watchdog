import { exec } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export class PermissionManager {
  private static configDir = join(homedir(), ".llm-whip");
  private static permissionFile = join(this.configDir, "permissions.json");

  static async hasKeyboardPermission(): Promise<boolean> {
    if (process.platform !== "darwin") {
      return true; // Non-macOS platforms don't need special permission
    }

    try {
      // Test if we can send a keystroke
      await execAsync(
        'osascript -e "tell application \\"System Events\\" to keystroke \\"\\""',
      );
      return true;
    } catch {
      return false;
    }
  }

  static async requestKeyboardPermission(): Promise<boolean> {
    if (process.platform !== "darwin") {
      return true;
    }

    console.log("🔐 Requesting accessibility permissions...");
    console.log("💡 You may see a system dialog asking for permission.");

    try {
      // This will trigger the permission dialog if not already granted
      await execAsync(
        'osascript -e "tell application \\"System Events\\" to keystroke \\"\\""',
      );
      console.log("✅ Accessibility permissions granted!");
      return true;
    } catch (error) {
      console.log("❌ Failed to get accessibility permissions.");
      console.log("💡 You can grant permissions manually in:");
      console.log(
        "   System Preferences > Security & Privacy > Privacy > Accessibility",
      );
      return false;
    }
  }

  static async getStoredPermissionChoice(): Promise<boolean | null> {
    try {
      const content = await readFile(PermissionManager.permissionFile, "utf-8");
      const config = JSON.parse(content);
      return config.keyboardInterrupts ?? null;
    } catch {
      return null; // File doesn't exist or invalid
    }
  }

  static async storePermissionChoice(enabled: boolean): Promise<void> {
    try {
      await PermissionManager.ensureConfigDir();
      const config = { keyboardInterrupts: enabled, timestamp: Date.now() };
      await writeFile(
        PermissionManager.permissionFile,
        JSON.stringify(config, null, 2),
      );
    } catch (error) {
      console.warn("Failed to store permission choice:", error);
    }
  }

  private static async ensureConfigDir(): Promise<void> {
    const { mkdir } = require("node:fs/promises");
    try {
      await mkdir(PermissionManager.configDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    }
  }

  static async promptForKeyboardPermission(): Promise<boolean> {
    // Check if user has already made a choice
    const storedChoice = await PermissionManager.getStoredPermissionChoice();
    if (storedChoice !== null) {
      return storedChoice;
    }

    console.log("\n🔐 LLM Whip - Keyboard Interrupt Setup");
    console.log("=".repeat(50));
    console.log(
      "\nThe watchdog can send keyboard interrupts to LLM tools when",
    );
    console.log("anti-cheat patterns are detected. This helps you catch");
    console.log("lazy coding in real-time by sending warnings directly");
    console.log("to the active window.");
    console.log("\n⚠️  This requires accessibility permissions to send");
    console.log("   keystrokes to other applications.");
    console.log("\n🔒 Your security: Only LLM Whip will have this");
    console.log("   permission, and it only sends predefined warning");
    console.log("   messages when anti-patterns are detected.");

    const response = await PermissionManager.promptUser(
      "\nEnable keyboard interrupts? (y/n): ",
    );

    const enabled = response.toLowerCase().startsWith("y");

    if (enabled) {
      console.log("\n✅ Keyboard interrupts enabled!");
      const hasPermission = await PermissionManager.requestKeyboardPermission();
      if (!hasPermission) {
        console.log(
          "\n⚠️  Keyboard interrupts will be disabled until permissions are granted.",
        );
        await PermissionManager.storePermissionChoice(false);
        return false;
      }
    } else {
      console.log("\n❌ Keyboard interrupts disabled.");
      console.log("💡 You can still get sound and console alerts.");
    }

    await PermissionManager.storePermissionChoice(enabled);
    return enabled;
  }

  private static promptUser(question: string): Promise<string> {
    return new Promise((resolve) => {
      process.stdout.write(question);
      process.stdin.once("data", (data) => {
        resolve(data.toString().trim());
      });
    });
  }
}
