import { describe, expect, it } from "vitest";
import { commandPlaceholderError } from "./commandPlaceholders";

describe("illustrative command placeholders", () => {
  it.each([
    "apt download <package>", "sudo apt install <package-name>",
    "cp <path/to/file> destination", "kubectl --context=<context> get pods",
    "echo ready && apt download <package>", "<command>",
    "printf '%s' real; apt download <package>",
  ])("requires an example argument to be replaced: %s", (command) => {
    expect(commandPlaceholderError(command)).toMatch(/Replace example placeholder .* before running/);
    expect(commandPlaceholderError(command)).toContain("{{package}}");
  });

  it.each([
    "apt download curl", "pnpm lint && pnpm test", "apt download {{package}}",
    "cat < input.txt > output.txt", "cat <input.txt", "cat<>file", "cat 0<input.txt 1>output.txt",
    "printf '<package>'", 'printf "<package>"', "printf \\<package\\>",
    "printf '<path/to/file>'", "printf 'it\\s <package>'", "echo literal#<package>",
    "echo ready # replace <package> later", "# apt download <package>",
    '[[ "$a" < "$b" ]]', '[[ "$a" > "$b" ]]', "(( a < b && b > c ))", "((a<b>c))",
    "(( a <b> c ))", "echo $(( a <b> c ))", "[[ a <b> c ]]",
    "printf '%s' file<extension>suffix", "cat <<EOF", "cat <<<word", "cat <(printf input)",
  ])("leaves literals, inputs, redirection and comparisons alone: %s", (command) => {
    expect(commandPlaceholderError(command)).toBeNull();
  });

  it("continues past quoted examples and comments to subsequent real arguments", () => {
    expect(commandPlaceholderError("printf '<literal>' <package>")).toContain("<package>");
    expect(commandPlaceholderError("# replace <comment>\napt download <package>")).toContain("<package>");
    expect(commandPlaceholderError("(( a <b> c )); apt download <package>")).toContain("<package>");
  });
});
