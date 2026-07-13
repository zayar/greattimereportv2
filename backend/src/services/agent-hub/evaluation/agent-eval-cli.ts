process.env.APICORE_GRAPHQL_URL ??= "https://agent-evaluation.invalid/graphql";

const { runAgentEvaluations } = await import("./run-agent-evals.js");

try {
  const report = await runAgentEvaluations({ semantic: process.argv.includes("--semantic") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passedThreshold) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
