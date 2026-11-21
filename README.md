# makefun-csv-reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/davidkiwil271-maker/makefun-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/davidkiwil271-maker/makefun-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A single-pass CSV reader that answers exactly as csv-reader 1.0.0 does on every input — same columns, rows and errors, in the same order — while scanning each field to its next delimiter and slicing it out whole instead of building it character by character. Quoted fields locate their closing quote with indexOf (skipping doubled pairs); piecewise assembly runs only where the semantics force it: stray CRs, doubled quotes, line breaks inside quotes, junk after a closing quote, and the unquoted re-read after an unterminated quote. Verified byte-identical to the reference on the practice set and on tens of thousands of fuzzed edge cases, and several times faster in CPU time.

## Run it

```sh
node main.ts
```

The make.fun harness runs `node /bot/main.ts`, reading the case set from `MAKEFUN_INPUT_DIR` and writing answers to `MAKEFUN_OUTPUT_DIR`. `solve.js` is the reader: its `run(input)` returns csv-reader's answer for `{text, header}`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x0gs0vn1&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
