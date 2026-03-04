import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type InboxCheckResult = {
  success: boolean;
  output: string;
  error?: string;
};

export async function checkInbox(
  account: string,
  maxResults: number = 20,
): Promise<InboxCheckResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "gog",
      [
        "gmail",
        "messages",
        "search",
        "is:unread newer_than:2h",
        "--account",
        account,
        "--max",
        String(maxResults),
      ],
      { timeout: 30_000 },
    );

    return {
      success: true,
      output: stdout.trim(),
      error: stderr.trim() || undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error: message };
  }
}
