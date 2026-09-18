import type { Command } from "@/command"
import REVIEW from "./review.txt"

type ReviewCommand = "review" // kilocode_change - offline: local ReviewCommand type replaces the kilo-telemetry import (keep-deleted)

const legacy = {
  "local-review": {
    description: "deprecated; use /review branch",
    message: "/local-review is deprecated and no longer runs a review. Use /review branch instead.",
  },
  "local-review-uncommitted": {
    description: "deprecated; use /review uncommitted",
    message: "/local-review-uncommitted is deprecated and no longer runs a review. Use /review uncommitted instead.",
  },
}

export function isReviewCommand(command: string | undefined): command is ReviewCommand {
  return command === "review"
}

export function reviewCommandName(command: string | undefined): ReviewCommand | undefined {
  if (isReviewCommand(command)) return command
}

export function parseReviewCommand(prompt: string | undefined): ReviewCommand | undefined {
  if (!prompt?.startsWith("/")) return
  const name = prompt.slice(1).split(/\s/, 1)[0]
  return reviewCommandName(name)
}

export function reviewCommand(): Command.Info {
  return {
    name: "review",
    description: "review changes [uncommitted|staged|unpushed|branch|commit|pr]",
    template: REVIEW,
    hints: ["$ARGUMENTS"],
  }
}
