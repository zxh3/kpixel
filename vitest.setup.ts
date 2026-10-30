import * as fc from "fast-check";

// Property tests run fast-check's default 100 cases. Set FAST_CHECK_NUM_RUNS to soak them,
// and lift the per-test timeout: `FAST_CHECK_NUM_RUNS=2000 pnpm test --testTimeout=0`.
const numRuns = Number(process.env.FAST_CHECK_NUM_RUNS);
if (Number.isInteger(numRuns) && numRuns > 0) {
  fc.configureGlobal({ numRuns });
}
