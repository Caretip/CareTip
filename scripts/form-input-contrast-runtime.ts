/**
 * Form value vs placeholder contrast (typed text vs example hints).
 * Run: npm run test:form-input-contrast
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

/** `text-input` as a Tailwind color class (not `border-input` / comments). */
function hasTextInputColorClass(src: string): boolean {
  return /(?:^|[\s"'`])text-input(?:[\s"'`]|$)/m.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));
}

const inputApp = read("src/app/components/ui/input.tsx");
const inputLib = read("src/components/ui/input.tsx");
const textarea = read("src/app/components/ui/textarea.tsx");
const theme = read("src/styles/theme.css");
const typeTokens = read("src/lib/typography/caretipType.ts");
const typeCss = read("src/styles/caretip-typography.css");
const command = read("src/app/components/ui/command.tsx");
const select = read("src/app/components/ui/select.tsx");

if (typeCss.includes("@utility text-type-input") && !typeCss.includes("@utility text-input {")) {
  pass("Typography input size utility is text-type-input (no collision with color text-input)");
} else {
  fail("caretip-typography.css must define text-type-input and not @utility text-input");
}

for (const [name, src] of [
  ["app Input", inputApp],
  ["lib Input", inputLib],
  ["Textarea", textarea],
] as const) {
  if (src.includes("text-type-input") && src.includes("text-foreground") && !hasTextInputColorClass(src)) {
    pass(`${name} uses text-type-input + text-foreground (not color text-input)`);
  } else {
    fail(`${name} typed-value classes drifted`);
  }
  if (src.includes("placeholder:font-normal") && src.includes("placeholder:text-muted-foreground/70")) {
    pass(`${name} placeholder is muted (font-normal, muted-foreground/70)`);
  } else {
    fail(`${name} placeholder must stay secondary to typed values`);
  }
  if (src.includes("disabled:text-foreground/75")) {
    pass(`${name} disabled text stays muted only when disabled`);
  } else {
    fail(`${name} missing disabled text treatment`);
  }
}

if (
  typeTokens.includes('text-type-input') &&
  typeTokens.includes("text-foreground") &&
  !hasTextInputColorClass(typeTokens)
) {
  pass("caretipType.input uses size token + foreground color");
} else {
  fail("caretipType.input drifted");
}

if (
  theme.includes("text-type-input") &&
  theme.includes("color: hsl(var(--foreground))") &&
  theme.includes("font-weight: 400") &&
  theme.includes("hsl(var(--muted-foreground) / 0.62)")
) {
  pass("Global input/textarea/select: typed color foreground, placeholder muted");
} else {
  fail("theme.css form contrast rules drifted");
}

if (theme.includes("input:disabled") && theme.includes("hsl(var(--foreground) / 0.75)")) {
  pass("Global disabled inputs are muted, not treated as placeholders");
} else {
  fail("theme.css disabled input color drifted");
}

if (command.includes("placeholder:text-muted-foreground/70") && command.includes("text-foreground")) {
  pass("Command search input distinguishes value vs placeholder");
} else {
  fail("command.tsx placeholder/value contrast drifted");
}

if (
  select.includes("text-foreground") &&
  select.includes("data-[placeholder]:text-muted-foreground/70")
) {
  pass("Select selected value is foreground; placeholder is muted");
} else {
  fail("select.tsx placeholder/value contrast drifted");
}

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} form-contrast check(s) failed`);
  process.exit(1);
}
console.log("\nAll form-input-contrast checks passed");
