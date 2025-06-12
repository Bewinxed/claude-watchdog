// Test setup file for Bun tests
import { beforeAll, afterAll } from "bun:test";

beforeAll(() => {
  // Suppress console output during tests unless explicitly testing it
  if (process.env.NODE_ENV === 'test' && !process.env.SHOW_TEST_OUTPUT) {
    global.console = {
      ...console,
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
    };
  }
});

afterAll(() => {
  // Restore console
  if (process.env.NODE_ENV === 'test' && !process.env.SHOW_TEST_OUTPUT) {
    global.console = console;
  }
});